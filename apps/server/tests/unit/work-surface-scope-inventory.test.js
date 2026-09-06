// @req FR-005, FR-012, FR-017 — the /work surface and its three intake modals
// list Businesses and Spaces from the scope inventory the shell already loaded
// (ScopeContext ← GET /api/scope). They used to useFetch `/api/businesses` and
// `/api/workspaces`, neither of which exists (D3-pm-plan-intake-05), so the
// Business filter and every selector stayed empty. No second broad list
// endpoint is added: the shell's inventory is the one source, and the shell's
// active Business is the default choice.
// @spec SDD-018
// @tested tests/unit/work-surface-scope-inventory.test.js
//
// Rendered with react-dom/server inside a scoped provider, so what is asserted
// is the markup a viewer gets: which options exist, which one is selected, and
// which requests the surface makes.
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import AllWorkView from '@/modules/project-manager/views/universal/AllWorkView'
import PlanModeCustomizerModal from '@/modules/project-manager/components/PlanModeCustomizerModal'
import UploadPlanModal from '@/modules/project-manager/components/UploadPlanModal'
import StandaloneTaskModal from '@/modules/project-manager/components/StandaloneTaskModal'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'

globalThis.React = React

const h = vi.hoisted(() => ({ fetched: [] }))

vi.mock('@/modules/project-manager/components/useApi', async () => {
  const { createElement } = await import('react')
  const idle = { loading: false, error: null, reload: () => {} }
  return {
    api: async () => null,
    LoadingCard: () => createElement('div', { role: 'status' }, 'Loading…'),
    useFetch: (path) => {
      h.fetched.push(path)
      if (!path) return { ...idle, data: null }
      if (path.startsWith('/api/work?')) return { ...idle, data: { items: [], limit: 200, truncated: false } }
      // The project list route's real shape: `{ items }`, never a bare array.
      if (path === '/api/projects?businessId=biz-1') {
        return {
          ...idle,
          data: {
            items: [
              { id: 'p-1', code: 'PRJ-A', name: 'Alpha Project', businessId: 'biz-1', workspaceId: 'ws-1' },
              { id: 'p-9', code: 'PRJ-Z', name: 'Stray Project', businessId: 'biz-2', workspaceId: 'ws-2' },
            ],
            limit: 200,
            truncated: false,
          },
        }
      }
      if (path.startsWith('/api/projects')) return { ...idle, data: { items: [], limit: 200, truncated: false } }
      if (path === '/api/viewer') return { ...idle, data: { principal: { displayName: 'Local Owner' } } }
      return { ...idle, data: null, error: `unexpected request ${path}` }
    },
  }
})

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children, ...rest }) =>
      createElement('a', { href: typeof href === 'string' ? href : href?.pathname || '', ...rest }, children),
  }
})

