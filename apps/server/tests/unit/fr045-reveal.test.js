// @req FR-045 — reveal is local-capability-only and never launches from hosted input.
// @spec SEC-007, SDD-023, ADR-016 D7/D8
// @tested tests/unit/fr045-reveal.test.js
import { describe, expect, it, vi } from 'vitest'
import { launchExplorer, revealFileAsset } from '@/modules/project-manager/application/local-file-reveal-service'
import { buildOsChildEnv, OS_CHILD_ENV_NAMES } from '@/lib/os-child-env'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

const owner = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })

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
    }, { db, viewer: owner, env: {}, launcher })).rejects.toThrow('Local file bridge is disabled')
    expect(launcher).not.toHaveBeenCalled()
  })

  it('requires loopback same-origin and explicit intent before contained launch', async () => {
    const db = baseDb()
    const launcher = vi.fn().mockResolvedValue(undefined)
    const realpath = vi.fn(async (value) => value)
    await expect(revealFileAsset('a', {
      requestUrl: 'http://127.0.0.1:3100/api/files/a/reveal', origin: 'http://127.0.0.1:3100', intent: 'reveal',
    }, { db, viewer: owner, env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher, realpath })).resolves.toMatchObject({ revealed: true })
    expect(launcher).toHaveBeenCalledWith('D:\\workspace\\Projects\\P\\file.txt')
  })

  it('denies mismatched origin and cross-Business assets', async () => {
    const db = baseDb()
    const common = { requestUrl: 'http://localhost:3100/api/files/a/reveal', origin: 'http://evil.test', intent: 'reveal' }
    await expect(revealFileAsset('a', common, { db, viewer: owner, env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher: vi.fn() })).rejects.toThrow('same-origin')
    // @req FR-072 — a viewer who merely sees the governing Business (never an
    // owner) is refused exactly like a nonexistent asset, not merely denied on
    // "not visible": ownership, not visibility, gates this real OS side effect.
    const attacker = ownsElsewhere({ owns: 'business-elsewhere', sees: 'business-a' })
    await expect(revealFileAsset('a', { ...common, origin: 'http://localhost:3100' }, { db, viewer: attacker, env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher: vi.fn(), realpath: async (x) => x })).rejects.toThrow('File asset not found')
  })
})

// @req SEC — a child process that has no use for this server's secrets must not
//   be handed them. Explorer inherits nothing but the OS names it needs to start;
//   anything the user then launches from that window inherits the same.
describe('reveal launches Explorer with an OS-only environment', () => {
  it('hands the child the allowlisted OS names and nothing else', async () => {
    const spawnImpl = vi.fn().mockReturnValue({ unref: vi.fn() })
    await launchExplorer('D:\workspace\Projects\P\file.txt', spawnImpl)

    const [, , options] = spawnImpl.mock.calls[0]
    const forwarded = Object.keys(options.env).map((name) => name.toUpperCase())
    expect(forwarded.length).toBeGreaterThan(0)
    for (const name of forwarded) expect(OS_CHILD_ENV_NAMES).toContain(name)
    for (const secret of ['DATABASE_URL', 'LINE_CHANNEL_SECRET', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']) {
      expect(options.env[secret]).toBeUndefined()
    }
  })

  it('matches names without case and copies them as spelled, dropping look-alikes', () => {
    const child = buildOsChildEnv({
      Path: 'C:/bin', SystemRoot: 'C:/Windows', windir: 'C:/Windows', TEMP: '/tmp',
      PATH_SECRET: 'decoy', DATABASE_URL: 'postgres://decoy', NODE_OPTIONS: '--require ./decoy.js',
      AWS_SECRET_ACCESS_KEY: 'decoy',
    })
    expect(child).toEqual({ Path: 'C:/bin', SystemRoot: 'C:/Windows', windir: 'C:/Windows', TEMP: '/tmp' })
  })
})
