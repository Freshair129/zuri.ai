import { createHmac, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildProjectFeatureRecord,
  buildProjectFeatureView,
  decodeFeatureCursor,
  deriveAllocationStates,
  parseFeatureListQuery,
  parseSnapshotListQuery,
  zFeatureRecord,
  zFeatureView,
  zGovernanceSnapshotMetadata,
} from '@/modules/project-manager/application/project-feature-read-model'

// @req FR-252 — the Feature read contract preserves explicit bindings,
// immutable Domain mappings, allocation semantics and signed scope cursors.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/unit/project-feature-read-model.test.js

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const FEATURE_ID = '22222222-2222-4222-8222-222222222222'
const LINK_A = '33333333-3333-4333-8333-333333333333'
const LINK_B = '44444444-4444-4444-8444-444444444444'
const ITEM_A = '55555555-5555-4555-8555-555555555555'
const ITEM_B = '66666666-6666-4666-8666-666666666666'
const DATE = '2026-09-17T00:00:00.000Z'

const feature = (over = {}) => ({
  id: FEATURE_ID,
  version: 1,
  projectId: PROJECT_ID,
  code: 'FEAT-ONE',
  title: 'Explicit feature',
  problem: 'A known problem',
  outcome: 'A measurable outcome',
  primaryDomainId: 'DOM-COMMERCE',
  canonicalFeatureKey: null,
  governanceSnapshotId: null,
  lifecycle: 'ACTIVE',
  ...over,
})

const item = (id, code, over = {}) => ({
  id,
  code,
  title: `${code} title`,
  ...over,
})

function expectFailure(operation, shape) {
  let error
  try {
    operation()
  } catch (caught) {
    error = caught
  }
  expect(error).toMatchObject(shape)
}

