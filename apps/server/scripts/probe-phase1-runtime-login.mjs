import pg from 'pg'
import { pathToFileURL } from 'node:url'
import { pinnedSupabaseTlsOptions } from './supabase-tls.mjs'

// @req FR-051, FR-052 - prove the production LINE login is scope-bound and read-only.
// @spec SDD-026, SEC-010 - runtime queries must assume the forced-RLS NOLOGIN role.
// @tested tests/unit/phase1-runtime-login-probe.test.js

const EXPECTED = Object.freeze({
  projectRef: 'qcnmhyglarzcpudjorzc',
  loginRole: 'zuri_line_smartgift_login',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  rowCount: 74,
})

function isPoolerHost(hostname) {
  return hostname.endsWith('.pooler.supabase.com')
}

export function normalizeRuntimeDatabaseUrl(value) {
  if (!value) throw new Error('ZURI_LINE_DB_URL_REQUIRED')
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_PROTOCOL_FORBIDDEN')
  const username = decodeURIComponent(url.username)
  const direct = url.hostname === `db.${EXPECTED.projectRef}.supabase.co`
    && username === EXPECTED.loginRole
  const pooled = isPoolerHost(url.hostname)
    && username === `${EXPECTED.loginRole}.${EXPECTED.projectRef}`
  if (!direct && !pooled) throw new Error('DATABASE_PROJECT_OR_ROLE_FORBIDDEN')
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key)
  return url.toString()
}

function isPrivilegeDenied(error) {
  return error?.code === '42501'
}

export async function probeRuntimeLogin({ connectionString, Client = pg.Client } = {}) {
  const client = new Client({
    connectionString: normalizeRuntimeDatabaseUrl(connectionString),
    connectionTimeoutMillis: 10000,
    ssl: pinnedSupabaseTlsOptions(),
  })
  const result = {
    projectRef: EXPECTED.projectRef,
    loginRoleDirectReadDenied: false,
    scopedRoleAssumed: false,
    exactApprovedRowsVisible: false,
    foreignScopeRowsVisible: null,
    mutationDenied: false,
  }

  await client.connect()
  try {
    await client.query('begin')
    await client.query('savepoint direct_read_probe')
    try {
      await client.query('select count(*) from zuri_core.business_knowledge')
    } catch (error) {
      result.loginRoleDirectReadDenied = isPrivilegeDenied(error)
      await client.query('rollback to savepoint direct_read_probe')
    }

    await client.query('set local role zuri_line_smartgift_ro')
    const identity = await client.query('select current_user, session_user')
    result.scopedRoleAssumed = identity.rows[0]?.current_user === 'zuri_line_smartgift_ro'
      && identity.rows[0]?.session_user === EXPECTED.loginRole

    const inventory = await client.query(
      `select
         count(*)::integer as row_count,
         count(*) filter (
           where tenant_id <> $1 or business_id <> $2
         )::integer as foreign_scope_rows,
         bool_and(is_active and sensitivity = 'PUBLIC') as all_rows_allowed
       from zuri_core.business_knowledge`,
      [EXPECTED.tenantId, EXPECTED.businessId],
    )
    result.exactApprovedRowsVisible = inventory.rows[0]?.row_count === EXPECTED.rowCount
      && inventory.rows[0]?.all_rows_allowed === true
    result.foreignScopeRowsVisible = inventory.rows[0]?.foreign_scope_rows

    await client.query('savepoint mutation_probe')
    try {
      await client.query(
        `update zuri_core.business_knowledge
         set updated_at = updated_at
         where tenant_id = $1 and business_id = $2`,
        [EXPECTED.tenantId, EXPECTED.businessId],
      )
    } catch (error) {
      result.mutationDenied = isPrivilegeDenied(error)
      await client.query('rollback to savepoint mutation_probe')
    }
    await client.query('rollback')
  } catch (error) {
    try { await client.query('rollback') } catch {}
    throw error
  } finally {
    await client.end()
  }

  if (!result.loginRoleDirectReadDenied
    || !result.scopedRoleAssumed
    || !result.exactApprovedRowsVisible
    || result.foreignScopeRowsVisible !== 0
    || !result.mutationDenied) {
    const error = new Error('PHASE1_RUNTIME_LOGIN_PROBE_FAILED')
    error.result = result
    throw error
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  probeRuntimeLogin({ connectionString: process.env.ZURI_LINE_DB_URL })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify(error.result ?? { error: error.message })}\n`)
      process.exitCode = 1
    })
}
