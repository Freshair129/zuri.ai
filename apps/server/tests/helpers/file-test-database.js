// @spec docs/architecture/VERIFICATION-POLICY.md — isolated owned test databases.
// @tested tests/unit/test-database-reset.test.js, tests/unit/test-database-file-isolation.test.js
import { createHash } from 'node:crypto'
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const TEST_DB_DIR = path.join(SERVER_ROOT, 'prisma', '.test-dbs')

const RUN_PREFIX = /^run-[A-Za-z0-9-]+$/
const RUN_DATABASE = /^(run-[A-Za-z0-9-]+)\.db$/

function assertRunPrefix(runPrefix) {
  if (typeof runPrefix !== 'string' || !RUN_PREFIX.test(runPrefix)) {
    throw new Error('TEST_DATABASE_RUN_PREFIX_INVALID')
  }
}

function assertDirectChild(databaseDir, filePath) {
  const resolvedDir = path.resolve(databaseDir)
  const resolvedFile = path.resolve(filePath)
  if (path.dirname(resolvedFile) !== resolvedDir) {
    throw new Error('TEST_DATABASE_PATH_ESCAPE_REFUSED')
  }
  return resolvedFile
}

function normalizedRealPath(value) {
  const resolved = path.resolve(value)
  if (process.platform !== 'win32') return resolved
  return resolved
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .toLowerCase()
}

function assertRealDirectory(databaseDir, inspect, realpath) {
  const resolvedDir = path.resolve(databaseDir)
  const details = inspect(resolvedDir)
  if (details.isSymbolicLink()) throw new Error('TEST_DATABASE_DIRECTORY_SYMLINK_REFUSED')
  if (!details.isDirectory()) throw new Error('TEST_DATABASE_DIRECTORY_INVALID')
  if (normalizedRealPath(realpath(resolvedDir)) !== normalizedRealPath(resolvedDir)) {
    throw new Error('TEST_DATABASE_DIRECTORY_PATH_SYMLINK_REFUSED')
  }
  return resolvedDir
}

function assertRegularFile(filePath, inspect) {
  const details = inspect(filePath)
  if (details.isSymbolicLink()) throw new Error('TEST_DATABASE_SYMLINK_REFUSED')
  if (!details.isFile()) throw new Error('TEST_DATABASE_FILE_INVALID')
}

function databaseTemplateName(templateUrl) {
  if (typeof templateUrl !== 'string') throw new Error('TEST_DATABASE_TEMPLATE_URL_INVALID')
  const match = /^file:\.\/\.test-dbs\/(run-[A-Za-z0-9-]+\.db)$/.exec(templateUrl)
  if (!match) throw new Error('TEST_DATABASE_TEMPLATE_URL_INVALID')
  return match[1]
}

function databaseUrl(name) {
  return `file:./.test-dbs/${name}`
}

/** Ensure the directory itself is not a symlink before global setup writes into it. */
export function ensureFileTestDatabaseDirectory(
  databaseDir = TEST_DB_DIR,
  { mkdir = mkdirSync, inspect = lstatSync, realpath = realpathSync.native } = {},
) {
  assertRealDirectory(path.dirname(path.resolve(databaseDir)), inspect, realpath)
  mkdir(path.resolve(databaseDir), { recursive: true })
  return assertRealDirectory(databaseDir, inspect, realpath)
}

/** Clone the already-closed schema template to an exclusive path for one test file. */
export function cloneFileTestDatabase(
  { templateUrl, testPath, runPrefix, databaseDir = TEST_DB_DIR },
  { inspect = lstatSync, realpath = realpathSync.native, copy = copyFileSync } = {},
) {
  const templateName = databaseTemplateName(templateUrl)
  const parsedPrefix = templateName.match(RUN_DATABASE)?.[1]
  if (!parsedPrefix || (runPrefix && runPrefix !== parsedPrefix)) throw new Error('TEST_DATABASE_RUN_PREFIX_MISMATCH')
  assertRunPrefix(parsedPrefix)
  if (typeof testPath !== 'string' || !testPath.trim()) throw new Error('TEST_DATABASE_TEST_PATH_REQUIRED')

  const directory = assertRealDirectory(databaseDir, inspect, realpath)
  const templateFile = assertDirectChild(directory, path.join(directory, templateName))
  assertRegularFile(templateFile, inspect)

  const canonicalTestPath = path.resolve(testPath).replaceAll('\\', '/')
  const hashInput = process.platform === 'win32' ? canonicalTestPath.toLowerCase() : canonicalTestPath
  const fileHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 24)
  const name = `${parsedPrefix}-file-${fileHash}.db`
  const file = assertDirectChild(directory, path.join(directory, name))

  // The exclusive flag refuses stale or duplicate destinations; it never truncates
  // a file that may belong to another worker or to a previous test setup.
  copy(templateFile, file, fsConstants.COPYFILE_EXCL)
  assertRegularFile(file, inspect)

  return { name, file, url: databaseUrl(name), runPrefix: parsedPrefix }
}

