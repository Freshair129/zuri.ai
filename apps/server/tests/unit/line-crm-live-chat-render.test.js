// @req FR-091 — the Live CRM inbox renders before any conversations arrive.
// @spec SDD-050
// @tested tests/unit/line-crm-live-chat-render.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import LineCrmLiveChat from '@/modules/line-crm/LineCrmLiveChat'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

const h = vi.hoisted(() => ({ inbox: null, requests: [] }))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

vi.mock('@/modules/project-manager/components/useApi', () => ({
  useFetch: (path) => {
    if (path) h.requests.push(path)
    return path ? h.inbox : { data: null, loading: false, error: null }
  },
}))

describe('Live CRM empty inbox rendering', () => {
  it.each([
    ['initial loading', { data: null, loading: true, error: null }],
    ['completed empty response', { data: { conversations: [] }, loading: false, error: null }],
  ])('renders the %s state with real icons', (_label, inbox) => {
    h.inbox = inbox
    const html = renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId: 'biz-1' } },
      createElement(LineCrmLiveChat),
    ))

    expect(html).toContain('ยังไม่มีข้อความแชทในฐานข้อมูล')
    expect(html).toContain('ยังไม่ได้เลือกห้องแชท')
    expect(html).toContain('lucide-message-square')
  })

  it.each(['biz-1', 'biz-2'])('loads conversations for selected Business %s', (businessId) => {
    h.inbox = { data: { conversations: [] }, loading: false, error: null }
    h.requests = []
    renderToStaticMarkup(createElement(
      ScopeProvider,
      { inventory: sampleInventory(), selection: { businessId } },
      createElement(LineCrmLiveChat),
    ))
    expect(h.requests).toEqual([`/api/crm/conversations?businessId=${businessId}`])
  })

  it('waits for a Business before requesting conversations', () => {
    h.inbox = { data: null, loading: false, error: null }
    h.requests = []
    renderToStaticMarkup(createElement(ScopeProvider, {}, createElement(LineCrmLiveChat)))
    expect(h.requests).toEqual([])
  })
})
