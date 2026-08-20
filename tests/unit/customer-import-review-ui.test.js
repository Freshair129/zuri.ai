import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DOMAINS, domainForPath } from '@/config/domains'
import { CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED } from '@/modules/crm/customer-import-review-store'

const page = fs.readFileSync('src/app/(pm)/platform/customer-import-reviews/page.jsx', 'utf8')

// @req FR-078 — Platform UI presents duplicate review IDs and explicit actions
// without rendering raw customer/source PII or a direct database client. A
// deployment gap (no review target configured) is reported distinctly from a
// configured target that is failing, and only the latter offers a Retry
// button — retrying an unconfigured target cannot change the outcome.
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

  it('keeps the page\'s hand-copied not-configured literal byte-for-byte in sync with the store', () => {
    // The store can't be imported into this 'use client' page (it pulls in
    // `pg`, `node:fs` and Prisma), so the literal is duplicated by hand. This
    // is the one place that duplication is checked.
    expect(page).toContain(`const CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED = '${CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED}'`)
  })

  it('reports an unconfigured review target as a deployment gap with no Retry button, distinct from a configured-and-failing target', () => {
    const notConfiguredBranch = page.slice(
      page.indexOf('queue.error === CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED'),
      page.indexOf('if (queue.error) return'),
    )
    expect(notConfiguredBranch).not.toBe('')
    expect(notConfiguredBranch).not.toContain('retry=')
    expect(notConfiguredBranch).toContain('ZURI_CUSTOMER_REVIEW_DATABASE_URL')
    expect(notConfiguredBranch).toContain('ZURI_CUSTOMER_REVIEW_MODE')

    // The fallback branch for every other error keeps its Retry button.
    expect(page).toContain('retry={queue.reload}')
  })
})
