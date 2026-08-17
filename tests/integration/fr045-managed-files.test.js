// @req FR-045 - managed local content, Business/Project isolation and reconcile/relink integration.
// @spec SDD-023, BR-010, SEC-007, ADR-016
// @tested src/modules/project-manager/application/file-asset-service.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import { makeViewer } from '../factories/viewer'
import {
  createManagedFileAsset,
  listManagedFileAssets,
  relinkFileAsset,
  resolveFileAssetContent,
  upsertLocalWorkspaceMount,
} from '@/modules/project-manager/application/file-asset-service'
import { reconcileLocalFiles } from '@/modules/project-manager/application/file-reconcile-cache-service'

describe('FR-045 managed local files integration', () => {
  let root
  let business
  let project
  let mount
  let asset

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-fr045-'))
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR045 ${suffix}`, code: `PF-F45-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `FR045 ${suffix}`, code: `TNT-F45-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `FR045 ${suffix}`, code: `BUS-F45-${suffix}` })
    const workspace = await createWorkspace({ name: `FR045 ${suffix}`, scopeType: 'BUSINESS', businessId: business.id, code: `WS-F45-${suffix}` })
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    project = await createProject({ workspaceId: workspace.id, name: `FR045 ${suffix}`, code: `PRJ-F45-${suffix}` }, { viewer: owner })
    mount = await upsertLocalWorkspaceMount({ businessId: business.id, deviceKey: `test-${suffix}`, rootPath: root }, { visibleBusinessIds: [business.id] })
  })

  afterAll(async () => {
    if (root && path.resolve(root).startsWith(path.resolve(os.tmpdir()))) await fs.rm(root, { recursive: true, force: true })
  })

  it('stages, hashes and promotes content then returns the same asset in Business and Project views', async () => {
    asset = await createManagedFileAsset({
      code: `FIL-${randomUUID().slice(0, 8).toUpperCase()}`,
      businessId: business.id, projectId: project.id, storageKind: 'LOCAL_FILE', mountId: mount.id,
      relativePath: 'Projects/report.txt', contentBase64: Buffer.from('managed').toString('base64'),
      name: 'report.txt', mime: 'text/plain', size: 7,
    }, { visibleBusinessIds: [business.id] })
    expect(asset).toMatchObject({ businessId: business.id, projectId: project.id, status: 'ACTIVE' })
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(fs.readFile(path.join(root, 'Projects', 'report.txt'), 'utf8')).resolves.toBe('managed')
    await expect(resolveFileAssetContent(asset.id, { visibleBusinessIds: [business.id] })).resolves.toMatchObject({ content: Buffer.from('managed') })
    const businessView = await listManagedFileAssets({ businessId: business.id }, { visibleBusinessIds: [business.id] })
    const projectView = await listManagedFileAssets({ businessId: business.id, projectId: project.id }, { visibleBusinessIds: [business.id] })
    expect(businessView.assets.filter((item) => item.id === asset.id)).toHaveLength(1)
    expect(projectView.assets.map((item) => item.id)).toContain(asset.id)
  })

  it('marks an external move missing and restores identity only after explicit relink', async () => {
    await fs.rename(path.join(root, 'Projects', 'report.txt'), path.join(root, 'Projects', 'moved.txt'))
    const preview = await reconcileLocalFiles({ businessId: business.id, mountId: mount.id }, { visibleBusinessIds: [business.id] })
    expect(preview.missing).toContain(asset.id)
    await reconcileLocalFiles({ businessId: business.id, mountId: mount.id, confirm: true }, { visibleBusinessIds: [business.id] })
    await expect(resolveFileAssetContent(asset.id, { visibleBusinessIds: [business.id] })).rejects.toThrow('MISSING')
    const relinked = await relinkFileAsset(asset.id, { mountId: mount.id, relativePath: 'Projects/moved.txt' }, { visibleBusinessIds: [business.id] })
    expect(relinked).toMatchObject({ id: asset.id, relativePath: 'Projects/moved.txt', status: 'ACTIVE' })
    await expect(resolveFileAssetContent(asset.id, { visibleBusinessIds: [business.id] })).resolves.toMatchObject({ content: Buffer.from('managed') })
  })
})
