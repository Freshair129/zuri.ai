// @req FR-045 — managed local files use portable, contained relative paths.
// @spec SDD-023, SEC-007, ADR-016 D3/D8
// @tested tests/unit/fr045-path-security.test.js
import path from 'node:path'

const windowsPath = path.win32

export class LocalPathSecurityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LocalPathSecurityError'
  }
}

function reject(message) {
  throw new LocalPathSecurityError(message)
}

function normalizeWindowsRoot(mountRoot) {
  if (typeof mountRoot !== 'string' || mountRoot.trim() === '') reject('mount root is required')
  if (mountRoot.includes('\0') || !windowsPath.isAbsolute(mountRoot)) reject('mount root must be absolute')
  return windowsPath.normalize(mountRoot)
}

function equalOrDescendant(candidate, root) {
  const relative = windowsPath.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !windowsPath.isAbsolute(relative))
}

function assertContained(candidate, root, message) {
  if (!equalOrDescendant(candidate, root)) reject(message)
}

/**
 * Converts a client-supplied path to portable separators. It intentionally accepts
 * neither absolute paths nor Windows drive-relative paths.
 */
export function normalizeClientRelativePath(input) {
  if (typeof input !== 'string' || input.trim() === '') reject('relative path is required')
  if (input.includes('\0')) reject('relative path contains a null byte')

  const candidate = input.trim()
  if (windowsPath.isAbsolute(candidate) || candidate.startsWith('/') || /^[a-zA-Z]:/.test(candidate)) {
    reject('relative path must not be absolute or drive-relative')
  }

  const segments = candidate.replaceAll('\\', '/').split('/')
  const normalized = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') reject('relative path must not traverse parent directories')
    if (segment.includes(':')) reject('relative path contains an invalid Windows segment')
    normalized.push(segment)
  }
  if (normalized.length === 0) reject('relative path is required')
  return normalized.join('/')
}

function lexicalContainedPath({ mountRoot, relativePath }) {
  const root = normalizeWindowsRoot(mountRoot)
  const normalizedRelativePath = normalizeClientRelativePath(relativePath)
  const absolutePath = windowsPath.join(root, ...normalizedRelativePath.split('/'))
  assertContained(absolutePath, root, 'lexical path escapes mounted root')
  return { root, relativePath: normalizedRelativePath, absolutePath }
}

export function resolveLexicalContainedPath({ mountRoot, relativePath }) {
  return lexicalContainedPath({ mountRoot, relativePath })
}

/**
 * Resolves an existing final path and verifies its resolved target remains inside
 * the resolved mount root. `realpath` is injected so this boundary is testable
 * against Windows junction/reparse escape without creating filesystem fixtures.
 */
export async function resolveContainedPath({ mountRoot, relativePath, realpath }) {
  if (typeof realpath !== 'function') reject('realpath capability is required')
  const lexical = lexicalContainedPath({ mountRoot, relativePath })
  const [realRoot, realFinalPath] = await Promise.all([
    realpath(lexical.root),
    realpath(lexical.absolutePath),
  ])
  assertContained(realFinalPath, realRoot, 'final real path escapes mounted root')
  return { relativePath: lexical.relativePath, absolutePath: lexical.absolutePath }
}

/**
 * Verifies a write destination before it exists. The final parent is resolved so
 * a junction/reparse point cannot redirect a promoted file outside the mount.
 */
export async function resolveContainedWritePath({ mountRoot, relativePath, realpath }) {
  if (typeof realpath !== 'function') reject('realpath capability is required')
  const lexical = lexicalContainedPath({ mountRoot, relativePath })
  const [realRoot, realParent] = await Promise.all([
    realpath(lexical.root),
    realpath(windowsPath.dirname(lexical.absolutePath)),
  ])
  assertContained(realParent, realRoot, 'final real path escapes mounted root')
  const absolutePath = windowsPath.join(realParent, windowsPath.basename(lexical.absolutePath))
  assertContained(absolutePath, realRoot, 'final real path escapes mounted root')
  return { relativePath: lexical.relativePath, absolutePath }
}

export function resolveStagingPath({ stagingRoot, stagingName }) {
  const root = normalizeWindowsRoot(stagingRoot)
  const normalizedName = normalizeClientRelativePath(stagingName)
  const absolutePath = windowsPath.join(root, ...normalizedName.split('/'))
  assertContained(absolutePath, root, 'staging path escapes staging root')
  return absolutePath
}

/**
 * Resolves an existing staged file and confirms it remains inside its caller-owned
 * staging root. Its canonical path is used for same-volume promotion checks.
 */
export async function resolveContainedStagingPath({ stagingRoot, stagingName, realpath }) {
  if (typeof realpath !== 'function') reject('realpath capability is required')
  const absolutePath = resolveStagingPath({ stagingRoot, stagingName })
  const root = normalizeWindowsRoot(stagingRoot)
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(absolutePath)])
  assertContained(realPath, realRoot, 'staged real path escapes staging root')
  return realPath
}

/**
 * Node rename is atomic only within one filesystem. Cross-volume promotion is
 * rejected instead of falling back to copy-and-delete semantics.
 */
export function assertSameWindowsVolume(sourcePath, destinationPath) {
  const sourceRoot = windowsPath.parse(sourcePath).root.toLowerCase()
  const destinationRoot = windowsPath.parse(destinationPath).root.toLowerCase()
  if (sourceRoot !== destinationRoot) reject('staging and destination must be on the same volume')
}
