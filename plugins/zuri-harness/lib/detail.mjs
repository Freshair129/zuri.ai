// @req FR-239 — the one set of rules for agent usage detail, shared by the Zuri
//   harness plugin and the programme usage meter so the two cannot disagree:
//   thinking/reasoning tokens, cache writes by lifetime, web search and fetch,
//   tool calls by name with errors and denials, prompts, compactions, API errors
//   and requests per model. Pure; reads parsed log entries, keeps only names and
//   numbers — never prompt, response, thinking, argument or output text.
// @spec ADR-086 D7
// @tested tests/unit/zuri-harness-plugin.test.js, tests/unit/programme-usage-meter.test.js

const NAME = /^[\w.:@/-]{1,120}$/

export const DETAIL_COUNTS = [
  'reasoningTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens', 'webSearchRequests', 'webFetchRequests',
  'prompts', 'toolCalls', 'toolErrors', 'toolDenials', 'compactions', 'apiErrors',
]

export const emptyDetail = () => ({
  reasoningTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, webSearchRequests: 0, webFetchRequests: 0,
  prompts: 0, toolCalls: 0, toolErrors: 0, toolDenials: 0, compactions: 0, apiErrors: 0,
  tools: {}, models: {},
})

const safeName = (value) => (typeof value === 'string' && NAME.test(value) ? value : 'unnamed')
const nonNegative = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

/** Per-request extras from a Claude Code `message.usage`. */
export function claudeRequestExtras(usage = {}) {
  return {
    reasoning: nonNegative(usage.output_tokens_details?.thinking_tokens),
    cacheWrite5m: nonNegative(usage.cache_creation?.ephemeral_5m_input_tokens),
    cacheWrite1h: nonNegative(usage.cache_creation?.ephemeral_1h_input_tokens),
    webSearch: nonNegative(usage.server_tool_use?.web_search_requests),
    webFetch: nonNegative(usage.server_tool_use?.web_fetch_requests),
  }
}

/** Per-request extras from a Codex `token_usage_record` usage. Fields Codex does not write are 0. */
export function codexRequestExtras(usage = {}) {
  return { reasoning: nonNegative(usage.reasoning_output_tokens), cacheWrite5m: 0, cacheWrite1h: 0, webSearch: 0, webFetch: 0 }
}

/** One request written several times keeps the largest value per field, as its tokens do. */
export function maxExtras(a = {}, b = {}) {
  const out = {}
  for (const key of ['reasoning', 'cacheWrite5m', 'cacheWrite1h', 'webSearch', 'webFetch']) out[key] = Math.max(a[key] || 0, b[key] || 0)
  return out
}

const textContent = (content) =>
  typeof content === 'string' || (Array.isArray(content) && content.some((b) => b?.type === 'text') && !content.some((b) => b?.type === 'tool_result'))

/**
 * One parsed Claude Code JSONL entry → its countable events (no text). Each
 * event carries a `key` that makes it count once however often the line repeats.
 */
export function claudeActivity(entry) {
  if (!entry || typeof entry !== 'object' || !entry.sessionId) return []
  const base = { source: 'claude-code', sessionId: entry.sessionId, branch: entry.gitBranch || '', cwd: entry.cwd || null, timestamp: entry.timestamp || null }
  const events = []
  const content = entry.message?.content
  if (entry.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_use' && block.id) events.push({ ...base, type: 'tool', key: block.id, name: safeName(block.name) })
    }
  }
  if (entry.type === 'user') {
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_result' && block.tool_use_id) events.push({ ...base, type: 'result', key: block.tool_use_id, isError: block.is_error === true })
      }
    }
    if (entry.toolDenialKind && entry.uuid) events.push({ ...base, type: 'denial', key: entry.uuid })
    if (!entry.isMeta && !entry.isCompactSummary && !entry.isSidechain && entry.uuid && textContent(content)) {
      events.push({ ...base, type: 'prompt', key: entry.uuid })
    }
  }
  if (entry.type === 'system' && entry.uuid) {
    if (entry.subtype === 'compact_boundary') events.push({ ...base, type: 'compaction', key: entry.uuid })
    if (entry.subtype === 'api_error') events.push({ ...base, type: 'apiError', key: entry.uuid })
  }
  return events
}

/** Lines worth parsing for activity; a cheap pre-filter before JSON.parse. */
export const claudeActivityCandidate = (line) =>
  line.includes('"tool_use"') || line.includes('"tool_result"') || line.includes('"type":"user"') || line.includes('"type":"system"')

export const codexActivityCandidate = (line) =>
  line.includes('"session_meta"') || line.includes('"function_call"') || line.includes('"custom_tool_call"') ||
  line.includes('"local_shell_call"') || line.includes('"task_started"') || line.includes('"compacted"')

