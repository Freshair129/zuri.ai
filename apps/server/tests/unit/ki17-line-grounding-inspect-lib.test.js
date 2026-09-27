import { describe, expect, it } from 'vitest'
import {
  SMARTGIFT_BUSINESS_CODE,
  KNOWLEDGE_GROUNDING_AUDIT_ACTION,
  isSmartGiftAccountRow,
  summarizeAudienceKindCounts,
  shapeGroundingAuditRow,
  groupGroundingAuditHistoryByAccount,
  buildGroundingInspectionReport,
} from '../../scripts/ki17-line-grounding-inspect-lib.mjs'

// @req FR-235 — the TASK-ZAI-095 read-only inspection report must correctly
//   classify SmartGift accounts, summarize the DIRECT-traffic heuristic, and
//   surface prior CONFIGURE_KNOWLEDGE_GROUNDING switches/rollbacks — this is
//   the shaping logic `ki17-line-grounding-inspect.mjs` calls after querying
//   Postgres; it is exercised here with fixtures, no live database.
// @spec ADR-090 D5
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js

describe('isSmartGiftAccountRow', () => {
  it('matches on businessCode', () => {
    expect(isSmartGiftAccountRow({ businessCode: SMARTGIFT_BUSINESS_CODE })).toBe(true)
  })

  it('matches on businessId when the code is missing', () => {
    expect(isSmartGiftAccountRow({ businessId: '834fa869-62f3-431c-a287-e9a95e91175b' })).toBe(true)
  })

  it('matches on a case-insensitive business name as a last resort', () => {
    expect(isSmartGiftAccountRow({ businessName: '  SmartGift  ' })).toBe(true)
  })

  it('does not match an unrelated Business', () => {
    expect(isSmartGiftAccountRow({ businessCode: 'BUS-ETOH-MUKU', businessName: 'Etoh Muku' })).toBe(false)
  })

  it('never throws on a missing or malformed row', () => {
    expect(isSmartGiftAccountRow(null)).toBe(false)
    expect(isSmartGiftAccountRow(undefined)).toBe(false)
    expect(isSmartGiftAccountRow({})).toBe(false)
  })
})

describe('summarizeAudienceKindCounts', () => {
  it('rolls counts up per account and computes directShare', () => {
    const rows = [
      { accountId: 'acc-1', audienceKind: 'DIRECT', count: 90 },
      { accountId: 'acc-1', audienceKind: 'GROUP', count: 10 },
      { accountId: 'acc-2', audienceKind: 'ROOM', count: 5 },
    ]
    const result = summarizeAudienceKindCounts(rows)
    expect(result['acc-1'].counts).toEqual({ DIRECT: 90, GROUP: 10 })
    expect(result['acc-1'].totalJobs).toBe(100)
    expect(result['acc-1'].directShare).toBeCloseTo(0.9)
    expect(result['acc-2'].directShare).toBe(0)
  })

  it('reports null directShare (not zero) for an account with no rows at all', () => {
    const result = summarizeAudienceKindCounts([])
    expect(result).toEqual({})
  })

  it('ignores rows with no accountId and tolerates string counts', () => {
    const rows = [{ accountId: null, audienceKind: 'DIRECT', count: 1 }, { accountId: 'acc-3', audienceKind: 'DIRECT', count: '4' }]
    const result = summarizeAudienceKindCounts(rows)
    expect(Object.keys(result)).toEqual(['acc-3'])
    expect(result['acc-3'].totalJobs).toBe(4)
  })
})

describe('shapeGroundingAuditRow', () => {
  it('reads from/to out of the service-written before/after payload', () => {
    const row = {
      occurredAt: '2026-09-27T10:00:00.000Z',
      actorId: 'user-1',
      actorType: 'LOCAL_USER',
      reason: 'Owner instruction TASK-ZAI-095',
      beforeJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }),
      afterJson: JSON.stringify({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }),
    }
    expect(shapeGroundingAuditRow(row)).toEqual({
      occurredAt: '2026-09-27T10:00:00.000Z',
      actorId: 'user-1',
      actorType: 'LOCAL_USER',
      reason: 'Owner instruction TASK-ZAI-095',
      from: 'BUSINESS_KNOWLEDGE',
      to: 'GKS_THEN_BUSINESS_KNOWLEDGE',
    })
  })

  it('reads malformed JSON as null instead of throwing', () => {
    const row = { beforeJson: '{not json', afterJson: undefined }
    expect(shapeGroundingAuditRow(row)).toMatchObject({ from: null, to: null })
  })
})

