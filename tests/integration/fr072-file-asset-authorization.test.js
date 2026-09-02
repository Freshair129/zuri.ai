// @req FR-072 — FileAsset/mount/reconcile/cache/reveal writes refuse unless the
// viewer owns the governing Business; reads stay scoped to visible Businesses.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-file-asset-authorization.test.js
//
// D3-business-pm-crud-forms-01 — file-asset-service.js and
// file-reconcile-cache-service.js gated every write with a local `assertVisible`
// helper keyed on `visibleBusinessIds`, so a plain MEMBER (or a platform DEV,
// who resolveViewer never lets own a Business) could create, relink, reveal,
// reconcile, rebuild the cache or delete FileAssets in a Business they merely
// see — the same bug class already repaid for FR-059, FR-038 and FR-061
// (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md). This
// file proves the repayment the way the sibling `fr072-project-file-
// authorization.test.js` and `fr072-refusal-disclosure.test.js` do: owner
// succeeds, a visible-but-not-owning attacker is refused exactly like a
// nonexistent target, and a platform DEV (sees everything, owns nothing) is
// refused too.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { makeViewer, makeDevViewer, ownsElsewhere } from '../factories/viewer'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import {
  createManagedFileAsset,
  deleteManagedFileAsset,
  relinkFileAsset,
  upsertLocalWorkspaceMount,
} from '@/modules/project-manager/application/file-asset-service'
import { reconcileLocalFiles, rebuildBusinessFileCache } from '@/modules/project-manager/application/file-reconcile-cache-service'
import { revealFileAsset } from '@/modules/project-manager/application/local-file-reveal-service'

