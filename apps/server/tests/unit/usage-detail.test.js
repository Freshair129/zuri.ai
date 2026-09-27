// @req FR-239 — programme usage detail: the shared rules count thinking tokens, cache
//   lifetimes, web search and fetch, tool calls with errors and denials, prompts,
//   compactions, API errors and models once each, keep no text, validate strictly
//   at the endpoint and extend only when
//   every count grows.
// @req FR-240 — the board aggregates detail across lanes and reports and shows the
//   token split, tool calls, prompts and compactions, or says no detail exists.
// @spec ADR-086 D7; ADR-087 D5
// @tested tests/unit/usage-detail.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildDetail, claudeActivity, codexActivity, toolNameIndex } from '../../scripts/programme-usage-detail.mjs'
import { measureUsage, parseClaudeEntry, parseCodexActivity, parseCodexLines } from '../../scripts/programme-usage-meter.mjs'
import {
  ProgrammeUsageReportSchema,
  canonicalDetail,
  usageReportDigest,
} from '@/modules/platform-control/application/programme-usage-reports'
import { mergeLaneUsage, phaseDeliveryMetrics, topTools } from '@/modules/platform-control/program-delivery-metrics'
import ProgramRoadmapBoard from '@/modules/platform-control/components/ProgramRoadmapBoard'

globalThis.React = React

const CWD = 'C:\\Users\\pc\\workspace\\zuri-ai\\.claude\\worktrees\\x'
const base = { sessionId: 'sess-d', gitBranch: 'feat/detail', cwd: CWD }
const SECRET_TEXT = 'SECRET PROMPT TEXT that must never be stored'
const lines = [
  { ...base, type: 'user', uuid: 'u1', timestamp: '2026-09-14T01:00:00.000Z', message: { role: 'user', content: SECRET_TEXT } },
  { ...base, type: 'user', uuid: 'u-meta', isMeta: true, timestamp: '2026-09-14T01:00:01.000Z', message: { role: 'user', content: 'meta' } },
  {
    ...base, type: 'assistant', requestId: 'req-1', timestamp: '2026-09-14T01:00:05.000Z',
    message: {
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: SECRET_TEXT } }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 300, cache_read_input_tokens: 5000, output_tokens: 90, output_tokens_details: { thinking_tokens: 40 }, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 }, server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 } },
    },
  },
  // The same request written again for a second content block: counted once.
  {
    ...base, type: 'assistant', requestId: 'req-1', timestamp: '2026-09-14T01:00:05.500Z',
    message: {
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: 'tu-2', name: 'PowerShell', input: { command: SECRET_TEXT } }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 300, cache_read_input_tokens: 5000, output_tokens: 95, output_tokens_details: { thinking_tokens: 40 }, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 }, server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 } },
    },
  },
  { ...base, type: 'user', uuid: 'u2', timestamp: '2026-09-14T01:00:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: SECRET_TEXT }, { type: 'tool_result', tool_use_id: 'tu-2', is_error: true, content: SECRET_TEXT }] } },
  { ...base, type: 'user', uuid: 'u3', toolDenialKind: 'user_rejected', timestamp: '2026-09-14T01:00:07.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-3', is_error: true, content: 'denied' }] } },
  { ...base, type: 'system', uuid: 's1', subtype: 'compact_boundary', timestamp: '2026-09-14T01:05:00.000Z' },
  { ...base, type: 'system', uuid: 's2', subtype: 'api_error', timestamp: '2026-09-14T01:06:00.000Z' },
  { ...base, type: 'system', uuid: 's2', subtype: 'api_error', timestamp: '2026-09-14T01:06:00.000Z' },
].map((l) => JSON.stringify(l))

const expected = {
  reasoningTokens: 40, cacheWrite5mTokens: 100, cacheWrite1hTokens: 200, webSearchRequests: 1, webFetchRequests: 2,
  prompts: 1, toolCalls: 2, toolErrors: 2, toolDenials: 1, compactions: 1, apiErrors: 1,
  tools: { PowerShell: { calls: 1, errors: 1 }, Read: { calls: 1, errors: 0 }, unnamed: { calls: 0, errors: 1 } },
  models: { 'claude-opus-5': 1 },
}

