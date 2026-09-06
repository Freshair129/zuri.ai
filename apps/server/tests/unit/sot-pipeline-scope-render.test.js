// @req FR-099, FR-100, FR-101 — the three SoT Pipeline pages fetch for the
// Business the shell has active. They must read `shell.activeBusinessId`, the
// one field ScopeContext exposes for it: a top-level `businessId` never
// existed, so every fetch ran with `undefined` and all three pages sat on
// their "choose a Business" state forever, whether or not a Business was
// chosen (D1-shell-domain-layers-01 — FEAT-011 did not work in any browser).
// @spec SDD-018
// @tested tests/unit/sot-pipeline-scope-render.test.js
//
// These render the real page components (react-dom/server — no DOM needed)
// inside a scoped provider and read the URL each page hands to useFetch: the
// request the browser would make. A source-text assertion could not see this
// bug, because the broken line was exactly the text it expected to find.
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import SotPipelineBoardPage from '@/app/(pm)/platform/sot-pipeline/page'
import SotInboxPage from '@/app/(pm)/platform/sot-pipeline/inbox/page'
import SotPipelineGraphPage from '@/app/(pm)/platform/sot-pipeline/graph/page'
import { ScopeProvider } from '@/context/ScopeContext'
import { buildScopeValue, sampleInventory } from '../factories/scope-context'

// esbuild's classic JSX runtime emits a bare React.createElement — see
// tests/unit/global-view-drilldown.test.js for why this is set here.
globalThis.React = React

const h = vi.hoisted(() => {
  const PLAN = {
    planId: 'SOT-PIPELINE-PLAN',
    version: '1.0.0',
    titleTh: 'แผน SoT ทดสอบ',
    tenantId: 'ten-1',
    businessId: 'biz-1',
    phases: [
      {
        phaseId: 'P0', title: 'Ingest', titleTh: 'นำเข้าข้อมูลต้นทาง', summaryTh: 'ดึงจากแหล่งข้อมูล',
        kind: 'AUTOMATED', status: 'done', pendingDecisions: 0, dependsOn: [], pipelineDefinitionIds: ['DPL-A'],
        runs: [{ dataPipelineDefinitionId: 'DPL-A', executionRunId: 'run-0001', status: 'SUCCEEDED', finishedAt: null }],
      },
      {
        phaseId: 'P1', title: 'Gate', titleTh: 'ประตูอนุมัติราคา', summaryTh: 'รอคนตัดสิน',
        kind: 'HUMAN_GATE', status: 'blocked', pendingDecisions: 2, dependsOn: ['P0'], pipelineDefinitionIds: [], runs: [],
      },
    ],
    graph: {
      version: 1,
      nodes: [
        { id: 'src-x', type: 'source', title: 'แหล่ง X', status: 'context', depth: 0, pendingDecisions: 0 },
        { id: 'P0', type: 'phase', title: 'นำเข้าข้อมูลต้นทาง', status: 'done', depth: 1, pendingDecisions: 0 },
        { id: 'P1', type: 'human-gate', title: 'ประตูอนุมัติราคา', status: 'blocked', depth: 2, pendingDecisions: 2 },
      ],
      edges: [
        { id: 'e1', source: 'src-x', target: 'P0' },
        { id: 'e2', source: 'P0', target: 'P1' },
      ],
    },
  }
  const DECISIONS = {
    decisions: [
      {
        id: 'dec-1', subjectRef: 'SKU-0001', decisionType: 'PRICE_ROW', phaseId: 'P1',
        decisionVersion: 1, submittedBy: 'sot-agent', payload: { price: 120 },
      },
    ],
  }
  return { fetched: [], PLAN, DECISIONS }
})

vi.mock('@/modules/project-manager/components/useApi', async () => {
  const { createElement } = await import('react')
  const idle = { loading: false, error: null, reload: () => {} }
  return {
    api: async () => null,
    LoadingCard: () => createElement('div', { role: 'status' }, 'Loading…'),
    // The seam under test: the path a page hands here is the request it makes.
    useFetch: (path) => {
      h.fetched.push(path)
      if (!path) return { ...idle, data: null }
      if (path.includes('businessId=biz-boom')) {
        return { ...idle, data: null, error: 'SoT plan is outside your visible Business scope' }
      }
      if (path.startsWith('/api/platform/sot/plan?')) return { ...idle, data: h.PLAN }
      if (path.startsWith('/api/platform/sot/decisions?')) return { ...idle, data: h.DECISIONS }
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
  usePathname: () => '/platform/sot-pipeline',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {} }),
}))

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const ROOT = process.cwd()
const PAGES = [
  'src/app/(pm)/platform/sot-pipeline/page.jsx',
  'src/app/(pm)/platform/sot-pipeline/inbox/page.jsx',
  'src/app/(pm)/platform/sot-pipeline/graph/page.jsx',
]
const ALL_PAGES = [SotPipelineBoardPage, SotInboxPage, SotPipelineGraphPage]
const PLAN_URL = '/api/platform/sot/plan?businessId=biz-1'

