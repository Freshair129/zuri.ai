// @req FR-222 — the zuri-harness plugin counts each billed request once with
//   the exact same rules as the programme usage meter (FR-217, proven here by
//   a parity test), splits usage by branch, queues what it cannot send and
//   retries it, replaces a resumed session's stale queued entry, skips any
//   session outside an allowed repository, and never carries a browser
//   cookie, a password, or prompt/response text.
// @spec ADR-087 D4, D5, D7
// @tested tests/unit/zuri-harness-plugin.test.js
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  dedupeRequests as meterDedupeRequests,
  parseClaudeLine as meterParseClaudeLine,
  parseCodexLines as meterParseCodexLines,
} from '../../scripts/programme-usage-meter.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..')
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'zuri-harness')

const {
  dedupeRequests,
  normaliseRepository,
  parseClaudeLine,
  parseCodexLines,
  summariseByBranch,
  toReportBody,
} = await import('../../../../plugins/zuri-harness/lib/usage.mjs')
const { DEFAULT_REPOSITORIES } = await import('../../../../plugins/zuri-harness/lib/config.mjs')
const queue = await import('../../../../plugins/zuri-harness/lib/queue.mjs')
const { createClient, flushQueue } = await import('../../../../plugins/zuri-harness/lib/client.mjs')
const { buildClaudeSessionReports, buildCodexSessionReports, enqueueAndFlush, isAllowedRepository } = await import(
  '../../../../plugins/zuri-harness/lib/report.mjs'
)

// ---------------------------------------------------------------------------
// fixtures — same shape as apps/server/tests/unit/programme-usage-meter.test.js
// ---------------------------------------------------------------------------

const claudeLine = ({
  requestId = 'req_1',
  sessionId = 'sess-a',
  timestamp = '2026-09-13T10:00:00.000Z',
  branch = 'feat/a',
  cwd = 'C:\\Users\\pc\\workspace\\zuri-ai\\.claude\\worktrees\\x',
  usage = {},
} = {}) =>
  JSON.stringify({
    type: 'assistant',
    requestId,
    sessionId,
    timestamp,
    gitBranch: branch,
    cwd,
    message: {
      model: 'claude-opus-5',
      usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5, ...usage },
    },
  })

const codexRolloutLines = ({ branch = 'feat/b', url = 'https://github.com/Freshair129/zuri.ai.git', sessionId = 'codex-thread-1' } = {}) => [
  JSON.stringify({ timestamp: '2026-09-13T11:00:00.000Z', type: 'session_meta', payload: { id: sessionId, cwd: 'C:\\Users\\pc\\workspace\\zuri-ai', git: { branch, repository_url: url } } }),
  JSON.stringify({ timestamp: '2026-09-13T11:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.5-codex' } }),
  JSON.stringify({ timestamp: '2026-09-13T11:00:10.000Z', type: 'token_usage_record', payload: { response_id: 'resp_1', usage: { input_tokens: 1200, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 30 } } }),
  JSON.stringify({ timestamp: '2026-09-13T11:40:10.000Z', type: 'token_usage_record', payload: { response_id: 'resp_2', usage: { input_tokens: 500, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 20 } } }),
]

// ---------------------------------------------------------------------------
// 1. Parity with the usage meter
// ---------------------------------------------------------------------------

