import { describe, expect, it } from 'vitest'
import { authorizeAgentToolExecution } from '@/modules/identity/agent-tool-authorizer'

// @req FR-094, FR-096, FR-098
// @spec ADR-045, SDD-052, BR-020, SEC-018
// @tested tests/unit/identity/agent-tool-authorizer.test.js

describe('authorizeAgentToolExecution', () => {
  const mockDb = {
    person: {
      findUnique: async ({ where }) => (where.id === 'person-1' ? { id: 'person-1' } : null),
    },
    tenant: {
      findUnique: async ({ where }) => (where.id === 'tenant-1' ? { id: 'tenant-1', status: 'ACTIVE' } : null),
    },
    business: {
      findUnique: async ({ where }) =>
        where.id === 'biz-1' ? { id: 'biz-1', tenantId: 'tenant-1', status: 'ACTIVE' } : null,
    },
    membership: {
      findMany: async ({ where }) => [
        {
          id: 'mem-1',
          tenantId: 'tenant-1',
          businessId: 'biz-1',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      ],
    },
  }

  it('allows tool execution for authorized viewer and binds trusted scope', async () => {
    const viewer = { personId: 'person-1', tenantId: 'tenant-1', businessId: 'biz-1' }
    const result = await authorizeAgentToolExecution({
      toolName: 'read_project_data',
      toolArgs: { filter: 'active' },
      viewer,
      db: mockDb,
    })

    expect(result.allowed).toBe(true)
    expect(result.authorizedArgs.tenantId).toBe('tenant-1')
    expect(result.authorizedArgs.businessId).toBe('biz-1')
    expect(result.authorizedArgs.authorizedByPersonId).toBe('person-1')
  })

  it('rejects tool call when tool arguments attempt to widen tenant scope (SEC-018)', async () => {
    const viewer = { personId: 'person-1', tenantId: 'tenant-1', businessId: 'biz-1' }
    const result = await authorizeAgentToolExecution({
      toolName: 'read_project_data',
      toolArgs: { tenantId: 'attacker-tenant-999', filter: 'all' },
      viewer,
      db: mockDb,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('CROSS_TENANT_ARGUMENT_FORBIDDEN')
  })

  it('fails closed when viewer is missing or unauthenticated', async () => {
    const result = await authorizeAgentToolExecution({
      toolName: 'read_project_data',
      toolArgs: {},
      viewer: null,
      db: mockDb,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('AUTHENTICATION_REQUIRED')
  })
})
