import { describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer } from '../../factories/viewer'
import { previewImport } from '@/modules/project-manager/application/backup-service'
import { criteriaHash, hashMarketingBroadcastPayload, serializeMarketingBroadcastPayload } from '@/modules/marketing/domain/marketing-broadcast-contract'

// @req FR-185 — snapshots retain a versioned parent/child recovery boundary
// and reject malformed references before an installation-wide delete.
// @spec BR-008, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-backup.test.js

function currentDb(counts = {}) {
  return new Proxy({}, { get: (_target, property) => ({ count: vi.fn(async () => counts[property] || 0) }) })
}

function baseSnapshot(over = {}) {
  return {
    schemaVersion: '1.0',
    exportedAt: '2026-09-11T00:00:00.000Z',
    genesisRag17Recovery: { schemaVersion: 'genesisrag17-recovery.v1', requiredTables: ['genesisRag17IngestionIntent', 'genesisRag17SourceMention'] },
    knowledgeAdmissionRecovery: { schemaVersion: 'knowledge-admission-recovery.v1', requiredTables: ['knowledgeCorpus', 'knowledgeSource', 'knowledgeIngestion', 'knowledgeCorpusGeneration'] },
    commerceBillingRecovery: { schemaVersion: 'commerce-billing-recovery.v1', requiredTables: ['businessBillingProfile', 'commerceDocumentSequence', 'commerceDocument'] },
    marketingBroadcastRecovery: { schemaVersion: 'marketing-broadcast-recovery.v1', requiredTables: ['marketingBroadcastIntent', 'marketingBroadcastIntentVersion'] },
    tables: {
      tenant: [], business: [], lineOaAccount: [], marketingContentBrief: [], marketingContentVersion: [],
      marketingBroadcastIntent: [], marketingBroadcastIntentVersion: [],
      genesisRag17IngestionIntent: [], genesisRag17SourceMention: [], knowledgeCorpus: [], knowledgeSource: [], knowledgeIngestion: [], knowledgeCorpusGeneration: [],
      businessBillingProfile: [], commerceDocumentSequence: [], commerceDocument: [],
    },
    fileContentManifest: [],
    ...over,
  }
}

describe('Marketing broadcast snapshot recovery', () => {
  it('blocks a legacy snapshot without its manifest when live planning rows exist', async () => {
    const snapshot = baseSnapshot()
    delete snapshot.marketingBroadcastRecovery
    const result = await previewImport(snapshot, { viewer: makeOperatorViewer(), db: currentDb({ marketingBroadcastIntent: 1 }) })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Marketing broadcast recovery is unavailable while the installation contains broadcast rows; refusing a restore that would erase planning evidence')
    expect(result.warnings).toContain('MARKETING_BROADCAST_RECOVERY_UNAVAILABLE: snapshot has no broadcast recovery manifest')
  })

  it('rejects malformed child payload evidence before deletion', async () => {
    const snapshot = baseSnapshot({
      tables: {
        ...baseSnapshot().tables,
        tenant: [{ id: 'tenant-1' }],
        business: [{ id: 'business-1', tenantId: 'tenant-1' }],
        marketingBroadcastIntent: [{ id: 'intent-1', tenantId: 'tenant-1', businessId: 'business-1', code: 'BRD-1', status: 'PLANNING', currentRevision: 1, version: 1, idempotencyKey: 'request-1', createdBy: 'owner' }],
        marketingBroadcastIntentVersion: [{ id: 'version-1', intentId: 'intent-1', revision: 1, payloadJson: '{}', payloadHash: 'a'.repeat(64), createdBy: 'owner' }],
      },
    })
    const result = await previewImport(snapshot, { viewer: makeOperatorViewer(), db: currentDb() })
    expect(result.valid).toBe(false)
    expect(result.marketingBroadcastRecovery.status).toBe('INVALID')
    expect(result.marketingBroadcastRecovery.errors.join(' ')).toMatch(/invalid payload or hash/i)
  })

  it('keeps historical planning evidence recoverable after account freshness changes', async () => {
    const payload = {
      channel: 'LINE',
      account: { lineOaAccountId: 'account-1', accountVersion: 1 },
      content: { briefId: 'brief-1', contentVersionId: 'content-1', payloadHash: 'b'.repeat(64) },
      audience: { source: 'CRM_CONVERSATION_READ_MODEL', sourceVersion: null, audienceSpecVersion: '1.0', filter: { consentStatus: 'GRANTED' }, criteriaHash: criteriaHash(), resolutionState: 'UNAVAILABLE', resolutionRef: null },
      consent: { source: 'CRM_CUSTOMER.consentStatus', requiredValue: 'GRANTED', policyReference: 'FR-103', policyVersion: null, snapshotRef: null, snapshotVersion: null, state: 'UNAVAILABLE' },
    }
    const payloadJson = serializeMarketingBroadcastPayload(payload)
    const snapshot = baseSnapshot({
      tables: {
        ...baseSnapshot().tables,
        tenant: [{ id: 'tenant-1' }],
        business: [{ id: 'business-1', tenantId: 'tenant-1' }],
        lineOaAccount: [{ id: 'account-1', businessId: 'business-1', tenantId: 'tenant-1', status: 'ARCHIVED', version: 2 }],
        marketingContentBrief: [{ id: 'brief-1', businessId: 'business-1' }],
        marketingContentVersion: [{ id: 'content-1', briefId: 'brief-1', payloadHash: 'b'.repeat(64) }],
        marketingBroadcastIntent: [{ id: 'intent-1', tenantId: 'tenant-1', businessId: 'business-1', code: 'BRD-1', status: 'PLANNING', currentRevision: 1, version: 1, idempotencyKey: 'request-1', createdBy: 'owner' }],
        marketingBroadcastIntentVersion: [{ id: 'version-1', intentId: 'intent-1', revision: 1, payloadJson, payloadHash: hashMarketingBroadcastPayload(payload), createdBy: 'owner' }],
      },
    })
    const result = await previewImport(snapshot, { viewer: makeOperatorViewer(), db: currentDb() })
    expect(result.valid).toBe(true)
    expect(result.marketingBroadcastRecovery).toMatchObject({ status: 'AVAILABLE', errors: [] })
  })
})
