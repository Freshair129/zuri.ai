// @req FR-173 — Knowledge source admission and corpus publication UI in the Knowledge (GKS) slot
// @spec ADR-072, ADR-085 D1, SEC-001, SEC-008
// @tested tests/unit/knowledge-documents-ui.test.js

import { readFileSync } from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import KnowledgeDocumentsView from '@/modules/knowledge/ui/KnowledgeDocumentsView'
import { DOMAINS, domainForPath } from '@/config/domains'

globalThis.React = React

// Mock ScopeContext
vi.mock('@/context/ScopeContext', () => ({
  useScope: () => ({
    currentBusiness: { id: 'biz-test-01', name: 'SmartGift Test Co' },
    shell: { activeBusinessId: 'biz-test-01' },
  }),
}))

// Mock useApi
vi.mock('@/modules/project-manager/components/useApi', () => ({
  api: vi.fn().mockResolvedValue({ items: [] }),
  useFetch: vi.fn().mockReturnValue({ data: { assets: [] }, loading: false, error: null, reload: vi.fn() }),
  LoadingCard: () => React.createElement('div', { 'data-testid': 'loading-card' }),
}))

describe('Knowledge Documents route contract', () => {
  it('is a server component protected by requirePipelineMapViewer before rendering', () => {
    const file = 'src/app/(pm)/knowledge/documents/page.jsx'
    const source = readFileSync(file, 'utf8')
    expect(source).not.toContain("'use client'")
    expect(source).toContain('await requirePipelineMapViewer()')
    expect(source).toContain('metadata = { title: \'Documents — Knowledge (GKS)\' }')
    expect(source).toContain('<KnowledgeDocumentsView')
  })

  it('is reachable under Knowledge (GKS) navigation slot', () => {
    const knowledge = DOMAINS.find((d) => d.key === 'knowledge')
    expect(knowledge).toBeDefined()
    const docItem = knowledge.sub.find((s) => s.path === '/knowledge/documents')
    expect(docItem).toBeDefined()
    expect(docItem.label).toBe('Documents')
    expect(domainForPath('/knowledge/documents').key).toBe('knowledge')
  })
})

describe('KnowledgeDocumentsView UI rendering', () => {
  it('renders page header, tabs, and dropzone in default intake mode', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeDocumentsView, { initialTab: 'intake' }))
    expect(html).toContain('data-testid="knowledge-documents-view"')
    expect(html).toContain('KNOWLEDGE (GKS)')
    expect(html).toContain('Documents &amp; Intake')
    expect(html).toContain('SmartGift Test Co')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('data-testid="tab-intake"')
    expect(html).toContain('data-testid="tab-queue"')
    expect(html).toContain('data-testid="tab-search"')
    expect(html).toContain('data-testid="file-dropzone"')
    expect(html).toContain('.txt, .md, .markdown หรือ .json')
  })

  it('renders queue tab correctly when initialTab is queue', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeDocumentsView, { initialTab: 'queue' }))
    expect(html).toContain('สถานะคิวการนำเข้าความรู้')
    expect(html).toContain('ทุกสถานะ')
    expect(html).toContain('กำลังดำเนินการ')
  })

  it('renders search tab correctly when initialTab is search', () => {
    const html = renderToStaticMarkup(createElement(KnowledgeDocumentsView, { initialTab: 'search' }))
    expect(html).toContain('data-testid="search-form"')
    expect(html).toContain('data-testid="search-input"')
    expect(html).toContain('data-testid="search-submit"')
  })
})
