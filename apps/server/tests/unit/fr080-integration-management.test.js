import { describe, expect, it, vi } from 'vitest'

import {
  createPhase1Integration,
  listPhase1Integrations,
} from '@/modules/integration/application/integration-management-service'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-080 — Platform Integrations manages only Business-scoped metadata;
// secret material is never accepted, returned or audited.
// @spec ADR-032 D1-D4, SEC-016, SDD-044
// @tested tests/unit/fr080-integration-management.test.js

const ref = 'supabase-vault:123e4567-e89b-12d3-a456-426614174000'
const owner = async () => makeViewer({
  principal: { id: 'owner-a', code: 'PER-OWNER-A', displayName: 'Owner A' },
  visibleBusinessIds: ['business-a'],
  ownedBusinessIds: ['business-a'],
})

describe('FR-080 Integration metadata management', () => {
  it('returns masked credential metadata only inside the owned Business scope', async () => {
    const db = {
      integrationConnection: {
        findMany: vi.fn(async () => [{
          id: 'connection-a', tenantId: 'tenant-a', businessId: 'business-a',
          name: 'Primary LLM', purpose: 'PHASE1_LINE_LLM', role: 'SECONDARY', status: 'DRAFT',
          metadataJson: JSON.stringify({ model: 'gpt-test' }), version: 2,
          provider: { code: 'openai', name: 'OpenAI' },
          credential: { secretRef: ref, status: 'ACTIVE', version: 3, expiresAt: null },
        }]),
      },
    }

    const rows = await listPhase1Integrations({ db, resolve: owner, businessId: 'business-a' })

    expect(rows).toMatchObject([{ id: 'connection-a', provider: 'openai', model: 'gpt-test', secretConfigured: true }])
    expect(rows[0]).not.toHaveProperty('secretRef')
    expect(rows[0].secretRefMasked).not.toBe(ref)
    expect(JSON.stringify(rows)).not.toContain(ref)
    expect(db.integrationConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: { in: ['business-a'] } }),
    }))
  })

  it('refuses a visible-but-not-owned Business before reading connection rows', async () => {
    const db = { integrationConnection: { findMany: vi.fn() } }
    await expect(listPhase1Integrations({
      db,
      resolve: async () => ownsElsewhere({ owns: 'business-a', sees: 'business-b' }),
      businessId: 'business-b',
    })).rejects.toMatchObject({ status: 404 })
    expect(db.integrationConnection.findMany).not.toHaveBeenCalled()
  })

  it('creates a draft connection and audits only redacted metadata', async () => {
    const tx = {
      business: { findUnique: vi.fn(async () => ({ id: 'business-a', tenantId: 'tenant-a' })) },
      integrationProvider: { upsert: vi.fn(async () => ({ id: 'provider-a', code: 'openai', name: 'OpenAI' })) },
      integrationConnection: { create: vi.fn(async () => ({
        id: 'connection-a', tenantId: 'tenant-a', businessId: 'business-a', providerId: 'provider-a',
        name: 'Primary LLM', purpose: 'PHASE1_LINE_LLM', role: 'SECONDARY', status: 'DRAFT',
        metadataJson: JSON.stringify({ model: 'gpt-test' }), version: 1,
        provider: { code: 'openai', name: 'OpenAI' }, credential: null,
      })) },
      integrationCredential: { create: vi.fn(async () => ({ connectionId: 'connection-a', secretRef: ref, version: 1 })) },
      auditEvent: { create: vi.fn(async () => ({})) },
    }
    const db = { $transaction: vi.fn(async (work) => work(tx)) }

    const created = await createPhase1Integration({
      businessId: 'business-a', provider: 'openai', name: 'Primary LLM', model: 'gpt-test', secretRef: ref,
    }, { db, resolve: owner })

    expect(created).toMatchObject({ id: 'connection-a', provider: 'openai', model: 'gpt-test', secretConfigured: true })
    expect(JSON.stringify(created)).not.toContain(ref)
    expect(tx.integrationCredential.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ secretRef: ref }) }))
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payloadJson: expect.not.stringContaining(ref) }),
    }))
    // The audit trail for one model (IntegrationConnection) must use one
    // entityType spelling everywhere it is written — line-registry-service.js
    // already writes the PascalCase model name for the same model; this
    // service used to write the SCREAMING_SNAKE_CASE 'INTEGRATION_CONNECTION'
    // instead, splitting the trail in two.
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'INTEGRATION_CONNECTION' }),
    }))
  })

  it('rejects raw provider credentials and local Ollama from the production management surface', async () => {
    const resolve = owner
    await expect(createPhase1Integration({
      businessId: 'business-a', provider: 'openai', name: 'Bad', model: 'gpt-test', secretRef: 'sk-live-raw',
    }, { db: {}, resolve })).rejects.toThrow(/Vault|secret.*ref/i)
    await expect(createPhase1Integration({
      businessId: 'business-a', provider: 'ollama', name: 'Local', model: 'llama3.2', secretRef: ref,
    }, { db: {}, resolve })).rejects.toThrow(/provider|Ollama/i)
  })
})