function render(Page, { inventory = sampleInventory(), selection = {} } = {}) {
  h.fetched.length = 0
  const html = renderToStaticMarkup(
    createElement(ScopeProvider, { inventory, selection }, createElement(Page))
  )
  return { html, fetched: [...h.fetched] }
}

describe('SoT Pipeline pages fetch for the Business the shell has active', () => {
  it('board: requests the plan for shell.activeBusinessId and renders it', () => {
    const { html, fetched } = render(SotPipelineBoardPage, { selection: { businessId: 'biz-1' } })
    expect(fetched).toEqual([PLAN_URL])
    expect(html).toContain('แผน SoT ทดสอบ')
    expect(html).toContain('นำเข้าข้อมูลต้นทาง')
    expect(html).toContain('run-0001')
    expect(html).toContain('/platform/sot-pipeline/inbox?phaseId=P1')
    expect(html).not.toContain('เลือก Business ก่อน')
  })

  it('inbox: requests the plan, then the PENDING decisions scoped by tenant and business', () => {
    const { html, fetched } = render(SotInboxPage, { selection: { businessId: 'biz-1' } })
    expect(fetched).toContain(PLAN_URL)
    expect(fetched).toContain('/api/platform/sot/decisions?tenantId=ten-1&businessId=biz-1&status=PENDING')
    expect(html).toContain('SKU-0001')
    expect(html).not.toContain('เลือก Business ก่อน')
  })

  it('graph: requests the plan and draws the projected nodes', () => {
    const { html, fetched } = render(SotPipelineGraphPage, { selection: { businessId: 'biz-1' } })
    expect(fetched).toEqual([PLAN_URL])
    expect(html).toContain('<svg')
    expect(html).toContain('ประตูอนุมัติราคา')
    expect(html).toContain('รออนุมัติ 2')
    expect(html).not.toContain('เลือก Business ก่อน')
  })

  it('follows the shell rule: a single-business install is scoped without any saved pick', () => {
    const inventory = sampleInventory()
    inventory.businesses = [inventory.businesses[0]]
    for (const Page of ALL_PAGES) {
      const { fetched } = render(Page, { inventory, selection: {} })
      expect(fetched).toContain(PLAN_URL)
    }
  })

  it('follows the shell rule: the pick decides which Business is requested', () => {
    const { fetched } = render(SotPipelineBoardPage, { selection: { businessId: 'biz-2' } })
    expect(fetched).toEqual(['/api/platform/sot/plan?businessId=biz-2'])
  })

  it('multi-business with no pick: nothing is requested and the guidance names the missing choice', () => {
    for (const Page of ALL_PAGES) {
      const { html, fetched } = render(Page, { selection: {} })
      expect(fetched.filter(Boolean)).toEqual([])
      expect(html).toContain('เลือก Business ก่อน')
    }
  })

  it('never builds a request around an undefined Business', () => {
    for (const Page of ALL_PAGES) {
      const { fetched } = render(Page, { selection: {} })
      for (const path of fetched) expect(String(path)).not.toContain('undefined')
    }
  })

  it('a fetch error reaches the reader as text, not as a bare "Something went wrong"', () => {
    const inventory = sampleInventory()
    inventory.businesses.push({ id: 'biz-boom', code: 'BUS-BOOM', name: 'Boom Co', tenantId: 'ten-1' })
    for (const Page of ALL_PAGES) {
      const { html } = render(Page, { inventory, selection: { businessId: 'biz-boom' } })
      expect(html).toContain('SoT plan is outside your visible Business scope')
    }
  })
})

describe('the provider contract these pages depend on', () => {
  it('the real ScopeProvider exposes shell.activeBusinessId and no top-level businessId', async () => {
    const real = await vi.importActual('@/context/ScopeContext')
    let seen = null
    function Probe() {
      seen = real.useScope()
      return null
    }
    renderToStaticMarkup(createElement(real.ScopeProvider, null, createElement(Probe)))
    expect(seen).not.toBeNull()
    expect(Object.hasOwn(seen, 'businessId')).toBe(false)
    expect(seen.shell).toHaveProperty('activeBusinessId')
  })

  it('the scoped double used above exposes no key the real provider does not', async () => {
    const real = await vi.importActual('@/context/ScopeContext')
    let seen = null
    function Probe() {
      seen = real.useScope()
      return null
    }
    renderToStaticMarkup(createElement(real.ScopeProvider, null, createElement(Probe)))
    const double = buildScopeValue({ inventory: sampleInventory(), selection: { businessId: 'biz-1' } })
    for (const key of Object.keys(double)) expect(seen).toHaveProperty(key)
    expect(Object.hasOwn(double, 'businessId')).toBe(false)
    expect(double.shell.activeBusinessId).toBe('biz-1')
  })

  it('none of the three pages destructures a businessId the provider never exposes', () => {
    for (const file of PAGES) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      expect(source).not.toMatch(/const\s*\{[^}]*\bbusinessId\b[^}]*\}\s*=\s*useScope\(\)/)
      expect(source).toContain('shell.activeBusinessId')
    }
  })
})
