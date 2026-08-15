// @req FR-025 — the agent read-only context contract (Gate E): public read surface.
// @req FR-026 — the agent write/action gate (Gate F): authorize + step-up + audited execute.
// @spec ADR-007 §P6/§P7 — read-only contract bound at Gate E; writes only through the
//   action gate at Gate F.
// @tested tests/integration/agent-context.test.js, tests/integration/agent-action-gate.test.js

export { assembleAgentContext } from './context'
export { memoryKey, createInMemoryMemory } from './memory-port'
export { scopedMemoryKey } from './scoped-memory'
export { resolveAgentAuthorization, vaultScope } from './auth-context'
export { createMspMemoryPort } from './msp-memory-port'
export { createMspVaultResolver } from './msp-vault-resolver'
export { createToolRegistry, defaultReadOnlyTools } from './tools'
export { authorizeAgentAction, executeAgentAction } from './action-gate'
export { createWriteToolRegistry, defaultWriteTools } from './write-tools'
export { issueStepUp } from './step-up'
// @req FR-027 — the end-to-end agent turn.
export { handleAgentTurn } from './turn'
// @req FR-029 — bind the agent to the real MSP + GenesisBlockDB backends.
export { createAgentPorts } from './runtime'
// @req FR-048, FR-049 — provider and grounded business-answer public surfaces.
export { createModelProviderPort, PUBLIC_LINE_PROVIDERS } from './model-provider'
export { answerBusinessQuestion } from './grounded-business-answer'
export {
  createPhase1BusinessAgentPortsFromEnv,
  resolvePhase1RequestScope,
} from './phase1-runtime'
export { createOpenRouterAuthorization, exchangeOpenRouterCode } from './openrouter-oauth'
export { createPostgresLineBindingResolver, hashBindingSecret } from './line-binding-resolver'
// @req FR-053, FR-054 — production-disabled activation-readiness public surface.
// @spec SDD-027, SEC-011 — evaluation and dry-run planning do not grant activation authority.
// @tested tests/unit/activation-readiness-integration.test.js
export {
  ACTIVATION_RECEIPT_STATES,
  parseCanaryReadinessPlan,
  parseGoldenQuestionCorpus,
} from './activation-readiness-contract'
export {
  evaluateGoldenQuestions,
  readRealProviderConfiguration,
  validateGoldenQuestionCorpus,
} from './golden-evaluation'
export { CANARY_RECEIPT_STATES, createCanaryPreflightPlan } from './canary-preflight'
