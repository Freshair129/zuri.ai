// @req FR-025 — the agent read-only context contract (Gate E): public read surface.
// @req FR-026 — the agent write/action gate (Gate F): authorize + step-up + audited execute.
// @spec ADR-007 §P6/§P7 — read-only contract bound at Gate E; writes only through the
//   action gate at Gate F.
// @tested tests/integration/agent-context.test.js, tests/integration/agent-action-gate.test.js

export { assembleAgentContext } from './context'
export { memoryKey, createInMemoryMemory } from './memory-port'
export { createMspMemoryPort } from './msp-memory-port'
export { createToolRegistry, defaultReadOnlyTools } from './tools'
export { authorizeAgentAction, executeAgentAction } from './action-gate'
export { createWriteToolRegistry, defaultWriteTools } from './write-tools'
export { issueStepUp } from './step-up'
// @req FR-027 — the end-to-end agent turn.
export { handleAgentTurn } from './turn'
// @req FR-029 — bind the agent to the real MSP + GenesisBlockDB backends.
export { createAgentPorts } from './runtime'
