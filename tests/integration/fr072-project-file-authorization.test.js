// @req FR-072 — project-file-service mutations refuse the write unless the
// viewer owns the governing Business of the Project named in the route path.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-project-file-authorization.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import { createProjectFile, deleteProjectFile } from '@/modules/project-manager/application/project-file-service'

let business, otherBusiness, workspace, project
let owner, attacker

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 project-file-service authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'W7 Authz Group', code: 'PF-W7AUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'W7 Authz Tenant', code: 'TNT-W7AUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'W7 Authz Business', code: 'BUS-W7AUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'W7 Other Business', code: 'BUS-W7AUTHZ-2' })

    workspace = await createWorkspace({
      name: 'W7 Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-W7AUTHZ',
    })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })

    project = await createProject({ workspaceId: workspace.id, name: 'W7 Authz Project', code: 'PRJ-W7AUTHZ' }, { viewer: owner })
  })

  describe('createProjectFile', () => {
    it('refuses the attacker and permits the owner on the same Project', async () => {
      const beforeFiles = await prisma.projectFile.count()
      const error = await refusalFrom(() =>
        createProjectFile(
          project.id,
          { code: 'FIL-W7-ATTACK', name: 'Attacker File', mime: 'text/plain', size: 3, blobRef: 'local:attack' },
          { viewer: attacker },
        ),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.projectFile.count()).toBe(beforeFiles)

      const file = await createProjectFile(
        project.id,
        { code: 'FIL-W7-OWNER', name: 'Owner File', mime: 'text/plain', size: 3, blobRef: 'local:owner' },
        { viewer: owner },
      )
      expect(file.id).toBeTruthy()
    })

    it('refuses an unowned real target identically to a fabricated id (no oracle)', async () => {
      // The real target is refused by assertProjectWritable (status 404); the
      // fabricated id is refused earlier by the pre-existing assertProject
      // not-found check, whose Error carries no status. Both produce the same
      // message and the same HTTP outcome once handle() applies its
      // "not found" -> 404 fallback for a statusless error, so the oracle
      // property is compared the way a caller (an HTTP client) would observe
      // it, not by requiring identical internal error shapes.
      const httpStatus = (error) => Number(error.status) || (/not found/i.test(error.message) ? 404 : 500)
      const real = await refusalFrom(() =>
        createProjectFile(project.id, { code: 'FIL-W7-REAL', name: 'x', mime: 'text/plain', size: 1, blobRef: 'local:x' }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        createProjectFile('no-such-project-id', { code: 'FIL-W7-FAKE', name: 'x', mime: 'text/plain', size: 1, blobRef: 'local:x' }, { viewer: attacker }),
      )
      expect(httpStatus(real)).toBe(404)
      expect(httpStatus(fabricated)).toBe(404)
      expect(real.message).toBe(fabricated.message)
    })
  })

  describe('deleteProjectFile', () => {
    let file

    beforeAll(async () => {
      file = await createProjectFile(
        project.id,
        { code: 'FIL-W7-DELETE', name: 'Delete Me', mime: 'text/plain', size: 3, blobRef: 'local:delete' },
        { viewer: owner },
      )
    })

    it('refuses the attacker, leaving both projectFile and fileAsset populations unchanged, and permits the owner', async () => {
      const filesBefore = await prisma.projectFile.count()
      const assetsBefore = await prisma.fileAsset.count()

      const error = await refusalFrom(() => deleteProjectFile(project.id, file.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
      expect(await prisma.projectFile.count()).toBe(filesBefore)
      expect(await prisma.fileAsset.count()).toBe(assetsBefore)

      const result = await deleteProjectFile(project.id, file.id, { viewer: owner })
      expect(result.id).toBe(file.id)
      expect(await prisma.projectFile.count()).toBe(filesBefore - 1)
    })
  })
})
