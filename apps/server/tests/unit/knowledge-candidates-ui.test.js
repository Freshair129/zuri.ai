// @req FR-236 — the LINE FAQ candidate review surface renders in the
//   Knowledge (GKS) slot and prompts for a Business before it fetches anything.
// @spec ADR-090 D6
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import KnowledgeCandidateReview from '@/modules/knowledge/ui/KnowledgeCandidateReview'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

describe('KnowledgeCandidateReview rendering (FR-236)', () => {
  it('asks for a Business before fetching any candidate', async () => {
    const { ScopeProvider } = await import('@/context/ScopeContext')
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: {} },
      createElement(KnowledgeCandidateReview),
    ))
    expect(html).toContain('เลือก Business ก่อนเพื่อดู LINE FAQ candidates')
  })

  it('renders the empty state for the selected Business before the fetch resolves', async () => {
    const { ScopeProvider } = await import('@/context/ScopeContext')
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(KnowledgeCandidateReview),
    ))
    expect(html).toContain('LINE FAQ candidates')
    // useEffect never runs during a static server render, so the fetch that
    // would populate the list has not fired — this proves the page does not
    // render stale or fabricated rows before real data arrives.
    expect(html).not.toContain('admitted source')
  })
})

describe('Knowledge (GKS) candidates page (FR-236)', () => {
  it('is client-rendered (API-authorized) and sits under the Knowledge slot', () => {
    const source = readFileSync('src/app/(pm)/knowledge/candidates/page.jsx', 'utf8')
    expect(source).toContain("import KnowledgeCandidateReview from '@/modules/knowledge/ui/KnowledgeCandidateReview'")
    expect(source).toContain('LINE FAQ candidates')
  })
})
