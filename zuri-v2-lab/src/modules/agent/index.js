// @req FR-025 — the agent read-only context contract: public surface of the module.
// @spec ADR-007 §P6 / Gate E — one settled contract the runtime binds to last.
// @tested tests/integration/agent-context.test.js

export { assembleAgentContext } from './context'
export { memoryKey, createInMemoryMemory } from './memory-port'
export { createToolRegistry, defaultReadOnlyTools } from './tools'