vi.mock('next/navigation', () => ({
  usePathname: () => '/work',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const ROOT = process.cwd()
const DEAD_ROUTES = ['/api/businesses', '/api/workspaces']
const noop = () => {}

function render(element, { inventory = sampleInventory(), selection = { businessId: 'biz-1' } } = {}) {
  h.fetched.length = 0
  const html = renderToStaticMarkup(createElement(ScopeProvider, { inventory, selection }, element))
  return { html, fetched: h.fetched.filter(Boolean) }
}

const optionTag = (html, value) => html.match(new RegExp(`<option[^>]*value="${value}"[^>]*>`))?.[0] ?? null
const isSelected = (html, value) => /\bselected\b/.test(optionTag(html, value) || '')

describe('All Work — the Business filter comes from the shell inventory', () => {
  it('lists every visible Business as a filter tab, plus the all-businesses tab', () => {
    const { html, fetched } = render(createElement(AllWorkView))
    expect(html).toContain('ทุกธุรกิจ')
    expect(html).toContain('Alpha Co')
    expect(html).toContain('Beta Co')
    for (const dead of DEAD_ROUTES) expect(fetched).not.toContain(dead)
    for (const path of fetched) expect(path.startsWith('/api/work?')).toBe(true)
  })

  it('drops the tabs in project scope, where the project already fixes the Business', () => {
    const { html } = render(createElement(AllWorkView, { projectId: 'p-1' }))
    expect(html).not.toContain('ทุกธุรกิจ')
    expect(html).not.toContain('Alpha Co')
  })

  it('shows no tabs when the shell holds no Business at all', () => {
    const { html } = render(createElement(AllWorkView), { inventory: { businesses: [] }, selection: {} })
    expect(html).not.toContain('ทุกธุรกิจ')
  })
})

describe('Plan Mode Customizer — Business and Space come from the shell inventory', () => {
  it('offers every visible Business and preselects the one the shell has active', () => {
    const { html, fetched } = render(createElement(PlanModeCustomizerModal, { open: true, onClose: noop }))
    expect(optionTag(html, 'biz-1')).not.toBeNull()
    expect(optionTag(html, 'biz-2')).not.toBeNull()
    expect(isSelected(html, 'biz-1')).toBe(true)
    expect(isSelected(html, 'biz-2')).toBe(false)
    for (const dead of DEAD_ROUTES) expect(fetched).not.toContain(dead)
  })

  it('offers only the Spaces visible inside the chosen Business — its own plus group-level', () => {
    const { html } = render(createElement(PlanModeCustomizerModal, { open: true, onClose: noop }))
    expect(optionTag(html, 'ws-1')).not.toBeNull()
    expect(optionTag(html, 'ws-g')).not.toBeNull()
    expect(optionTag(html, 'ws-2')).toBeNull()
  })

  it('follows the shell pick: a different active Business changes both lists', () => {
    const { html } = render(createElement(PlanModeCustomizerModal, { open: true, onClose: noop }), { selection: { businessId: 'biz-2' } })
    expect(isSelected(html, 'biz-2')).toBe(true)
    expect(optionTag(html, 'ws-2')).not.toBeNull()
    expect(optionTag(html, 'ws-1')).toBeNull()
  })

  it('offers the dry run first; the confirm control does not exist before a preview', () => {
    const { html } = render(createElement(PlanModeCustomizerModal, { open: true, onClose: noop }))
    expect(html).toContain('ตรวจสอบแผน (Dry run)')
    expect(html).not.toContain('ยืนยันสร้าง Execution Plan')
  })

  it('fetches nothing while closed', () => {
    const { html, fetched } = render(createElement(PlanModeCustomizerModal, { open: false, onClose: noop }))
    expect(html).toBe('')
    expect(fetched).toEqual([])
  })
})

describe('Upload Plan — the target Space list is the shell\'s scoped inventory', () => {
  it('offers the Spaces in scope for the active Business and nothing from another Business', () => {
    const { html, fetched } = render(createElement(UploadPlanModal, { open: true, onClose: noop }))
    expect(optionTag(html, 'ws-1')).not.toBeNull()
    expect(optionTag(html, 'ws-g')).not.toBeNull()
    expect(optionTag(html, 'ws-2')).toBeNull()
    expect(isSelected(html, 'ws-1')).toBe(true)
    for (const dead of DEAD_ROUTES) expect(fetched).not.toContain(dead)
  })

  it('preselects the Space the shell has selected when it is in scope', () => {
    const { html } = render(createElement(UploadPlanModal, { open: true, onClose: noop }), { selection: { businessId: 'biz-1', workspaceId: 'ws-g' } })
    expect(isSelected(html, 'ws-g')).toBe(true)
    expect(isSelected(html, 'ws-1')).toBe(false)
  })

  it('accepts both formats its label promises and offers the dry run before any confirm', () => {
    const { html } = render(createElement(UploadPlanModal, { open: true, onClose: noop }))
    expect(html).toContain('accept=".json,.xlsx"')
    expect(html).toContain('ตรวจสอบแผน (Dry run)')
    expect(html).not.toContain('ยืนยันนำเข้าแผนงาน')
  })
})

describe('Create Task — the Business scope comes from the shell inventory', () => {
  it('offers every visible Business, preselects the active one, and reads only routes that exist', () => {
    const { html, fetched } = render(createElement(StandaloneTaskModal, { open: true, onClose: noop }))
    expect(optionTag(html, 'biz-1')).not.toBeNull()
    expect(optionTag(html, 'biz-2')).not.toBeNull()
    expect(isSelected(html, 'biz-1')).toBe(true)
    expect(new Set(fetched)).toEqual(new Set(['/api/projects?businessId=biz-1', '/api/viewer']))
  })

  it('asks the project list for the chosen Business and reads its `items` shape', () => {
    // Unscoped, the route answers 403 and the picker stayed empty on every
    // open; and the route returns { items }, which `(projects || []).filter`
    // could never read.
    const { html } = render(createElement(StandaloneTaskModal, { open: true, onClose: noop }))
    expect(optionTag(html, 'p-1')).not.toBeNull()
    expect(html).toContain('Alpha Project (PRJ-A)')
    expect(optionTag(html, 'p-9')).toBeNull()
  })

  it('follows the shell pick when another Business is active', () => {
    const { fetched } = render(createElement(StandaloneTaskModal, { open: true, onClose: noop }), { selection: { businessId: 'biz-2' } })
    expect(fetched).toContain('/api/projects?businessId=biz-2')
  })

  it('fetches nothing while closed', () => {
    const { fetched } = render(createElement(StandaloneTaskModal, { open: false, onClose: noop }))
    expect(fetched).toEqual([])
  })
})

describe('source contract — no caller names the dead list endpoints', () => {
  const FILES = [
    'src/modules/project-manager/components/PlanModeCustomizerModal.jsx',
    'src/modules/project-manager/components/UploadPlanModal.jsx',
    'src/modules/project-manager/components/StandaloneTaskModal.jsx',
    'src/modules/project-manager/views/universal/AllWorkView.jsx',
  ]
  for (const file of FILES) {
    it(`${file} reads the shell scope instead`, () => {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      expect(source).not.toContain("'/api/businesses'")
      expect(source).not.toContain("'/api/workspaces'")
      expect(source).toContain("import { useScope } from '@/context/ScopeContext'")
      expect(source).toContain('const scope = useScope()')
    })
  }
})