let root
let business, otherBusiness
let owner, attacker, dev
let mount

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 FileAsset/mount/reconcile/cache/reveal authorization', () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-fr072-fa-'))
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `W7 FileAsset ${suffix}`, code: `PF-W7FA-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `W7 FileAsset ${suffix}`, code: `TNT-W7FA-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `W7 FileAsset ${suffix}`, code: `BUS-W7FA-${suffix}` })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: `W7 Other ${suffix}`, code: `BUS-W7FA-2-${suffix}` })
    await createWorkspace({ name: `W7 FileAsset WS ${suffix}`, scopeType: 'BUSINESS', businessId: business.id, code: `WS-W7FA-${suffix}` })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    dev = makeDevViewer({ visibleBusinessIds: [business.id] })

    mount = await upsertLocalWorkspaceMount(
      { businessId: business.id, deviceKey: `test-${suffix}`, rootPath: root },
      { viewer: owner },
    )
  })

  afterAll(async () => {
    if (root && path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true })
  })

  describe('upsertLocalWorkspaceMount', () => {
    it('refuses a visible-but-not-owning attacker and a platform DEV, and permits the owner', async () => {
      for (const viewer of [attacker, dev]) {
        const error = await refusalFrom(() =>
          upsertLocalWorkspaceMount({ businessId: business.id, deviceKey: 'attacker-device', rootPath: root }, { viewer }),
        )
        expect(error.status).toBe(404)
        expect(error.message).toBe('Business not found')
      }
      await expect(
        prisma.localWorkspaceMount.findFirst({ where: { businessId: business.id, deviceKey: 'attacker-device' } }),
      ).resolves.toBeNull()

      const remounted = await upsertLocalWorkspaceMount(
        { businessId: business.id, deviceKey: 'owner-device', rootPath: root },
        { viewer: owner },
      )
      expect(remounted.id).toBeTruthy()
    })

    it('refuses an unowned real Business identically to a fabricated one (no oracle)', async () => {
      const real = await refusalFrom(() =>
        upsertLocalWorkspaceMount({ businessId: business.id, deviceKey: 'x', rootPath: root }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        upsertLocalWorkspaceMount({ businessId: 'no-such-business-id', deviceKey: 'x', rootPath: root }, { viewer: attacker }),
      )
      expect(real.status).toBe(404)
      expect(Number(fabricated.status) || 404).toBe(404)
      expect(real.message).toBe(fabricated.message)
    })
  })

  describe('createManagedFileAsset', () => {
    it('refuses the attacker and a platform DEV, and permits the owner on the same Business', async () => {
      const beforeCount = await prisma.fileAsset.count()
      for (const viewer of [attacker, dev]) {
        const error = await refusalFrom(() =>
          createManagedFileAsset({
            code: `FIL-W7FA-DENY-${randomUUID().slice(0, 6)}`, businessId: business.id, storageKind: 'EXTERNAL_URL',
            name: 'attack.txt', mime: 'text/plain', size: 3, externalUrl: 'https://example.test/attack.txt',
          }, { viewer }),
        )
        expect(error.status).toBe(404)
        expect(error.message).toBe('Business not found')
      }
      expect(await prisma.fileAsset.count()).toBe(beforeCount)

      const asset = await createManagedFileAsset({
        code: `FIL-W7FA-OWNER-${randomUUID().slice(0, 6)}`, businessId: business.id, storageKind: 'EXTERNAL_URL',
        name: 'owner.txt', mime: 'text/plain', size: 3, externalUrl: 'https://example.test/owner.txt',
      }, { viewer: owner })
      expect(asset.id).toBeTruthy()
    })
  })

  describe('relinkFileAsset, deleteManagedFileAsset and revealFileAsset', () => {
    let asset

    beforeAll(async () => {
      await fs.writeFile(path.join(root, 'linked.txt'), 'hello')
      asset = await createManagedFileAsset({
        code: `FIL-W7FA-TARGET-${randomUUID().slice(0, 6)}`, businessId: business.id, storageKind: 'LOCAL_FILE',
        mountId: mount.id, relativePath: 'linked.txt', contentBase64: Buffer.from('hello').toString('base64'),
        name: 'linked.txt', mime: 'text/plain', size: 5,
      }, { viewer: owner })
    })

    it('refuses relink to the attacker and a platform DEV exactly like a nonexistent asset', async () => {
      const real = await refusalFrom(() =>
        relinkFileAsset(asset.id, { mountId: mount.id, relativePath: 'linked.txt' }, { viewer: attacker }),
      )
      const devError = await refusalFrom(() =>
        relinkFileAsset(asset.id, { mountId: mount.id, relativePath: 'linked.txt' }, { viewer: dev }),
      )
      const fabricated = await refusalFrom(() =>
        relinkFileAsset('no-such-file-id', { mountId: mount.id, relativePath: 'linked.txt' }, { viewer: attacker }),
      )
      expect(real.status).toBe(404)
      expect(real.message).toBe('File asset not found')
      expect(devError.status).toBe(404)
      expect(devError.message).toBe('File asset not found')
      expect(real.message).toBe(fabricated.message)
    })

    it('refuses reveal to the attacker and a platform DEV, without launching anything', async () => {
      for (const viewer of [attacker, dev]) {
        const error = await refusalFrom(() =>
          revealFileAsset(asset.id, {
            requestUrl: 'http://localhost:3100/api/files/x/reveal',
            origin: 'http://localhost:3100',
            intent: 'reveal',
          }, { viewer, env: { ZURI_LOCAL_FILE_BRIDGE: '1' }, launcher: async () => { throw new Error('must not launch') } }),
        )
        expect(error.status).toBe(404)
        expect(error.message).toBe('File asset not found')
      }
    })

    it('refuses delete to the attacker and a platform DEV, leaving the asset ACTIVE, then permits the owner', async () => {
      for (const viewer of [attacker, dev]) {
        const error = await refusalFrom(() => deleteManagedFileAsset(asset.id, { viewer }))
        expect(error.status).toBe(404)
        expect(error.message).toBe('File asset not found')
      }
      await expect(prisma.fileAsset.findUnique({ where: { id: asset.id } })).resolves.toMatchObject({ status: 'ACTIVE' })

      const deleted = await deleteManagedFileAsset(asset.id, { viewer: owner })
      expect(deleted.id).toBe(asset.id)
    })
  })

  describe('reconcileLocalFiles and rebuildBusinessFileCache', () => {
    it('refuses the attacker and a platform DEV, and permits the owner', async () => {
      for (const viewer of [attacker, dev]) {
        const reconcileError = await refusalFrom(() =>
          reconcileLocalFiles({ businessId: business.id, mountId: mount.id }, { viewer }),
        )
        expect(reconcileError.status).toBe(404)
        expect(reconcileError.message).toBe('Business not found')

        const cacheError = await refusalFrom(() =>
          rebuildBusinessFileCache({ businessId: business.id, mountId: mount.id }, { viewer }),
        )
        expect(cacheError.status).toBe(404)
        expect(cacheError.message).toBe('Business not found')
      }

      await expect(
        reconcileLocalFiles({ businessId: business.id, mountId: mount.id }, { viewer: owner }),
      ).resolves.toMatchObject({ confirmed: false })
      await expect(
        rebuildBusinessFileCache({ businessId: business.id, mountId: mount.id }, { viewer: owner }),
      ).resolves.toMatchObject({ businessId: business.id })
    })
  })
})
