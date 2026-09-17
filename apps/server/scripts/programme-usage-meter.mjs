import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  PROGRAMME_DOCUMENT,
  buildContainers,
  generateProgrammeModules,
  parseDeliveryPlan,
  replaceUsageBlock,
  repositoryRoot,
  validateDeliveryPlan,
} from './programme-containers.mjs'
import {
  buildDetail,
  claudeActivity,
  claudeActivityCandidate,
  claudeRequestExtras,
  codexActivity,
  codexActivityCandidate,
  codexRequestExtras,
  maxExtras,
  toolNameIndex,
} from '../../../plugins/zuri-harness/lib/detail.mjs'

// @req FR-217 — the programme usage meter: real tokens and active time per work
//   lane, measured from the Claude Code and Codex session logs on the operator's
//   machine, each billed request counted once, attributed only by a branch a lane
//   declares, and written back into the programme document with provenance.
// @req FR-239 — and its usage detail (thinking tokens, cache lifetimes, web search and
//   fetch, tool calls with errors and denials, prompts, compactions, API errors,
//   models) per lane, by the rules the Zuri harness plugin shares (lib/detail.mjs).
// @spec ADR-086 D3, D4, D7
// @tested tests/unit/programme-usage-meter.test.js
//
// Usage: node scripts/programme-usage-meter.mjs [--write] [--claude-dir <dir>] [--codex-dir <dir>]
// Without --write it only prints what it measured and what it could not attribute.

export const METER = 'scripts/programme-usage-meter.mjs'
const UNATTRIBUTABLE = new Set(['main', 'master', 'HEAD', ''])

const zeroTokens = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
const used = (t) => t.input + t.cacheWrite + t.output

/** A Claude Code or Codex working directory inside a zuri-ai checkout (primary, worktree or sibling lane). */
export function isRepositoryDirectory(cwd) {
  return typeof cwd === 'string' && /[\\/]zuri-ai(?:-[a-z0-9-]+)?(?:[\\/]|$)/i.test(cwd)
}

/**
 * One Claude Code JSONL line → one request observation, or null. A request is
 * written once per content block with the same `requestId`; the caller keeps the
 * largest count per field so a block written mid-stream never under-counts.
 */
export function parseClaudeLine(line) {
  if (!line.includes('"usage"')) return null
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return null
  }
  return claudeRequestFromEntry(entry)
}

/** One line → its request observation and its activity events, parsed once (FR-239). */
export function parseClaudeEntry(line) {
  const wantsUsage = line.includes('"usage"')
  const wantsActivity = claudeActivityCandidate(line)
  if (!wantsUsage && !wantsActivity) return { request: null, events: [] }
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    return { request: null, events: [] }
  }
  const inRepository = isRepositoryDirectory(entry?.cwd)
  return {
    request: wantsUsage ? claudeRequestFromEntry(entry) : null,
    events: wantsActivity ? claudeActivity(entry).map((e) => ({ ...e, inRepository })) : [],
  }
}

function claudeRequestFromEntry(entry) {
  const usage = entry?.message?.usage
  if (entry?.type !== 'assistant' || !usage || !entry.requestId || !entry.sessionId || !entry.timestamp) return null
  return {
    source: 'claude-code',
    sessionId: entry.sessionId,
    requestId: entry.requestId,
    timestamp: entry.timestamp,
    branch: entry.gitBranch || '',
    inRepository: isRepositoryDirectory(entry.cwd),
    model: entry.message.model || null,
    extras: claudeRequestExtras(usage),
    tokens: {
      input: usage.input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
    },
  }
}

/**
 * A whole Codex rollout → its request observations. Codex `input_tokens`
 * includes `cached_input_tokens`, so the cached part is moved to cacheRead.
 */
export function parseCodexLines(lines) {
  let meta = null
  let model = null
  const requests = []
  for (const line of lines) {
    if (!line) continue
    const isMeta = line.includes('"session_meta"')
    const isContext = line.includes('"turn_context"')
    const isUsage = line.includes('"token_usage_record"')
    if (!isMeta && !isContext && !isUsage) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'session_meta' && !meta) meta = entry.payload
    else if (entry.type === 'turn_context' && entry.payload?.model) model = entry.payload.model
    else if (entry.type === 'token_usage_record' && entry.payload?.usage && entry.payload.response_id) {
      const u = entry.payload.usage
      const cached = u.cached_input_tokens || 0
      requests.push({
        requestId: entry.payload.response_id,
        timestamp: entry.timestamp,
        model,
        extras: codexRequestExtras(u),
        tokens: {
          input: Math.max(0, (u.input_tokens || 0) - cached),
          cacheWrite: u.cache_write_input_tokens || 0,
          cacheRead: cached,
          output: u.output_tokens || 0,
        },
      })
    }
  }
  if (!meta) return []
  const repositoryUrl = meta.git?.repository_url || ''
  const inRepository = /freshair129\/zuri\.ai(?:\.git)?$/i.test(repositoryUrl) || (!repositoryUrl && isRepositoryDirectory(meta.cwd))
  return requests.map((r) => ({
    source: 'codex',
    sessionId: meta.id,
    branch: meta.git?.branch || '',
    inRepository,
    ...r,
  }))
}

