// @req FR-172 — existing Business/Project Files expose Text/Markdown admission,
// durable status, source withdrawal and authorized corpus queries.
// @spec ADR-072, SEC-001
// @tested tests/unit/knowledge-admission-ui-contract.test.js
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const panel = fs.readFileSync('src/modules/project-manager/components/ManagedFilesPanel.jsx', 'utf8')

describe('knowledge controls in the existing Files surfaces', () => {
  it('uses the shared admission API for file and direct text sources', () => {
    expect(panel).toContain('/api/knowledge/ingestions')
    expect(panel).toContain("kind: 'FILE'")
    expect(panel).toContain("kind: 'TEXT'")
    expect(panel).toContain('idempotencyKey')
  })

  it('renders durable status and keeps withdrawal separate from FileAsset deletion', () => {
    for (const status of ['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED', 'SUPERSEDED', 'WITHDRAWN']) {
      expect(panel).toContain(status)
    }
    expect(panel).toContain('/api/knowledge/sources/')
    expect(panel).toContain('expectedVersion')
    expect(panel).toContain('/api/knowledge/queries')
    expect(panel).toContain('data-testid="knowledge-admissions"')
    expect(panel).toContain('data-testid="knowledge-query"')
    expect(panel).toContain('data-testid="knowledge-admit-text"')
  })

  it('drops late admission-list responses when the Business or Project scope changes', () => {
    expect(panel).toContain('useScopedKnowledgeFetch')
    expect(panel).toContain('const requestSequence = ++sequence.current')
    expect(panel).toContain('if (requestSequence !== sequence.current) return')
    expect(panel).toContain('if (state.scopeKey !== scopeKey) return { data: null')
  })
})
