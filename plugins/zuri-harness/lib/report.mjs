// @req FR-222 — turns one finished session's log into the report bodies for
//   that session, skipping any session that does not belong to an allowed
//   repository, then hands them to the queue and a flush attempt.
// @spec ADR-087 D4, D7
// @tested tests/unit/zuri-harness-plugin.test.js
import { execFile } from 'node:child_process'
import { parseClaudeLine, parseCodexLines, normaliseRepository, summariseByBranch, toReportBody } from './usage.mjs'
import { claudeActivity, claudeActivityCandidate, codexActivity } from './detail.mjs'

// @req FR-239 — the session's usage detail (tool calls, prompts, compactions…) rides
//   along with its tokens, counted by the rules lib/detail.mjs shares with the meter.
function claudeEvents(lines) {
  const events = []
  for (const line of lines) {
    if (!claudeActivityCandidate(line)) continue
    try {
      events.push(...claudeActivity(JSON.parse(line)))
    } catch {
      // a torn line is skipped, as the usage parser skips it
    }
  }
  return events
}
import * as defaultQueue from './queue.mjs'
import { flushQueue } from './client.mjs'

const GIT_REMOTE_TIMEOUT_MS = 3000

/**
 * `git -C <cwd> remote get-url origin`, resolved to '' rather than rejecting
 * on any failure (not a git checkout, no `origin`, git missing, timeout) — the
 * caller treats an unresolved repository the same as a disallowed one: skip
 * the report rather than guess.
 */
export function resolveClaudeRepositoryUrl(cwd, { exec = execFile } = {}) {
  if (!cwd) return Promise.resolve('')
  return new Promise((resolve) => {
    const child = exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: GIT_REMOTE_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? '' : String(stdout || '').trim())
    })
    // node's execFile already applies `timeout`, but guard in case a fake exec
    // in a test never calls back.
    if (child?.unref) child.unref()
  })
}

/** Whether a (possibly empty) repository URL normalises to one of the allowed repositories. */
export function isAllowedRepository(repositoryUrl, allowedRepositories) {
  if (!repositoryUrl) return false
  const normalised = normaliseRepository(repositoryUrl)
  return allowedRepositories.some((allowed) => normaliseRepository(allowed) === normalised)
}

/**
 * A Claude Code transcript (its raw JSONL lines) → the report bodies for that
 * session, one per branch it touched. Returns `[]` (not an error) when the
 * repository is not allowed, so the caller can log and move on.
 */
export function buildClaudeSessionReports({
  lines,
  repositoryUrl,
  allowedRepositories,
  aiAccount,
  taskCode,
  gapCapMinutes = 15,
}) {
  if (!isAllowedRepository(repositoryUrl, allowedRepositories)) return []
  const requests = lines.map(parseClaudeLine).filter(Boolean)
  if (!requests.length) return []
  const repository = normaliseRepository(repositoryUrl)
  return summariseByBranch(requests, { gapCapMinutes, events: claudeEvents(lines) }).map((s) => toReportBody(s, { repository, aiAccount, taskCode }))
}

/**
 * A Codex rollout (its raw JSONL lines) → the report bodies for that session.
 * The repository comes from `session_meta.git.repository_url`, carried on
 * every parsed request by `parseCodexLines`.
 */
export function buildCodexSessionReports({ lines, allowedRepositories, aiAccount, taskCode, gapCapMinutes = 15 }) {
  const requests = parseCodexLines(lines)
  if (!requests.length) return []
  const repositoryUrl = requests[0].repositoryUrl || ''
  if (!isAllowedRepository(repositoryUrl, allowedRepositories)) return []
  const repository = normaliseRepository(repositoryUrl)
  return summariseByBranch(requests, { gapCapMinutes, events: codexActivity(lines) }).map((s) => toReportBody(s, { repository, aiAccount, taskCode }))
}

/**
 * Enqueue every report (replacing any earlier queued report for the same
 * (source, sessionId, branch) key — a resumed session's larger totals win),
 * then make one best-effort attempt to flush the whole queue.
 */
export async function enqueueAndFlush({ reports, home, client, queue = defaultQueue, log = () => {} }) {
  for (const report of reports) queue.enqueue(home, report)
  if (!client) return { sent: 0, dropped: 0, kept: reports.length }
  return flushQueue({ client, queue, home, log })
}
