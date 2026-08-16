import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { testDatabaseFiles, removeTestDatabase, assertSchemaApplied } from '../global-setup.js'

// Same reason as in global-setup.js: vitest 2.x's Vite cannot resolve node:sqlite.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

// The test harness's own reset step. It ran unverified until now: a `db push` that
// reported success without applying the schema surfaced as a dozen suites each
// failing with "The table main.Portfolio does not exist", and a second concurrent
// run surfaced as a bare EPERM stack trace from fs.

const dir = mkdtempSync(path.join(tmpdir(), 'db-reset-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('test database reset', () => {
  it('accounts for every file SQLite writes, not just the .db', () => {
    // A rollback journal outlives a process killed mid-transaction; leaving it
    // behind means the next run starts from a partially-old database.
    expect(testDatabaseFiles('/tmp/test.db')).toEqual([
      '/tmp/test.db',
      '/tmp/test.db-journal',
      '/tmp/test.db-wal',
      '/tmp/test.db-shm',
    ])
  })

  it('removes each of them when present and skips the ones that are not', () => {
    const removed = []
    removeTestDatabase('/tmp/test.db', {
      exists: (f) => !f.endsWith('-shm'),
      remove: (f) => removed.push(f),
    })
    expect(removed).toEqual(['/tmp/test.db', '/tmp/test.db-journal', '/tmp/test.db-wal'])
  })

  it('reports a locked database as a concurrent run, not a raw fs error', () => {
    const locked = Object.assign(new Error('EPERM, Permission denied'), { code: 'EPERM' })
    expect(() =>
      removeTestDatabase('/tmp/test.db', { exists: () => true, remove: () => { throw locked } }),
    ).toThrow(/another test run is holding it open/)
  })

  it('does not disguise an unrelated filesystem failure', () => {
    const denied = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    expect(() =>
      removeTestDatabase('/tmp/test.db', { exists: () => true, remove: () => { throw denied } }),
    ).toThrow(/read-only filesystem/)
  })

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
