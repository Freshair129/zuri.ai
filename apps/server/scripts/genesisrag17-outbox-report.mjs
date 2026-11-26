import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import prisma from '../src/lib/db.js'
import { GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS } from '../src/modules/knowledge/genesisrag17-response-contract.js'
import { parseRedactionMarker } from '../src/modules/knowledge/genesisrag17-outbox-redaction.js'

// @req FR-109 — report outbox rows over the ADR-121 bounds without changing them.
// @spec ADR-121
// @tested tests/unit/genesisrag17-outbox-report.test.js

// ADR-121 initial values awaiting owner/Astra confirmation, Open question 1.
export const TERMINAL_TEXT_RETENTION_DAYS = 30
export const PENDING_MAX_AGE_DAYS = 90

const PAGE_SIZE = 200
const DAY_MS = 24 * 60 * 60 * 1000
const SCOPE_FIELDS = Object.freeze([
  'portfolioId',
  'tenantId',
  'businessId',
  'workspaceId',
  'agentId',
  'visibility',
])
const RESPONSE_FIELDS = new Set(GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS)
const REPORT_REASONS = Object.freeze([
  'TEXT_PAST_TERMINAL_BOUND',
  'PENDING_PAST_BOUND',
  'REDACTED_BUT_PENDING',
  'RESPONSE_BEYOND_CONTRACT',
  'RESPONSE_UNREADABLE',
  'REQUEST_UNREADABLE',
])
const USAGE = 'usage: genesisrag17-outbox-report.mjs [--json]'

export function parseArgs(argv = []) {
  const parsed = { json: false }
  for (const token of argv) {
    if (token === '--json' && !parsed.json) {
      parsed.json = true
      continue
    }
    throw new Error(`GENESISRAG17_OUTBOX_REPORT_USAGE — ${USAGE}`)
  }
  return parsed
}

function parseJsonObject(value) {
  if (typeof value !== 'string') return { readable: false, value: null }
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { readable: false, value: null }
    return { readable: true, value: parsed }
  } catch {
    return { readable: false, value: null }
  }
}

function dateDetails(value, nowMs) {
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return { iso: null, ageMilliseconds: null, ageDays: null }
  return {
    iso: date.toISOString(),
    ageMilliseconds: nowMs - time,
    ageDays: Number(((nowMs - time) / DAY_MS).toFixed(2)),
  }
}

function scopeDetails(scopeJson) {
  const parsed = parseJsonObject(scopeJson)
  if (!parsed.readable || SCOPE_FIELDS.some((field) => typeof parsed.value[field] !== 'string')) {
    return { scope: null, scopeUnreadable: true }
  }
  const scope = {}
  for (const field of SCOPE_FIELDS) scope[field] = parsed.value[field]
  return { scope, scopeUnreadable: false }
}

function requestTextDetails(requestJson) {
  const parsed = parseJsonObject(requestJson)
  if (!parsed.readable) return { readable: false, hasText: false, textBytes: 0 }

  const members = []
  const sourceContent = parsed.value.source?.content
  if (typeof sourceContent === 'string') members.push(sourceContent)
  if (Array.isArray(parsed.value.chunks)) {
    for (const chunk of parsed.value.chunks) {
      if (typeof chunk?.text === 'string') members.push(chunk.text)
    }
  }
  if (Array.isArray(parsed.value.mentions)) {
    for (const mention of parsed.value.mentions) {
      if (typeof mention?.name === 'string') members.push(mention.name)
    }
  }

  return {
    readable: true,
    hasText: members.some((member) => member.length > 0),
    textBytes: members.reduce((total, member) => total + Buffer.byteLength(member, 'utf8'), 0),
  }
}

function responseDetails(responseJson) {
  // No reply stored yet (a PENDING row) is normal, not unreadable.
  if (responseJson === null || responseJson === undefined) return { readable: true, extraResponseKeys: [] }
  const parsed = parseJsonObject(responseJson)
  if (!parsed.readable) return { readable: false, extraResponseKeys: [] }
  return {
    readable: true,
    extraResponseKeys: Object.keys(parsed.value).filter((key) => !RESPONSE_FIELDS.has(key)),
  }
}

