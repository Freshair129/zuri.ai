// @req FR-045 — reveal is local-capability-only and never launches from hosted input.
// @spec SEC-007, SDD-023, ADR-016 D7/D8
// @tested tests/unit/fr045-reveal.test.js
import { describe, expect, it, vi } from 'vitest'
import { revealFileAsset } from '@/modules/project-manager/application/local-file-reveal-service'

function baseDb() {
  return {
    fileAsset: { findUnique: vi.fn().mockResolvedValue({ id: 'a', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'Projects/P/file.txt', status: 'ACTIVE' }) },
    localWorkspaceMount: { findFirst: vi.fn().mockResolvedValue({ businessId: 'business-a', rootPath: 'D:\\workspace', status: 'ACTIVE' }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  }
}

describe('FR-045 local reveal capability', () => {
  it('denies hosted/default mode before resolving or launching a file', async () => {
    const db = baseDb()
    const launcher = vi.fn()
    await expect(revealFileAsset('a', {
      requestUrl: 'https://zuri.example/api/files/a/reveal', origin: 'https://zuri.example', intent: 'reveal',
    }, { db, visibleBusinessIds: ['business-a'], env: {}, launcher })).rejects.toThrow('Local file bridge is disabled')
    expect(launcher).not.toHaveBeenCalled()
  })

  it('requires loopback same-origin and explicit intent before contained launch', async () => {
    const db = baseDb()
    const launcher = vi.fn().mockResolvedValue(undefined)
    const realpath = vi.fn(async (value) => value)
    await expect(revealFileAsset('a', {
      requestUrl: 'http://127.0.0.1:3100/api/files/a/reveal', origin: 'http://127.0.0.1:3100', intent: 'reveal',
    }, { db, visibleBusinessIds: ['business-a'], env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher, realpath })).resolves.toMatchObject({ revealed: true })
    expect(launcher).toHaveBeenCalledWith('D:\\workspace\\Projects\\P\\file.txt')
  })

  it('denies mismatched origin and cross-Business assets', async () => {
    const db = baseDb()
    const common = { requestUrl: 'http://localhost:3100/api/files/a/reveal', origin: 'http://evil.test', intent: 'reveal' }
    await expect(revealFileAsset('a', common, { db, visibleBusinessIds: ['business-a'], env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher: vi.fn() })).rejects.toThrow('same-origin')
    await expect(revealFileAsset('a', { ...common, origin: 'http://localhost:3100' }, { db, visibleBusinessIds: [], env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher: vi.fn(), realpath: async (x) => x })).rejects.toThrow('not visible')
  })
})
