// @req TASK-ZAI-007 — Agent Role registry with five core roles.
// @spec SPR-ZAI-03, GATE-ZAI-05 — Five core roles (Executive, Operations, Finance Analyst,
//   Research, Marketing) resolve distinct tool sets and policy; registration refuses
//   unauthorized tools at bind time, not at call time; cross-role leaks are prohibited.
// @tested tests/unit/agent-role-registry.test.js

/**
 * Five canonical core agent roles in the Zuri operating system.
 */
export const CORE_AGENT_ROLES = Object.freeze({
  EXECUTIVE: 'EXECUTIVE',
  OPERATIONS: 'OPERATIONS',
  FINANCE_ANALYST: 'FINANCE_ANALYST',
  RESEARCH: 'RESEARCH',
  MARKETING: 'MARKETING',
})

/**
 * Standard role specifications defining permitted tools and policy constraints.
 */
export const ROLE_SPECIFICATIONS = Object.freeze({
  [CORE_AGENT_ROLES.EXECUTIVE]: Object.freeze({
    roleId: CORE_AGENT_ROLES.EXECUTIVE,
    label: 'Executive',
    description: 'High-level strategic oversight, cross-business governance, and top-tier approval authority.',
    allowedTools: Object.freeze([
      'answer_from_knowledge',
      'portfolio_summary',
      'audit_decision_log',
      'review_approval_queue',
      'authorize_governed_action',
    ]),
    policy: Object.freeze({
      approvalTier: 'L4',
      scopeAccess: 'ENTERPRISE_WIDE',
      memoryNamespace: 'executive',
      canIssueDirectives: true,
      maxAutonomousActionSensitivity: 'HIGH',
    }),
  }),

  [CORE_AGENT_ROLES.OPERATIONS]: Object.freeze({
    roleId: CORE_AGENT_ROLES.OPERATIONS,
    label: 'Operations',
    description: 'Supply chain execution, inventory replenishment, order tracking, and operational intake.',
    allowedTools: Object.freeze([
      'answer_from_knowledge',
      'read_customer_profile',
      'search_conversations',
      'check_inventory_replenishment',
      'intake_catalog_batch',
      'track_order_fulfillment',
      'close_conversation',
    ]),
    policy: Object.freeze({
      approvalTier: 'L2',
      scopeAccess: 'OPERATIONAL_WORKSTREAMS',
      memoryNamespace: 'operations',
      canIssueDirectives: false,
      maxAutonomousActionSensitivity: 'LOW',
    }),
  }),

  [CORE_AGENT_ROLES.FINANCE_ANALYST]: Object.freeze({
    roleId: CORE_AGENT_ROLES.FINANCE_ANALYST,
    label: 'Finance Analyst',
    description: 'Financial analysis, pricing rule evaluation, quotations, and invoice/billing reconciliation.',
    allowedTools: Object.freeze([
      'answer_from_knowledge',
      'evaluate_pricing_rules',
      'calculate_quote_ladder',
      'audit_billing_ledger',
      'reconcile_invoice_totals',
    ]),
    policy: Object.freeze({
      approvalTier: 'L3',
      scopeAccess: 'COMMERCE_FINANCIAL',
      memoryNamespace: 'finance',
      canIssueDirectives: false,
      maxAutonomousActionSensitivity: 'LOW',
    }),
  }),

  [CORE_AGENT_ROLES.RESEARCH]: Object.freeze({
    roleId: CORE_AGENT_ROLES.RESEARCH,
    label: 'Research',
    description: 'Knowledge discovery, multi-corpus citations, ontology-v2 exploration, and document analysis.',
    allowedTools: Object.freeze([
      'answer_from_knowledge',
      'search_knowledge_graph',
      'query_corpus_citations',
      'analyze_document_structure',
      'discover_topic_clusters',
    ]),
    policy: Object.freeze({
      approvalTier: 'L1',
      scopeAccess: 'KNOWLEDGE_CORPUS',
      memoryNamespace: 'research',
      canIssueDirectives: false,
      maxAutonomousActionSensitivity: 'READ_ONLY',
    }),
  }),

  [CORE_AGENT_ROLES.MARKETING]: Object.freeze({
    roleId: CORE_AGENT_ROLES.MARKETING,
    label: 'Marketing',
    description: 'Campaign execution, broadcast messaging, paid media telemetry, and customer lifecycle journeys.',
    allowedTools: Object.freeze([
      'answer_from_knowledge',
      'read_customer_profile',
      'search_conversations',
      'track_campaign_telemetry',
      'schedule_broadcast_batch',
      'set_customer_lifecycle',
    ]),
    policy: Object.freeze({
      approvalTier: 'L2',
      scopeAccess: 'MARKETING_GROWTH',
      memoryNamespace: 'marketing',
      canIssueDirectives: false,
      maxAutonomousActionSensitivity: 'LOW',
    }),
  }),
})

/**
 * Create a scoped tool registry for a specific agent role.
 * Success Criterion: Any tool descriptor not declared in the role's allowedTools
 * MUST be rejected at bind/registration time, not at call time.
 *
 * @param {string} roleId
 * @returns {object} Scoped tool registry
 */
