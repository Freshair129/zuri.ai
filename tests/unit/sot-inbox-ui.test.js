import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// @req FR-096 — the inbox offers exactly two actions (approve /
// reject-with-reason) against the decide endpoint, displays the payload
// verbatim and never edits it, and never talks to the data plane directly.
// @tested tests/unit/sot-inbox-ui.test.js

const page = fs.readFileSync('src/app/(pm)/platform/sot-pipeline/inbox/page.jsx', 'utf8')

describe('FR-096 sot inbox UI contract', () => {
  it('lists PENDING decisions from the decisions endpoint, scoped by tenant and business', () => {
    expect(page).toContain('/api/platform/sot/decisions')
    expect(page).toContain("status: 'PENDING'")
    expect(page).toContain('tenantId')
    expect(page).toContain('businessId')
  })

  it('offers exactly the two decision actions and requires a reason to reject', () => {
    expect(page).toContain("'APPROVED'")
    expect(page).toContain("'REJECTED'")
    expect(page).toContain('/decide')
    // reject path never fires without a reason string
    expect(page).toMatch(/reason && reason\.trim\(\)/)
    // no third decision verb exists in this surface
    expect(page).not.toMatch(/'WAIVED'|'DEFER'|'ESCALATE'/)
  })

  it('renders the payload verbatim and offers no way to edit it', () => {
    expect(page).toContain('JSON.stringify(decision.payload')
    expect(page).not.toMatch(/<textarea/)
    expect(page).not.toMatch(/payload\s*:/)
  })

  it('never reaches past the API boundary', () => {
    expect(page).not.toMatch(/duckdb|genesisblock|prisma/i)
  })
})
