import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  PRODUCTION_PROJECT_REF,
  RECONCILIATION_PLAN,
  parseArgs,
  withoutTransactionWrapper,
} from '../../scripts/production-migration-reconcile.mjs'

// @req FR-051, FR-069, FR-094, FR-095, FR-268, FR-272 — the production
// reconciliation lane is explicit, allowlisted and refuses an unreviewed
// target or an incomplete catalog/security precondition.
// @spec ADR-104, ADR-057, SEC-001, SEC-018
// @tested tests/unit/production-migration-reconciliation.test.js

const SERVER_ROOT = process.cwd()

describe('production migration reconciliation contract', () => {
  it('pins one ordered version/name/path for every approved production step', () => {
    const versions = RECONCILIATION_PLAN.map((item) => item.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect(versions).toEqual([...versions].sort())
    expect(RECONCILIATION_PLAN).toHaveLength(11)
    for (const item of RECONCILIATION_PLAN) {
      expect(item.name).toMatch(/^[a-z0-9_]+$/)
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(fs.existsSync(path.join(SERVER_ROOT, item.relativePath))).toBe(true)
    }
    expect(PRODUCTION_PROJECT_REF).toBe('qcnmhyglarzcpudjorzc')
  })

  it('keeps historical reconciliation separate from SQL execution', () => {
    expect(RECONCILIATION_PLAN.filter((item) => item.mode === 'record')).toHaveLength(6)
    expect(RECONCILIATION_PLAN.filter((item) => item.mode === 'apply')).toHaveLength(5)
    for (const item of RECONCILIATION_PLAN.filter((candidate) => candidate.mode === 'record')) {
      expect(item.checks).toBeDefined()
    }
  })

  it('requires explicit target and evidence receipts before either dry-run or apply', () => {
    expect(() => parseArgs(['--apply', '--project-ref', PRODUCTION_PROJECT_REF])).not.toThrow()
    expect(() => parseArgs(['--unknown'])).toThrow(/unknown option/)
    expect(() => parseArgs(['--project-ref'])).toThrow(/requires a value/)
  })

  it('strips SQL transaction wrappers even when migration comments precede BEGIN', () => {
    for (const item of RECONCILIATION_PLAN.filter((candidate) => candidate.mode === 'apply')) {
      const sql = fs.readFileSync(path.join(SERVER_ROOT, item.relativePath), 'utf8')
      const stripped = withoutTransactionWrapper(sql)
      expect(stripped).not.toMatch(/\bBEGIN;\s*/i)
      expect(stripped).not.toMatch(/\bCOMMIT;\s*$/i)
    }
  })

  it('hardens every table that can be created by the approved set', () => {
    const sql = fs.readFileSync(
      path.join(SERVER_ROOT, 'supabase/migrations/20260923020000_pm_trace_and_iam_rls_hardening.sql'),
      'utf8',
    )
    for (const table of ['MfaFactor', 'PasskeyCredential', 'ProjectExecutionRun', 'ProjectExecutionStep']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.%I ENABLE ROW LEVEL SECURITY`, 'i'))
      expect(sql).toContain(`'${table}'`)
    }
    expect(sql).toMatch(/force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all/i)
    expect(sql).toMatch(/revoke all on table public\.%I from public, anon, authenticated, service_role/i)
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.%I to zuri_app_runtime, zuri_web_login/i)
    expect(sql).not.toMatch(/schema_migrations/i)
  })
})
