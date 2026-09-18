import { describe, expect, it, vi } from 'vitest'
import {
  CORE_AGENT_ROLES,
  ROLE_MEMORY_AUDIT_ENTITY,
  ROLE_MEMORY_ACTIONS,
  buildRoleMemoryKey,
  buildSharedBusinessMemoryKey,
  createRoleScopedMemoryPort,
  createInMemoryMemory,
} from '@/modules/agent'

// @req TASK-ZAI-008 — Role-scoped memory partition and retrieval policy.
// @spec SPR-ZAI-03, GATE-ZAI-05, ADR-043 §D2 — Role-scoped memory partition and retrieval policy;
//   private role memory partitions are isolated; shared business partition accessible across roles;
//   cross-role private read returns empty and is audited.
// @tested tests/unit/role-memory-partition.test.js

describe('Role-Scoped Memory Partition & Retrieval Policy (TASK-ZAI-008)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const businessId = '22222222-2222-4222-8222-222222222222'

  describe('Key Builders', () => {
    it('builds canonical private role partition key', () => {
      const key = buildRoleMemoryKey({
        tenantId,
        businessId,
        roleId: CORE_AGENT_ROLES.EXECUTIVE,
        principalId: 'person-1',
      })
      expect(key).toBe(`tenant:${tenantId}/business:${businessId}/role:EXECUTIVE/private:person-1`)
    })

    it('builds canonical shared business partition key', () => {
      const key = buildSharedBusinessMemoryKey({
        tenantId,
        businessId,
        topic: 'strategy',
      })
      expect(key).toBe(`tenant:${tenantId}/business:${businessId}/shared:strategy`)
    })

    it('throws when required key parameters are missing', () => {
      expect(() => buildRoleMemoryKey({ tenantId: null, businessId, roleId: 'EXECUTIVE' })).toThrow(/tenantId is required/)
      expect(() => buildRoleMemoryKey({ tenantId, businessId: null, roleId: 'EXECUTIVE' })).toThrow(/businessId is required/)
      expect(() => buildRoleMemoryKey({ tenantId, businessId, roleId: null })).toThrow(/roleId is required/)

      expect(() => buildSharedBusinessMemoryKey({ tenantId: null, businessId })).toThrow(/tenantId is required/)
      expect(() => buildSharedBusinessMemoryKey({ tenantId, businessId: null })).toThrow(/businessId is required/)
    })
  })

  describe('Acceptance Criteria: Private Role Isolation', () => {
    it('ensures two roles in the same Business cannot see each other private partition', async () => {
      const baseMemory = createInMemoryMemory()

      const execPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.EXECUTIVE,
        tenantId,
        businessId,
        principalId: 'exec-1',
      })

      const opsPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.OPERATIONS,
        tenantId,
        businessId,
        principalId: 'ops-1',
      })

      // Executive remembers confidential governance note
      await execPort.rememberPrivate({ fact: 'Upcoming board restructuring Q4' })

      // Operations remembers inventory intake status
      await opsPort.rememberPrivate({ fact: 'Warehouse dock B congestion resolved' })

      // Each role recalls only its own private partition
      const execPrivate = await execPort.recallPrivate()
      expect(execPrivate.entries).toEqual([{ fact: 'Upcoming board restructuring Q4' }])

      const opsPrivate = await opsPort.recallPrivate()
      expect(opsPrivate.entries).toEqual([{ fact: 'Warehouse dock B congestion resolved' }])

      // Executive attempting to read Operations private memory sees NOTHING
      const execReadOps = await execPort.recallOtherRolePrivate(CORE_AGENT_ROLES.OPERATIONS)
      expect(execReadOps.entries).toEqual([])
      expect(execReadOps.denied).toBe(true)

      // Operations attempting to read Executive private memory sees NOTHING
      const opsReadExec = await opsPort.recallOtherRolePrivate(CORE_AGENT_ROLES.EXECUTIVE)
      expect(opsReadExec.entries).toEqual([])
      expect(opsReadExec.denied).toBe(true)
    })
  })

  describe('Success Criteria: Shared Business Partition', () => {
    it('returns the same governed content to both roles from shared business partition', async () => {
      const baseMemory = createInMemoryMemory()

      const financePort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.FINANCE_ANALYST,
        tenantId,
        businessId,
        principalId: 'fin-1',
      })

      const mktPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.MARKETING,
        tenantId,
        businessId,
        principalId: 'mkt-1',
      })

      // Marketing stores a shared campaign target
      await mktPort.rememberShared('growth_target', { target: 'Increase active subscribers by 20%' })

      // Finance stores approved budget into the same shared topic
      await financePort.rememberShared('growth_target', { approvedBudgetThb: 500000 })

      // Both roles recall the EXACT same shared business memory
      const financeShared = await financePort.recallShared('growth_target')
      const mktShared = await mktPort.recallShared('growth_target')

      expect(financeShared.entries).toEqual([
        { target: 'Increase active subscribers by 20%' },
        { approvedBudgetThb: 500000 },
      ])
      expect(mktShared.entries).toEqual(financeShared.entries)
    })
  })

  describe('Exit Criteria: Cross-Role Read Returns Empty and is Audited', () => {
    it('refuses cross-role private read, returns empty entries, and emits an audit event', async () => {
      const baseMemory = createInMemoryMemory()
      const auditLog = []
      const onAudit = vi.fn((event) => auditLog.push(event))

      const researchPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.RESEARCH,
        tenantId,
        businessId,
        principalId: 'researcher-1',
        onAudit,
      })

      const execPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.EXECUTIVE,
        tenantId,
        businessId,
        principalId: 'exec-1',
      })

      await execPort.rememberPrivate({ confidential: 'M&A Acquisition Target XYZ' })

      // Research attempts to read Executive private partition
      const result = await researchPort.recallOtherRolePrivate(CORE_AGENT_ROLES.EXECUTIVE)

      // 1. Result must be empty and denied
      expect(result.entries).toEqual([])
      expect(result.denied).toBe(true)
      expect(result.reason).toBe('CROSS_ROLE_PRIVATE_PARTITION_REFUSED')

      // 2. Audit event must be emitted
      expect(onAudit).toHaveBeenCalledTimes(1)
      const auditEvent = auditLog[0]
      expect(auditEvent.entityType).toBe(ROLE_MEMORY_AUDIT_ENTITY)
      expect(auditEvent.action).toBe(ROLE_MEMORY_ACTIONS.CROSS_PARTITION_DENIED)
      expect(auditEvent.actorId).toBe(CORE_AGENT_ROLES.RESEARCH)
      expect(auditEvent.payload.targetRole).toBe(CORE_AGENT_ROLES.EXECUTIVE)
      expect(auditEvent.tenantId).toBe(tenantId)
      expect(auditEvent.businessId).toBe(businessId)
    })

    it('persists audit to db client if provided', async () => {
      const baseMemory = createInMemoryMemory()
      const mockDb = {
        auditEvent: {
          create: vi.fn().mockResolvedValue({ id: 'audit-123' }),
        },
      }

      const opsPort = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.OPERATIONS,
        tenantId,
        businessId,
        db: mockDb,
      })

      await opsPort.recallOtherRolePrivate(CORE_AGENT_ROLES.FINANCE_ANALYST)

      expect(mockDb.auditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'AGENT_ROLE_MEMORY',
          action: 'ROLE_MEMORY_CROSS_PARTITION_DENIED',
          actorId: 'OPERATIONS',
        }),
      })
    })
  })

  describe('Multi-Tenant and Multi-Business Boundary Enforcement', () => {
    it('strictly isolates memory across different businesses and tenants', async () => {
      const baseMemory = createInMemoryMemory()
      const tenantA = 'tenant-aaa'
      const tenantB = 'tenant-bbb'
      const business1 = 'business-111'
      const business2 = 'business-222'

      const portA = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.OPERATIONS,
        tenantId: tenantA,
        businessId: business1,
      })

      const portB = createRoleScopedMemoryPort({
        baseMemoryPort: baseMemory,
        roleId: CORE_AGENT_ROLES.OPERATIONS,
        tenantId: tenantB,
        businessId: business2,
      })

      await portA.rememberShared('inventory', { stock: 100 })
      await portB.rememberShared('inventory', { stock: 500 })

      expect((await portA.recallShared('inventory')).entries).toEqual([{ stock: 100 }])
      expect((await portB.recallShared('inventory')).entries).toEqual([{ stock: 500 }])
    })

    it('rejects unknown agent roles', () => {
      const baseMemory = createInMemoryMemory()
      expect(() =>
        createRoleScopedMemoryPort({
          baseMemoryPort: baseMemory,
          roleId: 'MALICIOUS_ROLE',
          tenantId,
          businessId,
        }),
      ).toThrow(/UNKNOWN_AGENT_ROLE/)
    })
  })
})
