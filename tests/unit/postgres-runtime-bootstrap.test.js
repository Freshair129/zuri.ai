import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-030 — provider-aware runtime bootstrap and local-only database commands.
// @spec ADR-035, SEC-011.
// @tested tests/unit/postgres-runtime-bootstrap.test.js

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('PostgreSQL primary runtime boundary', () => {
  it('loads .env only in the child process and never prints secret values', () => {
    const launcher = read('scripts/run-with-env-file.mjs')

    expect(launcher).toContain('parseEnv')
    expect(launcher).toContain('childEnv[key] === undefined')
    expect(launcher).toContain('values omitted')
    expect(launcher).not.toMatch(/console\.log\([^\n]*(DATABASE_URL|DIRECT_URL)/)
  })

  it('verifies PostgreSQL with read-only information_schema access', () => {
    const verifier = read('scripts/verify-postgres-runtime.mjs')

    expect(verifier).toContain('DATABASE_URL_MUST_BE_POSTGRES')
    expect(verifier).toContain('information_schema.tables')
    expect(verifier).not.toMatch(/db:push|db:reset|db:clean|migrate deploy/)
    expect(verifier).not.toMatch(/console\.error\([^\n]*databaseUrl/)
  })

  it('refuses SQLite schema commands when the process target is PostgreSQL', () => {
    const result = spawnSync(process.execPath, ['scripts/assert-sqlite-runtime.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: 'postgresql://example.invalid/postgres' },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('SQLITE_COMMAND_REQUIRES_FILE_DATABASE_URL')
  })

  it('refuses PostgreSQL demo seed without explicit opt-in before opening a client', () => {
    const result = spawnSync(process.execPath, ['prisma/seed.js'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: 'postgresql://example.invalid/postgres', ZURI_ALLOW_POSTGRES_SEED: '' },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('POSTGRES_SEED_REQUIRES_EXPLICIT_OPT_IN')
    expect(`${result.stdout}${result.stderr}`).not.toContain('example.invalid')
  })

  it('keeps an explicit local runner with SQLite bootstrap and seed', () => {
    const runner = read('run-local.bat')

    expect(runner).toContain('set "DATABASE_URL=file:./dev.db"')
    expect(runner).toContain('call npm run db:push')
    expect(runner).toContain('call npm run db:seed')
  })

  it('keeps the provider-specific client contract wired', () => {
    const packageJson = JSON.parse(read('package.json'))

    expect(packageJson.scripts['db:pg:verify']).toContain('verify-postgres-runtime.mjs')
    expect(packageJson.scripts['db:seed']).toContain('--env-file-if-exists=.env')
    expect(execFileSync(process.execPath, ['-e', "console.log(require('./package.json').scripts['db:push'])"], { encoding: 'utf8' })).toContain('assert-sqlite-runtime.mjs')
  })
})