describe('groupGroundingAuditHistoryByAccount', () => {
  it('groups by entityId and sorts newest first regardless of input order', () => {
    const rows = [
      { entityId: 'acc-1', occurredAt: '2026-09-14T00:00:00.000Z', afterJson: JSON.stringify({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }) },
      { entityId: 'acc-1', occurredAt: '2026-09-27T00:00:00.000Z', afterJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }) },
    ]
    const grouped = groupGroundingAuditHistoryByAccount(rows)
    expect(grouped['acc-1'].map((r) => r.to)).toEqual(['BUSINESS_KNOWLEDGE', 'GKS_THEN_BUSINESS_KNOWLEDGE'])
  })

  it('shows a rollback as a second row back to BUSINESS_KNOWLEDGE', () => {
    const rows = [
      { entityId: 'acc-1', occurredAt: '2026-09-20T00:00:00.000Z', beforeJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }), afterJson: JSON.stringify({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }) },
      { entityId: 'acc-1', occurredAt: '2026-09-21T00:00:00.000Z', beforeJson: JSON.stringify({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }), afterJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }) },
    ]
    const grouped = groupGroundingAuditHistoryByAccount(rows)
    expect(grouped['acc-1'][0]).toMatchObject({ from: 'GKS_THEN_BUSINESS_KNOWLEDGE', to: 'BUSINESS_KNOWLEDGE' })
  })
})

describe('buildGroundingInspectionReport', () => {
  it('assembles one row per account with grounding, SmartGift classification, audience heuristic and audit history', () => {
    const accountRows = [
      {
        id: 'acc-1', code: 'smartgift-main', displayName: 'SmartGift Main', status: 'ACTIVE',
        businessId: '834fa869-62f3-431c-a287-e9a95e91175b', businessCode: SMARTGIFT_BUSINESS_CODE, businessName: 'SmartGift',
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', executionMode: 'SERVER', serverEnabled: true,
        isDefaultForBusiness: true, version: 3, updatedAt: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'acc-2', code: 'etoh-main', displayName: 'Etoh Main', status: 'ACTIVE',
        businessId: 'dc84f828-df37-4417-84e0-63b863bedb34', businessCode: 'BUS-ETOH-MUKU', businessName: 'Etoh Muku',
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', executionMode: 'SERVER', serverEnabled: false,
        isDefaultForBusiness: true, version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    const jobAudienceRows = [{ accountId: 'acc-1', audienceKind: 'DIRECT', count: 42 }]
    const auditRows = [{
      entityId: 'acc-1', occurredAt: '2026-09-14T00:00:00.000Z', actorId: 'owner-1', actorType: 'LOCAL_USER',
      reason: 'FR-235 rollout', beforeJson: JSON.stringify({ knowledgeGrounding: 'GKS_CORPUS' }), afterJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }),
    }]

    const report = buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, generatedAt: '2026-09-27T12:00:00.000Z' })

    expect(report.mode).toBe('READ_ONLY')
    expect(report.smartGiftBusinessCode).toBe(SMARTGIFT_BUSINESS_CODE)
    expect(report.knowledgeGroundingAuditAction).toBe(KNOWLEDGE_GROUNDING_AUDIT_ACTION)
    expect(report.accounts).toHaveLength(2)

    const smartgift = report.accounts.find((a) => a.id === 'acc-1')
    expect(smartgift.isSmartGiftBusiness).toBe(true)
    expect(smartgift.recentAudienceKindCounts).toEqual({ DIRECT: 42 })
    expect(smartgift.recentDirectJobShare).toBe(1)
    expect(smartgift.knowledgeGroundingAuditHistory).toHaveLength(1)

    const other = report.accounts.find((a) => a.id === 'acc-2')
    expect(other.isSmartGiftBusiness).toBe(false)
    expect(other.recentDirectJobShare).toBeNull()
    expect(other.knowledgeGroundingAuditHistory).toEqual([])
  })

  it('never claims a production switch happened — an empty audit history means no switch on record', () => {
    const report = buildGroundingInspectionReport({
      accountRows: [{ id: 'acc-9', code: 'x', businessId: 'b1', knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }],
      jobAudienceRows: [],
      auditRows: [],
    })
    expect(report.accounts[0].knowledgeGroundingAuditHistory).toEqual([])
  })
})
