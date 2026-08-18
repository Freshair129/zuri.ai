import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DOMAINS, domainForPath } from '@/config/domains'

const page = fs.readFileSync('src/app/(pm)/platform/customer-import-reviews/page.jsx', 'utf8')

// @req FR-078 — Platform UI presents duplicate review IDs and explicit actions
// without rendering raw customer/source PII or a direct database client.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-ui.test.js

describe('FR-078 customer review UI contract', () => {
  it('registers the review queue under Platform', () => {
    const platform = DOMAINS.find((domain) => domain.key === 'platform')
    expect(platform.sub).toContainEqual(expect.objectContaining({ label: 'Customer Review', path: '/platform/customer-import-reviews' }))
    expect(domainForPath('/platform/customer-import-reviews').key).toBe('platform')
  })

  it('shows stable review IDs and all four decisions without raw PII fields', () => {
    expect(page).toContain('/api/platform/customer-import-reviews')
    expect(page).toContain('CREATE_SEPARATE')
    expect(page).toContain('LINK_EXISTING')
    expect(page).toContain('REJECT')
    expect(page).toContain('DEFER')
    expect(page).toContain('reviewItemId')
    expect(page).toContain('sourceSha256')
    expect(page).not.toMatch(/sourceRecordKey|normalizedName|taxId|phone|email|displayName\b/i)
    expect(page).not.toMatch(/SUPABASE|createClient|service_role/i)
  })
})
