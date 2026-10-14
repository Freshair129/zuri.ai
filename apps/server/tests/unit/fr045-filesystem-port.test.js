// @req FR-045, FR-284 — managed ingest stages content and promotes it atomically.
// @spec SDD-023, SDD-113, SEC-007, ADR-016 D6/D8
// @tested tests/unit/fr045-filesystem-port.test.js
import { describe, expect, it, vi } from 'vitest'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocalFilesystemPort } from '@/modules/project-manager/local-files/filesystem-port'
import { scanLocalFiles } from '@/modules/project-manager/application/file-reconcile-cache-service'

const MOUNT_ROOT = 'D:\\zuri-workspace\\client-01'
const STAGING_ROOT = 'D:\\zuri-workspace\\client-01\\.zuri\\temp'

function createFs(overrides = {}) {
  return {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('contents')),
    stat: vi.fn().mockResolvedValue({ size: 8 }),
    rm: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn().mockImplementation(async (candidate) => candidate),
    ...overrides,
  }
}

describe('FR-045 local filesystem port', () => {
  it('stages to the caller-provided root and name without generating either', async () => {
    const fs = createFs()
    const port = createLocalFilesystemPort({ fs })

    await expect(port.stageWrite({
      stagingRoot: STAGING_ROOT,
      stagingName: 'ingest\\upload-001.tmp',
      content: Buffer.from('contents'),
    })).resolves.toBe(`${STAGING_ROOT}\\ingest\\upload-001.tmp`)

    expect(fs.mkdir).toHaveBeenCalledWith(`${STAGING_ROOT}\\ingest`, { recursive: true })
    expect(fs.writeFile).toHaveBeenCalledWith(`${STAGING_ROOT}\\ingest\\upload-001.tmp`, Buffer.from('contents'), { flag: 'wx' })
  })

  it('atomically promotes a staged file only to a contained final path', async () => {
    const fs = createFs()
    const port = createLocalFilesystemPort({ fs })

    await expect(port.promote({
      mountRoot: MOUNT_ROOT,
      stagingRoot: STAGING_ROOT,
      stagingName: 'ingest\\upload-001.tmp',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
    })).resolves.toBe(`${MOUNT_ROOT}\\Projects\\P-001\\Documents\\brief.pdf`)

    expect(fs.rename).toHaveBeenCalledWith(
      `${STAGING_ROOT}\\ingest\\upload-001.tmp`,
      `${MOUNT_ROOT}\\Projects\\P-001\\Documents\\brief.pdf`,
    )
  })

  it('does not rename when the destination parent resolves outside the mount after creation', async () => {
    const destinationParent = `${MOUNT_ROOT}\\Projects\\P-001\\Documents`
    let destinationParentCreated = false
    const fs = createFs({
      mkdir: vi.fn().mockImplementation(async (candidate) => {
        if (candidate === destinationParent) destinationParentCreated = true
      }),
      realpath: vi.fn().mockImplementation(async (candidate) => {
        if (!destinationParentCreated || !candidate.startsWith(destinationParent)) return candidate
        return candidate === destinationParent ? 'D:\\outside' : 'D:\\outside\\brief.pdf'
      }),
    })
    const port = createLocalFilesystemPort({ fs })

    await expect(port.promote({
      mountRoot: MOUNT_ROOT,
      stagingRoot: STAGING_ROOT,
      stagingName: 'ingest\\upload-001.tmp',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
    })).rejects.toThrow('final real path escapes mounted root')

    expect(fs.mkdir).toHaveBeenCalledWith(destinationParent)
    expect(fs.rename).not.toHaveBeenCalled()
  })

  it('renames under the verified real destination parent rather than its lexical alias', async () => {
    const destinationParent = `${MOUNT_ROOT}\\Projects\\P-001\\Documents`
    const verifiedParent = `${MOUNT_ROOT}\\canonical\\Documents`
    const fs = createFs({
      realpath: vi.fn().mockImplementation(async (candidate) => candidate === destinationParent
        ? verifiedParent
        : candidate),
    })
    const port = createLocalFilesystemPort({ fs })

    await expect(port.promote({
      mountRoot: MOUNT_ROOT,
      stagingRoot: STAGING_ROOT,
      stagingName: 'ingest\\upload-001.tmp',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
    })).resolves.toBe(`${verifiedParent}\\brief.pdf`)

    expect(fs.rename).toHaveBeenCalledWith(
      `${STAGING_ROOT}\\ingest\\upload-001.tmp`,
      `${verifiedParent}\\brief.pdf`,
    )
  })

  it('rejects a staged path whose resolved root escapes the managed mount', async () => {
    const stagedPath = `${STAGING_ROOT}\\ingest\\upload-001.tmp`
    const fs = createFs({
      realpath: vi.fn().mockImplementation(async (candidate) => {
        if (candidate === STAGING_ROOT) return 'C:\\zuri-staging'
        if (candidate === stagedPath) return 'C:\\zuri-staging\\ingest\\upload-001.tmp'
        return candidate
      }),
    })
    const port = createLocalFilesystemPort({ fs })

    await expect(port.promote({
      mountRoot: MOUNT_ROOT,
      stagingRoot: STAGING_ROOT,
      stagingName: 'ingest\\upload-001.tmp',
      relativePath: 'Projects\\P-001\\Documents\\brief.pdf',
    })).rejects.toThrow('staging real path escapes mounted root')

    expect(fs.rename).not.toHaveBeenCalled()
  })

  it('propagates POSIX EXDEV without a copy-and-delete fallback', async () => {
    const crossDevice = Object.assign(new Error('cross-device rename'), { code: 'EXDEV' })
    const fs = createFs({ rename: vi.fn().mockRejectedValue(crossDevice) })
    const port = createLocalFilesystemPort({ fs })

    await expect(port.promote({
      mountRoot: '/srv/workspace',
      stagingRoot: '/srv/workspace/.zuri/temp',
      stagingName: 'asset.tmp',
      relativePath: 'docs/brief.txt',
    })).rejects.toMatchObject({ code: 'EXDEV' })

    expect(fs.rename).toHaveBeenCalledTimes(1)
    expect(fs.copyFile).not.toHaveBeenCalled()
  })

  it('reads, stats and cleans up only after containment validation', async () => {
    const fs = createFs()
    const port = createLocalFilesystemPort({ fs })
    const input = { mountRoot: MOUNT_ROOT, relativePath: 'Projects/P-001/Documents/brief.pdf' }

    await expect(port.read(input)).resolves.toEqual(Buffer.from('contents'))
    await expect(port.stat(input)).resolves.toEqual({ size: 8 })
    await expect(port.cleanup(input)).resolves.toBeUndefined()

    expect(fs.readFile).toHaveBeenCalledWith(`${MOUNT_ROOT}\\Projects\\P-001\\Documents\\brief.pdf`)
    expect(fs.stat).toHaveBeenCalledWith(`${MOUNT_ROOT}\\Projects\\P-001\\Documents\\brief.pdf`)
    expect(fs.rm).toHaveBeenCalledWith(`${MOUNT_ROOT}\\Projects\\P-001\\Documents\\brief.pdf`)
  })

  it('does not perform filesystem IO when the final real path escapes the mount', async () => {
    const fs = createFs({
      realpath: vi.fn().mockImplementation(async (candidate) => candidate === MOUNT_ROOT
        ? candidate
        : 'D:\\outside\\brief.pdf'),
    })
    const port = createLocalFilesystemPort({ fs })

    await expect(port.read({
      mountRoot: MOUNT_ROOT,
      relativePath: 'Projects/P-001/Documents/brief.pdf',
    })).rejects.toThrow('final real path escapes mounted root')
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('round-trips a managed file under a real POSIX mount', async () => {
    const fixtureRoot = await fsPromises.mkdtemp(path.posix.join(os.tmpdir(), 'zuri-fr045-roundtrip-'))
    const mountRoot = path.posix.join(fixtureRoot, 'workspace')
    const stagingRoot = path.posix.join(mountRoot, '.zuri', 'temp')
    const content = Buffer.from('portable managed file')
    const port = createLocalFilesystemPort()

    try {
      await port.stageWrite({ mountRoot, stagingRoot, stagingName: 'asset-a.tmp', content })
      await port.promote({ mountRoot, stagingRoot, stagingName: 'asset-a.tmp', relativePath: 'docs/brief.txt' })

      await expect(port.read({ mountRoot, relativePath: 'docs/brief.txt' })).resolves.toEqual(content)
      await expect(port.stat({ mountRoot, relativePath: 'docs/brief.txt' })).resolves.toMatchObject({ size: content.length })
      await expect(scanLocalFiles(mountRoot)).resolves.toEqual(['docs/brief.txt'])
    } finally {
      await fsPromises.rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('rejects POSIX symlink escapes before reading or creating outside paths', async () => {
    const fixtureRoot = await fsPromises.mkdtemp(path.posix.join(os.tmpdir(), 'zuri-fr045-symlink-'))
    const mountRoot = path.posix.join(fixtureRoot, 'Mount')
    const outsideRoot = path.posix.join(fixtureRoot, 'mount')
    const stagingRoot = path.posix.join(mountRoot, '.zuri', 'temp')
    const outsideFile = path.posix.join(outsideRoot, 'secret.txt')
    const outsideNewFile = path.posix.join(outsideRoot, 'new', 'upload.txt')
    const port = createLocalFilesystemPort()

    try {
      await fsPromises.mkdir(mountRoot)
      await fsPromises.mkdir(outsideRoot)
      await fsPromises.writeFile(outsideFile, 'outside')
      await fsPromises.symlink(outsideRoot, path.posix.join(mountRoot, 'escape'), 'dir')
      await port.stageWrite({ mountRoot, stagingRoot, stagingName: 'asset-a.tmp', content: Buffer.from('upload') })

      await expect(port.read({ mountRoot, relativePath: 'escape/secret.txt' }))
        .rejects.toThrow('final real path escapes mounted root')
      await expect(port.promote({ mountRoot, stagingRoot, stagingName: 'asset-a.tmp', relativePath: 'escape/new/upload.txt' }))
        .rejects.toThrow('final real path escapes mounted root')

      const linkedStagingName = 'linked.tmp'
      await fsPromises.symlink(outsideFile, path.posix.join(stagingRoot, linkedStagingName), 'file')
      await expect(port.stageWrite({ mountRoot, stagingRoot, stagingName: linkedStagingName, content: Buffer.from('must not overwrite') }))
        .rejects.toMatchObject({ code: 'EEXIST' })

      await expect(fsPromises.access(path.posix.join(outsideRoot, 'new'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fsPromises.access(outsideNewFile)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(fsPromises.readFile(outsideFile, 'utf8')).resolves.toBe('outside')

      const unsafeMountRoot = path.posix.join(fixtureRoot, 'UnsafeMount')
      await fsPromises.mkdir(unsafeMountRoot)
      await fsPromises.mkdir(path.posix.join(outsideRoot, '.zuri'))
      await fsPromises.symlink(path.posix.join(outsideRoot, '.zuri'), path.posix.join(unsafeMountRoot, '.zuri'), 'dir')
      await expect(port.stageWrite({
        mountRoot: unsafeMountRoot,
        stagingRoot: path.posix.join(unsafeMountRoot, '.zuri', 'temp'),
        stagingName: 'unsafe.tmp',
        content: Buffer.from('must not escape'),
      })).rejects.toThrow('final real path escapes mounted root')
      await expect(fsPromises.access(path.posix.join(outsideRoot, '.zuri', 'temp'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fsPromises.rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
