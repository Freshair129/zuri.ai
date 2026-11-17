import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_GROUNDING_AUDIT_ACTION,
  KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION,
  summarizeAudienceKindCounts,
  shapeGroundingAuditRow,
  groupLatestGroundingAuditByAccount,
  buildGroundingInspectionReport,
  GroundingInspectionReportSchema,
  resolveGroundingInspectionTarget,
} from '../../scripts/ki17-line-grounding-inspect-lib.mjs'

// @req FR-235 — the generic read-only inspection report must correctly
//   include runtime/shadow/version and audience evidence, preserve Business identity,
//   report latest mode/shadow audit events and incomplete query sets,
//   and validate the Zod output
//   contract — all shaping is exercised with fixtures, no live database.
// @spec ADR-090 D5
// @tested tests/unit/ki17-line-grounding-inspect-lib.test.js

describe('explicit PostgreSQL target configuration', () => {
  it('rejects pooler hostnames with DNS case and trailing-dot variations', () => {
    expect(() => resolveGroundingInspectionTarget('postgresql://reader:fixture@AWS-0-US-EAST-1.POOLER.SUPABASE.COM.:6543/postgres')).toThrow(/pooler/i)
  })

  it('supports direct self-hosted PostgreSQL on an operator-selected port with a custom CA', () => {
    const { clientConfig, connectionTarget } = resolveGroundingInspectionTarget('postgresql://reader:p%40ss@database.internal:6543/own-db?sslmode=require', { ca: 'fixture-ca' })
    expect(clientConfig).toMatchObject({ host: 'database.internal', port: 6543, user: 'reader', password: 'p@ss', database: 'own-db',
      ssl: { rejectUnauthorized: true, servername: 'database.internal', ca: 'fixture-ca' } })
    expect(connectionTarget).not.toHaveProperty('password')
    expect(connectionTarget).not.toHaveProperty('ca')
  })

  it('allows explicit loopback plaintext fixtures and refuses remote or ambiguous TLS downgrades', () => {
    expect(resolveGroundingInspectionTarget('postgresql://reader:fixture@[::1]/inspection?sslmode=disable').clientConfig.ssl).toBe(false)
    for (const suffix of ['sslmode=disable', 'sslmode=prefer', 'sslmode=no-verify', 'sslmode=require&sslmode=disable', 'sslmode=require&sslrootcert=untrusted']) {
      expect(() => resolveGroundingInspectionTarget(`postgresql://reader:fixture@database.internal/inspection?${suffix}`)).toThrow(/TLS|sslmode/i)
    }
  })

  it('requires explicit host, user, database and protocol without echoing credentials on error', () => {
    for (const url of ['not-a-url', 'https://reader:TOP_SECRET@database.internal/inspection', 'postgresql://database.internal/inspection', 'postgresql://reader:TOP_SECRET@database.internal']) {
      let error
      try { resolveGroundingInspectionTarget(url) } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(Error)
      expect(error.message).not.toContain('TOP_SECRET')
    }
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
  it('reads mode from/to from the persisted service payloadJson shape', () => {
    const row = {
      action: KNOWLEDGE_GROUNDING_AUDIT_ACTION,
      occurredAt: '2026-09-27T10:00:00.000Z',
      actorId: 'user-1',
      actorType: 'LOCAL_USER',
      reason: 'Owner instruction TASK-ZAI-095',
      payloadJson: JSON.stringify({
        from: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' },
        to: { knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' },
        version: 4,
      }),
    }
    expect(shapeGroundingAuditRow(row)).toEqual({
      action: KNOWLEDGE_GROUNDING_AUDIT_ACTION,
      occurredAt: '2026-09-27T10:00:00.000Z',
      actorId: 'user-1',
      actorType: 'LOCAL_USER',
      reason: 'Owner instruction TASK-ZAI-095',
      from: 'BUSINESS_KNOWLEDGE',
      to: 'GKS_THEN_BUSINESS_KNOWLEDGE',
    })
  })

  it('reads malformed JSON as null instead of throwing', () => {
    const row = { action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, beforeJson: '{not json', afterJson: undefined }
    expect(shapeGroundingAuditRow(row)).toMatchObject({ from: null, to: null })
  })

  it('reads boolean shadow state from the shadow action audit payload', () => {
    const row = {
      action: KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION,
      payloadJson: JSON.stringify({
        from: { knowledgeGroundingShadow: true },
        to: { knowledgeGroundingShadow: false },
        version: 5,
      }),
    }
    expect(shapeGroundingAuditRow(row)).toMatchObject({ action: KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION, from: true, to: false })
  })

  it('keeps historical before/after snapshots as a fallback', () => {
    const row = {
      action: KNOWLEDGE_GROUNDING_AUDIT_ACTION,
      beforeJson: JSON.stringify({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }),
      afterJson: JSON.stringify({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }),
    }
    expect(shapeGroundingAuditRow(row)).toMatchObject({ from: 'BUSINESS_KNOWLEDGE', to: 'GKS_THEN_BUSINESS_KNOWLEDGE' })
  })
})

describe('groupLatestGroundingAuditByAccount', () => {
  it('orders actual pg Date objects by time rather than weekday text', () => {
    const rows = [
      { entityId: 'acc-date', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: new Date('2026-11-11T00:00:00Z'), payloadJson: { to: { knowledgeGrounding: 'GKS_CORPUS' } } },
      { entityId: 'acc-date', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: new Date('2026-11-16T00:00:00Z'), payloadJson: { to: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } } },
    ]
    expect(groupLatestGroundingAuditByAccount(rows)['acc-date'][0].to).toBe('BUSINESS_KNOWLEDGE')
  })

  it('groups by entity and action, keeping the newest matching event regardless of input order', () => {
    const rows = [
      { entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: '2026-09-14T00:00:00.000Z', payloadJson: JSON.stringify({ to: { knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' } }) },
      { entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: '2026-09-27T00:00:00.000Z', payloadJson: JSON.stringify({ to: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } }) },
      { entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION, occurredAt: '2026-09-26T00:00:00.000Z', payloadJson: JSON.stringify({ to: { knowledgeGroundingShadow: false } }) },
    ]
    const grouped = groupLatestGroundingAuditByAccount(rows)
    expect(grouped['acc-1']).toEqual([
      expect.objectContaining({ action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, to: 'BUSINESS_KNOWLEDGE' }),
      expect.objectContaining({ action: KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION, to: false }),
    ])
  })

  it('shows the latest rollback mode back to BUSINESS_KNOWLEDGE', () => {
    const rows = [
      { entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: '2026-09-20T00:00:00.000Z', payloadJson: JSON.stringify({ from: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }, to: { knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' } }) },
      { entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: '2026-09-21T00:00:00.000Z', payloadJson: JSON.stringify({ from: { knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }, to: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' } }) },
    ]
    const grouped = groupLatestGroundingAuditByAccount(rows)
    expect(grouped['acc-1'][0]).toMatchObject({ from: 'GKS_THEN_BUSINESS_KNOWLEDGE', to: 'BUSINESS_KNOWLEDGE' })
  })
})

describe('buildGroundingInspectionReport', () => {
  it('preserves each Business identity without selecting a customer or production target', () => {
    const accountRows = [
      {
        id: 'acc-1', code: 'fixture-a-main', displayName: 'Fixture A', status: 'ACTIVE',
        businessId: 'business-a', businessCode: 'BUS-FIXTURE-A', businessName: 'Fixture A',
        transportMode: 'CLOUD',
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', runtimeOwner: 'SERVER', executionMode: 'SERVER', serverEnabled: true,
        knowledgeGroundingShadow: false,
        isDefaultForBusiness: true, version: 3, updatedAt: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'acc-2', code: 'fixture-b-main', displayName: 'Fixture B', status: 'ACTIVE',
        businessId: 'business-b', businessCode: 'BUS-FIXTURE-B', businessName: 'Fixture B',
        transportMode: 'CLOUD',
        knowledgeGrounding: 'BUSINESS_KNOWLEDGE', runtimeOwner: 'CONVERSATION_RUNTIME', executionMode: 'SERVER', serverEnabled: false,
        knowledgeGroundingShadow: true,
        isDefaultForBusiness: true, version: 1, updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    const jobAudienceRows = [{ accountId: 'acc-1', audienceKind: 'DIRECT', count: 42 }]
    const auditRows = [{
      entityId: 'acc-1', action: KNOWLEDGE_GROUNDING_AUDIT_ACTION, occurredAt: '2026-09-14T00:00:00.000Z', actorId: 'owner-1', actorType: 'LOCAL_USER',
      reason: 'FR-235 rollout', payloadJson: JSON.stringify({ from: { knowledgeGrounding: 'GKS_CORPUS' }, to: { knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }, version: 4 }),
    }]

    const report = buildGroundingInspectionReport({ accountRows, jobAudienceRows, auditRows, generatedAt: '2026-09-27T12:00:00.000Z' })

    expect(report.mode).toBe('READ_ONLY')
    expect(report.inspectionStatus).toBe('COMPLETE')
    expect(report).not.toHaveProperty('smartGiftBusinessCode')
    expect(report).not.toHaveProperty('selectedAccountId')
    expect(report.knowledgeGroundingAuditActions).toEqual([KNOWLEDGE_GROUNDING_AUDIT_ACTION, KNOWLEDGE_GROUNDING_SHADOW_AUDIT_ACTION])
    expect(report.accounts).toHaveLength(2)

    const first = report.accounts.find((a) => a.id === 'acc-1')
    expect(first).not.toHaveProperty('isSmartGiftBusiness')
    expect(first.businessId).toBe('business-a')
    expect(first.businessCode).toBe('BUS-FIXTURE-A')
    expect(first.transportMode).toBe('CLOUD')
    expect(first.runtimeOwner).toBe('SERVER')
    expect(first.knowledgeGroundingShadow).toBe(false)
    expect(first.version).toBe(3)
    expect(first.recentAudienceKindCounts).toEqual({ DIRECT: 42 })
    expect(first.recentDirectJobShare).toBe(1)
    expect(first.knowledgeGroundingAuditLatestByAction).toHaveLength(1)

    const other = report.accounts.find((a) => a.id === 'acc-2')
    expect(other).not.toHaveProperty('isSmartGiftBusiness')
    expect(other.businessId).toBe('business-b')
    expect(other.runtimeOwner).toBe('CONVERSATION_RUNTIME')
    expect(other.knowledgeGroundingShadow).toBe(true)
    expect(other.recentDirectJobShare).toBeNull()
    expect(other.knowledgeGroundingAuditLatestByAction).toEqual([])
  })

  it('marks an inspection incomplete when any required query fails; partial output is never ready', () => {
    const report = buildGroundingInspectionReport({
      accountRows: [],
      jobAudienceRows: [],
      auditRows: [],
      queryFailures: { knowledge_grounding_audit_latest_by_action: '42P01' },
    })

    expect(report.inspectionStatus).toBe('INCOMPLETE')
    expect(report.queryFailures).toEqual({ knowledge_grounding_audit_latest_by_action: '42P01' })
    expect(report).not.toHaveProperty('ready')
  })

  it('validates the inspection JSON contract and rejects incomplete or malformed payloads', () => {
    const report = buildGroundingInspectionReport({
      accountRows: [{ id: 'acc-10', runtimeOwner: 'SERVER', knowledgeGroundingShadow: false, version: 7 }],
      jobAudienceRows: [],
      auditRows: [],
    })

    expect(GroundingInspectionReportSchema.safeParse(report).success).toBe(true)
    expect(GroundingInspectionReportSchema.safeParse({ ...report, inspectionStatus: 'READY' }).success).toBe(false)
  })

  it('never claims a production switch happened — an empty audit history means no switch on record', () => {
    const report = buildGroundingInspectionReport({
      accountRows: [{ id: 'acc-9', code: 'x', businessId: 'b1', knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }],
      jobAudienceRows: [],
      auditRows: [],
    })
    expect(report.accounts[0].knowledgeGroundingAuditLatestByAction).toEqual([])
  })
})
