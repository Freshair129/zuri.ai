// @req FR-173 — existing Business/Project Files expose Text/Markdown admission,
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
    expect(panel).toContain('TextKnowledgeModal key={`text:${businessId}:${projectId || \'\'}`}')
  })

  it('remounts the complete panel when its Business or Project scope changes', () => {
    expect(panel).toContain('function ManagedFilesPanelBody')
    expect(panel).toContain('return <ManagedFilesPanelBody')
    expect(panel).toContain('key={scopeKey}')
  })
  it('lists admissions as a table paged 10 at a time, below the files', () => {
    expect(panel).toContain('const KNOWLEDGE_PAGE_SIZE = 10')
    expect(panel).toContain('data-testid="knowledge-admissions-table"')
    expect(panel).toContain('data-testid="knowledge-admissions-pager"')
    // The table pages through what the API returns, up to its own maximum.
    expect(panel).toContain('&limit=${KNOWLEDGE_LIST_LIMIT}')
    const body = panel.slice(panel.indexOf('function ManagedFilesPanelBody'))
    expect(body.indexOf('<KnowledgeJobs')).toBeGreaterThan(body.indexOf('<FileManagerViews'))
    expect(body.indexOf('<KnowledgeJobs')).toBeGreaterThan(body.indexOf('<KnowledgeQuery'))
  })

  it('never gives two sibling panels the same React key', () => {
    // Shared keys made React keep orphaned copies of the search card on every
    // re-render (e.g. switching the file view), so each sibling owns its prefix.
    const keys = [...panel.matchAll(/<(KnowledgeQuery|KnowledgeJobs|TextKnowledgeModal) key=\{`([^`]*)`\}/g)].map((match) => match[2])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })
})
