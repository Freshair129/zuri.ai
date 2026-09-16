// @req FR-245 — production archive reads and writes require the approved
//   mounted storage boundary before key/file/tombstone access.
// @spec ADR-093 D3; SDD-103; SEC-034
// @tested tests/unit/archive-storage-readiness.test.js
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertArchiveStorageReady,
  ChatEvidenceArchiveStorageError,
  resolveArchiveBaseDir,
} from '@/modules/crm/chat-evidence-archive-service'

const productionEnv = { NODE_ENV: 'production', ZURI_ARCHIVE_DIR: '/archive' }

function mockMountedArchive() {
  vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true })
  vi.spyOn(fs, 'realpath').mockResolvedValue('/archive')
  vi.spyOn(fs, 'readFile').mockResolvedValue('42 36 0:38 / /archive rw,relatime - tmpfs tmpfs rw\n')
}

afterEach(() => vi.restoreAllMocks())

describe('production archive storage readiness', () => {
  it('refuses missing, relative and OS-temp production configuration', () => {
    expect(() => resolveArchiveBaseDir({ NODE_ENV: 'production' })).toThrow(ChatEvidenceArchiveStorageError)
    expect(() => resolveArchiveBaseDir({ NODE_ENV: 'production', ZURI_ARCHIVE_DIR: 'archive' })).toThrow(/ARCHIVE_STORAGE_ROOT_INVALID/)
    expect(() => resolveArchiveBaseDir({ NODE_ENV: 'production', ZURI_ARCHIVE_DIR: path.join(os.tmpdir(), 'archive') })).toThrow(/ARCHIVE_STORAGE_ROOT_INVALID/)
  })

  it('accepts the approved root only when the injected directory and mount-info proofs agree', async () => {
    mockMountedArchive()
    await expect(assertArchiveStorageReady('/archive', productionEnv)).resolves.toBe('/archive')
  })

  it('rejects an absolute root when the directory is real but mount-info has no archive boundary', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true })
    vi.spyOn(fs, 'realpath').mockResolvedValue('/archive')
    vi.spyOn(fs, 'readFile').mockResolvedValue('42 36 0:38 / / rw,relatime - overlay overlay rw\n')
    await expect(assertArchiveStorageReady('/archive', productionEnv)).rejects.toThrow(/ARCHIVE_STORAGE_MOUNT_UNVERIFIED/)
  })

  it('rejects a symlinked production root and a baseDir override outside the approved root', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true })
    vi.spyOn(fs, 'realpath').mockResolvedValue('/var/tmp/archive')
    await expect(assertArchiveStorageReady('/archive', productionEnv)).rejects.toThrow(/ARCHIVE_STORAGE_NOT_CANONICAL/)
    mockMountedArchive()
    await expect(assertArchiveStorageReady('/var/tmp/archive', productionEnv)).rejects.toThrow(/ARCHIVE_STORAGE_ROOT_INVALID/)
  })

  it('keeps the deliberate OS-temp fallback outside production', () => {
    expect(resolveArchiveBaseDir({ NODE_ENV: 'test' })).toBe(path.join(os.tmpdir(), 'zuri-chat-evidence-archive'))
    expect(resolveArchiveBaseDir({ NODE_ENV: 'development', ZURI_ARCHIVE_DIR: 'fixtures/archive' })).toBe('fixtures/archive')
  })
})
