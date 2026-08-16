import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  TEST_DB_DIR,
  testDatabaseTarget,
  testDatabaseFiles,
  removeTestDatabase,
  sweepAbandonedDatabases,
  assertSchemaApplied,
} from '../global-setup.js'

// Same reason as in global-setup.js: vitest 2.x's Vite cannot resolve node:sqlite.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

// The test harness's own setup step. It ran unverified until recently: a `db push`
// that reported success without applying the schema surfaced as a dozen suites each
// failing with "The table main.Portfolio does not exist", and two concurrent runs
// collided on one shared prisma/test.db. Each run now gets its own database file.

const dir = mkdtempSync(path.join(tmpdir(), 'db-reset-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('per-run test database', () => {
  it('names a database no other run can be using', () => {
    const a = testDatabaseTarget()
    const b = testDatabaseTarget()
    expect(a.name).not.toEqual(b.name)
    expect(a.file.startsWith(TEST_DB_DIR)).toBe(true)
  })

  it('addresses it relative to prisma/, the directory Prisma resolves file: against', () => {
    const { name, url } = testDatabaseTarget()
    expect(url).toBe(`file:./.test-dbs/${name}`)
  })
})

describe('test database cleanup', () => {
  it('accounts for every file SQLite writes, not just the .db', () => {
    // A rollback journal outlives a process killed mid-transaction; leaving it
    // behind means part of an old database survives a "fresh" start.
    expect(testDatabaseFiles('/tmp/test.db')).toEqual([
      '/tmp/test.db',
      '/tmp/test.db-journal',
      '/tmp/test.db-wal',
      '/tmp/test.db-shm',
    ])
  })

  it('removes each of them when present and skips the ones that are not', () => {
    const removed = []
    const reported = removeTestDatabase('/tmp/test.db', {
      exists: (f) => !f.endsWith('-shm'),
      remove: (f) => removed.push(f),
    })
    expect(removed).toEqual(['/tmp/test.db', '/tmp/test.db-journal', '/tmp/test.db-wal'])
    expect(reported).toEqual(removed)
  })

  it('leaves a locked database alone — it belongs to a run that is still going', () => {
    const locked = Object.assign(new Error('EPERM, Permission denied'), { code: 'EPERM' })
    expect(
      removeTestDatabase('/tmp/test.db', {
        exists: () => true,
        remove: () => {
          throw locked
        },
      }),
    ).toEqual([])
  })

  it('does not disguise an unrelated filesystem failure', () => {
    const denied = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    expect(() =>
      removeTestDatabase('/tmp/test.db', {
        exists: () => true,
        remove: () => {
          throw denied
        },
      }),
    ).toThrow(/read-only filesystem/)
  })
})

describe('sweeping databases left by runs that never reached teardown', () => {
  const ages = { 'old.db': 12 * 60 * 60 * 1000, 'fresh.db': 60 * 1000 }
  const now = Date.now()
  const sweep = (extra = {}) =>
    sweepAbandonedDatabases('/dbs', {
      now,
      list: () => ['old.db', 'fresh.db', 'notes.txt'],
      modifiedAt: (f) => now - ages[path.basename(f)],
      exists: (f) => f.endsWith('.db'),
      remove: () => {},
      ...extra,
    })

  it('removes the stale ones and leaves databases a live run could still own', () => {
    expect(sweep()).toEqual([path.join('/dbs', 'old.db')])
  })

  it('ignores files that are not databases', () => {
    expect(sweep().some((f) => f.endsWith('notes.txt'))).toBe(false)
  })

  it('says nothing when the directory does not exist yet', () => {
    expect(
      sweepAbandonedDatabases('/dbs', {
        list: () => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        },
      }),
    ).toEqual([])
  })
})

describe('schema verification', () => {
  it('passes when the foundation tables are present', () => {
    const p = path.join(dir, 'good.db')
    const db = new DatabaseSync(p)
    for (const t of ['Portfolio', 'Tenant', 'Business']) db.exec(`CREATE TABLE ${t}(id TEXT)`)
    db.close()
    expect(() => assertSchemaApplied(p)).not.toThrow()
  })

  it('names the missing tables when a push lands short', () => {
    const p = path.join(dir, 'partial.db')
    const db = new DatabaseSync(p)
    db.exec('CREATE TABLE Portfolio(id TEXT)')
    db.close()
    expect(() => assertSchemaApplied(p)).toThrow(/Tenant, Business .* missing/)
  })
})
