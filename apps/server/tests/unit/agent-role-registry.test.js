import { describe, expect, it } from 'vitest'
import {
  CORE_AGENT_ROLES,
  ROLE_SPECIFICATIONS,
  createAgentRoleRegistry,
  createRoleScopedToolRegistry,
} from '@/modules/agent'

// @req TASK-ZAI-007 — Agent Role registry with five core roles.
// @spec SPR-ZAI-03, GATE-ZAI-05 — Five core roles (Executive, Operations, Finance Analyst,
//   Research, Marketing) resolve distinct tool sets and policy; registration refuses
//   unauthorized tools at bind time, not at call time; cross-role leaks are prohibited.
// @tested tests/unit/agent-role-registry.test.js

describe('Agent Role Registry (TASK-ZAI-007)', () => {
  const registry = createAgentRoleRegistry()

  it('declares the five canonical core roles', () => {
    expect(CORE_AGENT_ROLES).toEqual({
      EXECUTIVE: 'EXECUTIVE',
      OPERATIONS: 'OPERATIONS',
      FINANCE_ANALYST: 'FINANCE_ANALYST',
      RESEARCH: 'RESEARCH',
      MARKETING: 'MARKETING',
    })
    expect(Object.isFrozen(CORE_AGENT_ROLES)).toBe(true)
  })

  it('resolves distinct tool sets and distinct policies for all five roles', () => {
    const roles = registry.listRoles()
    expect(roles).toHaveLength(5)

    const roleIds = new Set(roles.map((r) => r.roleId))
    expect(roleIds.size).toBe(5)

    // Check each role resolves distinct tool signatures
    const toolSignatures = roles.map((r) => r.allowedTools.slice().sort().join(','))
    const uniqueToolSignatures = new Set(toolSignatures)
    expect(uniqueToolSignatures.size).toBe(5)

    // Check each role resolves distinct policy namespaces
    const namespaces = new Set(roles.map((r) => r.policy.memoryNamespace))
    expect(namespaces.size).toBe(5)
    expect(namespaces).toEqual(new Set(['executive', 'operations', 'finance', 'research', 'marketing']))

    // Check policy approval tiers
    expect(roles.find((r) => r.roleId === CORE_AGENT_ROLES.EXECUTIVE)?.policy.approvalTier).toBe('L4')
    expect(roles.find((r) => r.roleId === CORE_AGENT_ROLES.OPERATIONS)?.policy.approvalTier).toBe('L2')
    expect(roles.find((r) => r.roleId === CORE_AGENT_ROLES.FINANCE_ANALYST)?.policy.approvalTier).toBe('L3')
    expect(roles.find((r) => r.roleId === CORE_AGENT_ROLES.RESEARCH)?.policy.approvalTier).toBe('L1')
    expect(roles.find((r) => r.roleId === CORE_AGENT_ROLES.MARKETING)?.policy.approvalTier).toBe('L2')
  })

  describe('Bind-Time Refusal (not call-time)', () => {
    it('refuses unauthorized tool registration at bind time with TOOL_NOT_PERMITTED_FOR_ROLE', () => {
      const opsRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.OPERATIONS)

      // Permitted tool binds cleanly
      expect(() =>
        opsRegistry.register({
          name: 'check_inventory_replenishment',
          description: 'Inventory check',
        }),
      ).not.toThrow()

      expect(opsRegistry.has('check_inventory_replenishment')).toBe(true)

      // Unauthorized tool fails IMMEDIATELY at bind/registration time
      expect(() =>
        opsRegistry.register({
          name: 'authorize_governed_action', // Executive only
          description: 'Executive approval',
        }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE.*authorize_governed_action.*OPERATIONS/)

      // Ensure the unauthorized tool was never bound into the registry
      expect(opsRegistry.has('authorize_governed_action')).toBe(false)
      expect(opsRegistry.get('authorize_governed_action')).toBeUndefined()
    })

    it('rejects invalid or anonymous tool descriptors', () => {
      const execRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.EXECUTIVE)

      expect(() => execRegistry.register(null)).toThrow(/requires a name/)
      expect(() => execRegistry.register({})).toThrow(/requires a name/)
      expect(() => execRegistry.register({ name: '' })).toThrow(/requires a name/)
    })
  })

  describe('Cross-Role Tool Leak Prohibition', () => {
    it('prohibits OPERATIONS from registering financial pricing or executive tools', () => {
      const opsRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.OPERATIONS)

      expect(() =>
        opsRegistry.register({ name: 'evaluate_pricing_rules', description: 'Pricing rule' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        opsRegistry.register({ name: 'calculate_quote_ladder', description: 'Quote ladder' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        opsRegistry.register({ name: 'authorize_governed_action', description: 'Executive action' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)
    })

    it('prohibits RESEARCH from registering state-modifying write tools', () => {
      const researchRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.RESEARCH)

      expect(() =>
        researchRegistry.register({ name: 'close_conversation', description: 'Close conversation' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        researchRegistry.register({ name: 'set_customer_lifecycle', description: 'Set lifecycle' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        researchRegistry.register({ name: 'authorize_governed_action', description: 'Authorize' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)
    })

    it('prohibits FINANCE_ANALYST from registering supply chain or campaign tools', () => {
      const finRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.FINANCE_ANALYST)

      expect(() =>
        finRegistry.register({ name: 'intake_catalog_batch', description: 'Catalog batch' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        finRegistry.register({ name: 'schedule_broadcast_batch', description: 'Broadcast batch' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)
    })

    it('prohibits MARKETING from registering executive governance or ledger audit tools', () => {
      const mktRegistry = createRoleScopedToolRegistry(CORE_AGENT_ROLES.MARKETING)

      expect(() =>
        mktRegistry.register({ name: 'audit_decision_log', description: 'Decision log' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)

      expect(() =>
        mktRegistry.register({ name: 'audit_billing_ledger', description: 'Billing ledger' }),
      ).toThrow(/TOOL_NOT_PERMITTED_FOR_ROLE/)
    })
  })

  describe('resolveRoleContext()', () => {
    it('constructs complete role-scoped context with auto-bound allowed tools', () => {
      const context = registry.resolveRoleContext({
        roleId: CORE_AGENT_ROLES.FINANCE_ANALYST,
        baseContext: {
          tenantId: '11111111-1111-4111-8111-111111111111',
          businessId: '22222222-2222-4222-8222-222222222222',
        },
      })

      expect(context.tenantId).toBe('11111111-1111-4111-8111-111111111111')
      expect(context.role.roleId).toBe('FINANCE_ANALYST')
      expect(context.role.label).toBe('Finance Analyst')
      expect(context.policy.approvalTier).toBe('L3')
      expect(context.policy.memoryNamespace).toBe('finance')

      const toolNames = context.tools.map((t) => t.name)
      expect(toolNames).toContain('evaluate_pricing_rules')
      expect(toolNames).toContain('calculate_quote_ladder')
      expect(toolNames).toContain('audit_billing_ledger')
      expect(toolNames).toContain('reconcile_invoice_totals')
      expect(toolNames).not.toContain('intake_catalog_batch')
      expect(toolNames).not.toContain('authorize_governed_action')
    })

    it('throws UNKNOWN_AGENT_ROLE for unregistered role ID', () => {
      expect(() => registry.getRole('NON_EXISTENT_ROLE')).toThrow(/UNKNOWN_AGENT_ROLE/)
      expect(() => registry.createScopedToolRegistry('HACKER_ROLE')).toThrow(/UNKNOWN_AGENT_ROLE/)
      expect(() =>
        registry.resolveRoleContext({
          roleId: 'SUPER_USER_ROLE',
        }),
      ).toThrow(/UNKNOWN_AGENT_ROLE/)
    })
  })
})
