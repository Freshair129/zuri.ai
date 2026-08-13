// @req FR-045 — managed content is staged and promoted through a contained local port.
// @spec SDD-023, SEC-007, ADR-016 D6/D8
// @tested tests/unit/fr045-filesystem-port.test.js
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import {
  assertSameWindowsVolume,
  resolveContainedPath,
  resolveContainedStagingPath,
  resolveContainedWritePath,
  resolveLexicalContainedPath,
  resolveStagingPath,
} from './path-security.js'

const windowsPath = path.win32

/**
 * Minimal capability-neutral local filesystem adapter. Callers own authorization,
 * database state and reconciliation; this port owns only contained IO.
 */
export function createLocalFilesystemPort({ fs = fsPromises } = {}) {
  return {
    async stageWrite({ stagingRoot, stagingName, content }) {
      const stagingPath = resolveStagingPath({ stagingRoot, stagingName })
      await fs.mkdir(windowsPath.dirname(stagingPath), { recursive: true })
      await fs.writeFile(stagingPath, content)
      return stagingPath
    },

    async promote({ mountRoot, stagingRoot, stagingName, relativePath }) {
      const lexicalDestination = resolveLexicalContainedPath({ mountRoot, relativePath })
      const lexicalDestinationParent = windowsPath.dirname(lexicalDestination.absolutePath)
      await fs.mkdir(lexicalDestinationParent, { recursive: true })
      const [stagedRealPath, destination] = await Promise.all([
        resolveContainedStagingPath({ stagingRoot, stagingName, realpath: fs.realpath }),
        resolveContainedWritePath({
          mountRoot,
          relativePath,
          realpath: fs.realpath,
        }),
      ])
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

    async cleanupStaged({ stagingRoot, stagingName }) {
      await fs.rm(resolveStagingPath({ stagingRoot, stagingName }))
    },
  }
}
