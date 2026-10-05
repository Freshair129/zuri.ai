import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/modules/agent/msp-stdio-transport', async (importOriginal) => ({
  ...(await importOriginal()),
  createMspTransportFromEnvironment: mocks.createMspTransport,
}))
vi.mock('@/modules/agent/msp-thread-memory-port', () => ({
  createMspThreadMemoryPort: mocks.createMspThreadMemoryPort,
}))

import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'

const actualTransport = await vi.importActual('@/modules/agent/msp-stdio-transport')

beforeEach(() => {
  mocks.createMspTransport.mockReset()
  mocks.createMspThreadMemoryPort.mockReset()
})

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

  // #578 review, finding 1: an unreadable or empty HTTP-mode secret file threw a
  // plain Error out of transport construction and aborted LINE runtime startup.
  // Thread memory is optional here, so it degrades exactly as for an absent MSP.
  it('starts without thread memory, as with no MSP, when an HTTP-mode secret file is unreadable', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zuri-line-msp-'))
    try {
      mocks.createMspTransport.mockImplementation(actualTransport.createMspTransportFromEnvironment)
      const ports = serverLinePorts({
        ZURI_LINE_SERVER_ENABLED: 'true',
        ZURI_MSP_COMMAND: process.execPath,
        ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(32),
        MSP_GKS_TRANSPORT: 'http',
        GKS_MSP_RELAY_CREDENTIAL_FILE: path.join(directory, 'missing-relay-credential'),
      })
      expect(ports.threadMemory).toBeNull()
      expect(ports.replyTransport).toBe('reply-transport')
      expect(mocks.createMspThreadMemoryPort).not.toHaveBeenCalled()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('still fails startup on a transport error that is not a misconfigured secret', () => {
    mocks.createMspTransport.mockImplementation(actualTransport.createMspTransportFromEnvironment)
    expect(() => serverLinePorts({
      ZURI_LINE_SERVER_ENABLED: 'true',
      ZURI_MSP_COMMAND: process.execPath,
      ZURI_MSP_ARGS: 'not-json',
      ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(32),
    })).toThrow(/JSON array/)
  })
})
