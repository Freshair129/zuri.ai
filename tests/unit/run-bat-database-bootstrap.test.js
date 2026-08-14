import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-046 — local demo startup owns a safe SQLite datasource when no environment is provided.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/run-bat-database-bootstrap.test.js

const readRunBat = () => readFileSync(resolve(process.cwd(), 'run.bat'), 'utf8')

describe('run.bat database bootstrap', () => {
  it('sets the documented local SQLite URL only when DATABASE_URL is absent', () => {
    const script = readRunBat()
    const fallback = 'if not defined DATABASE_URL set "DATABASE_URL=file:./dev.db"'

    expect(script).toContain(fallback)
    expect(script.indexOf(fallback)).toBeLessThan(script.indexOf('call npm run db:push'))
    expect(script).not.toContain('set "DATABASE_URL=file:./dev.db"\nset "DATABASE_URL=')
  })
})
