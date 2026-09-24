import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEST_KEY } from './fixtures.js'

// Starts the REAL SCM entrypoint (src/main.js) as a separate OS process on a
// disposable SQLite file and an ephemeral port; returns an HTTP client.
const main = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main.js')

export async function startScmProcess({ sqlitePath, env = {} }) {
  const child = spawn(process.execPath, [main], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SCM_ENV: 'test', SCM_PORT: '0', SCM_SQLITE_PATH: sqlitePath, SCM_DELEGATION_KEY: TEST_KEY, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const lines = []
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SCM process did not start: ${stderr}`)), 15000)
    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1)
        try { const entry = JSON.parse(line); lines.push(entry); if (entry.message === 'listening') { clearTimeout(timer); resolve(entry.port) } } catch { /* non-JSON */ }
      }
    })
    child.once('exit', (code) => { clearTimeout(timer); reject(Object.assign(new Error(`SCM process exited ${code}: ${stderr}`), { exitCode: code, logs: lines })) })
  })
  const base = `http://127.0.0.1:${port}`
  const request = async (method, path, { token, key, body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Delegation ${token}` } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json() }
  }
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  return {
    child, port, base, logs: lines, request,
    async stop() { if (child.exitCode === null) child.kill('SIGTERM'); return exited },
    async kill() { if (child.exitCode === null) child.kill('SIGKILL'); return exited },
  }
}
