import { describe, expect, it, vi } from 'vitest'

import {
  CUSTOMER_REVIEW_DECIDE_PERMISSION,
  CUSTOMER_REVIEW_READ_PERMISSION,
  ROLE_CUSTOMER_DATA_REVIEWER,
  ROLE_PRODUCT_OWNER,
} from '@/modules/identity/rbac'
import {
  appendCustomerImportReviewDecisions,
  listCustomerImportReviewQueue,
  listCustomerImportReviewTargets,
} from '@/modules/crm/customer-import-review-service'
import { SMARTGIFT_REVIEW_SCOPE } from '@/modules/crm/customer-import-review-store'
import { makeDevViewer, makeViewer } from '../factories/viewer'

// @req FR-078 — review queue authorization, redaction and decision boundaries.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-service.test.js

const caseRow = () => ({
  id: '11111111-1111-4111-8111-111111111111',
  batchId: '3a7a45b1-1785-55dd-af41-d225a4afb45c',
  tenantId: SMARTGIFT_REVIEW_SCOPE.tenantId,
  businessId: SMARTGIFT_REVIEW_SCOPE.businessId,
  reasonCode: 'DUPLICATE_NORMALIZED_NAME',
  status: 'OPEN',
  itemCount: 2,
  evidenceSummaryJson: JSON.stringify({ normalizedNameMatch: true, emailMatch: true }),
  version: 1,
  updatedAt: new Date('2026-08-18T07:30:00Z'),
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      sourceRow: 10,
      sourceSha256: 'a'.repeat(64),
      reviewCaseId: '11111111-1111-4111-8111-111111111111',
      reviewReasonCode: 'DUPLICATE_NORMALIZED_NAME',
      reviewEvidenceJson: JSON.stringify({ normalizedNameMatch: true, emailMatch: true }),
      resolutionStatus: 'REVIEW_REQUIRED',
      disposition: 'REVIEW',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      sourceRow: 11,
      sourceSha256: 'b'.repeat(64),
      reviewCaseId: '11111111-1111-4111-8111-111111111111',
      reviewReasonCode: 'DUPLICATE_NORMALIZED_NAME',
      reviewEvidenceJson: JSON.stringify({ normalizedNameMatch: true }),
      resolutionStatus: 'REVIEW_REQUIRED',
      disposition: 'REVIEW',
    },
  ],
  decisions: [],
})

function reviewer() {
  return makeViewer({
    role: 'MEMBER',
    visibleBusinessIds: [SMARTGIFT_REVIEW_SCOPE.businessId],
    ownedBusinessIds: [],
    rolesByBusinessId: { [SMARTGIFT_REVIEW_SCOPE.businessId]: [ROLE_CUSTOMER_DATA_REVIEWER] },
    principal: { id: 'c82690eb-84e8-48a8-8a28-fe3d839c2276', code: 'PER-BOSS', displayName: 'Boss' },
  })
}

function store() {
  const row = caseRow()
  return {
    row,
    resolveScope: vi.fn(async () => SMARTGIFT_REVIEW_SCOPE),
    listCases: vi.fn(async () => [row]),
    getCase: vi.fn(async () => row),
    listTargetCustomers: vi.fn(async () => [{ id: '44444444-4444-4444-8444-444444444444', displayName: 'Restricted Name' }]),
    appendDecisions: vi.fn(async ({ decisions }) => ({
      ...row,
      version: 2,
      status: decisions.every((decision) => decision.action === 'DEFER') ? 'DEFERRED' : 'PARTIALLY_DECIDED',
      decisions: decisions.map((decision, index) => ({
        id: `decision-${index}`,
        provenanceId: decision.provenanceId,
        decisionVersion: 1,
        action: decision.action,
        targetCustomerId: decision.targetCustomerId,
        decidedByPersonId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
        decidedAt: new Date('2026-08-18T07:31:00Z'),
      })),
    })),
  }
}