/**
 * A whole Codex rollout's lines → its countable events. The branch and session
 * come from `session_meta`, as the rollout's usage does. Codex writes no tool
 * error flag, denial or API error line, so those stay 0.
 */
export function codexActivity(lines) {
  let meta = null
  const events = []
  let ordinal = 0
  for (const line of lines) {
    ordinal += 1
    if (!line || !codexActivityCandidate(line)) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'session_meta') {
      if (!meta) meta = entry.payload
      continue
    }
    const payload = entry.payload || {}
    if (entry.type === 'response_item' && ['function_call', 'custom_tool_call', 'local_shell_call'].includes(payload.type)) {
      const key = payload.call_id || payload.id
      if (key) events.push({ type: 'tool', key, name: safeName(payload.name || payload.type), timestamp: entry.timestamp || null })
    } else if (entry.type === 'event_msg' && payload.type === 'task_started') {
      events.push({ type: 'prompt', key: payload.turn_id || `${entry.timestamp}#${ordinal}`, timestamp: entry.timestamp || null })
    } else if (entry.type === 'compacted') {
      events.push({ type: 'compaction', key: `${entry.timestamp}#${ordinal}`, timestamp: entry.timestamp || null })
    }
  }
  if (!meta) return []
  return events.map((event) => ({
    source: 'codex', sessionId: meta.id, branch: meta.git?.branch || '', cwd: meta.cwd || null, repositoryUrl: meta.git?.repository_url || '', ...event,
  }))
}

/** `source:sessionId:toolUseId` → tool name, from every tool event seen, so a result on any line finds its tool. */
export function toolNameIndex(events) {
  const index = new Map()
  for (const e of events) if (e.type === 'tool') index.set(`${e.source}:${e.sessionId}:${e.key}`, e.name)
  return index
}

/**
 * Deduped requests (each with `extras` and `model`) and activity events for one
 * group (a branch, a lane) → its detail. Every event counts once by its key.
 */
export function buildDetail({ requests = [], events = [], toolNames = toolNameIndex(events) } = {}) {
  const detail = emptyDetail()
  for (const r of requests) {
    const x = r.extras || {}
    detail.reasoningTokens += x.reasoning || 0
    detail.cacheWrite5mTokens += x.cacheWrite5m || 0
    detail.cacheWrite1hTokens += x.cacheWrite1h || 0
    detail.webSearchRequests += x.webSearch || 0
    detail.webFetchRequests += x.webFetch || 0
    if (r.model) {
      const model = safeName(r.model)
      detail.models[model] = (detail.models[model] || 0) + 1
    }
  }
  const seen = new Set()
  for (const e of events) {
    const id = `${e.type}|${e.source}:${e.sessionId}:${e.key}`
    if (seen.has(id)) continue
    seen.add(id)
    if (e.type === 'tool') {
      detail.toolCalls += 1
      const row = detail.tools[e.name] || { calls: 0, errors: 0 }
      row.calls += 1
      detail.tools[e.name] = row
    } else if (e.type === 'result' && e.isError) {
      detail.toolErrors += 1
      const name = toolNames.get(`${e.source}:${e.sessionId}:${e.key}`) || 'unnamed'
      const row = detail.tools[name] || { calls: 0, errors: 0 }
      row.errors += 1
      detail.tools[name] = row
    } else if (e.type === 'denial') detail.toolDenials += 1
    else if (e.type === 'prompt') detail.prompts += 1
    else if (e.type === 'compaction') detail.compactions += 1
    else if (e.type === 'apiError') detail.apiErrors += 1
  }
  return sortDetail(detail)
}

/** Stable key order, so a detail serialises identically however it was built. */
export function sortDetail(detail) {
  const tools = Object.fromEntries(Object.keys(detail.tools || {}).sort().map((k) => [k, { calls: detail.tools[k].calls || 0, errors: detail.tools[k].errors || 0 }]))
  const models = Object.fromEntries(Object.keys(detail.models || {}).sort().map((k) => [k, detail.models[k]]))
  const out = {}
  for (const key of DETAIL_COUNTS) out[key] = detail[key] || 0
  return { ...out, tools, models }
}

export function addDetail(into, detail) {
  if (!detail) return into
  for (const key of DETAIL_COUNTS) into[key] = (into[key] || 0) + (detail[key] || 0)
  for (const [name, row] of Object.entries(detail.tools || {})) {
    const target = into.tools[name] || { calls: 0, errors: 0 }
    target.calls += row.calls || 0
    target.errors += row.errors || 0
    into.tools[name] = target
  }
  for (const [name, count] of Object.entries(detail.models || {})) into.models[name] = (into.models[name] || 0) + count
  return into
}

export const isEmptyDetail = (detail) =>
  !detail || (DETAIL_COUNTS.every((k) => !detail[k]) && !Object.keys(detail.tools || {}).length && !Object.keys(detail.models || {}).length)
