// @req FR-252 — owner Project Feature forms preserve the candidate DTO,
// capability-bound headers, compare-and-set tokens and explicit recovery states.
// @spec ADR-097, SDD-019, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/unit/project-feature-forms.test.js, tests/e2e/project-feature-mutations.spec.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildContributionsInput,
  buildFeatureCreateInput,
  buildFeaturePatchInput,
  buildGraphInput,
  buildRequirementBindingsInput,
  buildSnapshotCaptureInput,
  buildWorkLinksInput,
  describeMutationError,
  featurePath,
  featureViewPath,
  allocationSummary,
  editableLifecycles,
  fieldControlProps,
  fieldErrorFor,
  isFeatureEtag,
  isGraphEtag,
  isMutationReceipt,
  isSnapshotCaptureResult,
  makeIdempotencyKey,
  pendingMutationAttempt,
  normalizeFieldPath,
  requestFeatureJson,
  rereadAfterReceipt,
  sendFeatureMutation,
  snapshotPath,
  updateRequirementBindingRow,
} from '@/modules/project-manager/components/ProjectFeatureForms'

const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const FEATURE_ID = '00000000-0000-4000-8000-000000000102'
const WORK_ID = '00000000-0000-4000-8000-000000000103'
const SNAPSHOT_ID = '00000000-0000-4000-8000-000000000104'
const GRAPH_ETAG = '"PROJECT_FEATURE_GRAPH/' + PROJECT_ID + '/' + 'a'.repeat(64) + '"'
const FEATURE_ETAG = '"PROJECT_FEATURE/' + FEATURE_ID + '/v7"'
const UUID = '00000000-0000-4000-8000-000000000105'

function response(body, status = 200, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => normalized[String(key).toLowerCase()] || null },
    json: async () => body,
  }
}

function receipt(operation = 'UPDATE_FEATURE', overrides = {}) {
  return {
    receiptId: UUID,
    targetId: FEATURE_ID,
    targetType: 'FEATURE',
    operation,
    httpMethod: operation === 'DELETE_FEATURE' ? 'DELETE' : operation === 'UPDATE_FEATURE' ? 'PATCH' : 'PUT',
    resourceId: FEATURE_ID,
    resourceType: operation === 'REPLACE_FEATURE_WORK_GRAPH' ? 'PROJECT_FEATURE_GRAPH' : operation === 'CAPTURE_GOVERNANCE_SNAPSHOT' ? 'GOVERNANCE_SNAPSHOT' : 'PROJECT_FEATURE',
    status: 'COMMITTED',
    version: operation === 'REPLACE_FEATURE_WORK_GRAPH' || operation === 'CAPTURE_GOVERNANCE_SNAPSHOT' ? null : 8,
    etag: FEATURE_ETAG,
    recordedAt: '2026-09-17T00:00:00.000Z',
    auditRef: 'audit/' + UUID,
    requestId: UUID,
    ...overrides,
  }
}

