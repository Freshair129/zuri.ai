import { spawn } from 'node:child_process'

// @req FR-057 — the one lawful call direction out of Tier 1 is zuri-ai → MSP
//   (ADR-043 D2); this is the transport that carries it, spawning the MSP
//   server over NDJSON JSON-RPC exactly as MSP's own reference caller does.
// @spec ADR-068 D1, ADR-043 D2, ADR-050 D3
// @tested tests/unit/msp-stdio-transport.test.js, tests/integration/fr110-knowledge-evidence-chain.test.js
//
// Node built-ins only. Nothing here imports from the MSP repository — the
// wire is the contract (`initialize` → `notifications/initialized` →
// `tools/call`), and the returned callable has the `(name, input) =>
// Promise<structuredContent>` shape `createMspMemoryPort` already accepts, so
// one transport serves memory (API-009) and the knowledge evidence pull alike.
// One child process per call, closed in `finally`: a stuck MSP can hold this
// process's file descriptors only for as long as one call's timeout.
//
// The child gets an ALLOWLISTED environment, never a copy of this server's.
// The web process holds the production database URLs, LINE channel secrets,
// model keys and seal keys; MSP reads none of them, and MSP forwards its own
// environment to every GKS child it spawns (MSP gks-stdio-provider.mjs), so
// whatever reaches MSP reaches GKS as well. Names are exact — no prefix — so a
// variable MSP starts reading later arrives only after it is named here, which
// fails closed instead of open.

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Every variable the MSP runtime reads, taken from MSP's own source
 * (Memory-and-Soul-Passport origin/main), plus the GKS variables MSP must
 * carry because it spawns GKS with its own environment. Nothing named
 * ZURI_MSP_* is here: those configure this transport and MSP never reads them.
 */
export const MSP_RUNTIME_ENV_NAMES = Object.freeze([
  // apps/msp-server/bin/msp-server.mjs — the store; MSP refuses to start without it
  'MSP_DB_PATH',
  // apps/msp-server/src/providers/gks-stdio-provider.mjs — how MSP spawns GKS
  'MSP_GKS_COMMAND',
  'MSP_GKS_ARGS',
  'MSP_GKS_CWD',
  // apps/msp-server/src/transport/handlers/pipeline-handlers.mjs — relay grants and credentials
  'MSP_PIPELINE_PRINCIPALS',
  'MSP_GKS_PIPELINE_CREDENTIAL',
  'MSP_PIPELINE_WORKER_URL',
  'MSP_PIPELINE_WORKER_TOKEN',
  // packages/msp-retrieval/src/retrieval/vector.mjs — the embedding endpoint
  'OLLAMA_BASE_URL',
  // Read by GKS (apps/gks-server/src/server.mjs, packages/gks-contracts/src/resolution.mjs),
  // reaching it only because MSP spawns GKS with MSP's environment
  'GKS_DB_PATH',
  'GKS_PIPELINE_RELAY_CREDENTIAL',
  'GKS_DEFAULT_PORTFOLIO_ID',
  'GKS_AUTOMERGE_FLOOR',
])

/**
 * What a Node child needs from the OS to start and to spawn its own child:
 * command lookup (PATH, PATHEXT), os.tmpdir() (TMPDIR/TMP/TEMP), os.homedir()
 * (HOME, USERPROFILE/HOMEDRIVE/HOMEPATH), Windows system services that libuv
 * and OpenSSL resolve through SystemRoot/windir, and locale/time zone so the
 * child formats time the way its parent does. No credentials, no proxies, and
 * no NODE_OPTIONS — that one can load code into the child. On Windows, libuv
 * itself copies its required variables from this process into any explicit
 * environment (adding LOGONSERVER, USERDOMAIN and USERNAME to the names below);
 * that is outside this allowlist's reach, and none of them is a credential.
 */
export const MSP_OS_ENV_NAMES = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
  'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
])

// Windows spells these `Path` and `SystemRoot`, and its environment is
// case-insensitive, so names are matched without case and copied as spelled.
const ALLOWED_ENV_NAMES = new Set([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES].map((name) => name.toUpperCase()))

