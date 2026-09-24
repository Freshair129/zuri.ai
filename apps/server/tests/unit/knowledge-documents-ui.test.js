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
    expect(html).toContain('.txt, .md หรือ .markdown')
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

describe('SmartGift catalog admission from an existing file', () => {
  it('names the structured format only for the catalog button', async () => {
    const { existingAssetAdmissionBody, SMARTGIFT_CATALOG_FORMAT } = await import('@/modules/knowledge/ui/KnowledgeDocumentsView')
    const asset = { id: 'asset-1', sha256: 'f'.repeat(64), name: 'ProductMaster.genesisrag17.json', mime: 'application/json' }
    const catalog = existingAssetAdmissionBody({ businessId: 'biz-test-01', asset, format: SMARTGIFT_CATALOG_FORMAT })
    expect(catalog.source).toEqual({ kind: 'FILE', fileAssetId: 'asset-1', format: 'SMARTGIFT_CATALOG_V1' })
    // No caller key or version: the server derives both from the frozen bytes.
    expect(catalog.source).not.toHaveProperty('sourceKey')
    expect(catalog.source).not.toHaveProperty('version')
    const plain = existingAssetAdmissionBody({ businessId: 'biz-test-01', asset: { ...asset, name: 'notes.md', mime: 'text/markdown' } })
    expect(plain.source).toEqual({ kind: 'FILE', fileAssetId: 'asset-1' })
    // A catalog admission and a plain admission of the same bytes never share an idempotency key.
    expect(catalog.idempotencyKey).not.toBe(plain.idempotencyKey)
  })

  it('offers JSON files as catalogs and keeps text files on the plain path', async () => {
    const { isCatalogAsset, isTextAsset } = await import('@/modules/knowledge/ui/KnowledgeDocumentsView')
    expect(isCatalogAsset({ name: 'BundleOffer.genesisrag17.json', mime: 'application/json' })).toBe(true)
    expect(isCatalogAsset({ name: 'upload.bin', mime: 'application/json' })).toBe(true)
    expect(isCatalogAsset({ name: 'notes.md', mime: 'text/markdown' })).toBe(false)
    expect(isTextAsset({ name: 'catalog.json', mime: 'application/json' })).toBe(false)
  })

  it('matches the format the admission API accepts', async () => {
    const { SMARTGIFT_CATALOG_FORMAT } = await import('@/modules/knowledge/ui/KnowledgeDocumentsView')
    const { KNOWLEDGE_ADMISSION_STRUCTURED_FORMATS } = await import('@/modules/knowledge/knowledge-admission-service')
    expect(KNOWLEDGE_ADMISSION_STRUCTURED_FORMATS).toContain(SMARTGIFT_CATALOG_FORMAT)
  })
})

describe('SmartGift catalog upload from the intake', () => {
  it('posts the file name and bytes only, and reports the admission counts', async () => {
    const { catalogUploadBody, catalogAdmissionMessage, catalogUploadMessage } = await import('@/modules/knowledge/ui/KnowledgeDocumentsView')
    expect(catalogUploadBody({ businessId: 'biz-test-01', fileName: 'BundleOffer.genesisrag17.json', contentBase64: 'W10=' }))
      .toEqual({ businessId: 'biz-test-01', projectId: null, name: 'BundleOffer.genesisrag17.json', contentBase64: 'W10=' })
    expect(catalogAdmissionMessage({ recordCount: 6, admittedCount: 6, unchangedCount: 0, deniedCount: 0 }))
      .toBe('SmartGift catalog: เข้าคิว 6/6 record · ไม่เปลี่ยน 0 · ถูกปฏิเสธ 0')
    expect(catalogUploadMessage({ fileName: 'products.json', knowledgeStatus: 'ADMITTED', admission: { recordCount: 1, admittedCount: 1, unchangedCount: 0, deniedCount: 0 } }))
      .toBe('products.json · SmartGift catalog: เข้าคิว 1/1 record · ไม่เปลี่ยน 0 · ถูกปฏิเสธ 0')
    expect(catalogUploadMessage({ fileName: 'products.json', knowledgeStatus: 'UNAVAILABLE', knowledgeCode: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' }))
      .toBe('products.json · บันทึกไฟล์ต้นฉบับแล้ว · Knowledge ยังไม่พร้อม (KNOWLEDGE_RUNTIME_UNAVAILABLE)')
  })

  it('offers the catalog upload as its own intake mode', () => {
    const source = readFileSync('src/modules/knowledge/ui/KnowledgeDocumentsView.jsx', 'utf8')
    expect(source).toContain('data-testid="mode-catalog"')
    expect(source).toContain("'/api/knowledge/catalog-files'")
    expect(source).toContain('accept=".json,application/json"')
  })
})