describe('FR-252 Project Feature form DTOs', () => {
  it('builds create input with only candidate client fields and a server-owned DRAFT lifecycle', () => {
    expect(buildFeatureCreateInput({
      code: ' FEAT-NEW ',
      title: ' New feature ',
      problem: 'Problem',
      outcome: 'Outcome',
      primaryDomainId: 'DOM-CRM',
      tenantId: 'must-not-send',
      actorId: 'must-not-send',
      version: 99,
    })).toEqual({
      code: 'FEAT-NEW',
      title: 'New feature',
      problem: 'Problem',
      outcome: 'Outcome',
      primaryDomainId: 'DOM-CRM',
      lifecycle: 'DRAFT',
    })
  })

  it('builds patch input without code, scope, version, deletion, audit or evidence fields', () => {
    expect(buildFeaturePatchInput({
      title: 'Edited',
      problem: 'P',
      outcome: 'O',
      primaryDomainId: 'DOM-CRM',
      lifecycle: 'ACTIVE',
      code: 'READONLY',
      version: 42,
      deletedAt: '2026-01-01T00:00:00Z',
      governanceSnapshotId: SNAPSHOT_ID,
    })).toEqual({
      title: 'Edited',
      problem: 'P',
      outcome: 'O',
      primaryDomainId: 'DOM-CRM',
      lifecycle: 'ACTIVE',
    })
  })

  it('sends complete relationship sets and omits only truly blank UI rows', () => {
    expect(buildContributionsInput([
      { domainId: 'DOM-CRM', responsibility: 'Owns' },
      { domainId: '', responsibility: '' },
    ])).toEqual({ contributions: [{ domainId: 'DOM-CRM', responsibility: 'Owns' }] })
    expect(buildWorkLinksInput({
      allocationMode: 'COMPLETE_SPLIT',
      rows: [{ workItemId: WORK_ID, allocationBps: '2500' }, { workItemId: '', allocationBps: '' }],
    })).toEqual({ allocationMode: 'COMPLETE_SPLIT', links: [{ workItemId: WORK_ID, allocationBps: 2500 }] })
    expect(buildRequirementBindingsInput([
      { governanceSnapshotId: SNAPSHOT_ID, sourceNamespace: 'zuri', requirementKey: 'FR-252', revisionHash: 'a'.repeat(64), acceptanceRef: 'test' },
      { governanceSnapshotId: '', sourceNamespace: '', requirementKey: '', revisionHash: '', acceptanceRef: '' },
    ])).toEqual({
      bindings: [{ governanceSnapshotId: SNAPSHOT_ID, sourceNamespace: 'zuri', requirementKey: 'FR-252', revisionHash: 'a'.repeat(64), acceptanceRef: 'test' }],
    })
  })

  it('retains original graph WorkItem IDs when a UI row removes a link', () => {
    const body = buildGraphInput({
      allocationMode: 'UNALLOCATED',
      sets: [{ featureId: FEATURE_ID, originalWorkItemIds: [WORK_ID], links: [] }],
    })
    expect(body.affectedWorkItemIds).toEqual([WORK_ID])
    expect(body.featureSets).toEqual([{ featureId: FEATURE_ID, links: [] }])
  })

  it('keeps snapshot intent limited to repository, commit, hash and typed source manifest', () => {
    expect(buildSnapshotCaptureInput({
      repositoryId: PROJECT_ID,
      commitSha: 'a'.repeat(40),
      manifestHash: 'b'.repeat(64),
      sourceManifest: JSON.stringify({ schemaVersion: '1.0.0', entries: [] }),
      checkoutPath: 'C:/secret',
      proof: true,
    })).toEqual({
      repositoryId: PROJECT_ID,
      commitSha: 'a'.repeat(40),
      manifestHash: 'b'.repeat(64),
      sourceManifest: { schemaVersion: '1.0.0', entries: [] },
    })
    expect(() => buildSnapshotCaptureInput({ sourceManifest: '{' })).toThrow('valid JSON')
  })
})

