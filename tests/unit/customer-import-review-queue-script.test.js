import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = fs.readFileSync('scripts/build_smartgift_customer_review_queue.py', 'utf8')
const manifest = JSON.parse(fs.readFileSync('artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-review-queue-manifest.json', 'utf8'))

// @req FR-078 — source resolution produces deterministic review IDs and a
// redacted 65-case/130-item manifest before any target metadata apply.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018.
// @tested tests/unit/customer-import-review-queue-script.test.js

describe('FR-078 customer review queue manifest', () => {
  it('matches the current read-only held-row evidence', () => {
    expect(manifest.mode).toBe('READ_ONLY_REVIEW_QUEUE_MANIFEST')
    expect(manifest.rawPiiStored).toBe(false)
    expect(manifest.counts).toMatchObject({ sourceRows: 3569, reviewItems: 130, reviewCases: 65 })
    expect(manifest.cases).toHaveLength(65)
    expect(manifest.cases.reduce((count, item) => count + item.items.length, 0)).toBe(130)
  })

  it('contains only redacted case/item fields and has an explicit apply gate', () => {
    const serialized = JSON.stringify(manifest)
    expect(serialized).not.toMatch(/"(?:displayName|normalizedName|taxId|email|phone|postcode|sourceKey|taxKey|normalizedKey)"\s*:/i)
    expect(script).toContain('read_only=True')
    expect(script).toContain('if args.apply:')
    expect(script).toContain('APPLIED_REVIEW_QUEUE_METADATA')
    expect(script).toContain('publishesCustomers": False')
  })
})
