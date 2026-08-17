import { describe, it, expect, beforeAll } from 'vitest'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
  updateWorkspace,
  archiveWorkspace,
} from '../factories/scope'
import prisma from '@/lib/db'

// @req FR-072 — Workspace mutations refuse the write unless the viewer owns
// the Business governing the target Workspace. The seven scope-service
// creators are BLOCKED (route-viewer-plan.md §BLOCKED B1) and are untouched
// by this wave; this file exercises only `updateWorkspace` and
// `archiveWorkspace`.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-workspace-mutation-authorization.test.js
//
// This is the wave that exercises all three arms of the scope-type lookup:
// Tier A 404 for an unowned BUSINESS workspace, Tier B 403 for a
// PORTFOLIO-scoped one, and the deny-by-default 403 for a scope type outside
// the enum. Anyone could previously rename or archive the shared
// WS-PLATFORM-shaped workspace; after this wave nobody can — the FR-072(b)
// behaviour change — and that is proven with a viewer owning every fixture
// Business, refused the same as anyone else.

let business, otherBusiness, workspace
let portfolioWorkspace
let owner, attacker, dev, ownsEverything

/** Grab the thrown error rather than asserting on a message substring. */
async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-072 workspace mutation authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'WS Authz Group', code: 'PF-WSAUTHZ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'WS Authz Tenant', code: 'TNT-WSAUTHZ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'WS Authz Business', code: 'BUS-WSAUTHZ' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'WS Other Business', code: 'BUS-WSAUTHZ-2' })

    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    // The attacker shape from the RCAs: global role OWNER, target Business
    // visible, owned elsewhere.
    attacker = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
    dev = makeDevViewer({ visibleBusinessIds: [business.id, otherBusiness.id] })
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })

    workspace = await createWorkspace({
      name: 'WS Authz WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-WSAUTHZ',
    })

    // A PORTFOLIO-scoped Workspace — governed by no Business at all. The exact
    // shape of the real WS-PLATFORM seed workspace: renameable/archivable by
    // anyone before this wave, by nobody after.
    portfolioWorkspace = await createWorkspace({
      name: 'WS Authz Portfolio WS', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-WSAUTHZ-PORTFOLIO',
    })
  })

  describe('updateWorkspace — Tier A: an unowned BUSINESS workspace answers as an absent one', () => {
    it('refuses the attacker and permits the owner on the same target; refusal writes nothing', async () => {
      const error = await refusalFrom(() =>
        updateWorkspace(workspace.id, { name: 'Attacker Renamed' }, { viewer: attacker }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')

      // Both name AND version must be unchanged — version increments on every
      // successful update, so it is the more sensitive of the two witnesses.
      const unchanged = await prisma.workspace.findUnique({ where: { id: workspace.id } })
      expect(unchanged.name).toBe('WS Authz WS')
      expect(unchanged.version).toBe(1)

      const updated = await updateWorkspace(workspace.id, { name: 'Owner Renamed' }, { viewer: owner })
      expect(updated.name).toBe('Owner Renamed')
      expect(updated.version).toBe(2)
    })

    it('refuses a platform DEV — seeing everything is not owning anything', async () => {
      const error = await refusalFrom(() =>
        updateWorkspace(workspace.id, { name: 'Dev Renamed' }, { viewer: dev }),
      )
      expect(error.status).toBe(404)
    })

    it('refuses an unowned real workspace identically to a fabricated id (no oracle)', async () => {
      const real = await refusalFrom(() =>
        updateWorkspace(workspace.id, { name: 'Oracle Renamed' }, { viewer: attacker }),
      )
      const fabricated = await refusalFrom(() =>
        updateWorkspace('no-such-workspace-id', { name: 'Oracle Renamed' }, { viewer: attacker }),
      )
      // Byte-identical message either way. The raw `.status` differs at this
      // direct-call layer only because the pre-existing (unguarded, unchanged)
      // "Workspace not found" lookup throws before assertWorkspaceWritable is
      // ever reached for a truly nonexistent id — handle()'s message-sniffing
      // in src/app/api/_helpers.js maps *both* to the same 404 at the API
      // boundary, which is the layer an attacker actually observes.
      expect(real.status).toBe(404)
      expect([undefined, 404]).toContain(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('throws a wiring error, not a 4xx, when the viewer is omitted', async () => {
      const error = await refusalFrom(() => updateWorkspace(workspace.id, { name: 'No Viewer' }))
      expect(error.status).toBeUndefined()
      expect(error.message).toMatch(/viewer is required/)
    })
  })

  describe('updateWorkspace — Tier B: a PORTFOLIO-scoped workspace is refused for every principal', () => {
    it('refuses even a viewer owning every fixture Business, naming the missing authority', async () => {
      const error = await refusalFrom(() =>
        updateWorkspace(portfolioWorkspace.id, { name: 'Nobody Renames This' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/no authority above Business/)
      expect(error.message).toMatch(/cannot be authorized for any principal/)

      const unchanged = await prisma.workspace.findUnique({ where: { id: portfolioWorkspace.id } })
      expect(unchanged.name).toBe('WS Authz Portfolio WS')
      expect(unchanged.version).toBe(1)

      // The refusal is a statement about the system, not the caller: the
      // regular owner gets the identical refusal.
      const ownerError = await refusalFrom(() =>
        updateWorkspace(portfolioWorkspace.id, { name: 'Still Nobody' }, { viewer: owner }),
      )
      expect(ownerError.status).toBe(403)
      expect(ownerError.message).toBe(error.message)
    })
  })

  describe('updateWorkspace — deny-by-default: a scope type outside the enum is refused', () => {
    it('refuses a workspace record with an unrecognised scope type', async () => {
      // No production path can create this row (zWorkspaceInput constrains
      // scopeType to the enum); forced directly to exercise the deny-by-default
      // arm of the lookup, exactly as Wave 0's own test plants it.
      const galaxy = await createWorkspace({
        name: 'Galaxy WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-WSAUTHZ-GALAXY',
      })
      await prisma.workspace.update({ where: { id: galaxy.id }, data: { scopeType: 'GALAXY' } })

      const error = await refusalFrom(() =>
        updateWorkspace(galaxy.id, { name: 'Renamed' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/unrecognised scope type "GALAXY"/)
    })
  })

  describe('archiveWorkspace', () => {
    let toArchive

    beforeAll(async () => {
      toArchive = await createWorkspace({
        name: 'Archive Target WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-WSAUTHZ-ARCHIVE',
      })
    })

    it('fails closed 404 on a missing workspace id instead of a raw crash', async () => {
      const error = await refusalFrom(() => archiveWorkspace('no-such-workspace-id', { viewer: owner }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')
    })

    it('refuses the attacker and permits the owner on the same target', async () => {
      const error = await refusalFrom(() => archiveWorkspace(toArchive.id, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Workspace not found')

      const unchanged = await prisma.workspace.findUnique({ where: { id: toArchive.id } })
      expect(unchanged.status).toBe('ACTIVE')
      expect(unchanged.version).toBe(1)

      const archived = await archiveWorkspace(toArchive.id, { viewer: owner })
      expect(archived.status).toBe('ARCHIVED')
      expect(archived.version).toBe(2)
    })

    it('refuses to archive the shared PORTFOLIO workspace for any principal (FR-072(b))', async () => {
      const error = await refusalFrom(() => archiveWorkspace(portfolioWorkspace.id, { viewer: ownsEverything }))
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/cannot be authorized for any principal/)

      const unchanged = await prisma.workspace.findUnique({ where: { id: portfolioWorkspace.id } })
      expect(unchanged.status).toBe('ACTIVE')
    })
  })
})