describe('FR-222 parity with the FR-217 usage meter', () => {
  it('parses the same Claude Code line into identical tokens', () => {
    const line = claudeLine()
    const fromMeter = meterParseClaudeLine(line)
    const fromPlugin = parseClaudeLine(line)
    expect(fromPlugin.tokens).toEqual(fromMeter.tokens)
    expect(fromPlugin).toMatchObject({ source: 'claude-code', sessionId: 'sess-a', requestId: 'req_1', branch: 'feat/a' })
  })

  it('parses the same Codex rollout into identical tokens', () => {
    const lines = codexRolloutLines()
    const fromMeter = meterParseCodexLines(lines)
    const fromPlugin = parseCodexLines(lines)
    expect(fromPlugin.map((r) => r.tokens)).toEqual(fromMeter.map((r) => r.tokens))
    expect(fromPlugin.map((r) => r.requestId)).toEqual(fromMeter.map((r) => r.requestId))
  })

  it('dedupes identically: one request counted once, largest field kept', () => {
    const lines = [
      claudeLine({ usage: { output_tokens: 2 } }),
      claudeLine({ usage: { output_tokens: 40 } }),
      claudeLine({ usage: { output_tokens: 7 } }),
    ]
    const meterResult = meterDedupeRequests(lines.map(meterParseClaudeLine))
    const pluginResult = dedupeRequests(lines.map(parseClaudeLine))
    expect(pluginResult).toHaveLength(1)
    expect(pluginResult[0].tokens).toEqual(meterResult[0].tokens)
  })

  it('totals over a mixed Claude+Codex batch match the meter exactly', () => {
    const claudeLines = [
      claudeLine({ requestId: 'r1', timestamp: '2026-09-13T10:00:00.000Z' }),
      claudeLine({ requestId: 'r2', timestamp: '2026-09-13T10:05:00.000Z' }),
    ]
    const codexLines = codexRolloutLines()

    const meterRequests = meterDedupeRequests([...claudeLines.map(meterParseClaudeLine), ...meterParseCodexLines(codexLines)])
    const pluginRequests = dedupeRequests([...claudeLines.map(parseClaudeLine), ...parseCodexLines(codexLines)])

    const sumUsed = (rs) => rs.reduce((n, r) => n + r.tokens.input + r.tokens.cacheWrite + r.tokens.output, 0)
    const sumCacheRead = (rs) => rs.reduce((n, r) => n + r.tokens.cacheRead, 0)

    expect(pluginRequests).toHaveLength(meterRequests.length)
    expect(sumUsed(pluginRequests)).toBe(sumUsed(meterRequests))
    expect(sumCacheRead(pluginRequests)).toBe(sumCacheRead(meterRequests))
  })
})

// ---------------------------------------------------------------------------
// 2. Branch split
// ---------------------------------------------------------------------------

describe('FR-222 branch split', () => {
  it('splits one Claude Code session across two branches into two summaries', () => {
    const lines = [
      claudeLine({ requestId: 'r1', branch: 'feat/a', timestamp: '2026-09-13T10:00:00.000Z' }),
      claudeLine({ requestId: 'r2', branch: 'feat/a', timestamp: '2026-09-13T10:05:00.000Z' }),
      claudeLine({ requestId: 'r3', branch: 'feat/b', timestamp: '2026-09-13T10:20:00.000Z' }),
    ]
    const requests = lines.map(parseClaudeLine)
    const summaries = summariseByBranch(requests, { gapCapMinutes: 15 })

    expect(summaries).toHaveLength(2)
    expect(summaries.map((s) => s.branch)).toEqual(['feat/a', 'feat/b'])

    const a = summaries.find((s) => s.branch === 'feat/a')
    expect(a).toMatchObject({
      source: 'claude-code',
      sessionId: 'sess-a',
      requestCount: 2,
      tokens: { input: 20, cacheWrite: 200, cacheRead: 2000, output: 10 },
      activeMinutes: 5,
      startedAt: '2026-09-13T10:00:00.000Z',
      endedAt: '2026-09-13T10:05:00.000Z',
    })

    const b = summaries.find((s) => s.branch === 'feat/b')
    expect(b).toMatchObject({ requestCount: 1, activeMinutes: 0, startedAt: '2026-09-13T10:20:00.000Z', endedAt: '2026-09-13T10:20:00.000Z' })
  })

  it('caps an idle gap at gapCapMinutes when computing active time', () => {
    const lines = [
      claudeLine({ requestId: 'r1', timestamp: '2026-09-13T10:00:00.000Z' }),
      claudeLine({ requestId: 'r2', timestamp: '2026-09-13T10:45:00.000Z' }), // 45 min gap, capped at 15
    ]
    const summaries = summariseByBranch(lines.map(parseClaudeLine), { gapCapMinutes: 15 })
    expect(summaries).toHaveLength(1)
    expect(summaries[0].activeMinutes).toBe(15)
  })

  it('toReportBody sends only the contracted keys', () => {
    const [summary] = summariseByBranch([parseClaudeLine(claudeLine())], { gapCapMinutes: 15 })
    const body = toReportBody(summary, { repository: 'Freshair129/zuri.ai', aiAccount: 'acct-1' })
    expect(Object.keys(body).sort()).toEqual(
      ['activeMinutes', 'aiAccount', 'branch', 'cacheReadTokens', 'cacheWriteTokens', 'endedAt', 'inputTokens', 'model', 'outputTokens', 'repository', 'requestCount', 'sessionId', 'source', 'startedAt'].sort(),
    )
    expect(body.source).toBe('claude-code')
    expect(body.branch).toBe('feat/a')
  })
})

// ---------------------------------------------------------------------------
// 3. Codex cached-input subtraction and branch from session_meta
// ---------------------------------------------------------------------------

