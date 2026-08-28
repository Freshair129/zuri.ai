import { describe, it, expect } from 'vitest'
import { ingestionIdentity, classifyAgainst } from '@/modules/knowledge/dedup'

// @req FR-117 — deduplication and version relationships within one tenant
// @spec SEC-021, BR-021, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §11 (Stage 6)

const artifact = (over = {}) => ({
  scope: { tenantId: 'ten_1', businessId: 'biz_1' },
  source_id: 'src_1',
  source_version: '1',
  content_hash: 'a'.repeat(64),
  pipeline_version: 'ki-1',
  ...over,
})

describe('two tenants holding the same bytes hold two things', () => {
  it('does not treat an identical artifact in another tenant as a duplicate', () => {
    const mine = artifact()
    const theirs = artifact({ scope: { tenantId: 'ten_2', businessId: 'biz_9' } })
    expect(classifyAgainst(mine, [theirs]).relationship).toBe('INDEPENDENT')
  })

  it('gives them different identities even though every content field matches', () => {
    const mine = artifact()
    const theirs = artifact({ scope: { tenantId: 'ten_2', businessId: 'biz_9' } })
    expect(ingestionIdentity(mine)).not.toBe(ingestionIdentity(theirs))
  })

  it('never looks at a candidate from another tenant — it is filtered out, not judged', () => {
    const mine = artifact()
    const theirs = artifact({ scope: { tenantId: 'ten_2', businessId: 'biz_9' } })
    const result = classifyAgainst(mine, [theirs])
    expect(result.compared).toEqual([])
  })
})

describe('duplicate, revision, or neither', () => {
  it('calls a byte-identical re-ingest of the same source a DUPLICATE_OF', () => {
    const held = artifact()
    const incoming = artifact()
    const result = classifyAgainst(incoming, [held])
    expect(result.relationship).toBe('DUPLICATE_OF')
    expect(result.of).toBe(ingestionIdentity(held))
  })

  it('calls the same source at a later version a REVISION_OF, not a duplicate', () => {
    const v1 = artifact({ source_version: '1', content_hash: 'a'.repeat(64) })
    const v2 = artifact({ source_version: '2', content_hash: 'b'.repeat(64) })
    expect(classifyAgainst(v2, [v1]).relationship).toBe('REVISION_OF')
  })

  it('calls a different source with identical content INDEPENDENT — same bytes is not same thing', () => {
    const mine = artifact({ source_id: 'src_1' })
    const other = artifact({ source_id: 'src_2' })
    expect(classifyAgainst(mine, [other]).relationship).toBe('INDEPENDENT')
  })

  it('does not call a reparse under a new pipeline a duplicate', () => {
    const old = artifact({ pipeline_version: 'ki-1' })
    const reparsed = artifact({ pipeline_version: 'ki-2' })
    expect(classifyAgainst(reparsed, [old]).relationship).toBe('REVISION_OF')
  })
})

describe('what it refuses to decide', () => {
  it('does not read a version out of a filename', () => {
    const v1 = artifact({ source_id: 'src_1', source_version: '1', filename: 'contract-v1.pdf' })
    const other = artifact({ source_id: 'src_9', source_version: '1', filename: 'contract-v2.pdf' })
    // Different sources. The filenames suggest a lineage; nothing else does.
    expect(classifyAgainst(other, [v1]).relationship).toBe('INDEPENDENT')
  })

  it.each(['source_id', 'source_version', 'content_hash', 'pipeline_version'])(
    'refuses an artifact with no %s rather than hashing a hole',
    (field) => {
      const input = artifact()
      delete input[field]
      expect(() => ingestionIdentity(input)).toThrow(new RegExp(field))
    },
  )

  it('refuses an artifact with no tenant scope', () => {
    const input = artifact()
    delete input.scope
    expect(() => ingestionIdentity(input)).toThrow(/tenant/i)
  })
})

