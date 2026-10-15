import { describe, expect, it, vi } from 'vitest'
import {
  BUSINESS_AGENT_DELEGATION_POLICY,
  BUSINESS_AGENT_ROLE_IDS,
  BUSINESS_AGENT_SCHEMA_VERSION,
  BUSINESS_AGENT_TEMPLATE_ID,
  BUSINESS_AGENT_TEMPLATE_VERSION,
  buildBusinessAgentTemplate,
  businessAgentSnapshotDigest,
  canonicalJson,
  validateStoredBusinessAgentConfig,
} from '@/modules/agent/business-agent-template'
import {
  readBusinessAgentConfig,
  createDynamicSubagent,
  refuseUnsupportedBusinessAgentOperation,
} from '@/modules/agent/business-agent-factory'
import { ROLE_SPECIFICATIONS } from '@/modules/agent/role-registry'

describe('FR-285 standard Business agent template', () => {
  it('captures exactly the five current registry roles, tools and policies in one Business scope', () => {
    const snapshot = buildBusinessAgentTemplate({ tenantId: 'tenant-a', businessId: 'business-a' })

    expect(snapshot.schemaVersion).toBe(BUSINESS_AGENT_SCHEMA_VERSION)
    expect(snapshot.templateId).toBe(BUSINESS_AGENT_TEMPLATE_ID)
    expect(snapshot.templateVersion).toBe(BUSINESS_AGENT_TEMPLATE_VERSION)
    expect(snapshot.delegationPolicy).toBe(BUSINESS_AGENT_DELEGATION_POLICY)
    expect(snapshot.scope).toEqual({ tenantId: 'tenant-a', businessId: 'business-a' })
    expect(snapshot.roles.map((role) => role.roleId)).toEqual(BUSINESS_AGENT_ROLE_IDS)
    for (const role of snapshot.roles) {
      expect(role.allowedTools).toEqual([...ROLE_SPECIFICATIONS[role.roleId].allowedTools])
      expect(role.policy).toEqual({ ...ROLE_SPECIFICATIONS[role.roleId].policy })
    }
    expect(new Set(snapshot.roles.map((role) => role.roleId)).size).toBe(5)
  })

  it('uses stable content digests and rejects a checksum-consistent widened snapshot', () => {
    const snapshot = buildBusinessAgentTemplate({ tenantId: 'tenant-a', businessId: 'business-a' })
    expect(businessAgentSnapshotDigest(snapshot)).toBe(
      businessAgentSnapshotDigest(JSON.parse(canonicalJson(snapshot))),
    )

    const widened = structuredClone(snapshot)
    widened.roles[0].allowedTools.push('unregistered_tool')
    const row = {
      tenantId: 'tenant-a',
      businessId: 'business-a',
      schemaVersion: widened.schemaVersion,
      templateId: widened.templateId,
      templateVersion: widened.templateVersion,
      version: widened.configVersion,
      delegationPolicy: widened.delegationPolicy,
      snapshotJson: canonicalJson(widened),
      snapshotDigest: businessAgentSnapshotDigest(widened),
      appliedByPersonId: 'owner-a',
      appliedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    expect(() => validateStoredBusinessAgentConfig(row, { tenantId: 'tenant-a', businessId: 'business-a' }))
      .toThrow('BUSINESS_AGENT_CONFIG_CORRUPT')
  })

  it('returns NOT_CONFIGURED without synthesizing registry defaults', async () => {
    const db = {
      business: { findFirst: vi.fn().mockResolvedValue({ id: 'business-a', tenantId: 'tenant-a' }) },
      businessAgentConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    }

    await expect(readBusinessAgentConfig({ tenantId: 'tenant-a', businessId: 'business-a' }, { db }))
      .resolves.toEqual({ status: 'NOT_CONFIGURED', config: null })
    expect(db.businessAgentConfig.findUnique).toHaveBeenCalledWith({ where: { businessId: 'business-a' } })
  })

  it('denies dynamic child creation unconditionally', () => {
    expect(() => createDynamicSubagent()).toThrow('DYNAMIC_DELEGATION_DENIED')
  })

  it.each(['CUSTOMIZE', 'UPGRADE', 'ROLLBACK', 'BACKFILL', 'DELEGATE', 'PROVIDER_PROVISIONING'])(
    'refuses unsupported %s before any effect',
    (operation) => {
      expect(() => refuseUnsupportedBusinessAgentOperation(operation)).toThrow(
        `AGENT_FACTORY_${operation}_UNSUPPORTED`,
      )
    },
  )
})