describe('FR-252 Project Feature transport', () => {
  it('recognizes owner graph and Feature strong ETags only in their exact forms', () => {
    expect(isGraphEtag(GRAPH_ETAG)).toBe(true)
    expect(isGraphEtag('PROJECT_FEATURE_GRAPH/' + PROJECT_ID + '/' + 'a'.repeat(64))).toBe(false)
    expect(isFeatureEtag(FEATURE_ETAG, FEATURE_ID)).toBe(true)
    expect(isFeatureEtag(FEATURE_ETAG, PROJECT_ID)).toBe(false)
  })

  it('preserves status and response headers for the aggregate read', async () => {
    const result = await requestFeatureJson('/api/projects/' + PROJECT_ID + '/feature-view', {}, async () => response({ schemaVersion: '1.0' }, 200, { ETag: GRAPH_ETAG, 'X-Request-ID': UUID }))
    expect(result.etag).toBe(GRAPH_ETAG)
    expect(result.requestId).toBe(UUID)
  })

  it('obtains CSRF first and sends one idempotency key plus the current CAS token', async () => {
    const calls = []
    const fakeFetch = async (path, options) => {
      calls.push({ path, options })
      if (path === '/api/auth/csrf') return response({ token: 'csrf-token', expiresAt: '2026-09-17T00:15:00.000Z' })
      return response(receipt())
    }
    const result = await sendFeatureMutation({
      path: featurePath(PROJECT_ID, FEATURE_ID),
      method: 'PATCH',
      body: { title: 'Edited' },
      ifMatch: FEATURE_ETAG,
      idempotencyKey: 'intent-12345678',
      fetchImpl: fakeFetch,
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].path).toBe('/api/auth/csrf')
    expect(calls[1].options.headers).toMatchObject({
      'X-CSRF-Token': 'csrf-token',
      'Idempotency-Key': 'intent-12345678',
      'If-Match': FEATURE_ETAG,
    })
    expect(JSON.parse(calls[1].options.body)).toEqual({ title: 'Edited' })
    expect(result.attempt.idempotencyKey).toBe('intent-12345678')
  })

  it('preserves the same attempt when the mutation response is uncertain', async () => {
    let calls = 0
    await expect(sendFeatureMutation({
      path: featurePath(PROJECT_ID, FEATURE_ID),
      method: 'PATCH',
      body: { title: 'Keep this value' },
      ifMatch: FEATURE_ETAG,
      idempotencyKey: 'intent-uncertain',
      fetchImpl: async (path) => {
        calls += 1
        if (path === '/api/auth/csrf') return response({ token: 'csrf-token' })
        throw new Error('connection lost')
      },
    })).rejects.toMatchObject({
      uncertain: true,
      attempt: { idempotencyKey: 'intent-uncertain', body: { title: 'Keep this value' } },
    })
    expect(calls).toBe(2)
  })

  it('preserves the original intent for an untyped gateway or HTML refusal', async () => {
    await expect(sendFeatureMutation({
      path: featurePath(PROJECT_ID, FEATURE_ID),
      method: 'PATCH',
      body: { title: 'Keep this value' },
      ifMatch: FEATURE_ETAG,
      idempotencyKey: 'intent-gateway',
      fetchImpl: async (path) => {
        if (path === '/api/auth/csrf') return response({ token: 'csrf-token' })
        return response(null, 503)
      },
    })).rejects.toMatchObject({
      uncertain: true,
      attempt: { idempotencyKey: 'intent-gateway', body: { title: 'Keep this value' } },
    })
  })

  it('clears the uncertain state for a typed refusal', async () => {
    await expect(sendFeatureMutation({
      path: featurePath(PROJECT_ID, FEATURE_ID),
      method: 'PATCH',
      body: { title: 'Rejected value' },
      ifMatch: FEATURE_ETAG,
      idempotencyKey: 'intent-typed',
      fetchImpl: async (path) => {
        if (path === '/api/auth/csrf') return response({ token: 'csrf-token' })
        return response({ code: 'CAPABILITY_DENIED', message: 'Capability denied.', requestId: UUID, retryable: false }, 403)
      },
    })).rejects.toMatchObject({
      uncertain: false,
      attempt: { idempotencyKey: 'intent-typed' },
    })
  })

  it('retains the complete capture and graph attempt for same-intent reconciliation and rereads by operation', async () => {
    const fetchCalls = []
    const fetchImpl = async (path) => {
      fetchCalls.push(path)
      return response({ items: [], schemaVersion: '1.0' })
    }
    const captureAttempt = {
      path: snapshotPath(PROJECT_ID),
      method: 'POST',
      body: { repositoryId: PROJECT_ID, commitSha: 'a'.repeat(40) },
      ifMatch: null,
      idempotencyKey: 'intent-capture',
      fetchImpl,
      operation: 'CAPTURE_GOVERNANCE_SNAPSHOT',
    }
    const graphAttempt = {
      path: '/api/projects/' + PROJECT_ID + '/feature-work-links',
      method: 'PUT',
      body: { featureSets: [] },
      ifMatch: GRAPH_ETAG,
      idempotencyKey: 'intent-graph',
      fetchImpl,
      operation: 'REPLACE_FEATURE_WORK_GRAPH',
    }
    expect(pendingMutationAttempt({ uncertain: true }, captureAttempt)).toBe(captureAttempt)
    expect(pendingMutationAttempt({ uncertain: true }, graphAttempt)).toBe(graphAttempt)
    expect(pendingMutationAttempt({ uncertain: false }, graphAttempt)).toBeNull()
    await rereadAfterReceipt(PROJECT_ID, captureAttempt.operation, receipt(captureAttempt.operation), fetchImpl)
    await rereadAfterReceipt(PROJECT_ID, graphAttempt.operation, receipt(graphAttempt.operation), fetchImpl)
    expect(fetchCalls).toEqual([snapshotPath(PROJECT_ID), featureViewPath(PROJECT_ID)])
  })

  it('maps typed refusal statuses to bounded UI states without discarding fields', () => {
    const result = describeMutationError({
      status: 422,
      payload: {
        code: 'INVALID_ALLOCATION',
        message: 'Request violates a Feature invariant.',
        fields: [{ path: 'links.0.allocationBps', code: 'INVALID_FIELD', message: 'Request field is invalid.' }],
      },
    })
    expect(result.state).toBe('invalid')
    expect(result.fields[0].path).toBe('links.0.allocationBps')
    expect(describeMutationError({ uncertain: true }).state).toBe('uncertain')
  })

  it('keeps field errors linked to controls and constrains lifecycle choices', () => {
    expect(normalizeFieldPath('links[0].allocationBps')).toBe('links.0.allocationBps')
    const error = { fields: [{ path: 'links[0].allocationBps', message: 'Allocation is invalid.' }] }
    expect(fieldErrorFor(error, 'links.0.allocationBps')).toEqual(error.fields[0])
    expect(fieldControlProps(error, 'links.0.allocationBps')).toMatchObject({
      name: 'links.0.allocationBps',
      'aria-invalid': 'true',
      'aria-describedby': 'feature-field-error-links-0-allocationBps',
    })
    expect(editableLifecycles('RETIRED')).toEqual(['RETIRED'])
    expect(editableLifecycles('ACTIVE')).toEqual(['ACTIVE', 'RETIRED'])
  })

  it('derives WorkItem totals and remainders from complete Feature rows', () => {
    expect(allocationSummary([
      { id: 'feature-a', workLinks: [{ workItemId: WORK_ID, allocationBps: 2500 }] },
      { id: 'feature-b', workLinks: [{ workItemId: WORK_ID, allocationBps: 1500 }, { workItemId: UUID, allocationBps: null }] },
    ], [{ featureId: 'feature-a', links: [{ workItemId: WORK_ID, allocationBps: 5000 }] }])).toEqual([
      { workItemId: WORK_ID, total: 6500, hasUnallocated: false, remainder: 3500 },
      { workItemId: UUID, total: 0, hasUnallocated: true, remainder: 10000 },
    ])
  })

  it('clears a server-derived requirement subject when its identity tuple changes', () => {
    const row = { governanceSnapshotId: SNAPSHOT_ID, sourceNamespace: 'zuri', requirementKey: 'FR-252', revisionHash: 'a'.repeat(64), canonicalSubject: 'Owner Feature forms', bindingState: 'VERIFIED' }
    expect(updateRequirementBindingRow(row, 'requirementKey', 'FR-253')).toMatchObject({
      requirementKey: 'FR-253',
      canonicalSubject: null,
      bindingState: 'UNAVAILABLE',
    })
    expect(updateRequirementBindingRow(row, 'acceptanceRef', 'new proof')).toMatchObject({
      acceptanceRef: 'new proof',
      canonicalSubject: 'Owner Feature forms',
      bindingState: 'VERIFIED',
    })
  })
})

