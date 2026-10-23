import { afterEach, describe, expect, it, vi } from 'vitest'
import { startKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { register } from '@/instrumentation'

// @req FR-109 — runtime retry diagnostics reach the existing Server operations log.
// @spec ADR-073
// @tested tests/unit/knowledge-runtime-instrumentation.test.js
vi.mock('@/modules/knowledge/knowledge-runtime', () => ({ startKnowledgeAdmissionRuntime: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('Knowledge runtime bootstrap diagnostics', () => {
  it('connects the Node runtime observer and logs only the diagnostic projection', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('ZURI_KNOWLEDGE_ENABLED', '1')
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await register()
    const options = startKnowledgeAdmissionRuntime.mock.calls[0]?.[0]
    expect(typeof options?.onError).toBe('function')
    options.onError({ code: 'KNOWLEDGE_WORKER_RETRY', consecutiveFailures: 2, retryBudgetExhausted: false, retryInMs: 1000, ingestionId: 'ingestion-1', message: 'private message', credential: 'private credential', source: 'private document' })
    expect(log).toHaveBeenCalledWith('[knowledge-runtime]', expect.objectContaining({ code: 'KNOWLEDGE_WORKER_RETRY', consecutiveFailures: 2, retryInMs: 1000, ingestionId: 'ingestion-1' }))
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|credential|source/)
  })

  it('does not start the Knowledge runtime in an Edge process', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    vi.stubEnv('ZURI_KNOWLEDGE_ENABLED', '1')
    await register()
    expect(startKnowledgeAdmissionRuntime).not.toHaveBeenCalled()
  })

  it('keeps an unconfigured Node installation disabled', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('ZURI_KNOWLEDGE_ENABLED', '0')
    await register()
    expect(startKnowledgeAdmissionRuntime).not.toHaveBeenCalled()
  })
})
