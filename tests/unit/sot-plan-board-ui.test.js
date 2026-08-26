import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DOMAINS, domainForPath } from '@/config/domains'

// @req FR-099 — the board is a reader surface: it fetches the derivation
// endpoint, offers only navigation (inbox, graph), and contains no status
// editing and no direct data-plane access.
// @tested tests/unit/sot-plan-board-ui.test.js

const page = fs.readFileSync('src/app/(pm)/platform/sot-pipeline/page.jsx', 'utf8')

describe('FR-099 sot plan board UI contract', () => {
  it('registers under Platform navigation', () => {
    const platform = DOMAINS.find((domain) => domain.key === 'platform')
    expect(platform.sub).toContainEqual(expect.objectContaining({ label: 'SoT Pipeline', path: '/platform/sot-pipeline' }))
    expect(domainForPath('/platform/sot-pipeline').key).toBe('platform')
  })

  it('reads the one plan endpoint and links to the inbox and the graph', () => {
    expect(page).toContain('/api/platform/sot/plan?businessId=')
    expect(page).toContain('/platform/sot-pipeline/inbox')
    expect(page).toContain('/platform/sot-pipeline/graph')
  })

  it('derived status is displayed, never edited: no mutation calls, no status inputs', () => {
    expect(page).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/)
    expect(page).not.toMatch(/<select|<input|<textarea/)
    expect(page).not.toMatch(/duckdb|genesisblock/i)
  })

  it('shows run evidence by executionRunId so "done" is traceable', () => {
    expect(page).toContain('executionRunId')
    expect(page).toContain('pendingDecisions')
  })
})
