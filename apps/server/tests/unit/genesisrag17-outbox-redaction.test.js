import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  GENESIS_RAG17_REDACTION_SCHEMA_VERSION,
  buildRedactedRequestJson,
  canonicalRequestSha256,
  isRedactedRequestJson,
  parseRedactionMarker,
  validateRedactionMarker,
} from '@/modules/knowledge/genesisrag17-outbox-redaction'

// @req FR-109 — owner-run redaction preserves the outbox envelope and records provenance.
// @spec ADR-121 D3-D6
// @tested tests/unit/genesisrag17-outbox-redaction.test.js

const marker = {
  redacted: true,
  schemaVersion: GENESIS_RAG17_REDACTION_SCHEMA_VERSION,
  redactedAt: '2026-11-27T03:04:05.000Z',
  redactedBy: 'Owner One',
  reason: 'Retention review completed',
  originalSha256: 'a'.repeat(64),
}

describe('GenesisRAG17 outbox redaction marker', () => {
  it('accepts only the exact complete marker contract', () => {
    expect(validateRedactionMarker(marker)).toBe(true)
    const invalid = [
      { ...marker, extra: true },
      Object.fromEntries(Object.entries(marker).filter(([key]) => key !== 'reason')),
      { ...marker, schemaVersion: 'genesisrag17.redaction.v2' },
      { ...marker, redactedAt: 'yesterday' },
      { ...marker, originalSha256: 'g'.repeat(64) },
      { ...marker, redactedBy: '   ' },
      { ...marker, redactedBy: `A${'x'.repeat(200)}` },
      { ...marker, reason: '   ' },
      { ...marker, reason: `R${'x'.repeat(1000)}` },
      { ...marker, redacted: false },
    ]
    for (const value of invalid) expect(validateRedactionMarker(value)).toBe(false)
    expect(validateRedactionMarker({ ...marker, redactedAt: '2026-11-27T10:04:05+07:00' })).toBe(true)
  })

  it('hashes the exact stored request string with lowercase SHA-256 hex', () => {
    const original = '{ "source": { "content": "Exact source" }, "chunks": [], "mentions": [] }'
    const expected = createHash('sha256').update(original, 'utf8').digest('hex')
    expect(canonicalRequestSha256(original)).toBe(expected)
    expect(canonicalRequestSha256(original)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('empties only the text members, preserves envelope order and values, and is deterministic', () => {
    const originalObject = {
      schemaVersion: 'genesisrag17.v1',
      batchId: 'batch-1',
      idempotencyKey: 'key-1',
      scope: { tenantId: 'tenant-1' },
      source: { sourceId: 'source-1', contentHash: 'b'.repeat(64), content: 'source secret', other: 7 },
      chunks: [{ chunkId: 'chunk-1', text: 'chunk secret', startOffset: 4, endOffset: 16, contentHash: 'c'.repeat(64) }],
      mentions: [{ sourceMentionId: 'mention-1', name: 'mention secret', startOffset: 5, endOffset: 12 }],
    }
    const original = JSON.stringify(originalObject)
    const before = JSON.stringify(originalObject)
    const options = { actor: 'Owner One', reason: 'Retention review completed', redactedAt: '2026-11-27T03:04:05.000Z' }

    const result = buildRedactedRequestJson(original, options)
    const repeated = buildRedactedRequestJson(original, options)
    const redacted = JSON.parse(result)

    expect(result).toBe(repeated)
    expect(JSON.stringify(originalObject)).toBe(before)
    expect(Object.keys(redacted)).toEqual([...Object.keys(originalObject), 'redaction'])
    expect(redacted).toMatchObject({
      schemaVersion: 'genesisrag17.v1',
      batchId: 'batch-1',
      idempotencyKey: 'key-1',
      scope: { tenantId: 'tenant-1' },
      source: { sourceId: 'source-1', contentHash: 'b'.repeat(64), content: '', other: 7 },
      chunks: [{ chunkId: 'chunk-1', text: '', startOffset: 4, endOffset: 16, contentHash: 'c'.repeat(64) }],
      mentions: [{ sourceMentionId: 'mention-1', name: '', startOffset: 5, endOffset: 12 }],
      redaction: {
        redacted: true,
        schemaVersion: GENESIS_RAG17_REDACTION_SCHEMA_VERSION,
        redactedAt: options.redactedAt,
        redactedBy: options.actor,
        reason: options.reason,
        originalSha256: createHash('sha256').update(original, 'utf8').digest('hex'),
      },
    })
    expect(Object.keys(redacted.source)).toEqual(Object.keys(originalObject.source))
    expect(Object.keys(redacted.chunks[0])).toEqual(Object.keys(originalObject.chunks[0]))
    expect(Object.keys(redacted.mentions[0])).toEqual(Object.keys(originalObject.mentions[0]))
    expect(isRedactedRequestJson(result)).toBe(true)
  })

  it('distinguishes an absent marker from a malformed marker', () => {
    const plain = JSON.stringify({ source: { content: 'still present' } })
    const malformed = JSON.stringify({ source: { content: 'still present' }, redaction: { redacted: true } })

    expect(parseRedactionMarker(plain)).toEqual({ redacted: false })
    expect(isRedactedRequestJson(plain)).toBe(false)
    expect(parseRedactionMarker(malformed)).toMatchObject({ redacted: false, invalid: true })
    expect(isRedactedRequestJson(malformed)).toBe(false)
    expect(parseRedactionMarker(JSON.parse(buildRedactedRequestJson(plain, {
      actor: 'Owner One',
      reason: 'Retention review completed',
      redactedAt: '2026-11-27T03:04:05.000Z',
    }))).redacted).toBe(true)
  })
})