describe('FR-239 detail rules', () => {
  it('counts each kind once from Claude Code lines and keeps no text', () => {
    const events = lines.flatMap((l) => claudeActivity(JSON.parse(l)))
    const requests = lines.map(parseClaudeEntry).map(({ request }) => request).filter(Boolean).slice(0, 1)
    const detail = buildDetail({ requests, events })
    expect(detail).toEqual(expected)
    expect(JSON.stringify(detail)).not.toContain('SECRET')
  })

  it('agrees field for field with the meter over the same lines', () => {
    const parsed = lines.map(parseClaudeEntry)
    const { usage } = measureUsage({
      requests: parsed.map((p) => p.request).filter(Boolean),
      activity: parsed.flatMap((p) => p.events),
      lanes: [{ id: 'LANE-D', tasks: ['TASK-ZAI-074'], branches: ['feat/detail'] }],
      gapCapMinutes: 15,
    })
    expect(usage.lanes['LANE-D'].detail).toEqual(expected)
    expect(JSON.stringify(usage)).not.toContain('SECRET')
  })

  it('counts Codex reasoning tokens, tool calls, tasks and compactions from a rollout', () => {
    const rollout = [
      { type: 'session_meta', timestamp: 't0', payload: { id: 'codex-1', cwd: 'C:\\Users\\pc\\workspace\\zuri-ai', git: { branch: 'feat/detail', repository_url: 'https://github.com/Freshair129/zuri.ai.git' } } },
      { type: 'turn_context', timestamp: 't1', payload: { model: 'gpt-5.5-codex' } },
      { type: 'event_msg', timestamp: 't2', payload: { type: 'task_started', turn_id: 'turn-1' } },
      { type: 'response_item', timestamp: 't3', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: SECRET_TEXT } },
      { type: 'response_item', timestamp: 't3', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: SECRET_TEXT } },
      { type: 'response_item', timestamp: 't4', payload: { type: 'function_call', call_id: 'c2', name: 'wait' } },
      { type: 'compacted', timestamp: 't5', payload: { message: SECRET_TEXT } },
      { type: 'token_usage_record', timestamp: '2026-09-14T02:00:00.000Z', payload: { response_id: 'r1', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 20 } } },
    ].map((l) => JSON.stringify(l))
    const events = parseCodexActivity(rollout)
    expect(events.every((e) => e.inRepository && e.branch === 'feat/detail')).toBe(true)
    const detail = buildDetail({ requests: parseCodexLines(rollout), events })
    expect(detail).toMatchObject({ reasoningTokens: 20, toolCalls: 2, prompts: 1, compactions: 1, tools: { exec: { calls: 1, errors: 0 }, wait: { calls: 1, errors: 0 } }, models: { 'gpt-5.5-codex': 1 } })
    expect(codexActivity(rollout.slice(1))).toEqual([])
    expect(JSON.stringify(detail)).not.toContain('SECRET')
  })

  it('names an unusable tool name unnamed rather than storing it', () => {
    const events = claudeActivity({ ...base, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'rm -rf / && echo secret' }] } })
    expect(buildDetail({ events, toolNames: toolNameIndex(events) }).tools).toEqual({ unnamed: { calls: 1, errors: 0 } })
  })
})

describe('FR-239 report detail', () => {
  const body = (over = {}) => ({
    source: 'claude-code', sessionId: 'sess-detail-1', branch: 'feat/detail', inputTokens: 10, cacheWriteTokens: 300, cacheReadTokens: 5000, outputTokens: 95,
    requestCount: 1, activeMinutes: 0, startedAt: '2026-09-14T01:00:00.000Z', endedAt: '2026-09-14T01:06:00.000Z', ...over,
  })

  it('accepts the detail strictly and refuses text or unbounded names', () => {
    expect(ProgrammeUsageReportSchema.safeParse(body({ detail: expected })).success).toBe(true)
    expect(ProgrammeUsageReportSchema.safeParse(body({ detail: { ...expected, prompt: SECRET_TEXT } })).success).toBe(false)
    expect(ProgrammeUsageReportSchema.safeParse(body({ detail: { ...expected, tools: { 'rm -rf': { calls: 1, errors: 0 } } } })).success).toBe(false)
    expect(ProgrammeUsageReportSchema.safeParse(body({ detail: { ...expected, tools: { Read: { calls: 1, errors: 0, input: 'x' } } } })).success).toBe(false)
  })

  it('digests a report without detail exactly as before, and a detail independent of key order', () => {
    const plain = ProgrammeUsageReportSchema.parse(body())
    expect(usageReportDigest(plain)).toBe(usageReportDigest({ ...plain, detail: null }))
    const reordered = { models: expected.models, tools: { Read: expected.tools.Read, PowerShell: expected.tools.PowerShell, unnamed: expected.tools.unnamed }, ...Object.fromEntries(Object.entries(expected).filter(([k]) => !['tools', 'models'].includes(k)).reverse()) }
    expect(JSON.stringify(canonicalDetail(reordered))).toBe(JSON.stringify(canonicalDetail(expected)))
  })
})