export function createRoleScopedToolRegistry(roleId) {
  const spec = ROLE_SPECIFICATIONS[roleId]
  if (!spec) {
    throw new Error(`UNKNOWN_AGENT_ROLE: Role "${roleId}" is not a registered core role`)
  }

  const allowedSet = new Set(spec.allowedTools)
  const registeredTools = new Map()

  return {
    roleId,
    /**
     * Register a tool descriptor strictly verified against the role's allowed tools.
     * Throws at bind time if unauthorized.
     */
    register(descriptor) {
      if (!descriptor || typeof descriptor.name !== 'string' || !descriptor.name) {
        throw new Error('Tool descriptor requires a name')
      }

      if (!allowedSet.has(descriptor.name)) {
        throw new Error(
          `TOOL_NOT_PERMITTED_FOR_ROLE: Tool "${descriptor.name}" is not permitted for role "${roleId}" at bind time`,
        )
      }

      registeredTools.set(descriptor.name, descriptor)
      return descriptor
    },

    get(name) {
      return registeredTools.get(name)
    },

    has(name) {
      return registeredTools.has(name)
    },

    list() {
      return [...registeredTools.values()].map((t) => ({
        name: t.name,
        description: t.description ?? '',
        readOnly: Boolean(t.readOnly),
        sensitivity: t.sensitivity ?? null,
      }))
    },
  }
}

/**
 * Create the Agent Role Registry managing all core roles and their bindings.
 */
export function createAgentRoleRegistry() {
  return {
    /**
     * Get a role specification by ID.
     */
    getRole(roleId) {
      const spec = ROLE_SPECIFICATIONS[roleId]
      if (!spec) {
        throw new Error(`UNKNOWN_AGENT_ROLE: Role "${roleId}" is not a registered core role`)
      }
      return spec
    },

    /**
     * List all five canonical roles with their descriptions and allowed tools.
     */
    listRoles() {
      return Object.values(ROLE_SPECIFICATIONS).map((r) => ({
        roleId: r.roleId,
        label: r.label,
        description: r.description,
        toolCount: r.allowedTools.length,
        allowedTools: [...r.allowedTools],
        policy: { ...r.policy },
      }))
    },

    /**
     * Create a role-scoped tool registry enforcing bind-time refusal for unauthorized tools.
     */
    createScopedToolRegistry(roleId) {
      return createRoleScopedToolRegistry(roleId)
    },

    /**
     * Resolve role-specific execution context and policy.
     * Acceptance Criterion: Given the five roles, when each resolves its context,
     * each receives a distinct tool set and policy.
     */
    resolveRoleContext({ roleId, authorization, baseContext = {} }) {
      const role = this.getRole(roleId)
      const scopedTools = this.createScopedToolRegistry(roleId)

      // Bind all standard default tools that this role is permitted to have
      const defaultToolDefinitions = [
        { name: 'answer_from_knowledge', readOnly: true, description: 'Knowledge lookup' },
        { name: 'read_customer_profile', readOnly: true, description: 'Customer profile lookup' },
        { name: 'search_conversations', readOnly: true, description: 'Conversation lookup' },
        { name: 'portfolio_summary', readOnly: true, description: 'Executive portfolio summary' },
        { name: 'audit_decision_log', readOnly: true, description: 'Executive audit decision log' },
        { name: 'review_approval_queue', readOnly: true, description: 'Executive approval queue' },
        { name: 'authorize_governed_action', readOnly: false, effect: 'WRITE', sensitivity: 'HIGH', description: 'Executive action authorization' },
        { name: 'check_inventory_replenishment', readOnly: true, description: 'Inventory replenishment' },
        { name: 'intake_catalog_batch', readOnly: true, description: 'Catalog intake' },
        { name: 'track_order_fulfillment', readOnly: true, description: 'Order fulfillment status' },
        { name: 'close_conversation', readOnly: false, effect: 'WRITE', sensitivity: 'LOW', description: 'Close conversation' },
        { name: 'evaluate_pricing_rules', readOnly: true, description: 'Evaluate pricing rules' },
        { name: 'calculate_quote_ladder', readOnly: true, description: 'Calculate quote ladder' },
        { name: 'audit_billing_ledger', readOnly: true, description: 'Audit billing ledger' },
        { name: 'reconcile_invoice_totals', readOnly: true, description: 'Reconcile invoice totals' },
        { name: 'search_knowledge_graph', readOnly: true, description: 'Search GKS knowledge graph' },
        { name: 'query_corpus_citations', readOnly: true, description: 'Query corpus citations' },
        { name: 'analyze_document_structure', readOnly: true, description: 'Analyze document structure' },
        { name: 'discover_topic_clusters', readOnly: true, description: 'Discover topic clusters' },
        { name: 'track_campaign_telemetry', readOnly: true, description: 'Track campaign telemetry' },
        { name: 'schedule_broadcast_batch', readOnly: true, description: 'Schedule broadcast batch' },
        { name: 'set_customer_lifecycle', readOnly: false, effect: 'WRITE', sensitivity: 'LOW', description: 'Set customer lifecycle' },
      ]

      for (const tool of defaultToolDefinitions) {
        if (role.allowedTools.includes(tool.name)) {
          scopedTools.register(tool)
        }
      }

      return {
        ...baseContext,
        role: {
          roleId: role.roleId,
          label: role.label,
          description: role.description,
        },
        policy: {
          ...(baseContext.policy ?? {}),
          ...role.policy,
        },
        tools: scopedTools.list(),
        toolRegistry: scopedTools,
      }
    },
  }
}