/** Preserve PostgreSQL's run URL while cloning only SQLite test databases. */
export function prepareTestDatabaseForFile(options) {
  const { databaseUrl, engine } = options
  if (engine === 'postgresql') return { url: databaseUrl, fileDatabase: null }
  if (engine !== 'sqlite') throw new Error('TEST_DATABASE_ENGINE_UNSUPPORTED')
  const fileDatabase = cloneFileTestDatabase({
    templateUrl: databaseUrl,
    testPath: options.testPath,
    runPrefix: options.runPrefix,
    databaseDir: options.databaseDir,
  })
  return { url: fileDatabase.url, fileDatabase }
}

/** Redirect only the compact-storage setup's DIRECT_URL when it still targets the template. */
export function directUrlForFileDatabase(directUrl, templateUrl, fileDatabaseUrl) {
  return directUrl === templateUrl ? fileDatabaseUrl : directUrl
}

function ownedDatabaseName(name, runPrefix) {
  const escapedPrefix = runPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return name === `${runPrefix}.db` || new RegExp(`^${escapedPrefix}-file-[a-f0-9]{24}\\.db$`).test(name)
}

/** Remove one verified database and its SQLite sidecars; leave EPERM/EBUSY paths for a later retry. */
export function removeFileTestDatabase(
  filePath,
  runPrefix,
  { databaseDir = TEST_DB_DIR, inspect = lstatSync, realpath = realpathSync.native, exists = existsSync, remove = rmSync } = {},
) {
  assertRunPrefix(runPrefix)
  const directory = assertRealDirectory(databaseDir, inspect, realpath)
  const file = assertDirectChild(directory, filePath)
  const name = path.basename(file)
  if (!ownedDatabaseName(name, runPrefix)) throw new Error('TEST_DATABASE_FOREIGN_PREFIX_REFUSED')

  const candidates = [file, `${file}-journal`, `${file}-wal`, `${file}-shm`].filter(exists)
  for (const candidate of candidates) {
    assertDirectChild(directory, candidate)
    assertRegularFile(candidate, inspect)
  }

  const removed = []
  for (const candidate of candidates) {
    try {
      remove(candidate)
      removed.push(candidate)
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EBUSY') continue
      throw error
    }
  }
  return removed
}

/** Run-teardown fallback for only the template and file clones named by this run. */
export function cleanupRunFileTestDatabases(
  runPrefix,
  {
    databaseDir = TEST_DB_DIR,
    inspect = lstatSync,
    realpath = realpathSync.native,
    list = readdirSync,
    exists = existsSync,
    remove = rmSync,
  } = {},
) {
  assertRunPrefix(runPrefix)
  let directory
  try {
    directory = assertRealDirectory(databaseDir, inspect, realpath)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const sidecarSuffixes = ['-journal', '-wal', '-shm']
  const candidates = new Set()
  for (const entry of list(directory)) {
    const databaseName = sidecarSuffixes.reduce(
      (name, suffix) => (name.endsWith(suffix) ? name.slice(0, -suffix.length) : name),
      entry,
    )
    if (!databaseName.endsWith('.db') || !ownedDatabaseName(databaseName, runPrefix)) continue
    candidates.add(path.join(directory, databaseName))
  }

  const removed = []
  for (const file of candidates) {
    removed.push(...removeFileTestDatabase(file, runPrefix, { databaseDir: directory, inspect, realpath, exists, remove }))
  }
  return removed
}
