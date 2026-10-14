// @req FR-045, FR-284 — managed content is staged and promoted through a contained local port.
// @spec SDD-023, SDD-113, SEC-007, ADR-016 D6/D8
// @tested tests/unit/fr045-filesystem-port.test.js
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import {
  assertSameWindowsVolume,
  normalizeMountRoot,
  pathFlavorForRoot,
  pathImplementationForRoot,
  resolveContainedPath,
  resolveContainedStagingPath,
  resolveContainedWritePath,
  resolveLexicalContainedPath,
  resolveStagingPath,
} from './path-security.js'

function assertDescendant(candidate, root, pathApi, message) {
  const relative = pathApi.relative(root, candidate)
  if (relative === '..' || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error(message)
  }
}

/** Locate the nearest existing path before creating a user-selected new mount. */
async function ensureMountRootExists(mountRoot, fs) {
  const root = normalizeMountRoot(mountRoot)
  const pathApi = pathImplementationForRoot(root)
  try {
    return await fs.realpath(root)
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
  }

  let ancestor = root
  let realAncestor
  while (realAncestor === undefined) {
    try {
      realAncestor = await fs.realpath(ancestor)
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = pathApi.dirname(ancestor)
      if (parent === ancestor) throw error
      ancestor = parent
    }
  }

  const relative = pathApi.relative(ancestor, root)
  assertDescendant(root, ancestor, pathApi, 'mount root escapes its nearest existing ancestor')
  let current = ancestor
  for (const segment of relative.split(pathApi.sep).filter(Boolean)) {
    current = pathApi.join(current, segment)
    try {
      await fs.mkdir(current)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const realCurrent = await fs.realpath(current)
    assertDescendant(realCurrent, realAncestor, pathApi, 'mount root path escapes its nearest existing ancestor')
  }
  return fs.realpath(root)
}

/** Create and check each directory level before proceeding through it. */
async function ensureContainedDirectories({ mountRoot, targetDirectory, fs }) {
  const root = normalizeMountRoot(mountRoot)
  const pathApi = pathImplementationForRoot(root)
  assertDescendant(targetDirectory, root, pathApi, 'lexical path escapes mounted root')
  const relative = pathApi.relative(root, targetDirectory)
  const segments = relative ? relative.split(pathApi.sep).filter(Boolean) : []
  const realRoot = await ensureMountRootExists(root, fs)
  let current = root

  for (const segment of segments) {
    current = pathApi.join(current, segment)
    try {
      await fs.mkdir(current)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const realCurrent = await fs.realpath(current)
    assertDescendant(realCurrent, realRoot, pathApi, 'final real path escapes mounted root')
  }
}

/**
 * Minimal capability-neutral local filesystem adapter. Callers own authorization,
 * database state and reconciliation; this port owns only contained IO.
 */
export function createLocalFilesystemPort({ fs = fsPromises } = {}) {
  return {
    async stageWrite({ mountRoot, stagingRoot, stagingName, content }) {
      const stagingPath = resolveStagingPath({ stagingRoot, stagingName })
      const stagingParent = pathImplementationForRoot(stagingRoot).dirname(stagingPath)
      if (mountRoot !== undefined) {
        await ensureContainedDirectories({ mountRoot, targetDirectory: stagingParent, fs })
      } else {
        await fs.mkdir(stagingParent, { recursive: true })
      }
      await fs.writeFile(stagingPath, content, { flag: 'wx' })
      return stagingPath
    },

    async promote({ mountRoot, stagingRoot, stagingName, relativePath }) {
      const lexicalDestination = resolveLexicalContainedPath({ mountRoot, relativePath })
      const pathApi = pathImplementationForRoot(lexicalDestination.absolutePath)
      const lexicalDestinationParent = pathApi.dirname(lexicalDestination.absolutePath)
      const stagedRealPath = await resolveContainedStagingPath({ stagingRoot, stagingName, realpath: fs.realpath, mountRoot })
      await ensureContainedDirectories({ mountRoot, targetDirectory: lexicalDestinationParent, fs })
      const destination = await resolveContainedWritePath({ mountRoot, relativePath, realpath: fs.realpath })
      assertSameWindowsVolume(stagedRealPath, destination.absolutePath)
      await fs.rename(stagedRealPath, destination.absolutePath)
      return destination.absolutePath
    },

    async read({ mountRoot, relativePath }) {
      const target = await resolveContainedPath({ mountRoot, relativePath, realpath: fs.realpath })
      return fs.readFile(target.absolutePath)
    },

    async stat({ mountRoot, relativePath }) {
      const target = await resolveContainedPath({ mountRoot, relativePath, realpath: fs.realpath })
      return fs.stat(target.absolutePath)
    },

    async cleanup({ mountRoot, relativePath }) {
      const target = await resolveContainedPath({ mountRoot, relativePath, realpath: fs.realpath })
      await fs.rm(target.absolutePath)
    },

    async cleanupStaged({ mountRoot, stagingRoot, stagingName }) {
      if (mountRoot === undefined) {
        await fs.rm(resolveStagingPath({ stagingRoot, stagingName }))
        return
      }
      const normalizedMountRoot = normalizeMountRoot(mountRoot)
      const normalizedStagingRoot = normalizeMountRoot(stagingRoot)
      const pathApi = pathImplementationForRoot(normalizedMountRoot)
      if (pathFlavorForRoot(normalizedMountRoot) !== pathFlavorForRoot(normalizedStagingRoot)) {
        throw new Error('staging and mount roots must use the same path type')
      }
      const stagingPath = resolveStagingPath({ stagingRoot: normalizedStagingRoot, stagingName })
      const relativePath = pathApi.relative(normalizedMountRoot, stagingPath)
      const target = await resolveContainedPath({ mountRoot: normalizedMountRoot, relativePath, realpath: fs.realpath })
      await fs.rm(target.absolutePath)
    },
  }
}
