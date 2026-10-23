import { createMspVaultResolver } from '@/modules/agent/msp-vault-resolver'

// @req FR-057 — custom vault-resolution doubles still use the real signed API-009 boundary.
// @spec SDD-030, SEC-013
// @tested tests/integration/msp-memory-lineage.test.js, tests/integration/agent-multi-principal.test.js, tests/integration/conversation-runtime-memory.test.js
export const authorizeMemoryToolFixture = createMspVaultResolver({
  serviceKey: 'synthetic-memory-authorizer-fixture-key-32-bytes',
  transport: async () => { throw new Error('Fixture signer cannot resolve a vault') },
}).authorizeMemoryTool