describe('Project Feature read model', () => {
  it('returns the strict view DTO with unknown Domains and no aggregate snapshot', () => {
    const links = [
      { id: LINK_A, version: 1, featureId: FEATURE_ID, workItemId: ITEM_A, allocationBps: 5000 },
      { id: LINK_B, version: 1, featureId: FEATURE_ID, workItemId: ITEM_A, allocationBps: 5000 },
    ]
    const result = buildProjectFeatureView({
      projectId: PROJECT_ID,
      features: [feature({ primaryDomainId: 'DOM-IMPORTED-FROM-PLAN' })],
      contributions: [{
        id: '77777777-7777-4777-8777-777777777777',
        version: 1,
        featureId: FEATURE_ID,
        domainId: 'DOM-UNKNOWN-IMPORTED',
        responsibility: 'Supporting responsibility',
      }],
      workLinks: links,
      workItems: new Map([[ITEM_A, item(ITEM_A, 'WI-ONE')], [ITEM_B, item(ITEM_B, 'WI-UNLINKED')]]),
      now: DATE,
    })

    expect(zFeatureView.parse(result)).toEqual(result)
    expect(result).toMatchObject({
      schemaVersion: '1.0',
      projectId: PROJECT_ID,
      snapshotId: null,
      snapshotState: 'UNAVAILABLE',
      observedAt: DATE,
      uniqueWorkCount: 2,
    })
    expect(result.features[0].primaryDomain).toEqual({
      domainId: 'DOM-IMPORTED-FROM-PLAN', label: 'Unknown domain', mappingState: 'UNMAPPED',
    })
    expect(result.features[0].contributions[0]).toMatchObject({
      domainId: 'DOM-UNKNOWN-IMPORTED', label: 'Unknown domain', mappingState: 'UNMAPPED',
      responsibility: 'Supporting responsibility',
    })
    expect(result.features[0].workLinks.every(({ allocationState }) => allocationState === 'COMPLETE_SPLIT')).toBe(true)
    expect(result.features[0].uniqueWorkCount).toBe(1)
    expect(buildProjectFeatureView({
      projectId: PROJECT_ID, features: [], workItems: [item(ITEM_B, 'WI-UNLINKED')], now: DATE,
    })).toMatchObject({ features: [], uniqueWorkCount: 1 })
  })

  it('deduplicates WorkItems and treats zero as a supplied allocation value', () => {
    const states = deriveAllocationStates([
      { workItemId: ITEM_A, allocationBps: 0 },
      { workItemId: ITEM_A, allocationBps: null },
      { workItemId: ITEM_B, allocationBps: null },
    ])
    expect(states.get(ITEM_A)).toBe('PARTIAL')
    expect(states.get(ITEM_B)).toBe('UNALLOCATED')

    const result = buildProjectFeatureRecord({
      projectId: PROJECT_ID,
      feature: feature(),
      workLinks: [{ id: LINK_A, version: 1, featureId: FEATURE_ID, workItemId: ITEM_A, allocationBps: 0 }],
      allWorkLinks: [{ id: LINK_A, version: 1, featureId: FEATURE_ID, workItemId: ITEM_A, allocationBps: 0 }],
      workItems: new Map([[ITEM_A, item(ITEM_A, 'WI-ZERO')]]),
    })
    expect(zFeatureRecord.parse(result)).toEqual(result)
    expect(result.uniqueWorkCount).toBe(1)
    expect(result.workLinks[0].allocationState).toBe('PARTIAL')
    expect(result.workLinks[0].allocationBps).toBe(0)
  })

  it('rejects invalid allocation totals and unpaired evidence references', () => {
    expectFailure(() => deriveAllocationStates([
      { workItemId: ITEM_A, allocationBps: 9000 },
      { workItemId: ITEM_A, allocationBps: 1001 },
    ]), { code: 'DATA_INTEGRITY_UNAVAILABLE', status: 503 })

    expect(() => zFeatureRecord.parse(buildProjectFeatureRecord({
      projectId: PROJECT_ID,
      feature: feature({ canonicalFeatureKey: 'feature.one' }),
    }))).toThrow()
  })

  it('does not treat VALID snapshot metadata as canonical key or revision proof', () => {
    const snapshotId = '88888888-8888-4888-8888-888888888888'
    const result = buildProjectFeatureRecord({
      projectId: PROJECT_ID,
      feature: feature({ canonicalFeatureKey: 'feature.unproven', governanceSnapshotId: snapshotId }),
      availableSnapshotIds: new Set([snapshotId]),
    })
    expect(result.evidenceState).toBe('UNAVAILABLE')
    expect(result.evidence).toEqual([{ state: 'UNAVAILABLE', ref: null }])
  })

  it('requires exact key and revision correspondence before projecting verified evidence', () => {
    const snapshotId = '88888888-8888-4888-8888-888888888888'
    const binding = {
      id: '99999999-9999-4999-8999-999999999999', version: 1,
      governanceSnapshotId: snapshotId, sourceNamespace: 'ZAI', requirementKey: 'FR-252',
      revisionHash: 'a'.repeat(64), acceptanceRef: 'docs/acceptance',
    }
    const base = {
      projectId: PROJECT_ID,
      feature: feature({ canonicalFeatureKey: 'FEAT-001', governanceSnapshotId: snapshotId }),
      requirementBindings: [binding],
    }
    const mismatched = buildProjectFeatureRecord({
      ...base,
      featureEvidenceById: new Map([[FEATURE_ID, { state: 'AVAILABLE', canonicalFeatureKey: 'FEAT-002', ref: 'wrong-key' }]]),
      requirementEvidenceById: new Map([[binding.id, { ...binding, state: 'AVAILABLE', revisionHash: 'b'.repeat(64), canonicalSubject: 'Wrong revision subject' }]]),
    })
    expect(mismatched.evidenceState).toBe('UNAVAILABLE')
    expect(mismatched.requirementBindings[0]).toMatchObject({ canonicalSubject: null, bindingState: 'UNAVAILABLE' })
    const verified = buildProjectFeatureRecord({
      ...base,
      featureEvidenceById: new Map([[FEATURE_ID, { state: 'AVAILABLE', canonicalFeatureKey: 'FEAT-001', ref: 'docs/FEATURES.md#FEAT-001@bound-commit' }]]),
      requirementEvidenceById: new Map([[binding.id, { ...binding, state: 'AVAILABLE', canonicalSubject: 'Approved source wording.' }]]),
    })
    expect(verified.evidenceState).toBe('AVAILABLE')
    expect(verified.requirementBindings[0]).toMatchObject({ canonicalSubject: 'Approved source wording.', bindingState: 'PINNED' })
  })

  it('enforces bounded list queries and scope-bound HMAC cursors', () => {
    expect(parseFeatureListQuery(new URLSearchParams('limit=1&visibility=ACTIVE&lifecycle=DRAFT'))).toEqual({
      limit: 1, visibility: 'ACTIVE', lifecycle: 'DRAFT', cursor: null,
    })
    expect(parseSnapshotListQuery(new URLSearchParams('limit=50'))).toEqual({ limit: 50, cursor: null })
    expectFailure(() => parseFeatureListQuery(new URLSearchParams('limit=0')), { status: 400 })
    expectFailure(() => parseSnapshotListQuery(new URLSearchParams('limit=51')), { status: 400 })

    const env = { ZURI_SESSION_SECRET: 'phase-b-test-session-secret-0123456789' }
    const expected = {
      tenantId: 'tenant-1', businessId: 'business-1', projectId: PROJECT_ID,
      visibility: 'ACTIVE', lifecycle: null, order: 'code,id',
    }
    const payload = {
      v: 1, ...expected, position: { code: 'FEAT-ONE', id: FEATURE_ID },
      expiresAt: Date.now() + 60_000,
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signed = `pm_feature_cursor_v1.${encoded}`
    const signature = createHmac('sha256', env.ZURI_SESSION_SECRET).update(signed).digest('base64url')
    const token = `${signed}.${signature}`
    expect(decodeFeatureCursor(token, expected, { env })).toEqual(payload.position)
    expectFailure(() => decodeFeatureCursor(`${signed}.${signature.slice(0, -1)}x`, expected, { env }), {
      code: 'INVALID_CURSOR', status: 400,
    })
    expectFailure(() => decodeFeatureCursor(token, { ...expected, projectId: randomUUID() }, { env }), {
      code: 'INVALID_CURSOR', status: 400,
    })
  })

  it('accepts both 40 and 64 hex commit identifiers while rejecting other forms', () => {
    const base = {
      id: randomUUID(), repositoryId: randomUUID(), manifestHash: 'a'.repeat(64),
      capturedAt: DATE, validationStatus: 'VALID',
    }
    expect(zGovernanceSnapshotMetadata.parse({ ...base, commitSha: 'a'.repeat(40) }).commitSha).toHaveLength(40)
    expect(zGovernanceSnapshotMetadata.parse({ ...base, commitSha: 'b'.repeat(64) }).commitSha).toHaveLength(64)
    expect(() => zGovernanceSnapshotMetadata.parse({ ...base, commitSha: 'a'.repeat(41) })).toThrow()
  })
})
