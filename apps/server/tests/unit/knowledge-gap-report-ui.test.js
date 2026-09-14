// @req FR-237 — the knowledge gap report surface renders in the Knowledge
//   (GKS) slot and prompts for a Business before it fetches anything.
// @spec ADR-090 D7
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import KnowledgeGapReport from '@/modules/knowledge/ui/KnowledgeGapReport'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('KnowledgeGapReport rendering (FR-237)', () => {
  it('asks for a Business before fetching anything', async () => {
    const { ScopeProvider } = await import('@/context/ScopeContext')
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: {} },
      createElement(KnowledgeGapReport),
    ))
    expect(html).toContain('เลือก Business ก่อนเพื่อดูรายงานช่องว่างความรู้')
  })

  it('renders the empty state for the selected Business before the fetch resolves, with no fabricated rows', async () => {
    const { ScopeProvider } = await import('@/context/ScopeContext')
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(KnowledgeGapReport),
    ))
    expect(html).toContain('ช่องว่างความรู้')
    expect(html).toContain('ยังไม่พบช่องว่างความรู้')
    // useEffect never runs during a static server render, so the fetch that
    // would populate gaps has not fired — a real gap row's own "พบ N ครั้ง"
    // count text never appears.
    expect(html).not.toContain('ครั้ง')
  })
})

describe('Knowledge (GKS) gap-report page (FR-237)', () => {
  it('is client-rendered and sits under the Knowledge slot, never showing question text by design', () => {
    const source = readFileSync('src/app/(pm)/knowledge/gap-report/page.jsx', 'utf8')
    expect(source).toContain("import KnowledgeGapReport from '@/modules/knowledge/ui/KnowledgeGapReport'")
    expect(source).toContain('ไม่มีข้อความคำถาม')
  })
})