describe('FR-222 Codex parsing', () => {
  it('moves cached_input_tokens out of input and takes the branch from session_meta', () => {
    const requests = parseCodexLines(codexRolloutLines({ branch: 'feat/codex-lane' }))
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      source: 'codex',
      sessionId: 'codex-thread-1',
      branch: 'feat/codex-lane',
      tokens: { input: 200, cacheWrite: 0, cacheRead: 1000, output: 30 },
    })
    expect(requests[1].tokens).toEqual({ input: 100, cacheWrite: 0, cacheRead: 400, output: 20 })
  })

  it('carries repository_url from session_meta onto every request', () => {
    const requests = parseCodexLines(codexRolloutLines({ url: 'git@github.com:Freshair129/zuri.ai.git' }))
    expect(requests.every((r) => r.repositoryUrl === 'git@github.com:Freshair129/zuri.ai.git')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Hook report flow: queue + flush against an injected fetch
// ---------------------------------------------------------------------------

function makeFakeFetch(script) {
  // `script` is an array of { status, body } consumed in order, one per call.
  let i = 0
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const step = script[Math.min(i, script.length - 1)]
    i += 1
    if (step.networkError) throw new Error('network down')
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? {},
    }
  }
  fetchImpl.calls = calls
  return fetchImpl
}

describe('FR-222 hook report flow', () => {
  const allowedRepositories = DEFAULT_REPOSITORIES
  const repositoryUrl = 'https://github.com/Freshair129/zuri.ai.git'

  function tempHome() {
    return mkdtempSync(path.join(os.tmpdir(), 'zuri-harness-test-'))
  }

  function writeTranscript(home, lines) {
    const file = path.join(home, 'transcript.jsonl')
    writeFileSync(file, `${lines.join('\n')}\n`)
    return file
  }

  it('sends successfully (201): the queue ends up empty', async () => {
    const home = tempHome()
    const transcript = writeTranscript(home, [
      claudeLine({ requestId: 'ok-1', sessionId: 'sess-201', branch: 'feat/x', timestamp: '2026-09-13T09:00:00.000Z' }),
    ])
    const lines = readFileSync(transcript, 'utf8').split('\n').filter(Boolean)
    const reports = buildClaudeSessionReports({ lines, repositoryUrl, allowedRepositories })
    expect(reports).toHaveLength(1)

    const fetchImpl = makeFakeFetch([{ status: 201 }])
    const client = createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchImpl })
    await enqueueAndFlush({ reports, home, client, queue })

    expect(queue.list(home)).toHaveLength(0)
  })

  it('a 503 keeps the report queued; a later 201 flushes it', async () => {
    const home = tempHome()
    const reports = buildClaudeSessionReports({
      lines: [claudeLine({ requestId: 'r-503', sessionId: 'sess-503', branch: 'feat/y' })],
      repositoryUrl,
      allowedRepositories,
    })

    const fetchDown = makeFakeFetch([{ status: 503 }])
    await enqueueAndFlush({ reports, home, client: createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchDown }), queue })
    expect(queue.list(home)).toHaveLength(1)

    const fetchNetworkError = makeFakeFetch([{ networkError: true }])
    const flushResult1 = await flushQueue({ client: createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchNetworkError }), queue, home })
    expect(flushResult1.kept).toBe(1)
    expect(queue.list(home)).toHaveLength(1)

    const fetchUp = makeFakeFetch([{ status: 201 }])
    const flushResult2 = await flushQueue({ client: createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchUp }), queue, home })
    expect(flushResult2.sent).toBe(1)
    expect(queue.list(home)).toHaveLength(0)
  })

  it('400 and 409 are dropped from the queue', async () => {
    for (const status of [400, 409]) {
      const home = tempHome()
      const reports = buildClaudeSessionReports({
        lines: [claudeLine({ requestId: `r-${status}`, sessionId: `sess-${status}`, branch: 'feat/z' })],
        repositoryUrl,
        allowedRepositories,
      })
      const fetchImpl = makeFakeFetch([{ status }])
      await enqueueAndFlush({ reports, home, client: createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchImpl }), queue })
      expect(queue.list(home)).toHaveLength(0)
    }
  })

  it('401 and 403 keep the report queued', async () => {
    for (const status of [401, 403]) {
      const home = tempHome()
      const reports = buildClaudeSessionReports({
        lines: [claudeLine({ requestId: `r-${status}`, sessionId: `sess-auth-${status}`, branch: 'feat/w' })],
        repositoryUrl,
        allowedRepositories,
      })
      const fetchImpl = makeFakeFetch([{ status }])
      await enqueueAndFlush({ reports, home, client: createClient({ server: 'https://example.test', key: 'hrnk_test', fetch: fetchImpl }), queue })
      expect(queue.list(home)).toHaveLength(1)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Resumed session re-enqueue replaces the queued file for the same key
// ---------------------------------------------------------------------------

describe('FR-222 resumed session replaces its queued report', () => {
  it('a later, larger report for the same (source, sessionId, branch) overwrites the queued file', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'zuri-harness-test-'))
    const first = {
      source: 'claude-code',
      sessionId: 'sess-resume',
      branch: 'feat/resume',
      inputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 5,
      requestCount: 1,
      activeMinutes: 0,
      startedAt: '2026-09-13T10:00:00.000Z',
      endedAt: '2026-09-13T10:00:00.000Z',
    }
    const resumed = { ...first, inputTokens: 40, outputTokens: 25, requestCount: 3, activeMinutes: 12, endedAt: '2026-09-13T10:20:00.000Z' }

    const file1 = queue.enqueue(home, first)
    const file2 = queue.enqueue(home, resumed)
    expect(file2).toBe(file1) // same row key ⇒ same filename

    const entries = queue.list(home)
    expect(entries).toHaveLength(1)
    expect(entries[0].report).toEqual(resumed)
  })
})

