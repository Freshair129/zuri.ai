#!/usr/bin/env node
// @req FR-222 — the zuri-harness CLI: pair, whoami, unpair, report and flush,
//   used by the Claude Code hooks/slash commands and the Codex wrapper.
// @spec ADR-087 D1-D7
// @tested tests/unit/zuri-harness-plugin.test.js
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPOSITORIES, homeDir, readConfig, writeConfig, clearConfig } from '../lib/config.mjs'
import { createClient, flushQueue } from '../lib/client.mjs'
import * as queue from '../lib/queue.mjs'
import { buildClaudeSessionReports, buildCodexSessionReports, enqueueAndFlush, resolveClaudeRepositoryUrl } from '../lib/report.mjs'

const HARNESS_LABELS = { 'claude-code': 'CLAUDE_CODE', codex: 'CODEX' }
const POLL_TIMEOUT_MS = 8000

function logLine(message) {
  // The one channel every command writes user-visible output to. Kept as a
  // single function so a hook invocation's "always one short line" rule is
  // easy to audit.
  console.log(message)
}

function logToFile(message) {
  try {
    const home = homeDir()
    mkdirSync(home, { recursive: true })
    appendFileSync(path.join(home, 'log.txt'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // The log is best-effort diagnostics; a failure to write it must never
    // surface as a hook failure.
  }
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
}

function tryOpenBrowser(url) {
  // Best-effort only — a headless or SSH session has no opener, and pairing
  // must still succeed by the person reading the printed link.
  try {
    const platform = process.platform
    if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref()
    else if (platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref()
  } catch {
    // No opener available; the printed link is enough.
  }
}

// ---------------------------------------------------------------------------
// pair
// ---------------------------------------------------------------------------

async function cmdPair(argv) {
  const server = argValue(argv, '--server')
  if (!server) {
    console.error('zuri-harness pair: --server <url> is required')
    process.exitCode = 1
    return
  }
  const harnessFlag = argValue(argv, '--harness') || 'claude-code'
  const harness = HARNESS_LABELS[harnessFlag]
  if (!harness) {
    console.error(`zuri-harness pair: --harness must be one of ${Object.keys(HARNESS_LABELS).join(', ')}`)
    process.exitCode = 1
    return
  }
  const deviceLabel = argValue(argv, '--label') || os.hostname()
  const aiAccount = argValue(argv, '--ai-account') || null
  let osUser = null
  try {
    osUser = os.userInfo().username
  } catch {
    osUser = null
  }

  const client = createClient({ server })
  const startResult = await client.start({ harness, deviceLabel, ...(osUser ? { osUser } : {}) })
  if (startResult.status === 429) {
    console.error('zuri-harness pair: pairing is busy right now (PAIRING_BUSY_TRY_LATER) — try again in a moment')
    process.exitCode = 1
    return
  }
  if (!startResult.ok || !startResult.body) {
    console.error(`zuri-harness pair: could not start pairing (${startResult.status || 'network error'})`)
    process.exitCode = 1
    return
  }
  const { requestId, deviceSecret, checkCode, approvalUrl, pollIntervalMs, expiresAt } = startResult.body
  logLine(`zuri-harness: open ${approvalUrl} and approve device "${deviceLabel}" — check code ${checkCode}`)
  logLine(`zuri-harness: waiting for approval (expires ${expiresAt})...`)
  tryOpenBrowser(approvalUrl)

  let cancelled = false
  const onSigint = () => {
    cancelled = true
  }
  process.once('SIGINT', onSigint)

  try {
    for (;;) {
      if (cancelled) {
        await client.poll({ requestId, cancel: true }, deviceSecret)
        console.error('zuri-harness pair: cancelled')
        process.exitCode = 1
        return
      }
      if (expiresAt && Date.now() > Date.parse(expiresAt)) {
        console.error('zuri-harness pair: pairing request expired — run pair again')
        process.exitCode = 1
        return
      }
      const poll = await client.poll({ requestId }, deviceSecret)
      if (poll.status === 410) {
        const code = poll.body?.error
        console.error(`zuri-harness pair: ${code === 'PAIRING_ALREADY_USED_START_AGAIN' ? 'already used — start again' : 'expired — start again'}`)
        process.exitCode = 1
        return
      }
      if (poll.status === 429) {
        await sleep(Math.max(pollIntervalMs || 2000, 1000))
        continue
      }
      if (!poll.ok || !poll.body) {
        await sleep(pollIntervalMs || 2000)
        continue
      }
      if (poll.body.state === 'DENIED') {
        console.error('zuri-harness pair: the approval was denied')
        process.exitCode = 1
        return
      }
      if (poll.body.state === 'CANCELLED') {
        console.error('zuri-harness pair: pairing was cancelled')
        process.exitCode = 1
        return
      }
      if (poll.body.state === 'PAIRED') {
        const { pairing } = poll.body
        writeConfig({
          server,
          harness,
          deviceLabel: pairing.deviceLabel || deviceLabel,
          key: pairing.key,
          installationId: pairing.installationId,
          personDisplayName: pairing.personDisplayName,
          status: pairing.status,
          repositories: DEFAULT_REPOSITORIES,
          aiAccount,
        })
        logLine(`zuri-harness: paired to ${pairing.personDisplayName} on ${pairing.deviceLabel} (${pairing.status})`)
        if (pairing.status === 'PENDING_ACTIVATION') {
          logLine('zuri-harness: an operator must activate this device before reports are accepted — usage reports will queue until then')
        }
        return
      }
      // PENDING — keep waiting.
      await sleep(poll.body.checkCode ? (pollIntervalMs || 2000) : (pollIntervalMs || 2000))
    }
  } finally {
    process.removeListener('SIGINT', onSigint)
  }
}

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------

async function cmdWhoami(argv) {
  const hookMode = argv.includes('--hook')
  const config = readConfig()
  if (!config) {
    logLine('zuri-harness: not paired — run /zuri-harness:pair')
    if (hookMode) await flushBounded()
    return
  }
  if (hookMode) {
    // A hook has a small time budget: print from the saved config rather than
    // waiting on a network round trip, then flush whatever is queued.
    logLine(`zuri-harness: paired to ${config.personDisplayName} on ${config.deviceLabel} (${config.status})`)
    await flushBounded()
    return
  }
  const client = createClient({ server: config.server, key: config.key })
  const result = await client.whoami()
  if (result.status === 401) {
    console.error('zuri-harness whoami: credential no longer valid (HARNESS_CREDENTIAL_REQUIRED) — run pair again')
    process.exitCode = 1
    return
  }
  if (!result.ok || !result.body) {
    console.error(`zuri-harness whoami: could not reach server (${result.status || 'network error'})`)
    process.exitCode = 1
    return
  }
  const w = result.body
  logLine(`zuri-harness: paired to ${w.personDisplayName} on ${w.deviceLabel} as ${w.harness} (${w.status}) — installation ${w.installationId}`)
}

async function flushBounded() {
  const config = readConfig()
  if (!config) return
  try {
    const client = createClient({ server: config.server, key: config.key, timeoutMs: 5000 })
    await flushQueue({ client, queue, home: homeDir(), log: logToFile })
  } catch (error) {
    logToFile(`flush failed: ${error?.message || error}`)
  }
}

// ---------------------------------------------------------------------------
// unpair
// ---------------------------------------------------------------------------

function cmdUnpair() {
  const config = readConfig()
  clearConfig()
  if (config) logLine(`zuri-harness: removed local pairing for ${config.personDisplayName} on ${config.deviceLabel}. An operator must also revoke this device from the harness device list — this only clears the local credential.`)
  else logLine('zuri-harness: no local pairing to remove')
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function codexSessionsDir(env = process.env) {
  return env.CODEX_HOME ? path.join(env.CODEX_HOME, 'sessions') : path.join(os.homedir(), '.codex', 'sessions')
}

function newestJsonlFile(dir, since) {
  if (!existsSync(dir)) return null
  const out = []
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
      else if (name.endsWith('.jsonl')) out.push({ full, mtime: stat.mtimeMs })
    }
  }
  walk(dir)
  const sinceMs = since ? Date.parse(since) : null
  const candidates = sinceMs ? out.filter((f) => f.mtime >= sinceMs) : out
  if (!candidates.length) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].full
}

function readLinesSync(file) {
  return readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
}

async function reportFromClaudeTranscript({ transcriptPath, cwd, config, taskCode }) {
  if (!transcriptPath || !existsSync(transcriptPath)) return
  const lines = readLinesSync(transcriptPath)
  const repositoryUrl = await resolveClaudeRepositoryUrl(cwd)
  const allowedRepositories = config.repositories || DEFAULT_REPOSITORIES
  const reports = buildClaudeSessionReports({ lines, repositoryUrl, allowedRepositories, aiAccount: config.aiAccount, taskCode })
  if (!reports.length) return
  const client = config.key ? createClient({ server: config.server, key: config.key, timeoutMs: 5000 }) : null
  await enqueueAndFlush({ reports, home: homeDir(), client, queue, log: logToFile })
}

async function reportFromCodexRollout({ rolloutPath, config, taskCode }) {
  if (!rolloutPath || !existsSync(rolloutPath)) return
  const lines = readLinesSync(rolloutPath)
  const allowedRepositories = config.repositories || DEFAULT_REPOSITORIES
  const reports = buildCodexSessionReports({ lines, allowedRepositories, aiAccount: config.aiAccount, taskCode })
  if (!reports.length) return
  const client = config.key ? createClient({ server: config.server, key: config.key, timeoutMs: 5000 }) : null
  await enqueueAndFlush({ reports, home: homeDir(), client, queue, log: logToFile })
}

async function cmdReport(argv) {
  const config = readConfig()
  const taskCode = argValue(argv, '--task-code')
  try {
    if (argv.includes('--claude-hook')) {
      const raw = await readStdin()
      let hookInput = {}
      try {
        hookInput = raw ? JSON.parse(raw) : {}
      } catch (error) {
        logToFile(`report --claude-hook: could not parse hook input: ${error.message}`)
        return
      }
      if (!config) return // never paired — nothing to report against
      await reportFromClaudeTranscript({ transcriptPath: hookInput.transcript_path, cwd: hookInput.cwd, config, taskCode })
      return
    }
    if (argv.includes('--claude-transcript')) {
      if (!config) {
        console.error('zuri-harness report: not paired — run pair first')
        process.exitCode = 1
        return
      }
      const transcriptPath = argValue(argv, '--claude-transcript')
      await reportFromClaudeTranscript({ transcriptPath, cwd: process.cwd(), config, taskCode })
      return
    }
    if (argv.includes('--codex-latest')) {
      if (!config) return
      const since = argValue(argv, '--since')
      const rolloutPath = newestJsonlFile(codexSessionsDir(), since)
      await reportFromCodexRollout({ rolloutPath, config, taskCode })
      return
    }
    if (argv.includes('--codex-session')) {
      if (!config) {
        console.error('zuri-harness report: not paired — run pair first')
        process.exitCode = 1
        return
      }
      const rolloutPath = argValue(argv, '--codex-session')
      await reportFromCodexRollout({ rolloutPath, config, taskCode })
      return
    }
    console.error('zuri-harness report: pass one of --claude-hook, --claude-transcript <path>, --codex-latest, --codex-session <path>')
    process.exitCode = 1
  } catch (error) {
    // A SessionEnd hook must never fail the session it reports on.
    logToFile(`report failed: ${error?.stack || error}`)
  }
}

async function cmdFlush() {
  const config = readConfig()
  if (!config) {
    logLine('zuri-harness: not paired — nothing to flush')
    return
  }
  const client = createClient({ server: config.server, key: config.key, timeoutMs: 5000 })
  const result = await flushQueue({ client, queue, home: homeDir(), log: logLine })
  logLine(`zuri-harness: flush sent ${result.sent}, dropped ${result.dropped}, kept ${result.kept}`)
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function printHelp() {
  logLine(`zuri-harness — Claude Code / Codex usage reporter (FR-220..222, ADR-087)

Usage:
  zuri-harness pair --server <url> [--harness claude-code|codex] [--label <name>] [--ai-account <label>]
  zuri-harness whoami [--hook]
  zuri-harness unpair
  zuri-harness report --claude-hook            (reads SessionEnd hook JSON from stdin)
  zuri-harness report --claude-transcript <path> [--task-code TASK-ZAI-###]
  zuri-harness report --codex-latest [--since <iso>] [--task-code TASK-ZAI-###]
  zuri-harness report --codex-session <path> [--task-code TASK-ZAI-###]
  zuri-harness flush`)
}

export async function main(argv) {
  const [command, ...rest] = argv
  switch (command) {
    case 'pair':
      await cmdPair(rest)
      break
    case 'whoami':
      await cmdWhoami(rest)
      break
    case 'unpair':
      cmdUnpair()
      break
    case 'report':
      await cmdReport(rest)
      break
    case 'flush':
      await cmdFlush()
      break
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      break
    default:
      console.error(`zuri-harness: unknown command "${command}"`)
      printHelp()
      process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`zuri-harness: ${error?.stack || error}`)
    // whoami --hook and report --claude-hook must never exit non-zero; every
    // other command legitimately can.
    process.exitCode = process.argv.includes('--hook') || process.argv.includes('--claude-hook') ? 0 : 1
  })
}
