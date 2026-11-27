import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import prisma from '../src/lib/db.js'
import { buildRedactedRequestJson, canonicalRequestSha256, parseRedactionMarker } from '../src/modules/knowledge/genesisrag17-outbox-redaction.js'
import { PENDING_MAX_AGE_DAYS, TERMINAL_TEXT_RETENTION_DAYS } from './genesisrag17-outbox-report.mjs'

// @req FR-109 — owner-run redaction of named over-bound Stage 9 outbox rows.
// @spec ADR-121 D3-D6
// @tested tests/unit/genesisrag17-outbox-redact-script.test.js

// ADR-121 initial values awaiting owner/Astra confirmation, Open question 1.
const PAGE_SIZE = 200
const DAY_MS = 24 * 60 * 60 * 1000
const ACTOR_MAX_LENGTH = 200
const REASON_MAX_LENGTH = 1000
const USAGE = 'usage: genesisrag17-outbox-redact.mjs [--apply --actor <name> --reason <text>] [--scope-tenant <id>] [--batch-id <id> ...] [--limit <n>] [--json]'

function usageError() {
  return new Error(`GENESISRAG17_OUTBOX_REDACT_USAGE — ${USAGE}`)
}

export function parseArgs(argv = []) {
  const parsed = { apply: false, actor: null, reason: null, json: false, scopeTenant: null, batchIds: [], limit: PAGE_SIZE }
  const seen = new Set()
  const singleValueFlags = new Set(['--actor', '--reason', '--scope-tenant', '--limit'])
  const takeValue = (flag, index) => {
    const value = argv[index + 1]
    if (typeof value !== 'string' || !value.length || value.startsWith('--')) throw usageError()
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--apply' || token === '--json') {
      if (seen.has(token)) throw usageError()
      seen.add(token)
      parsed[token === '--apply' ? 'apply' : 'json'] = true
      continue
    }
    if (singleValueFlags.has(token) || token === '--batch-id') {
      if (singleValueFlags.has(token) && seen.has(token)) throw usageError()
      const value = takeValue(token, index)
      index += 1
      if (token === '--batch-id') parsed.batchIds.push(value)
      else if (token === '--actor') parsed.actor = value
      else if (token === '--reason') parsed.reason = value
      else if (token === '--scope-tenant') parsed.scopeTenant = value
      else {
        if (!/^\d+$/.test(value)) throw usageError()
        const limit = Number(value)
        if (!Number.isSafeInteger(limit) || limit < 1) throw usageError()
        parsed.limit = limit
      }
      if (singleValueFlags.has(token)) seen.add(token)
      continue
    }
    throw usageError()
  }

  parsed.batchIds = [...new Set(parsed.batchIds)]
  if (parsed.apply && (!parsed.actor?.trim() || !parsed.reason?.trim()
    || parsed.actor.trim().length > ACTOR_MAX_LENGTH || parsed.reason.trim().length > REASON_MAX_LENGTH)) {
    throw usageError()
  }
  if (parsed.actor !== null) parsed.actor = parsed.actor.trim()
  if (parsed.reason !== null) parsed.reason = parsed.reason.trim()
  if (parsed.scopeTenant !== null) {
    parsed.scopeTenant = parsed.scopeTenant.trim()
    if (!parsed.scopeTenant) throw usageError()
  }
  return parsed
}

