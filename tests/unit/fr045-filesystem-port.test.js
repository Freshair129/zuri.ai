// @req FR-045 — managed ingest stages content and promotes it atomically.
// @spec SDD-023, SEC-007, ADR-016 D6/D8
// @tested tests/unit/fr045-filesystem-port.test.js
import { describe, expect, it, vi } from 'vitest'
import { createLocalFilesystemPort } from '@/modules/project-manager/local-files/filesystem-port'

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
    expect(fs.writeFile).toHaveBeenCalledWith(`${STAGING_ROOT}\\ingest\\upload-001.tmp`, Buffer.from('contents'))
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

    expect(fs.mkdir).toHaveBeenCalledWith(destinationParent, { recursive: true })
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

  it('fails closed without rename when the staged file and verified destination use different volumes', async () => {
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
    })).rejects.toThrow('staging and destination must be on the same volume')

    expect(fs.rename).not.toHaveBeenCalled()
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
})
