import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { normalizeRuntimeDatabaseUrl, probeRuntimeLogin } from './probe-phase1-runtime-login.mjs'

const PROJECT_REF = 'qcnmhyglarzcpudjorzc'
const LOGIN_ROLE = 'zuri_line_smartgift_login'
const SECRET = /^[A-Za-z0-9_-]{43,128}$/

function poolerHost(hostname) {
  return hostname.endsWith('.pooler.supabase.com')
}

function normalizeAdminDatabaseUrl(value) {
  if (!value) throw new Error('ZURI_ADMIN_DB_URL_REQUIRED')
  const url = new URL(value)
  const username = decodeURIComponent(url.username)
  const direct = url.hostname === `db.${PROJECT_REF}.supabase.co` && username === 'postgres'
  const pooled = poolerHost(url.hostname) && username === `postgres.${PROJECT_REF}`
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)) {
    throw new Error('ADMIN_DATABASE_PROJECT_OR_ROLE_FORBIDDEN')
  }
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
  return url
}

export function runtimeDatabaseUrlFromAdmin(adminConnectionString, password) {
  if (!SECRET.test(password)) throw new Error('RUNTIME_DATABASE_PASSWORD_INVALID')
  const url = normalizeAdminDatabaseUrl(adminConnectionString)
  url.username = poolerHost(url.hostname) ? `${LOGIN_ROLE}.${PROJECT_REF}` : LOGIN_ROLE
  url.password = password
  return normalizeRuntimeDatabaseUrl(url.toString())
}

export async function provisionRuntimeLogin({
  adminConnectionString,
  runtimePassword,
  Client = pg.Client,
  probe = probeRuntimeLogin,
} = {}) {
  if (!SECRET.test(runtimePassword ?? '')) throw new Error('RUNTIME_DATABASE_PASSWORD_INVALID')
  const adminUrl = normalizeAdminDatabaseUrl(adminConnectionString).toString()
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: true },
  })
  await client.connect()
  try {
    await client.query(`alter role ${LOGIN_ROLE} password '${runtimePassword}'`)
  } finally {
    await client.end()
  }
  const runtimeUrl = runtimeDatabaseUrlFromAdmin(adminConnectionString, runtimePassword)
  const result = await probe({ connectionString: runtimeUrl })
  return { runtimeUrl, result }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionRuntimeLogin({
    adminConnectionString: process.env.ZURI_ADMIN_DB_URL,
    runtimePassword: process.env.ZURI_RUNTIME_DB_PASSWORD,
  }).then(({ result }) => {
    process.stdout.write(`${JSON.stringify({ ...result, runtimeCredentialStoredByWrapper: true })}\n`)
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`)
    process.exitCode = 1
  })
}