// ---------------------------------------------------------------------------
// 6. Repository normalisation and the allow-list
// ---------------------------------------------------------------------------

describe('FR-222 repository normalisation and allow-listing', () => {
  it('normalises the https and ssh remote forms to Owner/Repo', () => {
    expect(normaliseRepository('https://github.com/Freshair129/zuri.ai')).toBe('Freshair129/zuri.ai')
    expect(normaliseRepository('https://github.com/Freshair129/zuri.ai.git')).toBe('Freshair129/zuri.ai')
    expect(normaliseRepository('git@github.com:Freshair129/zuri.ai.git')).toBe('Freshair129/zuri.ai')
  })

  it('accepts the configured repository and rejects one that is not allowed', () => {
    expect(isAllowedRepository('https://github.com/Freshair129/zuri.ai.git', DEFAULT_REPOSITORIES)).toBe(true)
    expect(isAllowedRepository('https://github.com/Freshair129/zuri-edge-device.git', DEFAULT_REPOSITORIES)).toBe(false)
    expect(isAllowedRepository('', DEFAULT_REPOSITORIES)).toBe(false)
  })

  it('skips building reports for a Claude session outside the allowed repository', () => {
    const reports = buildClaudeSessionReports({
      lines: [claudeLine({ requestId: 'outside' })],
      repositoryUrl: 'https://github.com/Freshair129/zuri-edge-device.git',
      allowedRepositories: DEFAULT_REPOSITORIES,
    })
    expect(reports).toEqual([])
  })

  it('skips building reports for a Codex session outside the allowed repository', () => {
    const reports = buildCodexSessionReports({
      lines: codexRolloutLines({ url: 'https://github.com/SomeoneElse/other-repo.git' }),
      allowedRepositories: DEFAULT_REPOSITORIES,
    })
    expect(reports).toEqual([])
  })

  it('builds a report for a Codex session inside the allowed repository', () => {
    const reports = buildCodexSessionReports({
      lines: codexRolloutLines({ url: 'https://github.com/Freshair129/zuri.ai.git' }),
      allowedRepositories: DEFAULT_REPOSITORIES,
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'codex', branch: 'feat/b', repository: 'Freshair129/zuri.ai' })
  })
})

// ---------------------------------------------------------------------------
// 7. Static check: no plugin source file leaks a cookie, credential-secret name
// ---------------------------------------------------------------------------

function listFilesRecursive(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...listFilesRecursive(full))
    else out.push(full)
  }
  return out
}

describe('FR-222 / ADR-087 D7 — never a browser cookie, never a password', () => {
  it('no source file (code and manifests, not prose docs) mentions zuri_session, Cookies, or password', () => {
    // .md files (README, the skill, the slash commands) are prose that
    // explains the rule — they legitimately say "never stores a password".
    // The check that matters is over what actually runs: code and manifests.
    const forbidden = ['zuri_session', 'Cookies', 'password']
    const offenders = []
    for (const file of listFilesRecursive(PLUGIN_ROOT)) {
      if (file.endsWith('.md')) continue
      const text = readFileSync(file, 'utf8')
      for (const term of forbidden) {
        if (text.includes(term)) offenders.push(`${path.relative(PLUGIN_ROOT, file)}: contains "${term}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})
