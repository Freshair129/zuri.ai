// @req FR-038, FR-106 — the /platform/users page renders both new owner
// surfaces from the fields the real ScopeProvider actually exposes, and the key
// panel it draws carries no secret.
// @spec SDD-017, SEC-006
// @tested tests/unit/platform-users-page-render.test.js
//
// The page component is rendered for real (react-dom/server — no DOM needed)
// inside the scoped-provider double, because the failure this guards against is
// invisible to a source-text assertion: a page reading a context field that
// does not exist renders its empty state forever while the source line still
// reads exactly as intended (D1-shell-domain-layers-01). The Business selector
// added here reads `shell.activeBusinessId` and `businesses`, so it is the same
// class of bug.
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import UsersPermissionsPage from '@/app/(pm)/platform/users/page'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

// esbuild's classic JSX runtime emits a bare React.createElement.
globalThis.React = React

const h = vi.hoisted(() => ({
  MEMBERSHIPS: [
    {
      id: 'mem-1', role: 'OWNER', domainKeys: ['projects'], manageable: true,
      person: { id: 'per-1', code: 'PER-1', displayName: 'เจ้าของ' },
      business: { id: 'biz-1', code: 'BUS-1', name: 'Alpha Co' },
    },
  ],
  KEYS: {
    tenants: [{ id: 'ten-1', code: 'TNT-1', name: 'Tenant One' }],
    keys: [
      { id: 'k-1', label: 'erp', tenantId: 'ten-1', keyPrefix: 'apik_ABCD1234', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z', revokedAt: null },
      { id: 'k-2', label: 'legacy', tenantId: 'ten-1', keyPrefix: 'apik_ZZZZ9999', status: 'REVOKED', createdAt: '2026-08-01T00:00:00.000Z', revokedAt: '2026-08-20T00:00:00.000Z' },
    ],
  },
  fetched: [],
}))

vi.mock('@/modules/project-manager/components/useApi', async () => {
  const { createElement: h2 } = await import('react')
  const idle = { loading: false, error: null, reload: () => {} }
  return {
    api: async () => null,
    LoadingCard: () => h2('div', { role: 'status' }, 'Loading…'),
    useFetch: (path) => {
      h.fetched.push(path)
      if (path === '/api/platform/users') return { ...idle, data: h.MEMBERSHIPS }
      if (path === '/api/platform/api-access-keys') return { ...idle, data: h.KEYS }
      return { ...idle, data: null, error: `unexpected request ${path}` }
    },
  }
})

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

function render({ selection = { businessId: 'biz-2' } } = {}) {
  h.fetched.length = 0
  const html = renderToStaticMarkup(
    createElement(ScopeProvider, { inventory: sampleInventory(), selection }, createElement(UsersPermissionsPage)),
  )
  return { html, fetched: [...h.fetched] }
}

describe('/platform/users renders both owner surfaces', () => {
  it('asks for the roster and the key listing, and nothing else', () => {
    expect(render().fetched).toEqual(['/api/platform/users', '/api/platform/api-access-keys'])
  })

  it('offers every visible Business, pre-selecting the one the shell has active', () => {
    const { html } = render({ selection: { businessId: 'biz-2' } })
    expect(html).toContain('เพิ่มสมาชิกเข้าธุรกิจ')
    expect(html).toContain('Alpha Co · BUS-1')
    expect(html).toContain('Beta Co · BUS-2')
    // The selected option is the active Business, not merely the first one —
    // this is the field a top-level `businessId` would have silently missed.
    expect(html).toMatch(/<option[^>]*selected[^>]*value="biz-2"|<option[^>]*value="biz-2"[^>]*selected/)
  })

  it('draws the key panel with the display prefix only, and no revoke on a revoked key', () => {
    const { html } = render()
    expect(html).toContain('apik_ABCD1234…')
    expect(html).toContain('เพิกถอน')
    expect(html).toContain('เพิกถอนแล้ว')
    expect(html).not.toContain('keyHash')
    // Nothing that could be a live secret: the mint response is the only place
    // a raw key exists, and no server round trip has happened here.
    expect(html).not.toMatch(/apik_[A-Za-z0-9_-]{20,}/)
  })

  it('still renders the existing roster it was grafted onto', () => {
    const { html } = render()
    expect(html).toContain('เจ้าของ')
    expect(html).toContain('Memberships')
    expect(html).toContain('Enterprise API keys')
  })
})
