import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const apiRoute = fs.readFileSync('src/app/api/platform/customer-import-reviews/route.js', 'utf8')
const decisionRoute = fs.readFileSync('src/app/api/platform/customer-import-reviews/[caseId]/decisions/route.js', 'utf8')
const targetsRoute = fs.readFileSync('src/app/api/platform/customer-import-reviews/targets/route.js', 'utf8')

// @req FR-078 — API routes resolve one trusted viewer and keep review writes
// behind the server-owned service boundary.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-017, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-api.test.js

describe('FR-078 customer review API boundary', () => {
  it('uses the trusted viewer for queue reads and target lookup', () => {
    expect(apiRoute).toContain('resolveRequestViewer(request)')
    expect(apiRoute).toContain('listCustomerImportReviewQueue')
    expect(targetsRoute).toContain('resolveRequestViewer(request)')
    expect(targetsRoute).toContain('listCustomerImportReviewTargets')
    expect(apiRoute + targetsRoute).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/i)
  })

  it('accepts decisions only through the append service and never calls a Customer importer', () => {
    expect(decisionRoute).toContain('resolveRequestViewer(request)')
    expect(decisionRoute).toContain('appendCustomerImportReviewDecisions')
    expect(decisionRoute).not.toMatch(/apply|publish|customerImportBackfill|LINE/i)
  })
})
