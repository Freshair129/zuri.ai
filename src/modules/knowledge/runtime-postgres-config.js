import { readFileSync } from 'node:fs'

// @req FR-052, FR-054 — one exact dedicated-login contract for direct and Supavisor runtime reads.
// @spec SDD-026, SDD-027, SEC-010, SEC-011
// @tested tests/unit/runtime-postgres-config.test.js

export const PHASE1_PROJECT_REF = 'qcnmhyglarzcpudjorzc'
export const PHASE1_LOGIN_ROLE = 'zuri_line_smartgift_login'

const DIRECT_HOST = `db.${PHASE1_PROJECT_REF}.supabase.co`
const POOLER_ROLE = `${PHASE1_LOGIN_ROLE}.${PHASE1_PROJECT_REF}`
const POOLER_HOST = 'aws-0-ap-northeast-2.pooler.supabase.com'

export function parseDedicatedRuntimeDatabaseUrl(value, {
  invalidError = 'PHASE1_DATABASE_URL_INVALID',
  forbiddenError = 'PHASE1_DATABASE_ROLE_FORBIDDEN',
} = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(invalidError)
  }

  const username = decodeURIComponent(url.username)
  const direct = username === PHASE1_LOGIN_ROLE && url.hostname === DIRECT_HOST
  const pooler = username === POOLER_ROLE && url.hostname === POOLER_HOST
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || (!direct && !pooler)
    || url.port !== '5432'
    || url.pathname !== '/postgres') {
    throw new Error(forbiddenError)
  }

  return { url, role: PHASE1_LOGIN_ROLE, connectionMode: pooler ? 'SUPAVISOR_SESSION' : 'DIRECT' }
}

export function readRuntimeDatabaseCa(env = process.env) {
  const path = env.ZURI_LINE_DB_CA_FILE
  if (!path) throw new Error('PHASE1_DATABASE_CA_REQUIRED')

  let ca
  try {
    ca = readFileSync(path, 'utf8')
  } catch {
    throw new Error('PHASE1_DATABASE_CA_INVALID')
  }
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('PHASE1_DATABASE_CA_INVALID')
  }
  return { rejectUnauthorized: true, ca }
}