describe('FR-078 duplicate customer review queue', () => {
  it('returns only stable identifiers and redacted evidence flags', async () => {
    const adapter = store()
    const result = await listCustomerImportReviewQueue({
      businessId: SMARTGIFT_REVIEW_SCOPE.businessId,
      viewer: reviewer(),
      store: adapter,
    })

    expect(result.scope).toEqual(SMARTGIFT_REVIEW_SCOPE)
    expect(result.cases[0].reviewCaseId).toBe(caseRow().id)
    expect(result.cases[0].items[0]).toEqual(expect.objectContaining({
      reviewItemId: caseRow().items[0].id,
      sourceRow: 10,
      sourceSha256: 'a'.repeat(64),
      evidence: { normalizedNameMatch: true, emailMatch: true },
    }))
    expect(JSON.stringify(result)).not.toContain('Restricted Name')
    expect(JSON.stringify(result)).not.toMatch(/email@|phone|taxId|displayName/i)
    expect(adapter.listCases).toHaveBeenCalledWith(expect.objectContaining({ businessId: SMARTGIFT_REVIEW_SCOPE.businessId }))
  })

  it('does not infer review authority from Product Owner, platform or visibility', async () => {
    const adapter = store()
    const productOwner = makeViewer({
      role: 'MEMBER',
      visibleBusinessIds: [SMARTGIFT_REVIEW_SCOPE.businessId],
      ownedBusinessIds: [],
      rolesByBusinessId: { [SMARTGIFT_REVIEW_SCOPE.businessId]: [ROLE_PRODUCT_OWNER] },
    })
    await expect(listCustomerImportReviewQueue({ businessId: SMARTGIFT_REVIEW_SCOPE.businessId, viewer: productOwner, store: adapter }))
      .rejects.toMatchObject({ status: 403 })
    await expect(listCustomerImportReviewQueue({ businessId: SMARTGIFT_REVIEW_SCOPE.businessId, viewer: makeDevViewer({ visibleBusinessIds: [SMARTGIFT_REVIEW_SCOPE.businessId] }), store: adapter }))
      .rejects.toMatchObject({ status: 403 })
    expect(adapter.listCases).not.toHaveBeenCalled()
  })

  it('requires the explicit Business reviewer role for target lookup', async () => {
    const adapter = store()
    const result = await listCustomerImportReviewTargets({
      businessId: SMARTGIFT_REVIEW_SCOPE.businessId,
      query: 'restricted',
      viewer: reviewer(),
      store: adapter,
    })
    expect(result.customers).toEqual([{ id: '44444444-4444-4444-8444-444444444444', displayNameMasked: 'R•••••• N•••' }])
    expect(JSON.stringify(result)).not.toContain('Restricted Name')
    expect(adapter.listTargetCustomers).toHaveBeenCalledWith(expect.objectContaining({ query: 'restricted' }))
  })

  it('appends an explicit per-item decision without publishing a Customer', async () => {
    const adapter = store()
    const result = await appendCustomerImportReviewDecisions({
      businessId: SMARTGIFT_REVIEW_SCOPE.businessId,
      caseId: caseRow().id,
      expectedVersion: 1,
      decisions: [{ provenanceId: caseRow().items[0].id, action: 'CREATE_SEPARATE' }],
      viewer: reviewer(),
      store: adapter,
    })
    expect(result.decisionRecorded).toBe(true)
    expect(result).not.toHaveProperty('applied')
    expect(result.applyRequired).toBe(true)
    expect(result.publishesCustomers).toBe(false)
    expect(result.lineReplay).toBe(false)
    expect(adapter.appendDecisions).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
      expectedVersion: 1,
    }))
  })

  it('rejects free-text notes so the decision ledger cannot become a PII side channel', async () => {
    const adapter = store()
    await expect(appendCustomerImportReviewDecisions({
      businessId: SMARTGIFT_REVIEW_SCOPE.businessId,
      caseId: caseRow().id,
      expectedVersion: 1,
      decisions: [{ provenanceId: caseRow().items[0].id, action: 'REJECT', note: 'person@example.com' }],
      viewer: reviewer(),
      store: adapter,
    })).rejects.toThrow(/free-text/i)
    expect(adapter.appendDecisions).not.toHaveBeenCalled()
  })

  it('refuses any other Business even when the viewer has a reviewer permission there', async () => {
    const adapter = store()
    await expect(listCustomerImportReviewQueue({
      businessId: '99999999-9999-4999-8999-999999999999',
      viewer: reviewer(),
      store: adapter,
    })).rejects.toMatchObject({ status: 404 })
    expect(adapter.listCases).not.toHaveBeenCalled()
  })
})
