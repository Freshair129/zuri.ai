import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import {
  ensureFileTestDatabaseDirectory,
  cleanupRunFileTestDatabases,
  cloneFileTestDatabase,
  directUrlForFileDatabase,
  prepareTestDatabaseForFile,
  removeFileTestDatabase,
} from '../helpers/file-test-database.js'

// Same reason as in global-setup.js: vitest 2.x's Vite cannot resolve node:sqlite.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

// The test harness prepares one verified schema template per run, then clones it
// to an exclusive SQLite database for each test file.

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

describe('per-file test database clones', () => {
  it('passes PostgreSQL URLs through without per-file cloning', () => {
    const databaseUrl = 'postgresql://test.invalid/zuri_server_test'
    expect(prepareTestDatabaseForFile({ databaseUrl, engine: 'postgresql' })).toEqual({
      url: databaseUrl,
      fileDatabase: null,
    })
  })

  it('fails closed for an unknown database engine instead of treating it as SQLite', () => {
    expect(() => prepareTestDatabaseForFile({ databaseUrl: 'file:./.test-dbs/run-unknown.db', engine: 'mysql' }))
      .toThrow(/ENGINE_UNSUPPORTED/)
  })

  it('redirects DIRECT_URL only when it still names the injected SQLite template', () => {
    const templateUrl = 'file:./.test-dbs/run-owned.db'
    const fileUrl = 'file:./.test-dbs/run-owned-file-0123456789abcdef01234567.db'
    expect(directUrlForFileDatabase(templateUrl, templateUrl, fileUrl)).toBe(fileUrl)
    expect(directUrlForFileDatabase('postgresql://other.invalid/app', templateUrl, fileUrl))
      .toBe('postgresql://other.invalid/app')
    expect(directUrlForFileDatabase(undefined, templateUrl, fileUrl)).toBeUndefined()
  })

  it('copies one closed schema template to a distinct exclusive file per test path', () => {
    const runPrefix = 'run-file-isolation-fixture'
    const templateName = `${runPrefix}.db`
    const templateFile = path.join(dir, templateName)
    const template = new DatabaseSync(templateFile)
    template.exec('CREATE TABLE TemplateSchema(id TEXT)')
    template.close()

    const first = cloneFileTestDatabase(
      { templateUrl: `file:./.test-dbs/${templateName}`, testPath: path.join(dir, 'first.test.js'), runPrefix, databaseDir: dir },
    )
    const second = cloneFileTestDatabase(
      { templateUrl: `file:./.test-dbs/${templateName}`, testPath: path.join(dir, 'second.test.js'), runPrefix, databaseDir: dir },
    )

    expect(first.file).not.toBe(second.file)
    expect(first.url).toMatch(/^file:\.\/\.test-dbs\/run-[A-Za-z0-9-]+\.db$/)
    const firstClone = new DatabaseSync(first.file, { readOnly: true })
    const secondClone = new DatabaseSync(second.file, { readOnly: true })
    try {
      expect(firstClone.prepare("SELECT name FROM sqlite_master WHERE name = 'TemplateSchema'").get()).toBeTruthy()
      expect(secondClone.prepare("SELECT name FROM sqlite_master WHERE name = 'TemplateSchema'").get()).toBeTruthy()
    } finally {
      firstClone.close()
      secondClone.close()
    }
  })

  it('refuses template URLs and paths that could escape the owned database directory', () => {
    const runPrefix = 'run-file-path-fixture'
    const templateName = `${runPrefix}.db`
    const templateFile = path.join(dir, templateName)
    const template = new DatabaseSync(templateFile)
    template.close()

    expect(() => cloneFileTestDatabase({
      templateUrl: 'file:./.test-dbs/../foreign.db',
      testPath: path.join(dir, 'escape.test.js'),
      runPrefix,
      databaseDir: dir,
    })).toThrow(/TEMPLATE_URL_INVALID/)
    expect(() => removeFileTestDatabase(path.join(dir, '..', 'foreign.db'), runPrefix, { databaseDir: dir }))
      .toThrow(/PATH_ESCAPE_REFUSED/)
  })

  it('cleans only the exact run prefix and its SQLite sidecars', () => {
    const runPrefix = 'run-file-cleanup-fixture'
    const cloneName = `${runPrefix}-file-${'a'.repeat(24)}.db`
    const foreignName = `${runPrefix}-other-file-${'b'.repeat(24)}.db`
    const owned = [`${runPrefix}.db`, cloneName]
    for (const name of owned) {
      writeFileSync(path.join(dir, name), 'owned')
      for (const suffix of ['-journal', '-wal', '-shm']) writeFileSync(path.join(dir, `${name}${suffix}`), 'sidecar')
    }
    writeFileSync(path.join(dir, foreignName), 'foreign')
    for (const suffix of ['-journal', '-wal', '-shm']) {
      writeFileSync(path.join(dir, `${foreignName}${suffix}`), 'foreign sidecar')
    }

    cleanupRunFileTestDatabases(runPrefix, { databaseDir: dir })

    for (const name of owned) {
      expect(existsSync(path.join(dir, name))).toBe(false)
      for (const suffix of ['-journal', '-wal', '-shm']) expect(existsSync(path.join(dir, `${name}${suffix}`))).toBe(false)
    }
    expect(existsSync(path.join(dir, foreignName))).toBe(true)
    for (const suffix of ['-journal', '-wal', '-shm']) {
      expect(existsSync(path.join(dir, `${foreignName}${suffix}`))).toBe(true)
    }
  })

  it('refuses a symlinked template before attempting a clone', () => {
    const runPrefix = 'run-file-symlink-fixture'
    const templateName = `${runPrefix}.db`
    const templateFile = path.join(dir, templateName)
    const template = new DatabaseSync(templateFile)
    template.close()
    const inspect = (file) => file === templateFile
      ? { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
      : lstatSync(file)

    expect(() => cloneFileTestDatabase(
      { templateUrl: `file:./.test-dbs/${templateName}`, testPath: path.join(dir, 'linked.test.js'), runPrefix, databaseDir: dir },
      { inspect, copy: () => { throw new Error('copy must not run for a symlink') } },
    )).toThrow(/SYMLINK_REFUSED/)
  })

  it('refuses a symlinked database directory before global setup writes into it', () => {
    const inspect = (file) => file === dir
      ? { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
      : lstatSync(file)
    expect(() => ensureFileTestDatabaseDirectory(dir, {
      mkdir: () => {},
      inspect,
    })).toThrow(/DIRECTORY_SYMLINK_REFUSED/)
  })

  it('refuses a database directory whose resolved path escapes through an ancestor junction', () => {
    expect(() => ensureFileTestDatabaseDirectory(dir, {
      mkdir: () => {},
      realpath: () => path.join(dir, 'redirected'),
    })).toThrow(/DIRECTORY_PATH_SYMLINK_REFUSED/)
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
      inspect: () => ({ isSymbolicLink: () => false, isFile: () => true }),
      remove: (f) => removed.push(f),
    })
    expect(removed).toEqual(['/tmp/test.db', '/tmp/test.db-journal', '/tmp/test.db-wal'])
    expect(reported).toEqual(removed)
  })

  it('leaves an EPERM path untouched so a later cleanup can retry', () => {
    const denied = Object.assign(new Error('EPERM, Permission denied'), { code: 'EPERM' })
    expect(
      removeTestDatabase('/tmp/test.db', {
        exists: () => true,
        inspect: () => ({ isSymbolicLink: () => false, isFile: () => true }),
        remove: () => {
          throw denied
        },
      }),
    ).toEqual([])
  })

  it('does not disguise an unrelated filesystem failure', () => {
    const denied = Object.assign(new Error('read-only filesystem'), { code: 'EROFS' })
    expect(() =>
      removeTestDatabase('/tmp/test.db', {
        exists: () => true,
        inspect: () => ({ isSymbolicLink: () => false, isFile: () => true }),
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
      inspect: () => ({ isSymbolicLink: () => false, isFile: () => true }),
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