describe('supersession is a pair or it is a broken graph', () => {
  const v1 = artifact({ source_version: '1', content_hash: 'a'.repeat(64) })
  const v2 = artifact({ source_version: '2', content_hash: 'b'.repeat(64) })

  it('names what the incoming artifact supersedes', () => {
    const result = classifyAgainst(v2, [v1])
    expect(result.supersedes).toBe(ingestionIdentity(v1))
  })

  it('names the edge the held artifact gains, so both ends exist', () => {
    const result = classifyAgainst(v2, [v1])
    expect(result.edges).toEqual([
      { from: ingestionIdentity(v2), type: 'SUPERSEDES', to: ingestionIdentity(v1) },
      { from: ingestionIdentity(v1), type: 'SUPERSEDED_BY', to: ingestionIdentity(v2) },
    ])
  })

  it('emits no supersession edge for a duplicate — nothing was replaced', () => {
    const result = classifyAgainst(artifact(), [artifact()])
    expect(result.relationship).toBe('DUPLICATE_OF')
    expect(result.edges).toEqual([])
  })

  it('emits no supersession edge for an independent artifact', () => {
    expect(classifyAgainst(artifact({ source_id: 'src_9' }), [v1]).edges).toEqual([])
  })
})

describe('DERIVED_FROM is not this stage to assign', () => {
  it('never returns DERIVED_FROM — that edge is provenance, and FR-116 owns it', () => {
    const cases = [
      classifyAgainst(artifact(), [artifact()]),
      classifyAgainst(artifact({ source_version: '2' }), [artifact()]),
      classifyAgainst(artifact({ source_id: 'src_9' }), [artifact()]),
    ]
    for (const result of cases) {
      expect(result.relationship).not.toBe('DERIVED_FROM')
      expect(result.edges.some((e) => e.type === 'DERIVED_FROM')).toBe(false)
    }
  })
})

describe('the key does not collide, which is the only thing it is for', () => {
  it('separates its parts so a space inside one cannot borrow from the next', () => {
    const a = artifact({ source_id: 'a b', source_version: 'c' })
    const b = artifact({ source_id: 'a', source_version: 'b c' })
    expect(ingestionIdentity(a)).not.toBe(ingestionIdentity(b))
  })
})

describe('the newer supersedes the older, never the reverse', () => {
  const v1 = artifact({ source_version: '1', content_hash: 'a'.repeat(64) })
  const v2 = artifact({ source_version: '2', content_hash: 'b'.repeat(64) })

  it('does not let a late re-ingest of v1 supersede v2', () => {
    const result = classifyAgainst(v1, [v2])
    expect(result.edges.some((e) => e.type === 'SUPERSEDES' && e.from === ingestionIdentity(v1))).toBe(false)
  })

  it('says nothing about direction when the versions cannot be ordered', () => {
    const draft = artifact({ source_version: 'draft', content_hash: 'c'.repeat(64) })
    const final = artifact({ source_version: 'final', content_hash: 'd'.repeat(64) })
    const result = classifyAgainst(final, [draft])
    expect(result.relationship).toBe('REVISION_OF')
    expect(result.edges).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/order/i)
  })
})

describe('every prior gets its back edge, not just the first in the array', () => {
  it('supersedes all determinably earlier versions of the same source', () => {
    const v1 = artifact({ source_version: '1', content_hash: 'a'.repeat(64) })
    const v2 = artifact({ source_version: '2', content_hash: 'b'.repeat(64) })
    const v3 = artifact({ source_version: '3', content_hash: 'c'.repeat(64) })
    const result = classifyAgainst(v3, [v1, v2])
    const backEdges = result.edges.filter((e) => e.type === 'SUPERSEDED_BY')
    expect(backEdges.map((e) => e.from).sort()).toEqual([ingestionIdentity(v1), ingestionIdentity(v2)].sort())
  })
})

describe('a broken candidate does not break a sound classification silently', () => {
  it('names which artifact was malformed, not only which field', () => {
    const broken = artifact()
    delete broken.content_hash
    broken.source_id = 'src_broken'
    expect(() => classifyAgainst(artifact(), [broken])).toThrow(/src_broken/)
  })
})
