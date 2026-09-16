// @req FR-217 — the usage meter counts each billed request once, normalises Claude
//   Code and Codex tokens to the same four counts, attributes only by a declared
//   lane branch inside this repository, caps idle gaps, and writes a block that a
//   second run over the same logs reproduces byte for byte.
// @spec ADR-086 D3, D4
// @tested tests/unit/programme-usage-meter.test.js
import { describe, expect, it } from 'vitest'
import {
  dedupeRequests,
  isRepositoryDirectory,
  measureUsage,
  parseClaudeLine,
  parseCodexLines,
} from '../../scripts/programme-usage-meter.mjs'

const claude = ({ requestId = 'req_1', sessionId = 'sess-a', timestamp = '2026-09-13T10:00:00.000Z', branch = 'feat/a', cwd = 'C:\\Users\\pc\\workspace\\zuri-ai\\.claude\\worktrees\\x', usage = {} } = {}) => JSON.stringify({
  type: 'assistant',
  requestId,
  sessionId,
  timestamp,
  gitBranch: branch,
  cwd,
  message: { model: 'claude-opus-5', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5, ...usage } },
})

const codexLines = ({ branch = 'feat/b', url = 'https://github.com/Freshair129/zuri.ai.git' } = {}) => [
  JSON.stringify({ timestamp: '2026-09-13T11:00:00.000Z', type: 'session_meta', payload: { id: 'codex-thread-1', cwd: 'C:\\Users\\pc\\workspace\\zuri-ai', git: { branch, repository_url: url } } }),
  JSON.stringify({ timestamp: '2026-09-13T11:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.5-codex' } }),
  JSON.stringify({ timestamp: '2026-09-13T11:00:10.000Z', type: 'token_usage_record', payload: { response_id: 'resp_1', usage: { input_tokens: 1200, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 30 } } }),
  JSON.stringify({ timestamp: '2026-09-13T11:40:10.000Z', type: 'token_usage_record', payload: { response_id: 'resp_2', usage: { input_tokens: 500, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 20 } } }),
]

const lanes = [{ id: 'LANE-A', tasks: ['TASK-ZAI-001'], branches: ['feat/a'] }, { id: 'LANE-B', tasks: ['TASK-ZAI-002'], branches: ['feat/b'] }]

describe('FR-217 log readers', () => {
  it('reads a Claude Code assistant line and ignores everything else', () => {
    const r = parseClaudeLine(claude())
    expect(r).toMatchObject({ source: 'claude-code', sessionId: 'sess-a', requestId: 'req_1', branch: 'feat/a', inRepository: true, tokens: { input: 10, cacheWrite: 100, cacheRead: 1000, output: 5 } })
    expect(parseClaudeLine(JSON.stringify({ type: 'user', message: { content: 'usage' } }))).toBeNull()
    expect(parseClaudeLine('{not json "usage"')).toBeNull()
  })

  it('moves Codex cached input out of input, and takes the branch from session_meta', () => {
    const rs = parseCodexLines(codexLines())
    expect(rs).toHaveLength(2)
    expect(rs[0]).toMatchObject({ source: 'codex', sessionId: 'codex-thread-1', requestId: 'resp_1', branch: 'feat/b', inRepository: true, model: 'gpt-5.5-codex', tokens: { input: 200, cacheWrite: 0, cacheRead: 1000, output: 30 } })
    expect(parseCodexLines(codexLines({ url: 'https://github.com/Freshair129/zuri-edge-device' }))[0].inRepository).toBe(false)
  })

  it('knows a zuri-ai checkout from any other directory', () => {
    expect(isRepositoryDirectory('C:\\Users\\pc\\workspace\\zuri-ai')).toBe(true)
    expect(isRepositoryDirectory('C:\\Users\\pc\\workspace\\zuri-ai-sku-governance\\apps\\server')).toBe(true)
    expect(isRepositoryDirectory('D:/zuri-ai/.claude/worktrees/feat-x')).toBe(true)
    expect(isRepositoryDirectory('C:\\Users\\pc\\workspace\\zuri-edge-device')).toBe(false)
    expect(isRepositoryDirectory('C:\\Users\\pc\\workspace\\business-01-smart-gift')).toBe(false)
  })
})

describe('FR-217 counting', () => {
  it('counts one request once, keeping the largest count a content block recorded', () => {
    const rs = dedupeRequests([
      parseClaudeLine(claude({ usage: { output_tokens: 2 } })),
      parseClaudeLine(claude({ usage: { output_tokens: 40 } })),
      parseClaudeLine(claude({ usage: { output_tokens: 7 } })),
    ])
    expect(rs).toHaveLength(1)
    expect(rs[0].tokens.output).toBe(40)
  })

  it('attributes by declared branch only, and reports detached, main and outside work as unattributed or ignored', () => {
    const requests = [
      parseClaudeLine(claude({ requestId: 'r1', timestamp: '2026-09-13T10:00:00.000Z' })),
      parseClaudeLine(claude({ requestId: 'r2', timestamp: '2026-09-13T10:05:00.000Z' })),
      parseClaudeLine(claude({ requestId: 'r3', branch: 'HEAD' })),
      parseClaudeLine(claude({ requestId: 'r4', branch: 'main' })),
      parseClaudeLine(claude({ requestId: 'r5', branch: 'feat/unknown' })),
      parseClaudeLine(claude({ requestId: 'r6', cwd: 'C:\\Users\\pc\\workspace\\zuri-edge-device' })),
      ...parseCodexLines(codexLines()),
    ]
    const { usage, unattributed } = measureUsage({ requests, lanes, gapCapMinutes: 15 })
    expect(Object.keys(usage.lanes)).toEqual(['LANE-A', 'LANE-B'])
    expect(usage.lanes['LANE-A']).toMatchObject({ requests: 2, sessions: ['claude-code:sess-a'], tokens: { input: 20, cacheWrite: 200, cacheRead: 2000, output: 10 }, activeMinutes: 5 })
    // Codex: one 40-minute gap, capped at 15.
    expect(usage.lanes['LANE-B']).toMatchObject({ requests: 2, sessions: ['codex:codex-thread-1'], activeMinutes: 15, tokens: { input: 300, cacheRead: 1400, output: 50 } })
    expect(usage.lanes['LANE-B'].bySource.codex.requests).toBe(2)
    expect(unattributed.map(([branch]) => branch).sort()).toEqual(['HEAD', 'feat/unknown', 'main'])
    expect(usage.measuredThrough).toBe('2026-09-13T11:40:10.000Z')
  })

  it('writes the same block on a second run over the same logs, whatever order they are read in', () => {
    const requests = [parseClaudeLine(claude({ requestId: 'r1' })), parseClaudeLine(claude({ requestId: 'r2', timestamp: '2026-09-13T10:09:00.000Z' })), ...parseCodexLines(codexLines())]
    const first = JSON.stringify(measureUsage({ requests, lanes, gapCapMinutes: 15 }).usage)
    const second = JSON.stringify(measureUsage({ requests: [...requests].reverse(), lanes, gapCapMinutes: 15 }).usage)
    expect(second).toBe(first)
  })
})
