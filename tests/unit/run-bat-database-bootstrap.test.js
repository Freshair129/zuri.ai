import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-046 — local demo startup owns a safe SQLite datasource when no environment is provided.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/run-bat-database-bootstrap.test.js

const readRunBat = () => readFileSync(resolve(process.cwd(), 'run.bat'), 'utf8')

describe('run.bat database bootstrap', () => {
  it('uses the PostgreSQL runtime preflight and never falls back to SQLite', () => {
    const script = readRunBat()

    expect(script).toContain('call npm run db:pg:verify')
    expect(script).not.toContain('call npm run db:push')
    expect(script).not.toContain('if not defined DATABASE_URL set "DATABASE_URL=file:./dev.db"')
    expect(script).toContain('ZURI_ALLOW_POSTGRES_SEED')
    expect(script).toContain('ZURI_ALLOW_POSTGRES_LOCAL_DEMO')
    expect(script).toContain('set "ZURI_LOCAL_DEMO_AUTH="')
    expect(script).not.toMatch(/^set "ZURI_LOCAL_DEMO_AUTH=1"$/m)
  })

  it('bootstraps the process-local Supabase credential before startup and verifies isolation', () => {
    const script = readRunBat()

    expect(script).toContain('scripts\\run-with-supabase-runtime.ps1')
    expect(script).toContain('ZURI_SUPABASE_RUNTIME_BOOTSTRAPPED')
    expect(script).toContain('call npm run phase1:isolation:verify')
    expect(script).toContain('run-local.bat')
    expect(script.indexOf('call npm run phase1:isolation:verify')).toBeLessThan(script.indexOf('call npm run dev'))
    expect(script).not.toMatch(/echo[^\r\n]*ZURI_LINE_DB_URL/i)
  })

  it('only invokes the PostgreSQL demo seed behind an explicit opt-in', () => {
    const script = readRunBat()

    expect(script).toMatch(/if "%ZURI_ALLOW_POSTGRES_SEED%"=="1" \(/)
    expect(script.indexOf('call npm run db:seed')).toBeGreaterThan(script.indexOf('ZURI_ALLOW_POSTGRES_SEED'))
  })
})