describe('FR-252 Project Feature response validation', () => {
  it('accepts only a complete receipt and the snapshot result discriminator', () => {
    const value = receipt()
    expect(isMutationReceipt(value, 'UPDATE_FEATURE')).toBe(true)
    expect(isMutationReceipt({ ...value, status: 'PENDING' }, 'UPDATE_FEATURE')).toBe(false)
    expect(isMutationReceipt({ ...value, operation: 'DELETE_FEATURE' }, 'UPDATE_FEATURE')).toBe(false)
    const snapshot = {
      id: SNAPSHOT_ID,
      repositoryId: PROJECT_ID,
      commitSha: 'a'.repeat(40),
      manifestHash: 'b'.repeat(64),
      validationStatus: 'VALID',
      sourceManifest: { schemaVersion: '1.0.0', entries: [] },
    }
    expect(isSnapshotCaptureResult({
      snapshot,
      receipt: receipt('CAPTURE_GOVERNANCE_SNAPSHOT', {
        targetId: PROJECT_ID,
        targetType: 'PROJECT',
        resourceId: SNAPSHOT_ID,
        resourceType: 'GOVERNANCE_SNAPSHOT',
        httpMethod: 'POST',
        etag: GRAPH_ETAG,
        version: null,
      }),
    })).toBe(true)
  })

  it('documents the owner graph ETag gate and no planned actions for shared readers', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectFeatureView.jsx'), 'utf8')
    const forms = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectFeatureForms.jsx'), 'utf8')
    expect(view).toContain('isGraphEtag(view.etag)')
    expect(view).toContain('dataIsCurrent')
    expect(view).toContain('canMutate={ownerCapability}')
    expect(forms).toContain('if (!owner || !action) return null')
    expect(forms).not.toContain('checkoutPath')
    expect(forms).not.toContain('proof:')
  })

  it('uses explicit list/detail empty and unavailable copy instead of inventing IDs', () => {
    const forms = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectFeatureForms.jsx'), 'utf8')
    const pickers = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectFeaturePickers.jsx'), 'utf8')
    expect(forms).toContain('No VALID governance snapshots are available.')
    expect(forms).toContain('No deleted Features are available to restore.')
    expect(pickers).toContain('Choose a canonical execution Domain.')
    expect(makeIdempotencyKey(() => 'fixed-id')).toBe('pm-feature-fixed-id')
  })
})
