import pg from 'pg'
import {
  parseRuntimeIsolationEnvironment,
  runRuntimeIsolationProbe,
} from '../src/modules/knowledge/runtime-isolation-probe.js'

// @req FR-054 — operators can generate a live dedicated-login isolation report.
// @spec SDD-027, SEC-011 — configuration is environment-only and output is secret-redacted.
// @tested tests/unit/runtime-isolation-probe.test.js

let client = null
let connected = false

try {
  const config = parseRuntimeIsolationEnvironment(process.env)
  client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: true },
  })
  await client.connect()
  connected = true
  const report = await runRuntimeIsolationProbe({ client, ...config })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.status !== 'PASS') process.exitCode = 1
} catch (error) {
  const safeReasons = new Set([
    'RUNTIME_ISOLATION_CONFIGURATION_MISSING',
    'RUNTIME_ISOLATION_DATABASE_URL_INVALID',
    'RUNTIME_ISOLATION_DATABASE_ROLE_FORBIDDEN',
    'RUNTIME_ISOLATION_CLIENT_REQUIRED',
  ])
  const reason = safeReasons.has(error?.message)
    ? error.message
    : 'RUNTIME_ISOLATION_PROBE_FAILED'
  process.stdout.write(`${JSON.stringify({ version: '1.0.0', status: 'ERROR', reason }, null, 2)}\n`)
  process.exitCode = 1
} finally {
  if (connected) {
    try {
      await client.end()
    } catch {
      process.exitCode = 1
    }
  }
}