function parseRequestJson(requestJson) {
  if (typeof requestJson !== 'string') return null
  try {
    const value = JSON.parse(requestJson)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function requestTextDetails(request) {
  const members = []
  if (typeof request.source?.content === 'string') members.push(request.source.content)
  if (Array.isArray(request.chunks)) {
    for (const chunk of request.chunks) if (typeof chunk?.text === 'string') members.push(chunk.text)
  }
  if (Array.isArray(request.mentions)) {
    for (const mention of request.mentions) if (typeof mention?.name === 'string') members.push(mention.name)
  }
  return {
    hasText: members.some((member) => member.length > 0),
    textBytes: members.reduce((total, member) => total + Buffer.byteLength(member, 'utf8'), 0),
  }
}

function ageMilliseconds(value, nowMs) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? nowMs - time : null
}

function matchesTenantScope(scopeJson, tenantId) {
  if (!tenantId) return true
  if (typeof scopeJson !== 'string') return false
  try {
    const scope = JSON.parse(scopeJson)
    return Boolean(scope && typeof scope === 'object' && !Array.isArray(scope) && scope.tenantId === tenantId)
  } catch {
    return false
  }
}

function inspectRow(row, nowMs, counters) {
  const createdAge = ageMilliseconds(row.createdAt, nowMs)
  const updatedAge = ageMilliseconds(row.updatedAt, nowMs)
  if (row.status === 'PENDING' && createdAge !== null && createdAge > PENDING_MAX_AGE_DAYS * DAY_MS) {
    counters.skippedPendingOverBoundBatchIds.push(row.batchId)
  }

  const request = parseRequestJson(row.requestJson)
  if (!request) {
    counters.skippedUnreadable += 1
    counters.skippedUnreadableBatchIds.push(row.batchId)
    return null
  }

  const redaction = parseRedactionMarker(request)
  if (redaction.redacted) {
    counters.alreadyRedacted += 1
    counters.alreadyRedactedBatchIds.push(row.batchId)
    return null
  }
  if (redaction.invalid) {
    counters.skippedInvalidMarker += 1
    counters.skippedInvalidMarkerBatchIds.push(row.batchId)
    return null
  }
  if (row.status === 'PENDING') return null

  const text = requestTextDetails(request)
  if (updatedAge === null || updatedAge <= TERMINAL_TEXT_RETENTION_DAYS * DAY_MS || !text.hasText) return null
  return {
    row,
    requestJson: row.requestJson,
    details: {
      batchId: row.batchId,
      textBytes: text.textBytes,
      originalSha256: canonicalRequestSha256(row.requestJson),
    },
  }
}

function newCounters() {
  return {
    alreadyRedacted: 0,
    alreadyRedactedBatchIds: [],
    skippedPendingOverBoundBatchIds: [],
    skippedUnreadable: 0,
    skippedUnreadableBatchIds: [],
    skippedInvalidMarker: 0,
    skippedInvalidMarkerBatchIds: [],
    conflicts: 0,
    conflictBatchIds: [],
    redactedBatchIds: [],
  }
}

function makeReport({ args, nowDate, rows, counters, rowsScanned, redacted }) {
  return {
    mode: args.apply ? 'apply' : 'dry-run',
    actor: args.actor,
    reason: args.reason,
    reasonLength: args.reason?.length ?? 0,
    at: nowDate.toISOString(),
    rows,
    summary: {
      mode: args.apply ? 'apply' : 'dry-run',
      rowsScanned,
      eligible: rows.length,
      redacted,
      alreadyRedacted: counters.alreadyRedacted,
      alreadyRedactedBatchIds: counters.alreadyRedactedBatchIds,
      skippedPendingOverBound: counters.skippedPendingOverBoundBatchIds.length,
      skippedPendingOverBoundBatchIds: counters.skippedPendingOverBoundBatchIds,
      skippedUnreadable: counters.skippedUnreadable,
      skippedUnreadableBatchIds: counters.skippedUnreadableBatchIds,
      skippedInvalidMarker: counters.skippedInvalidMarker,
      skippedInvalidMarkerBatchIds: counters.skippedInvalidMarkerBatchIds,
      conflicts: counters.conflicts,
      conflictBatchIds: counters.conflictBatchIds,
      redactedBatchIds: counters.redactedBatchIds,
      thresholds: {
        terminalTextRetentionDays: TERMINAL_TEXT_RETENTION_DAYS,
        pendingMaxAgeDays: PENDING_MAX_AGE_DAYS,
      },
      ...(!args.apply ? { dryRun: 'dry run: nothing was changed' } : {}),
    },
  }
}

function humanOutput(report) {
  const lines = [
    'GenesisRAG17 outbox redaction',
    `Mode: ${report.mode}`,
    `Actor: ${report.actor ?? '(not provided)'}`,
    `Reason: ${report.reason ?? '(not provided)'}`,
    `At: ${report.at}`,
    'batchId | textBytes | originalSha256',
  ]
  for (const row of report.rows) lines.push(`${row.batchId} | ${row.textBytes} | ${row.originalSha256}`)
  lines.push(`Summary: scanned=${report.summary.rowsScanned}; eligible=${report.summary.eligible}; redacted=${report.summary.redacted}; alreadyRedacted=${report.summary.alreadyRedacted}; skippedPendingOverBound=${report.summary.skippedPendingOverBound}; skippedUnreadable=${report.summary.skippedUnreadable}; skippedInvalidMarker=${report.summary.skippedInvalidMarker}; conflicts=${report.summary.conflicts}`)
  lines.push(`Already redacted batchIds: ${JSON.stringify(report.summary.alreadyRedactedBatchIds)}`)
  lines.push(`PENDING over-bound batchIds for owner review: ${JSON.stringify(report.summary.skippedPendingOverBoundBatchIds)}`)
  lines.push(`Unreadable request batchIds: ${JSON.stringify(report.summary.skippedUnreadableBatchIds)}`)
  lines.push(`Conflicting batchIds: ${JSON.stringify(report.summary.conflictBatchIds)}`)
  lines.push(`Thresholds: terminalTextRetentionDays=${TERMINAL_TEXT_RETENTION_DAYS}; pendingMaxAgeDays=${PENDING_MAX_AGE_DAYS}`)
  if (report.mode === 'dry-run') lines.push('dry run: nothing was changed')
  return lines.join('\n')
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseArgs(argv)
  const db = dependencies.db ?? prisma
  const log = dependencies.log ?? console.log
  const injectedNow = typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now
  const nowDate = new Date(injectedNow ?? new Date())
  const nowMs = nowDate.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('GENESISRAG17_OUTBOX_REDACT_INVALID_NOW')

  const counters = newCounters()
  const eligibleRows = []
  const pageSize = Math.min(args.limit, PAGE_SIZE)
  let rowsScanned = 0
  let cursorId = null
  let redacted = 0

  while (true) {
    const query = {
      orderBy: { id: 'asc' },
      take: pageSize,
      select: {
        id: true,
        batchId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        scopeJson: true,
        requestJson: true,
      },
    }
    if (args.batchIds.length) query.where = { batchId: { in: args.batchIds } }
    if (cursorId !== null) {
      query.cursor = { id: cursorId }
      query.skip = 1
    }

    let page
    try {
      page = await db.genesisRag17Batch.findMany(query)
    } catch {
      throw new Error('GENESISRAG17_OUTBOX_REDACT_READ_FAILED')
    }
    if (!Array.isArray(page)) throw new Error('GENESISRAG17_OUTBOX_REDACT_READ_FAILED')
    if (!page.length) break

    rowsScanned += page.length
    const lastId = page[page.length - 1]?.id
    const pageCandidates = []
    for (const row of page) {
      if (!matchesTenantScope(row.scopeJson, args.scopeTenant)) continue
      const candidate = inspectRow(row, nowMs, counters)
      if (candidate) {
        eligibleRows.push(candidate.details)
        pageCandidates.push(candidate)
      }
    }

    if (args.apply && pageCandidates.length) {
      let outcomes
      try {
        outcomes = await db.$transaction(async (tx) => {
          const pageOutcomes = []
          for (const candidate of pageCandidates) {
            const redactedRequestJson = buildRedactedRequestJson(candidate.requestJson, {
              actor: args.actor,
              reason: args.reason,
              redactedAt: nowDate,
            })
            // Prisma may advance @updatedAt for updateMany; the only supplied data field is requestJson,
            // and the durable marker makes later eligibility independent of that timestamp.
            const result = await tx.genesisRag17Batch.updateMany({
              // The status/time predicates also prevent a concurrent terminal transition from
              // making an originally ineligible fresh row inherit this page's stale age check.
              where: {
                id: candidate.row.id,
                requestJson: candidate.requestJson,
                status: candidate.row.status,
                updatedAt: candidate.row.updatedAt,
              },
              data: { requestJson: redactedRequestJson },
            })
            pageOutcomes.push({ batchId: candidate.row.batchId, count: result?.count })
          }
          return pageOutcomes
        })
      } catch {
        throw new Error('GENESISRAG17_OUTBOX_REDACT_APPLY_FAILED')
      }
      for (const outcome of outcomes) {
        if (outcome.count === 1) {
          redacted += 1
          counters.redactedBatchIds.push(outcome.batchId)
        } else {
          counters.conflicts += 1
          counters.conflictBatchIds.push(outcome.batchId)
        }
      }
    }

    if (page.length < pageSize) break
    if (lastId === undefined || lastId === null || lastId === cursorId) {
      throw new Error('GENESISRAG17_OUTBOX_REDACT_PAGINATION_FAILED')
    }
    cursorId = lastId
  }

  const report = makeReport({ args, nowDate, rows: eligibleRows, counters, rowsScanned, redacted })
  log(args.json ? JSON.stringify(report, null, 2) : humanOutput(report))
  if (args.apply && counters.conflicts) {
    const error = new Error('GENESISRAG17_OUTBOX_REDACT_CONFLICTS')
    error.code = 'GENESISRAG17_OUTBOX_REDACT_CONFLICTS'
    error.report = report
    throw error
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? 'GENESISRAG17_OUTBOX_REDACT_FAILED'}\n`)
    process.exitCode = 1
  })
}