function inspectRow(row, nowMs) {
  const created = dateDetails(row.createdAt, nowMs)
  const updated = dateDetails(row.updatedAt, nowMs)
  const text = requestTextDetails(row.requestJson)
  const request = parseJsonObject(row.requestJson)
  const redaction = request.readable ? parseRedactionMarker(request.value) : { redacted: false }
  const response = responseDetails(row.responseJson)
  const reasons = []

  if (!redaction.redacted
    && row.status !== 'PENDING'
    && updated.ageMilliseconds !== null
    && updated.ageMilliseconds > TERMINAL_TEXT_RETENTION_DAYS * DAY_MS
    && text.hasText) {
    reasons.push('TEXT_PAST_TERMINAL_BOUND')
  }
  if (row.status === 'PENDING'
    && created.ageMilliseconds !== null
    && created.ageMilliseconds > PENDING_MAX_AGE_DAYS * DAY_MS) {
    reasons.push('PENDING_PAST_BOUND')
  }
  if (redaction.redacted && row.status === 'PENDING') reasons.push('REDACTED_BUT_PENDING')
  if (!response.readable) reasons.push('RESPONSE_UNREADABLE')
  else if (response.extraResponseKeys.length) reasons.push('RESPONSE_BEYOND_CONTRACT')
  if (!text.readable) reasons.push('REQUEST_UNREADABLE')

  if (!reasons.length) return null
  return {
    batchId: row.batchId,
    status: row.status,
    createdAt: created.iso,
    updatedAt: updated.iso,
    ageDaysSinceCreatedAt: created.ageDays,
    ageDaysSinceUpdatedAt: updated.ageDays,
    ...scopeDetails(row.scopeJson),
    reasons,
    textBytes: text.textBytes,
    extraResponseKeys: response.extraResponseKeys,
  }
}

function summarize(reported, rowsScanned, redacted) {
  const reasonCounts = Object.fromEntries(REPORT_REASONS.map((reason) => [reason, 0]))
  for (const row of reported) {
    for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
  }
  return {
    rowsScanned,
    rowsReported: reported.length,
    countPerReason: reasonCounts,
    redactedRows: redacted.length,
    redacted,
    thresholds: {
      terminalTextRetentionDays: TERMINAL_TEXT_RETENTION_DAYS,
      pendingMaxAgeDays: PENDING_MAX_AGE_DAYS,
    },
    dryRun: 'dry run: nothing was changed',
  }
}

function humanOutput(report) {
  const lines = [
    'GenesisRAG17 outbox report',
    'batchId | status | createdAt | updatedAt | ageDays(created,updated) | scope | reasons | textBytes | extraResponseKeys',
  ]
  for (const row of report.rows) {
    lines.push([
      row.batchId,
      row.status,
      row.createdAt,
      row.updatedAt,
      `${row.ageDaysSinceCreatedAt},${row.ageDaysSinceUpdatedAt}`,
      row.scopeUnreadable ? 'scope unreadable' : JSON.stringify(row.scope),
      row.reasons.join(','),
      row.textBytes,
      row.extraResponseKeys.join(','),
    ].join(' | '))
  }
  lines.push(`Summary: scanned=${report.summary.rowsScanned}; reported=${report.summary.rowsReported}; countPerReason=${JSON.stringify(report.summary.countPerReason)}`)
  lines.push(`Redacted rows: count=${report.summary.redactedRows}; records=${JSON.stringify(report.summary.redacted)}`)
  lines.push(`Thresholds: terminalTextRetentionDays=${TERMINAL_TEXT_RETENTION_DAYS}; pendingMaxAgeDays=${PENDING_MAX_AGE_DAYS}`)
  lines.push('dry run: nothing was changed')
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv)
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const injectedNow = typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now
  const nowDate = new Date(injectedNow ?? new Date())
  const nowMs = nowDate.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('GENESISRAG17_OUTBOX_REPORT_INVALID_NOW')

  const reported = []
  const redactedRows = []
  let rowsScanned = 0
  let cursorId = null

  while (true) {
    const query = {
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        batchId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        scopeJson: true,
        requestJson: true,
        responseJson: true,
      },
    }
    if (cursorId !== null) {
      query.cursor = { id: cursorId }
      query.skip = 1
    }

    let page
    try {
      page = await db.genesisRag17Batch.findMany(query)
    } catch {
      throw new Error('GENESISRAG17_OUTBOX_REPORT_READ_FAILED')
    }
    if (!Array.isArray(page)) throw new Error('GENESISRAG17_OUTBOX_REPORT_READ_FAILED')
    if (!page.length) break

    rowsScanned += page.length
    const lastId = page[page.length - 1]?.id
    for (let index = 0; index < page.length; index += 1) {
      const request = parseJsonObject(page[index].requestJson)
      const redaction = request.readable ? parseRedactionMarker(request.value) : { redacted: false }
      if (redaction.redacted) {
        redactedRows.push({
          batchId: page[index].batchId,
          redactedAt: redaction.marker.redactedAt,
          redactedBy: redaction.marker.redactedBy,
          originalSha256: redaction.marker.originalSha256,
        })
      }
      const inspected = inspectRow(page[index], nowMs)
      page[index] = null
      if (inspected) reported.push(inspected)
    }

    if (page.length < PAGE_SIZE) break
    if (lastId === undefined || lastId === null || lastId === cursorId) {
      throw new Error('GENESISRAG17_OUTBOX_REPORT_PAGINATION_FAILED')
    }
    cursorId = lastId
  }

  const report = { rows: reported, summary: summarize(reported, rowsScanned, redactedRows) }
  log(args.json ? JSON.stringify(report, null, 2) : humanOutput(report))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'GENESISRAG17_OUTBOX_REPORT_FAILED'}\n`)
    process.exitCode = 1
  })
}
