// @req FR-045, FR-284 — managed local files use portable, contained relative paths.
// @spec SDD-023, SDD-113, SEC-007, ADR-016 D3/D8
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

/**
 * Roots keep the path syntax of the filesystem that owns them. Drive and UNC
 * roots remain Windows paths even when inspected by a POSIX-hosted server.
 * A single leading backslash and drive-relative roots are ambiguous and fail
 * closed; POSIX roots must use their unambiguous leading slash form.
 */
export function normalizeMountRoot(mountRoot) {
  if (typeof mountRoot !== 'string' || mountRoot.trim() === '') reject('mount root is required')
  if (mountRoot.includes('\0')) reject('mount root contains a null byte')

  if (/^[a-zA-Z]:[\\/]/.test(mountRoot)) {
    if (!windowsPath.isAbsolute(mountRoot)) reject('mount root must be absolute')
    return windowsPath.normalize(mountRoot)
  }

  if (mountRoot.startsWith('\\\\') || mountRoot.startsWith('//')) {
    const slashForm = mountRoot.replaceAll('\\', '/')
    if (/^\/\/[?.]\//.test(slashForm)) reject('Windows device paths are not supported')
    const uncParts = slashForm.slice(2).split('/')
    if (!uncParts[0] || !uncParts[1] || !windowsPath.isAbsolute(mountRoot)) {
      reject('mount root must be a fully qualified UNC path')
    }
    return windowsPath.normalize(mountRoot)
  }

  if (mountRoot.startsWith('/') && !mountRoot.startsWith('//')) {
    return path.posix.normalize(mountRoot)
  }

  reject('mount root must be a fully qualified Windows or absolute POSIX path')
}

export function pathFlavorForRoot(mountRoot) {
  const normalized = normalizeMountRoot(mountRoot)
  return /^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\')
    ? 'windows'
    : 'posix'
}

/** Returns the path implementation selected by an already trusted root value. */
export function pathImplementationForRoot(mountRoot) {
  return pathFlavorForRoot(mountRoot) === 'windows' ? windowsPath : path.posix
}

function assertContained(candidate, root, flavor, message) {
  const pathApi = flavor === 'windows' ? windowsPath : path.posix
  const relative = pathApi.relative(root, candidate)
  if (relative === '') return
  if (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) reject(message)
}

/**
 * Converts a client-supplied path to portable separators. It intentionally accepts
 * neither absolute paths nor Windows drive-relative paths.
 */
export function normalizeClientRelativePath(input) {
  if (typeof input !== 'string' || input.trim() === '') reject('relative path is required')
  if (input.includes('\0')) reject('relative path contains a null byte')

  const candidate = input.trim()
  if (candidate.startsWith('/') || candidate.startsWith('\\') || /^[a-zA-Z]:/.test(candidate)) {
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
  const root = normalizeMountRoot(mountRoot)
  const flavor = pathFlavorForRoot(root)
  const pathApi = flavor === 'windows' ? windowsPath : path.posix
  const normalizedRelativePath = normalizeClientRelativePath(relativePath)
  const absolutePath = pathApi.join(root, ...normalizedRelativePath.split('/'))
  assertContained(absolutePath, root, flavor, 'lexical path escapes mounted root')
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
  const flavor = pathFlavorForRoot(lexical.root)
  const [realRoot, realFinalPath] = await Promise.all([
    realpath(lexical.root),
    realpath(lexical.absolutePath),
  ])
  assertContained(realFinalPath, realRoot, flavor, 'final real path escapes mounted root')
  return { relativePath: lexical.relativePath, absolutePath: lexical.absolutePath }
}

/**
 * Verifies a write destination before it exists. The final parent is resolved so
 * a junction/reparse point cannot redirect a promoted file outside the mount.
 */
export async function resolveContainedWritePath({ mountRoot, relativePath, realpath }) {
  if (typeof realpath !== 'function') reject('realpath capability is required')
  const lexical = lexicalContainedPath({ mountRoot, relativePath })
  const flavor = pathFlavorForRoot(lexical.root)
  const pathApi = flavor === 'windows' ? windowsPath : path.posix
  const [realRoot, realParent] = await Promise.all([
    realpath(lexical.root),
    realpath(pathApi.dirname(lexical.absolutePath)),
  ])
  assertContained(realParent, realRoot, flavor, 'final real path escapes mounted root')
  const absolutePath = pathApi.join(realParent, pathApi.basename(lexical.absolutePath))
  assertContained(absolutePath, realRoot, flavor, 'final real path escapes mounted root')
  return { relativePath: lexical.relativePath, absolutePath }
}

export function resolveStagingPath({ stagingRoot, stagingName }) {
  const root = normalizeMountRoot(stagingRoot)
  const flavor = pathFlavorForRoot(root)
  const pathApi = flavor === 'windows' ? windowsPath : path.posix
  const normalizedName = normalizeClientRelativePath(stagingName)
  const absolutePath = pathApi.join(root, ...normalizedName.split('/'))
  assertContained(absolutePath, root, flavor, 'staging path escapes staging root')
  return absolutePath
}

/**
 * Resolves an existing staged file and confirms it remains within its staging
 * root and, when supplied, within the managed mount as well.
 */
export async function resolveContainedStagingPath({ stagingRoot, stagingName, realpath, mountRoot }) {
  if (typeof realpath !== 'function') reject('realpath capability is required')
  const normalizedStagingRoot = normalizeMountRoot(stagingRoot)
  const stagingFlavor = pathFlavorForRoot(normalizedStagingRoot)
  const pathApi = stagingFlavor === 'windows' ? windowsPath : path.posix
  const absolutePath = resolveStagingPath({ stagingRoot: normalizedStagingRoot, stagingName })
  const [realStagingRoot, realPath] = await Promise.all([
    realpath(normalizedStagingRoot),
    realpath(absolutePath),
  ])
  assertContained(realPath, realStagingRoot, stagingFlavor, 'staged real path escapes staging root')

  if (mountRoot !== undefined) {
    const normalizedMountRoot = normalizeMountRoot(mountRoot)
    const mountFlavor = pathFlavorForRoot(normalizedMountRoot)
    if (mountFlavor !== stagingFlavor) reject('staging and mount roots must use the same path type')
    assertContained(normalizedStagingRoot, normalizedMountRoot, mountFlavor, 'staging path escapes mounted root')
    const realMountRoot = await realpath(normalizedMountRoot)
    assertContained(realStagingRoot, realMountRoot, mountFlavor, 'staging real path escapes mounted root')
    assertContained(realPath, realMountRoot, mountFlavor, 'staging real path escapes mounted root')
  }

  return realPath
}

/**
 * Node rename is atomic only within one filesystem. Windows drive/UNC volume
 * checks are explicit; POSIX cross-device renames fail atomically with EXDEV.
 */
export function assertSameWindowsVolume(sourcePath, destinationPath) {
  const sourceFlavor = pathFlavorForRoot(sourcePath)
  const destinationFlavor = pathFlavorForRoot(destinationPath)
  if (sourceFlavor !== destinationFlavor) reject('staging and destination must be on the same volume')
  if (sourceFlavor === 'posix') return
  const sourceRoot = windowsPath.parse(sourcePath).root.toLowerCase()
  const destinationRoot = windowsPath.parse(destinationPath).root.toLowerCase()
  if (sourceRoot !== destinationRoot) reject('staging and destination must be on the same volume')
}
