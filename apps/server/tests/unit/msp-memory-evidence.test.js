import { describe, expect, it } from 'vitest'
import { canonicalJson, MAX_TRACE_PAYLOAD_BYTES, sha256 } from '@/modules/agent/execution-trace'
import { captureMspMemoryRead, captureMspMemoryWrite } from '@/modules/agent/msp-memory-evidence'

// @req FR-171 — preserve API-009 memory identity, version and exact returned-page evidence.
// @spec ADR-070, ADR-022 — MSP owns memory authority; local hashes prove captured bodies only.
// @tested tests/unit/msp-memory-evidence.test.js

const vaultId = 'vault-private-1'

function entity(overrides = {}) {
  return {
    entity_id: 'memory-1',
    vault_id: vaultId,
    current_version: 7,
    source_hash: 'a'.repeat(64),
    category: 'customer-preference',
    key: 'preferred-language',
    recorded_at: '2026-09-08T00:00:00.000Z',
    body_json: { language: 'th', confidence: 0.9 },
    ...overrides,
  }
}

describe('captureMspMemoryRead (API-009)', () => {
  it('rejects conflicting MSP source hashes even when revision bodies match', () => {
    expect(() => captureMspMemoryRead({ entities: [entity(), entity({ source_hash: 'b'.repeat(64) })] }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_CONFLICT')
  })
  it('distinguishes a local body hash from an absent MSP source hash', () => {
    const captured = captureMspMemoryRead({ entities: [entity({ source_hash: null })] }, { vaultId })
    expect(captured.evidence.references[0]).toMatchObject({ status: 'INCOMPLETE', sourceHash: null,
      reasons: ['SOURCE_HASH_NOT_REPORTED'] })
    expect(captured.evidence.references[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects contradictory bodies for one source revision and ambiguous timestamps', () => {
    expect(() => captureMspMemoryRead({ entities: [entity(), entity({ body_json: { altered: true } })] }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_CONFLICT')
    expect(() => captureMspMemoryRead({ entities: [entity({ recorded_at: 'yesterday' })] }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_INVALID')
    const result = captureMspMemoryRead({ entities: [entity({ recorded_at: '2026-09-08T07:00:00+07:00' })] }, { vaultId })
    expect(result.evidence.references[0].recordedAt).toBe('2026-09-08T00:00:00.000Z')
  })
  it('keeps MSP identity/version/source hash separate from the local canonical body hash', () => {
    const body = { language: 'th', confidence: 0.9 }
    const captured = captureMspMemoryRead({
      structuredContent: { entities: [entity({ body_json: body })], next_page_token: 'cursor-2' },
    }, { vaultId, observedAt: '2026-09-08T01:02:03.000Z' })

    expect(captured.entries).toEqual([body])
    expect(captured.evidence).toMatchObject({
      schemaVersion: 'msp-memory-evidence.v1',
      source: 'MSP_API_009',
      vaultId,
      observedAt: '2026-09-08T01:02:03.000Z',
      selection: 'RETURNED_PAGE',
      hasMore: true,
      references: [{
        entryIndex: 0,
        memoryId: 'memory-1',
        version: 7,
        sourceVaultId: vaultId,
        sourceHash: 'a'.repeat(64),
        snapshotHash: sha256(canonicalJson(body)),
        status: 'VERSIONED',
        reasons: [],
      }],
    })
    expect(captured.evidence.references[0].sourceHash)
      .not.toBe(captured.evidence.references[0].snapshotHash)
  })

  it('detaches and freezes the returned page and caller context before source mutation', () => {
    const body = { nested: { answer: 'before' } }
    const callerContext = { sessionId: 'session-1', policyVersion: 'FR-057.v2' }
    const result = { entities: [entity({ body_json: body })], next_page_token: null }
    const captured = captureMspMemoryRead(result, { vaultId, callerContext })

    body.nested.answer = 'after'
    result.entities[0].body_json.nested.extra = 'source mutation'
    result.entities[0].current_version = 99
    callerContext.policyVersion = 'tampered'

    expect(captured.entries).toEqual([{ nested: { answer: 'before' } }])
    expect(captured.evidence.references[0].version).toBe(7)
    expect(captured.evidence.callerContext).toEqual({ sessionId: 'session-1', policyVersion: 'FR-057.v2' })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.entries)).toBe(true)
    expect(Object.isFrozen(captured.entries[0])).toBe(true)
    expect(Object.isFrozen(captured.entries[0].nested)).toBe(true)
    expect(Object.isFrozen(captured.evidence)).toBe(true)
    expect(Object.isFrozen(captured.evidence.references[0])).toBe(true)
    expect(Object.isFrozen(captured.evidence.callerContext)).toBe(true)
  })

  it('denies an entity reported from a different source vault', () => {
    expect(() => captureMspMemoryRead({ entities: [entity({ vault_id: 'vault-other' })] }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_SCOPE_MISMATCH')
  })

  it('marks missing API-009 metadata explicitly incomplete', () => {
    const captured = captureMspMemoryRead({ entities: [{ body_json: { note: 'body retained' } }] }, { vaultId })
    expect(captured.entries).toEqual([{ note: 'body retained' }])
    expect(captured.evidence.references[0]).toMatchObject({
      memoryId: null,
      version: null,
      sourceVaultId: null,
      sourceHash: null,
      status: 'INCOMPLETE',
      reasons: ['MEMORY_ID_NOT_REPORTED', 'MEMORY_VERSION_NOT_REPORTED', 'SOURCE_VAULT_NOT_REPORTED', 'SOURCE_HASH_NOT_REPORTED'],
    })
  })

  it.each([
    [{ status: 'ok' }, 'MSP_MEMORY_EVIDENCE_INVALID'],
    [{ entities: [entity({ current_version: 0 })] }, 'MSP_MEMORY_EVIDENCE_INVALID'],
    [{ entities: [entity({ current_version: Number.MAX_SAFE_INTEGER + 1 })] }, 'MSP_MEMORY_EVIDENCE_INVALID'],
    [{ entities: [entity({ source_hash: 'not-a-sha256' })] }, 'MSP_MEMORY_EVIDENCE_INVALID'],
    [{ entities: [entity({ body_json: { authorization: 'Bearer secret' } })] }, 'MSP_MEMORY_EVIDENCE_INVALID'],
  ])('rejects malformed, invalid-version, invalid-hash or secret-bearing page %#', (result, code) => {
    expect(() => captureMspMemoryRead(result, { vaultId })).toThrow(code)
  })

  it('rejects an oversized returned page before retaining it', () => {
    expect(() => captureMspMemoryRead({ entities: [entity({ body_json: 'x'.repeat(MAX_TRACE_PAYLOAD_BYTES) })] }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_TOO_LARGE')
  })

  it.each([
    [{ entities: [], next_page_token: 'next' }, true],
    [{ entities: [], next_page_token: null }, false],
    [{ entities: [] }, null],
  ])('reports pagination truthfully for %#', (result, hasMore) => {
    expect(captureMspMemoryRead(result, { vaultId }).evidence.hasMore).toBe(hasMore)
  })

  it('rejects a malformed pagination token instead of inventing a page state', () => {
    expect(() => captureMspMemoryRead({ entities: [], next_page_token: 17 }, { vaultId }))
      .toThrow('MSP_MEMORY_EVIDENCE_INVALID')
  })
})

describe('captureMspMemoryWrite (API-009)', () => {
  it('keeps the write acknowledgement separate from a later list page', () => {
    const writeBody = { value: 'draft' }
    const write = captureMspMemoryWrite({
      structuredContent: {
        entity: entity({ body_json: writeBody, current_version: 8 }),
        created: true,
        changed: false,
      },
    }, { vaultId, observedAt: '2026-09-08T02:00:00.000Z' })
    const laterList = captureMspMemoryRead({
      entities: [entity({ body_json: { value: 'published' }, current_version: 9 })],
    }, { vaultId, observedAt: '2026-09-08T03:00:00.000Z' })

    expect(write).toMatchObject({
      status: 'ACKNOWLEDGED',
      observedAt: '2026-09-08T02:00:00.000Z',
      entry: writeBody,
      created: true,
      changed: false,
      reference: { memoryId: 'memory-1', version: 8, status: 'VERSIONED' },
    })
    expect(laterList.entries).toEqual([{ value: 'published' }])
    expect(write.entry).toEqual({ value: 'draft' })
    expect(write.reference.version).toBe(8)
    expect(write.reference.snapshotHash).toBe(sha256(canonicalJson(writeBody)))
    expect(write.reference.snapshotHash).not.toBe(laterList.evidence.references[0].snapshotHash)
  })

  it('marks the write outcome unknown when a remote receipt is malformed', () => {
    let thrown
    try {
      captureMspMemoryWrite({ entity: entity({ current_version: 0 }) }, { vaultId })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'MSP_MEMORY_EVIDENCE_INVALID', writeOutcome: 'UNKNOWN' })
  })

  it('reports an absent write entity as unavailable without claiming success', () => {
    expect(captureMspMemoryWrite({ structuredContent: { ok: true } }, { vaultId }))
      .toMatchObject({ status: 'UNAVAILABLE', reason: 'WRITE_ENTITY_NOT_REPORTED' })
  })
})
