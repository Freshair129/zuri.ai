import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { pinnedSupabaseTlsOptions } from './supabase-tls.mjs'

const PROJECT_REF = 'qcnmhyglarzcpudjorzc'
const LOGIN_ROLE = 'zuri_customer_review_login'
const SECRET = /^[A-Za-z0-9_-]{43,128}$/

function isPoolerHost(hostname) {
  return hostname.endsWith('.pooler.supabase.com')
}

function normalizeAdminDatabaseUrl(value) {
  if (!value) throw new Error('ZURI_ADMIN_DB_URL_REQUIRED')
  const url = new URL(value)
  const username = decodeURIComponent(url.username)
  const direct = url.hostname === `db.${PROJECT_REF}.supabase.co` && username === 'postgres'
  const pooled = isPoolerHost(url.hostname) && username === `postgres.${PROJECT_REF}`
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled)) {
    throw new Error('ADMIN_DATABASE_PROJECT_OR_ROLE_FORBIDDEN')
  }
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
  return url
}

export function customerReviewRuntimeDatabaseUrlFromAdmin(adminConnectionString, password) {
  if (!SECRET.test(password ?? '')) throw new Error('CUSTOMER_REVIEW_RUNTIME_PASSWORD_INVALID')
  const url = normalizeAdminDatabaseUrl(adminConnectionString)
  url.username = isPoolerHost(url.hostname) ? `${LOGIN_ROLE}.${PROJECT_REF}` : LOGIN_ROLE
  url.password = password
  return url.toString()
}

export async function provisionCustomerReviewRuntimeLogin({
  adminConnectionString,
  runtimePassword,
  Client = pg.Client,
} = {}) {
  if (!SECRET.test(runtimePassword ?? '')) {
    throw new Error('CUSTOMER_REVIEW_RUNTIME_PASSWORD_INVALID')
  }
  const adminUrl = normalizeAdminDatabaseUrl(adminConnectionString).toString()
  const client = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 10_000,
    ssl: pinnedSupabaseTlsOptions(),
  })
  await client.connect()
  try {
    await client.query(`alter role ${LOGIN_ROLE} password '${runtimePassword}'`)
  } finally {
    await client.end()
  }
  return {
    loginRole: LOGIN_ROLE,
    runtimeUrl: customerReviewRuntimeDatabaseUrlFromAdmin(adminConnectionString, runtimePassword),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionCustomerReviewRuntimeLogin({
    adminConnectionString: process.env.ZURI_ADMIN_DB_URL,
    runtimePassword: process.env.ZURI_CUSTOMER_REVIEW_DB_PASSWORD,
  }).then(({ loginRole }) => {
    process.stdout.write(`${JSON.stringify({ loginRole, passwordUpdated: true })}\n`)
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: error.message })}\n`)
    process.exitCode = 1
  })
}