/**
 * The environment an MSP child is spawned with: the allowlisted names from
 * `env`, and nothing else.
 */
export function buildMspChildEnvironment(env = process.env) {
  const child = {}
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string' && ALLOWED_ENV_NAMES.has(name.toUpperCase())) child[name] = value
  }
  return child
}

function parseArgs(value) {
  if (!value) return []
  let args
  try {
    args = JSON.parse(value)
  } catch {
    throw new Error('ZURI_MSP_ARGS must be a JSON array of strings')
  }
  if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    throw new Error('ZURI_MSP_ARGS must be a JSON array of strings')
  }
  return args
}

function transportError(message, code = 'MSP_TRANSPORT_UNAVAILABLE') {
  const error = new Error(message)
  error.code = code
  error.status = 503
  return error
}

/**
 * Build the transport from deployment configuration. Returns `null` — never
 * a transport that will fail later — when `ZURI_MSP_COMMAND` is unset, so a
 * caller fails closed at the boundary it can name (503) rather than inside a
 * spawn. The child receives `buildMspChildEnvironment(env)`, not `env`.
 */
export function createMspTransportFromEnvironment(env = process.env) {
  const command = env.ZURI_MSP_COMMAND?.trim()
  if (!command) return null
  return createMspStdioTransport({
    command,
    args: parseArgs(env.ZURI_MSP_ARGS),
    cwd: env.ZURI_MSP_CWD?.trim() || undefined,
    env: buildMspChildEnvironment(env),
    timeoutMs: Number(env.ZURI_MSP_TIMEOUT_MS) > 0 ? Number(env.ZURI_MSP_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  })
}

/**
 * `(name, input) => Promise<structuredContent>` over a freshly spawned MSP
 * process per call. A tool result with `isError` becomes a thrown error
 * carrying the tool's own text, so a caller sees `gks_provider_unconfigured`
 * or `vault_scope_denied` verbatim rather than a generic failure.
 *
 * `env` is the source the child environment is drawn from, and it is always
 * filtered through the allowlist — also when a caller passes one explicitly —
 * so no path spawns MSP holding a variable MSP does not read.
 */
export function createMspStdioTransport({ command, args = [], cwd, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('createMspStdioTransport requires a command')
  const childEnv = buildMspChildEnvironment(env)

  return async function callMspTool(name, input) {
    const child = spawn(command, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    let buffer = Buffer.alloc(0)
    let stderrTail = ''
    let nextId = 1
    let closed = false
    const pending = new Map()

    const rejectPending = (error) => {
      for (const { reject, timeout } of pending.values()) {
        clearTimeout(timeout)
        reject(error)
      }
      pending.clear()
    }
    const close = () => {
      if (closed) return
      closed = true
      child.kill()
    }
    const request = (method, params) => {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(transportError(`MSP request timed out: ${method}`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timeout })
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      })
    }

    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const body = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '')
        buffer = buffer.subarray(newline + 1)
        let message
        try {
          message = JSON.parse(body)
        } catch {
          rejectPending(transportError('MSP returned malformed NDJSON'))
          close()
          return
        }
        const waiting = pending.get(message.id)
        if (!waiting) continue
        pending.delete(message.id)
        clearTimeout(waiting.timeout)
        if (message.error) waiting.reject(transportError(message.error.message ?? 'MSP returned a JSON-RPC error'))
        else waiting.resolve(message.result)
      }
    })
    child.stderr.on('data', (chunk) => { stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-2048) })
    child.on('error', (error) => rejectPending(transportError(error.message)))
    child.on('exit', (code) => {
      if (!closed) rejectPending(transportError(`MSP process exited with code ${code}.${stderrTail ? ` ${stderrTail.trim()}` : ''}`))
    })

    try {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zuri-ai', version: '0.1.0' },
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
      const result = await request('tools/call', { name, arguments: input ?? {} })
      if (result?.isError) {
        const text = result.content?.find((item) => item.type === 'text')?.text
        throw transportError(text ?? `MSP tool ${name} returned an error`, 'MSP_TOOL_ERROR')
      }
      return result?.structuredContent ?? {}
    } finally {
      close()
    }
  }
}
