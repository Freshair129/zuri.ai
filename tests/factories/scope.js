// Scope fixtures, authorized as arrangement rather than as the behaviour under test.
//
// @req FR-074, FR-075 — the seven scope creators now authorize at four different
// scopes. Almost every suite in this repository builds a Portfolio → Tenant →
// Business → Workspace chain purely to have somewhere to put the thing it
// actually tests, and threading a correctly-shaped viewer through ~200 such call
// sites would put authorization decisions into files that are not about
// authorization — the surest way to end up with one that is quietly wrong.
//
// So these wrappers keep the service's exact signatures and supply the viewer
// each creator requires. Import them **instead of** `scope-service` when the
// scope is arrangement. When the subject *is* who may create scope, import the
// real service and pass viewers explicitly — that is
// `fr074-scope-creation-authorization.test.js`, and it deliberately does not use
// this file.
//
// The wrappers grant no more than the creator needs: the operator capability for
// the primitives above a Tenant, Tenant ownership for a Business, Business
// ownership for a Branch. A blanket "owns everything" fixture viewer would be
// easier and would also be the shape that hid three privilege escalations here
// before — a fixture that cannot fail teaches nothing.

import * as service from '@/modules/project-manager/application/scope-service'
import { makeViewer, makeOperatorViewer } from './viewer'

/** The installation operator: the only authority above a Tenant (FR-075). */
const operator = () => makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

/** A tenant-wide OWNER: what FR-074(b) requires to create a Business. */
const tenantOwner = (tenantId) =>
  tenantId
    ? makeViewer({ role: 'OWNER', visibleBusinessIds: [], ownedBusinessIds: [], ownedTenantIds: [tenantId] })
    : operator() // see businessOwner: malformed input is the service's error to raise

/** A per-Business OWNER: what FR-074(a) requires for a Branch or BUSINESS Space. */
const businessOwner = (businessId) =>
  businessId
    ? makeViewer({ visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    // Some suites deliberately pass malformed input — a BUSINESS Space with no
    // businessId, say — to assert the service's own shape validation. There is no
    // id to own, so hand over an operator and let the service raise the error the
    // test is actually about, instead of failing in the fixture.
    : operator()

export const createPortfolio = (input) => service.createPortfolio(input, { viewer: operator() })
export const createTenant = (input) => service.createTenant(input, { viewer: operator() })
export const createLegalEntity = (input) => service.createLegalEntity(input, { viewer: operator() })

export const createBusiness = (input) =>
  service.createBusiness(input, { viewer: tenantOwner(input?.tenantId) })

export const createBranch = (input) =>
  service.createBranch(input, { viewer: businessOwner(input?.businessId) })

/** Authorized at whichever scope the Space is actually being created at. */
export const createWorkspace = (input) => {
  const viewer =
    input?.scopeType === 'BUSINESS'
      ? businessOwner(input?.businessId)
      : input?.scopeType === 'TENANT'
        ? tenantOwner(input?.tenantId)
        : operator()
  return service.createWorkspace(input, { viewer })
}

/**
 * Self-service provisioning (FR-074(c)). Needs only an authenticated principal,
 * but the Membership it writes points at `viewer.principal.id`, so that must be
 * a Person that exists — callers pass a viewer built from a real seeded Person.
 */
export const createBusinessInGroup = (input, { viewer } = {}) =>
  service.createBusinessInGroup(input, { viewer })

// Everything else passes straight through, so a suite swaps one import line
// rather than splitting its imports in two.
//
// Listed by name rather than `export *`: under this bundler a star re-export
// wins over the explicit wrappers above, which silently handed the unguarded
// service functions back to every suite — the wrappers were still there, and
// nothing was using them. Naming the pass-throughs makes the split impossible to
// get wrong, and a scope-service export added later will fail to resolve here
// loudly rather than quietly bypass a guard.
export {
  listScope,
  listWorkspacesForScope,
  updateWorkspace,
  archiveWorkspace,
  assertWorkspaceInScope,
} from '@/modules/project-manager/application/scope-service'
