import { describe, expect, it, vi } from 'vitest'

// @req FR-149, FR-171 — the server worker composes the same scoped MSP thread
//   memory port for delivery receipts as the answering path.
// @spec ADR-061, ADR-070, SEC-018
// @tested tests/unit/server-line-runtime.test.js

const mocks = vi.hoisted(() => ({
  createMspTransport: vi.fn(),
  createMspThreadMemoryPort: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ default: {} }))
vi.mock('@/platform/integrations/providers/line/server-line-transport', () => ({
  resolveServerLineAccount: vi.fn(),
  createServerLineReplyTransport: vi.fn(() => 'reply-transport'),
  createServerLinePushTransport: vi.fn(() => 'push-transport'),
}))
vi.mock('@/platform/integrations/core/secret-store/dispatching-secret-manager', () => ({
  createLineSecretManagerFromEnv: vi.fn(() => ({ resolve: vi.fn() })),
}))
vi.mock('@/modules/agent/msp-stdio-transport', () => ({
  createMspTransportFromEnvironment: mocks.createMspTransport,
}))
vi.mock('@/modules/agent/msp-thread-memory-port', () => ({
  createMspThreadMemoryPort: mocks.createMspThreadMemoryPort,
}))

import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'

describe('serverLinePorts private-memory composition', () => {
  it('passes the canary workspace and agent identity to the delivery scanner port', () => {
    const transport = vi.fn()
    const threadMemory = { recordDelivery: vi.fn() }
    mocks.createMspTransport.mockReturnValue(transport)
    mocks.createMspThreadMemoryPort.mockReturnValue(threadMemory)

    const ports = serverLinePorts({
      ZURI_LINE_SERVER_ENABLED: 'true',
      ZURI_MSP_COMMAND: 'node',
      ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(32),
      ZURI_MSP_THREAD_MEMORY_ACTOR: 'zuri-line-agent',
      ZURI_MSP_THREAD_AGENT_ID: 'zuri-line-agent',
      ZURI_MSP_THREAD_WORKSPACE_ID: 'task-zai-001-canary',
    })

    expect(ports.threadMemory).toBe(threadMemory)
    expect(mocks.createMspThreadMemoryPort).toHaveBeenCalledWith(expect.objectContaining({
      transport,
      serviceKey: 'k'.repeat(32),
      actor: 'zuri-line-agent',
      agentId: 'zuri-line-agent',
      workspaceId: 'task-zai-001-canary',
    }))
  })
})