/** Collapse repeated observations of one request, keeping the largest count per field. */
export function dedupeRequests(observations) {
  const byKey = new Map()
  for (const o of observations) {
    const key = `${o.source}:${o.requestId}`
    const prior = byKey.get(key)
    if (!prior) {
      byKey.set(key, { ...o, tokens: { ...o.tokens }, extras: { ...(o.extras || {}) } })
      continue
    }
    for (const field of Object.keys(prior.tokens)) prior.tokens[field] = Math.max(prior.tokens[field], o.tokens[field])
    prior.extras = maxExtras(prior.extras, o.extras)
    if (o.timestamp < prior.timestamp) prior.timestamp = o.timestamp
  }
  return [...byKey.values()]
}

/** The Codex rule for 'inside this repository', shared by requests and activity. */
const codexInRepository = (repositoryUrl, cwd) => /freshair129\/zuri\.ai(?:\.git)?$/i.test(repositoryUrl || '') || (!repositoryUrl && isRepositoryDirectory(cwd))

/** A Codex rollout's activity events, marked in or out of this repository like its requests. */
export function parseCodexActivity(lines) {
  return codexActivity(lines).map((e) => ({ ...e, inRepository: codexInRepository(e.repositoryUrl, e.cwd) }))
}

/**
 * Requests → the usage block (ADR-086 D4). Deterministic: sorted keys, integer
 * minutes, and `measuredThrough` is the last counted request, never the clock.
 * Activity events add each lane's usage detail (FR-239, ADR-086 D7).
 */
export function measureUsage({ requests, activity = [], lanes, gapCapMinutes }) {
  const toolNames = toolNameIndex(activity)
  const laneOfBranch = new Map()
  for (const lane of lanes) for (const branch of lane.branches) laneOfBranch.set(branch, lane.id)
  const perLane = new Map()
  const unattributed = new Map()
  let measuredThrough = null
  for (const r of dedupeRequests(requests)) {
    if (!r.inRepository) continue
    const laneId = UNATTRIBUTABLE.has(r.branch) ? null : laneOfBranch.get(r.branch)
    if (!laneId) {
      const label = r.branch || '(no branch)'
      const u = unattributed.get(label) || { requests: 0, used: 0 }
      u.requests += 1
      u.used += used(r.tokens)
      unattributed.set(label, u)
      continue
    }
    const lane = perLane.get(laneId) || { requests: [], sessions: new Map() }
    lane.requests.push(r)
    const sessionKey = `${r.source}:${r.sessionId}`
    const times = lane.sessions.get(sessionKey) || []
    times.push(r.timestamp)
    lane.sessions.set(sessionKey, times)
    perLane.set(laneId, lane)
    if (!measuredThrough || r.timestamp > measuredThrough) measuredThrough = r.timestamp
  }

  const capMs = gapCapMinutes * 60_000
  const lanesOut = {}
  for (const laneId of [...perLane.keys()].sort()) {
    const { requests: rs, sessions } = perLane.get(laneId)
    const tokens = zeroTokens()
    const bySource = {}
    const models = new Set()
    let first = null
    let last = null
    for (const r of rs) {
      for (const f of Object.keys(tokens)) tokens[f] += r.tokens[f]
      const s = bySource[r.source] || { requests: 0, tokens: zeroTokens() }
      s.requests += 1
      for (const f of Object.keys(s.tokens)) s.tokens[f] += r.tokens[f]
      bySource[r.source] = s
      if (r.model) models.add(r.model)
      if (!first || r.timestamp < first) first = r.timestamp
      if (!last || r.timestamp > last) last = r.timestamp
    }
    let activeMs = 0
    for (const times of sessions.values()) {
      const sorted = times.map((t) => Date.parse(t)).sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i += 1) activeMs += Math.min(sorted[i] - sorted[i - 1], capMs)
    }
    lanesOut[laneId] = {
      requests: rs.length,
      sessions: [...sessions.keys()].sort(),
      tokens,
      bySource: Object.fromEntries(Object.keys(bySource).sort().map((k) => [k, bySource[k]])),
      models: [...models].sort(),
      firstActivityAt: first,
      lastActivityAt: last,
      activeMinutes: Math.round(activeMs / 60_000),
      detail: buildDetail({
        requests: rs,
        events: activity.filter((e) => e.inRepository && !UNATTRIBUTABLE.has(e.branch) && laneOfBranch.get(e.branch) === laneId),
        toolNames,
      }),
    }
  }
  return {
    usage: { meter: METER, measuredThrough, lanes: lanesOut },
    unattributed: [...unattributed.entries()].sort((a, b) => b[1].used - a[1].used),
  }
}

function jsonlFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(full)
      else if (name.endsWith('.jsonl')) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

async function readLines(file, onLine) {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) onLine(line)
}

export async function collectRequests({ claudeDir, codexDir, onSkip = () => {} }) {
  const requests = []
  const activity = []
  for (const file of jsonlFiles(claudeDir)) {
    try {
      await readLines(file, (line) => {
        const { request, events } = parseClaudeEntry(line)
        if (request) requests.push(request)
        if (events.length) activity.push(...events)
      })
    } catch (error) {
      onSkip(file, error)
    }
  }
  for (const file of jsonlFiles(codexDir)) {
    try {
      const lines = []
      await readLines(file, (line) => {
        if (line.includes('"turn_context"') || line.includes('"token_usage_record"') || codexActivityCandidate(line)) lines.push(line)
      })
      requests.push(...parseCodexLines(lines))
      activity.push(...parseCodexActivity(lines))
    } catch (error) {
      onSkip(file, error)
    }
  }
  return { requests, activity }
}

const argValue = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const root = repositoryRoot()
  const write = process.argv.includes('--write')
  const claudeDir = argValue('--claude-dir') || path.join(os.homedir(), '.claude', 'projects')
  const codexDir = argValue('--codex-dir') || path.join(os.homedir(), '.codex', 'sessions')
  try {
    const docPath = path.join(root, PROGRAMME_DOCUMENT)
    const markdown = readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n')
    const containers = buildContainers({ markdown, fileExists: () => true })
    const plan = validateDeliveryPlan(parseDeliveryPlan(markdown), containers)
    const skipped = []
    const { requests, activity } = await collectRequests({ claudeDir, codexDir, onSkip: (file, error) => skipped.push(`${file}: ${error.message}`) })
    const { usage, unattributed } = measureUsage({ requests, activity, lanes: plan.lanes, gapCapMinutes: plan.sizing.activeGapCapMinutes })
    console.log(`programme-usage-meter: ${requests.length} observations and ${activity.length} activity events read · measured through ${usage.measuredThrough ?? '—'}`)
    for (const [laneId, m] of Object.entries(usage.lanes)) {
      const d = m.detail
      console.log(`  ${laneId}: ${m.requests} requests · ${m.sessions.length} sessions · used ${used(m.tokens).toLocaleString()} (in ${m.tokens.input.toLocaleString()} · out ${m.tokens.output.toLocaleString()} · thinking ${d.reasoningTokens.toLocaleString()} · cache write ${m.tokens.cacheWrite.toLocaleString()} · cache read ${m.tokens.cacheRead.toLocaleString()}) · ${d.toolCalls} tool calls (${d.toolErrors} errors, ${d.toolDenials} denied) · ${d.prompts} prompts · ${d.compactions} compactions · active ${m.activeMinutes} min · ${Object.keys(m.bySource).join(', ')}`)
    }
    for (const lane of plan.lanes) if (!usage.lanes[lane.id]) console.log(`  ${lane.id}: not measured (no request on ${lane.branches.join(', ')})`)
    if (unattributed.length) {
      console.log(`  unattributed repository work (counted for no lane): ${unattributed.slice(0, 8).map(([b, u]) => `${b} ${u.requests} req/${u.used.toLocaleString()}`).join(' · ')}${unattributed.length > 8 ? ` · +${unattributed.length - 8} more` : ''}`)
    }
    if (skipped.length) console.log(`  skipped ${skipped.length} unreadable file(s)`)
    if (write) {
      writeFileSync(docPath, replaceUsageBlock(markdown, usage))
      const { drift } = generateProgrammeModules({ root })
      console.log(`  wrote ${PROGRAMME_DOCUMENT}${drift.length ? ` and ${drift.join(', ')}` : ''}`)
    }
  } catch (error) {
    console.error(`programme-usage-meter: ${error.message}`)
    process.exit(1)
  }
}
