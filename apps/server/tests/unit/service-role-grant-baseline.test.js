import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req SEC-003, SEC-001 — `public` stays out of service_role's reach once it is
//   taken back.
// @spec ADR-056; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested this file
//
// This is a static check and says so: it reads migration text, never a
// database. What it can prove is that no migration written after the revoke
// hands the grant back — which is the realistic way it would return, since
// Supabase's own tooling and copied boilerplate both like to GRANT to the three
// API roles. What it cannot prove is the live state of production; that check
// is the query in DB-MIGRATION-NOTES, run after an apply.
//
// The pairing matters. An earlier attempt at a static check for the per-table
// security block was abandoned because several migrations create policies in a
// DO loop, so scanning text reported 75 of 84 tables as missing one while the
// database said 83 of 84 had one. A guard that cries wolf gets muted. This one
// has no such ambiguity: a GRANT naming service_role is a GRANT naming
// service_role.

const DIR = 'supabase/migrations'
const REVOKE = '20260906235000_revoke_service_role_on_public.sql'
const REVOKE_FN = '20260907130000_revoke_execute_on_public_functions.sql'
const API_ROLES = ['service_role', 'anon', 'authenticated']
const read = (name) => readFileSync(resolve(process.cwd(), DIR, name), 'utf8')
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '')
const grantsTo = (sql, role, executeOnly = false) => new RegExp(
  `\\bGRANT\\b${executeOnly ? '[^;]*\\bEXECUTE\\b' : ''}[^;]*\\bTO\\b[^;]*\\b${role}\\b`, 'i',
).test(stripComments(sql))
const migrations = () => readdirSync(resolve(process.cwd(), DIR)).filter((f) => f.endsWith('.sql')).sort()

describe('grant recipient scanning', () => {
  it('does not join a runtime grant to the next API-role revoke', () => {
    const sql = 'GRANT SELECT ON TABLE "Example" TO zuri_app_runtime; REVOKE ALL ON TABLE "Example" FROM service_role;'
    expect(grantsTo(sql, 'service_role')).toBe(false)
    expect(grantsTo('GRANT EXECUTE ON FUNCTION example() TO zuri_app_runtime; REVOKE EXECUTE ON FUNCTION example() FROM anon;', 'anon', true)).toBe(false)
  })

  it('still catches actual recipients, including long grants and quoted lists', () => {
    expect(grantsTo('GRANT SELECT ON TABLE "Example" TO service_role;', 'service_role')).toBe(true)
    expect(grantsTo(`GRANT SELECT ON TABLE ${Array.from({ length: 40 }, (_, i) => `"Table${i}"`).join(', ')} TO zuri_app_runtime, "service_role";`, 'service_role')).toBe(true)
    expect(grantsTo('GRANT EXECUTE ON FUNCTION example() TO zuri_app_runtime, authenticated;', 'authenticated', true)).toBe(true)
    expect(grantsTo('GRANT SELECT ON TABLE service_role TO zuri_app_runtime;', 'service_role')).toBe(false)
  })
})

describe('the revoke migration says what it must', () => {
  const sql = stripComments(read(REVOKE))

  it('revokes the existing grants on tables and sequences', () => {
    expect(sql).toMatch(/REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+service_role/i)
    expect(sql).toMatch(/REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+FROM\s+service_role/i)
  })

  it('closes the default privileges, which is the part that keeps it closed', () => {
    // Without these two lines the next CREATE TABLE inherits the grant again —
    // exactly how LineConversationJob arrived with all seven privileges on
    // 2026-09-06, after the 2026-08-21 hardening had already run.
    expect(sql).toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+REVOKE\s+ALL\s+ON\s+TABLES\s+FROM\s+service_role/i)
    expect(sql).toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+REVOKE\s+ALL\s+ON\s+SEQUENCES\s+FROM\s+service_role/i)
  })

  it('touches no schema other than public', () => {
    // storage (7 tables), realtime (2) and vault (2) also grant service_role,
    // and the deployment's Storage credential needs the first of those.
    for (const schema of ['storage', 'realtime', 'vault', 'auth', 'extensions']) {
      expect(sql).not.toMatch(new RegExp(`SCHEMA\\s+${schema}\\b`, 'i'))
    }
  })
})

describe('no later migration hands the grant back', () => {
  it('contains no GRANT to service_role after the revoke', () => {
    const after = migrations().filter((name) => name > REVOKE)
    const offenders = after.filter((name) => grantsTo(read(name), 'service_role'))
    expect(offenders).toEqual([])
  })

  it('the revoke itself is still present and is the newest word on the subject', () => {
    // A migration that deleted the revoke rather than superseding it would pass
    // the check above by having nothing to find.
    expect(migrations()).toContain(REVOKE)
  })
})

describe('the function revoke closes the door the table revoke left open', () => {
  const sql = stripComments(read(REVOKE_FN))

  it('revokes the EXECUTE default from all three API roles', () => {
    // This is the load-bearing half: `public` holds no functions today, so the
    // only thing this migration can affect is the first one somebody adds.
    for (const role of API_ROLES) {
      expect(sql).toMatch(new RegExp(`ALTER\\s+DEFAULT\\s+PRIVILEGES\\s+IN\\s+SCHEMA\\s+public\\s+REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTIONS\\s+FROM\\s+${role}\\b`, 'i'))
    }
  })

  it('also revokes on existing functions, so it stays correct if one lands first', () => {
    for (const role of API_ROLES) {
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+ALL\\s+FUNCTIONS\\s+IN\\s+SCHEMA\\s+public\\s+FROM\\s+${role}\\b`, 'i'))
    }
  })

  it('touches no schema other than public', () => {
    for (const schema of ['storage', 'realtime', 'vault', 'auth', 'extensions']) {
      expect(sql).not.toMatch(new RegExp(`SCHEMA\\s+${schema}\\b`, 'i'))
    }
  })

  it('leaves the supabase_admin-owned default alone', () => {
    // Altering it would need to run as that role, and nothing here creates
    // objects that way. A migration that tried would fail on production rather
    // than in review, which is the worst place to find out.
    expect(sql).not.toMatch(/FOR\s+ROLE\s+supabase_admin/i)
  })
})

describe('no later migration hands EXECUTE back', () => {
  it('contains no GRANT EXECUTE to an API role after the function revoke', () => {
    const after = migrations().filter((name) => name > REVOKE_FN)
    const offenders = after.filter((name) => {
      const sql = stripComments(read(name))
      return API_ROLES.some((role) => grantsTo(sql, role, true))
    })
    expect(offenders).toEqual([])
  })

  it('the function revoke is still present', () => {
    expect(migrations()).toContain(REVOKE_FN)
  })
})
