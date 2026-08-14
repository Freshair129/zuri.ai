import { describe, expect, it, vi } from 'vitest'
import { normalizeRuntimeDatabaseUrl, probeRuntimeLogin } from '../../scripts/probe-phase1-runtime-login.mjs'
import {
  provisionRuntimeLogin,
  runtimeDatabaseUrlFromAdmin,
} from '../../scripts/provision-phase1-runtime-login.mjs'

// @req FR-051, FR-052 - production runtime login proof fails closed.
// @spec SDD-026, SEC-010
// @tested tests/unit/phase1-runtime-login-probe.test.js

const ref = 'qcnmhyglarzcpudjorzc'
const role = 'zuri_line_smartgift_login'
const password = 'p'.repeat(48)
const directUrl = `postgresql://${role}:secret@db.${ref}.supabase.co:5432/postgres`

function clientWith(results) {
  return class FakeClient {
    async connect() {}
    async end() {}
    async query() {
      const next = results.shift()
      if (next instanceof Error) throw next
      return next ?? { rows: [] }
    }
  }
}

describe('Phase 1 runtime-login production probe', () => {
  it('accepts dedicated direct/session-pooler roles only and strips connection TLS overrides', () => {
    expect(normalizeRuntimeDatabaseUrl(`${directUrl}?sslmode=no-verify`)).not.toContain('sslmode')
    expect(normalizeRuntimeDatabaseUrl(
      `postgresql://${role}.${ref}:secret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
    )).toContain(`${role}.${ref}`)
    expect(() => normalizeRuntimeDatabaseUrl(directUrl.replace(role, 'postgres'))).toThrow(/FORBIDDEN/)
    expect(() => normalizeRuntimeDatabaseUrl(directUrl.replace(ref, 'attacker-project'))).toThrow(/FORBIDDEN/)
  })

  it('derives a dedicated runtime URL from direct or session-pooler admin connections', () => {
    expect(runtimeDatabaseUrlFromAdmin(
      `postgresql://postgres:admin@db.${ref}.supabase.co:5432/postgres?sslmode=require`, password,
    )).toContain(`${role}:${password}@db.${ref}.supabase.co`)
    expect(runtimeDatabaseUrlFromAdmin(
      `postgresql://postgres.${ref}:admin@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`, password,
    )).toContain(`${role}.${ref}:${password}@aws-0-ap-northeast-2.pooler.supabase.com`)
  })

  it('rotates only the fixed runtime role then proves the derived login', async () => {
    const queries = []
    class AdminClient {
      async connect() {}
      async end() {}
      async query(sql) { queries.push(sql) }
    }
    const probe = vi.fn().mockResolvedValue({ mutationDenied: true })
    const adminConnectionString = `postgresql://postgres:admin@db.${ref}.supabase.co:5432/postgres`

    const provisioned = await provisionRuntimeLogin({
      adminConnectionString,
      runtimePassword: password,
      Client: AdminClient,
      probe,
    })

    expect(queries).toEqual([`alter role ${role} password '${password}'`])
    expect(provisioned.runtimeUrl).toContain(`${role}:${password}@db.${ref}.supabase.co`)
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith({ connectionString: provisioned.runtimeUrl })
  })

  it('passes only when direct read and mutation are denied and exact scoped inventory is visible', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: '42501' })
    const Client = clientWith([
      { rows: [] }, { rows: [] }, denied, { rows: [] }, { rows: [] },
      { rows: [{ current_user: 'zuri_line_smartgift_ro', session_user: role }] },
      { rows: [{ row_count: 74, foreign_scope_rows: 0, all_rows_allowed: true }] },
      { rows: [] }, denied, { rows: [] }, { rows: [] },
    ])
    await expect(probeRuntimeLogin({ connectionString: directUrl, Client })).resolves.toMatchObject({
      loginRoleDirectReadDenied: true,
      scopedRoleAssumed: true,
      exactApprovedRowsVisible: true,
      foreignScopeRowsVisible: 0,
      mutationDenied: true,
    })
  })

  it('fails closed when the visible inventory is not exact', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: '42501' })
    const Client = clientWith([
      { rows: [] }, { rows: [] }, denied, { rows: [] }, { rows: [] },
      { rows: [{ current_user: 'zuri_line_smartgift_ro', session_user: role }] },
      { rows: [{ row_count: 73, foreign_scope_rows: 0, all_rows_allowed: true }] },
      { rows: [] }, denied, { rows: [] }, { rows: [] },
    ])
    await expect(probeRuntimeLogin({ connectionString: directUrl, Client }))
      .rejects.toMatchObject({ message: 'PHASE1_RUNTIME_LOGIN_PROBE_FAILED' })
  })
})
