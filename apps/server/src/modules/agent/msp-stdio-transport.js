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

const DEFAULT_TIMEOUT_MS = 15_000

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
 * spawn.
 */
export function createMspTransportFromEnvironment(env = process.env) {
  const command = env.ZURI_MSP_COMMAND?.trim()
  if (!command) return null
  return createMspStdioTransport({
    command,
    args: parseArgs(env.ZURI_MSP_ARGS),
    cwd: env.ZURI_MSP_CWD?.trim() || undefined,
    env,
    timeoutMs: Number(env.ZURI_MSP_TIMEOUT_MS) > 0 ? Number(env.ZURI_MSP_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
  })
}

/**
 * `(name, input) => Promise<structuredContent>` over a freshly spawned MSP
 * process per call. A tool result with `isError` becomes a thrown error
 * carrying the tool's own text, so a caller sees `gks_provider_unconfigured`
 * or `vault_scope_denied` verbatim rather than a generic failure.
 */
export function createMspStdioTransport({ command, args = [], cwd, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('createMspStdioTransport requires a command')

  return async function callMspTool(name, input) {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
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
