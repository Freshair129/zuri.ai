// @spec docs/architecture/VERIFICATION-POLICY.md — prove file boundaries with real Prisma queries.
// @tested tests/unit/test-database-file-isolation.test.js
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PROBE_OUTPUT = mkdtempSync(path.join(tmpdir(), 'zuri-file-db-isolation-'))

afterAll(() => {
  const target = path.resolve(PROBE_OUTPUT)
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('zuri-file-db-isolation-')) {
    throw new Error('TEST_DATABASE_PROBE_CLEANUP_BOUNDARY_INVALID')
  }
  rmSync(target, { recursive: true, force: true })
})

describe('per-file SQLite test databases', () => {
  it('starts each test file from the same empty schema while retaining state within a file', () => {
    const postgresKeys = [
      'POSTGRES_PRISMA_URL',
      'POSTGRES_URL',
      'POSTGRES_URL_NON_POOLING',
      'DATABASE_POSTGRES_URL',
    ]
    const env = { ...process.env, ZURI_FILE_DB_PROBE_OUTPUT: PROBE_OUTPUT }
    for (const key of postgresKeys) delete env[key]

    const result = spawnSync(
      process.execPath,
      [
        path.join(SERVER_ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        'tests/fixtures/file-database-isolation/vitest.config.js',
      ],
      { cwd: SERVER_ROOT, env, encoding: 'utf8', timeout: 25_000 },
    )

    expect(result.error, `${result.stdout ?? ''}\n${result.stderr ?? ''}`).toBeUndefined()
    expect(result.status, `${result.stdout ?? ''}\n${result.stderr ?? ''}`).toBe(0)
    expect((result.stdout.match(/Your database is now in sync with your Prisma schema\./g) ?? []))
      .toHaveLength(1)

    const first = JSON.parse(readFileSync(path.join(PROBE_OUTPUT, 'probe-a.json'), 'utf8'))
    const second = JSON.parse(readFileSync(path.join(PROBE_OUTPUT, 'probe-b.json'), 'utf8'))
    expect(first.databaseUrl).not.toBe(second.databaseUrl)
    expect(first.databaseUrl.match(/^(file:\.\/\.test-dbs\/run-[A-Za-z0-9-]+)-file-/)?.[1])
      .toBe(second.databaseUrl.match(/^(file:\.\/\.test-dbs\/run-[A-Za-z0-9-]+)-file-/)?.[1])
    expect(first.withinFileCount).toBe(1)
    expect(second.initialProbeTableCount).toBe(0)
    expect(first.portfolioCount).toBe(0)
    expect(second.portfolioCount).toBe(0)
    const runPrefix = /\/(run-[A-Za-z0-9-]+)-file-[a-f0-9]+\.db$/.exec(first.databaseUrl)?.[1]
    expect(runPrefix).toBeTruthy()
    expect(readdirSync(path.join(SERVER_ROOT, 'prisma/.test-dbs'))
      .filter(name => name === `${runPrefix}.db` || name.startsWith(`${runPrefix}.db-`) || name.startsWith(`${runPrefix}-file-`))).toEqual([])
  })
})