describe('FR-240 board detail', () => {
  const lanes = [{ id: 'LANE-D', tasks: ['TASK-ZAI-074'], branches: ['feat/detail'] }]
  const meterUsage = { lanes: { 'LANE-D': { requests: 1, sessions: ['claude-code:sess-d'], tokens: { input: 10, cacheWrite: 300, cacheRead: 5000, output: 95 }, bySource: { 'claude-code': {} }, activeMinutes: 1, detail: expected } } }
  const report = {
    source: 'codex', sessionId: 'codex-9', branch: 'feat/detail', installationId: 'inst-1', inputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 100, outputTokens: 50, requestCount: 2, activeMinutes: 3,
    startedAt: '2026-09-14T02:00:00.000Z', endedAt: '2026-09-14T02:05:00.000Z',
    detail: { ...expected, toolCalls: 5, toolErrors: 0, prompts: 2, tools: { exec: { calls: 5, errors: 0 } }, models: { 'gpt-5.5-codex': 2 } },
  }

  it('adds the meter and report detail once per lane and into the phase', () => {
    const merged = mergeLaneUsage({ lanes, usage: meterUsage, reports: [report, { ...report, sessionId: 'no-detail', detail: null }] })
    const lane = merged.get('LANE-D')
    expect(lane.detail.toolCalls).toBe(7)
    expect(lane.detail.prompts).toBe(3)
    expect(lane.detailSessions).toBe(2)
    expect(lane.sessions).toBe(3)
    expect(topTools(lane.detail)[0]).toEqual({ name: 'exec', calls: 5, errors: 0 })
    const phase = { id: 'PHASE-D', start: '2026-09-07', end: '2026-09-20', status: 'in-progress', sprints: [{ id: 'SPR-D' }] }
    const { measured } = phaseDeliveryMetrics({ phase, tasks: [['TASK-ZAI-074', 'SPR-D', 't', 'FR', 'C-3', 'H3', 'review']], sizing: { points: { 'C-3': 3 }, effortHours: { 'C-3': 16 } }, lanes, laneUsage: merged })
    expect(measured.detail.reasoningTokens).toBe(80)
    expect(measured.detailSessions).toBe(2)
  })

  it('shows the split on the real board, and says so where a lane has no detail', () => {
    const html = renderToStaticMarkup(createElement(ProgramRoadmapBoard, {
      lanes: [{ id: 'LANE-USAGE-DETAIL-AND-SPEC', tasks: ['TASK-ZAI-073', 'TASK-ZAI-074', 'TASK-ZAI-075'], branches: ['feat/usage-detail-and-spec'] }],
      laneUsage: Object.fromEntries(mergeLaneUsage({ lanes: [{ id: 'LANE-USAGE-DETAIL-AND-SPEC', tasks: ['TASK-ZAI-073', 'TASK-ZAI-074', 'TASK-ZAI-075'], branches: ['feat/usage-detail-and-spec'] }], usage: { lanes: { 'LANE-USAGE-DETAIL-AND-SPEC': { ...meterUsage.lanes['LANE-D'] } } } })),
    }))
    const phase = html.slice(html.indexOf('data-testid="phase-detail-PHASE-ZAI-01"'))
    expect(phase).toContain('data-detail="true"')
    expect(phase).toMatch(/tool call · error/)
    expect(phase).toContain('thinking')
    const bare = renderToStaticMarkup(createElement(ProgramRoadmapBoard, {
      lanes: [{ id: 'LANE-USAGE-DETAIL-AND-SPEC', tasks: ['TASK-ZAI-073', 'TASK-ZAI-074', 'TASK-ZAI-075'], branches: ['feat/usage-detail-and-spec'] }],
      laneUsage: { 'LANE-USAGE-DETAIL-AND-SPEC': { ...mergeLaneUsage({ lanes: [], usage: { lanes: { X: { ...meterUsage.lanes['LANE-D'], detail: undefined } } } }).get('X'), laneId: 'LANE-USAGE-DETAIL-AND-SPEC' } },
    }))
    expect(bare.slice(bare.indexOf('data-testid="phase-detail-PHASE-ZAI-01"'))).toContain('data-detail="false"')
  })
})
