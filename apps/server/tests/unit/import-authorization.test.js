import { describe, expect, it } from 'vitest'
import { WORKSPACE_SCOPE_TYPES } from '@/lib/validation/enums'
import {
  authorizeImportTarget,
  AUTHORIZABLE_SCOPE_TYPES,
  UNGOVERNED_SCOPE_TYPES,
} from '@/modules/project-manager/import/import-authorization'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'

// @req FR-065 — may this viewer import into this Workspace?
// @spec SDD-037, SEC-001, SEC-008
// @tested tests/unit/import-authorization.test.js
//
// The pure decision. Its integration with the pipeline is pinned separately in
// tests/integration/import-target-authorization.test.js — this file is about the
// three properties the decision itself must hold:
//
//   1. a write takes the write bar (`ownsBusiness`), not the read bar
//   2. a scope type nobody declared authority for is REFUSED, derived from the
//      enum rather than from a hand-written list of the two that exist today
//   3. a refusal never becomes an enumeration oracle

const businessWorkspace = (businessId) => ({
  id: 'ws-1',
  code: 'WS-TARGET',
  scopeType: 'BUSINESS',
  businessId,
})

describe('a Business-scoped target takes the write bar', () => {
  it('authorizes the owner of that Business', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    expect(authorizeImportTarget(viewer, businessWorkspace('b-1'))).toEqual({ authorized: true })
  })

  it('refuses a viewer who only SEES the Business', () => {
    // The shape from the RCAs: global role OWNER, target Business visible but
    // not owned. Import is a write; visibility is not a write bar.
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-target' })
    expect(viewer.role).toBe('OWNER')
    expect(viewer.visibleBusinessIds).toContain('b-target')

    const decision = authorizeImportTarget(viewer, businessWorkspace('b-target'))
    expect(decision.authorized).toBe(false)
  })

  it('refuses a platform DEV — sees everything, owns nothing, writes nothing', () => {
    const viewer = makeDevViewer({ visibleBusinessIds: ['b-1'] })
    expect(authorizeImportTarget(viewer, businessWorkspace('b-1')).authorized).toBe(false)
  })

  it('refuses a BUSINESS-scoped workspace whose businessId is missing', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    for (const businessId of [null, undefined, '']) {
      expect(authorizeImportTarget(viewer, businessWorkspace(businessId)).authorized).toBe(false)
    }
  })
})

describe('a refusal must not become an enumeration oracle', () => {
  it('discloses no reason when the Business is simply not owned', () => {
    // `reason: null` is the contract for "answer exactly as you would for a
    // Workspace that is not there". If this ever becomes a string, an attacker
    // can tell a real other-tenant workspace id from a made-up one.
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-target' })
    expect(authorizeImportTarget(viewer, businessWorkspace('b-target'))).toEqual({
      authorized: false,
      reason: null,
    })
  })

  it('discloses nothing for a Business the viewer cannot even see', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    expect(authorizeImportTarget(viewer, businessWorkspace('b-someone-elses')).reason).toBeNull()
  })
})

describe('scope types nobody declared authority for are refused, by derivation', () => {
  it('declares BUSINESS as the only authorizable scope type today', () => {
    expect(AUTHORIZABLE_SCOPE_TYPES).toEqual(['BUSINESS'])
  })

  it('derives the ungoverned set from the enum rather than a hand-written list', () => {
    // The point of this assertion: if someone adds a value to
    // WORKSPACE_SCOPE_TYPES, it lands here automatically and is DENIED, instead
    // of slipping past an `if (t === 'PORTFOLIO' || t === 'TENANT')` that was
    // written when only two existed.
    expect(UNGOVERNED_SCOPE_TYPES).toEqual(
      WORKSPACE_SCOPE_TYPES.filter((t) => !AUTHORIZABLE_SCOPE_TYPES.includes(t))
    )
    expect(UNGOVERNED_SCOPE_TYPES.length).toBeGreaterThan(0)
  })

  it('refuses every ungoverned scope type, for an owner of everything in sight', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    for (const scopeType of UNGOVERNED_SCOPE_TYPES) {
      const decision = authorizeImportTarget(viewer, {
        id: 'ws-x',
        code: 'WS-PLATFORM',
        scopeType,
        businessId: null,
      })
      expect(decision.authorized).toBe(false)
      // This refusal IS disclosed — it names the authority that does not exist,
      // which is the signpost to the requirement that would create it.
      expect(decision.reason).toContain('no authority above Business')
      expect(decision.reason).toContain(scopeType)
    }
  })

  it('gives the same answer to every principal, because none can hold that authority', () => {
    const target = { id: 'ws-x', code: 'WS-PLATFORM', scopeType: 'PORTFOLIO', businessId: null }
    const viewers = [
      makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] }),
      ownsElsewhere(),
      makeDevViewer(),
    ]
    const answers = new Set(viewers.map((v) => authorizeImportTarget(v, target).reason))
    // One distinct answer: the refusal depends on the system, not the caller —
    // which is why disclosing it grants nobody anything.
    expect(answers.size).toBe(1)
  })

  it('refuses a scope type outside the vocabulary entirely', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    const decision = authorizeImportTarget(viewer, {
      id: 'ws-x',
      code: 'WS-WEIRD',
      scopeType: 'GALAXY',
      businessId: 'b-1',
    })
    expect(decision.authorized).toBe(false)
    expect(decision.reason).toMatch(/unrecognised scope type/i)
  })
})

describe('both arguments are required, and say so loudly', () => {
  const workspace = businessWorkspace('b-1')

  it('throws when the viewer is omitted rather than deciding without one', () => {
    // The failure mode for wiring a new intake surface without authorization
    // must be a crash at wiring time, not a quiet write.
    expect(() => authorizeImportTarget(undefined, workspace)).toThrow(/viewer is required/i)
    expect(() => authorizeImportTarget(null, workspace)).toThrow(/viewer is required/i)
  })

  it('throws when the workspace is not resolved', () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    for (const bad of [undefined, null, 'ws-1']) {
      expect(() => authorizeImportTarget(viewer, bad)).toThrow(/workspace is required/i)
    }
  })

  it('fails closed on a viewer-shaped value that carries no grants', () => {
    // Not a throw — a value was passed, it just grants nothing.
    expect(authorizeImportTarget({}, workspace).authorized).toBe(false)
    expect(authorizeImportTarget({ role: 'OWNER' }, workspace).authorized).toBe(false)
    expect(authorizeImportTarget('owner', workspace).authorized).toBe(false)
  })
})
