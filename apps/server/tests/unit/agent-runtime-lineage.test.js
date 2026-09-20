import { describe, expect, it } from 'vitest'
import { captureAgentMemoryLineage, replayAgentContext } from '@/modules/agent/runtime'
import { sha256 } from '@/modules/agent/execution-trace'

// @req TASK-ZAI-025, FR-116, FR-171 — replay must use the recorded memory
// identity/version/content lineage or refuse before any current context is used.
// @spec ADR-070 D3-D5 — exact snapshots and external version references are
// evidence; a changed source never becomes a silent replay substitution.
// @tested tests/unit/agent-runtime-lineage.test.js

const SOURCE_HASH = 'a'.repeat(64)

function context({ version = 1, body = { note: 'original' }, memoryId = 'memory-1', sourceHash = SOURCE_HASH } = {}) {
  return {
    memory: {
      entries: [body],
      evidence: {
        schemaVersion: 'msp-memory-evidence.v1',
        source: 'MSP_API_009',
        vaultId: 'vault-1',
        references: [{
          entryIndex: 0,
          memoryId,
          version,
          sourceVaultId: 'vault-1',
          key: 'customer-note',
          category: 'agent-memory',
          sourceHash,
          snapshotHash: sha256(body),
          recordedAt: '2026-09-21T00:00:00.000Z',
          status: 'VERSIONED',
          reasons: [],
        }],
      },
    },
  }
}

function thrown(action) {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('expected action to throw')
}

describe('agent runtime memory lineage (TASK-ZAI-025)', () => {
  it('captures stable memory identity, version and hashes without retaining the body', () => {
    const lineage = captureAgentMemoryLineage(context())

    expect(lineage).toMatchObject({
      schemaVersion: 'agent-memory-lineage.v1',
      vaultId: 'vault-1',
      complete: true,
      references: [{ memoryId: 'memory-1', version: 1, snapshotHash: sha256({ note: 'original' }) }],
    })
    expect(lineage).not.toHaveProperty('entries')
    expect(Object.isFrozen(lineage)).toBe(true)
    expect(Object.isFrozen(lineage.references)).toBe(true)
  })

  it('accepts a replay only when the exact recorded memory reference is still selected', () => {
    const result = replayAgentContext({ recordedContext: context(), currentContext: context() })

    expect(result.replayed).toBe(true)
    expect(result.context).toEqual(context())
    expect(result.recordedLineage.hash).toBe(result.currentLineage.hash)
  })

  it('refuses newer memory content and reports the recorded and replay versions', () => {
    const error = thrown(() => replayAgentContext({
      recordedContext: context(),
      currentContext: context({ version: 2, body: { note: 'newer' }, sourceHash: 'b'.repeat(64) }),
    }))

    expect(error).toMatchObject({ code: 'AGENT_REPLAY_LINEAGE_DIVERGED', status: 409 })
    expect(error.message).toContain('memory memory-1 version diverged')
    expect(error.message).toContain('recorded 1')
    expect(error.message).toContain('replay 2')
    expect(error.details.divergences).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'version', recorded: 1, current: 2, reason: 'MEMORY_VERSION_DIVERGED' }),
    ]))
  })

  it('refuses changed content even when the memory version is unchanged', () => {
    const error = thrown(() => replayAgentContext({
      recordedContext: context(),
      currentContext: context({ body: { note: 'changed without a version' } }),
    }))

    expect(error).toMatchObject({ code: 'AGENT_REPLAY_LINEAGE_DIVERGED' })
    expect(error.details.divergences).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'snapshotHash', reason: 'MEMORY_CONTENT_DIVERGED' }),
    ]))
  })

  it('refuses a memory-bearing context whose source lineage was not retained', () => {
    const error = thrown(() => replayAgentContext({
      recordedContext: { memory: { entries: [{ note: 'unversioned' }], evidence: null } },
      currentContext: context(),
    }))

    expect(error).toMatchObject({ code: 'AGENT_REPLAY_LINEAGE_UNAVAILABLE' })
    expect(error.message).toContain('recorded:MEMORY_EVIDENCE_MISSING')
  })

  it('refuses a tampered snapshot declaration before replay can use it', () => {
    const current = context()
    current.memory.entries[0] = { note: 'tampered' }
    const error = thrown(() => replayAgentContext({ recordedContext: context(), currentContext: current }))

    expect(error).toMatchObject({ code: 'AGENT_REPLAY_LINEAGE_UNAVAILABLE' })
    expect(error.message).toContain('current:MEMORY_REFERENCE_0_SNAPSHOT_HASH_MISMATCH')
  })

  it('allows a public context with no memory lineage on either side', () => {
    const result = replayAgentContext({
      recordedContext: { memory: { entries: [], evidence: null } },
      currentContext: { memory: { entries: [], evidence: null } },
    })

    expect(result.replayed).toBe(true)
  })
})
