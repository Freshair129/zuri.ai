// @req FR-005, FR-017 — the Create Task modal is an intake surface, so it
// builds a PlanEnvelope and travels dry run → preview → confirm → commit; it
// used to POST /api/workstreams and /api/work directly and attach a
// "standalone" task to whichever Project happened to be first in the Business
// (D3-pm-plan-intake-02). A standalone task now lands in the Business's inbox
// Project, named in the preview before the user confirms.
// @spec BR-004, BR-009, SDD-009, SDD-018
// @tested tests/unit/task-intake-modal.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import StandaloneTaskModal from '@/modules/project-manager/components/StandaloneTaskModal'
import { ScopeProvider } from '@/context/ScopeContext'
import { sampleInventory } from '../factories/scope-context'
import {
  allowedItemSubtypes,
  buildTaskEnvelope,
  generalWorkstreamFor,
  inboxProjectFor,
  inboxWorkstreamFor,
} from '@/modules/project-manager/import/task-envelope'
import { zPlanEnvelope, validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'
import { EXECUTION_MODE_CONTRACTS } from '@/lib/validation/enums'

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
      if (path === '/api/viewer') return { ...idle, data: { principal: { displayName: 'Local Owner' } } }
      if (path === '/api/projects?businessId=biz-1') {
        return {
          ...idle,
          data: {
            items: [
              { id: 'p-1', code: 'PRJ-A', name: 'Alpha Project', businessId: 'biz-1', workspaceId: 'ws-1', workspace: { code: 'WS-1', name: 'Alpha Space', scopeType: 'BUSINESS' } },
            ],
            limit: 200,
            truncated: false,
          },
        }
      }
      if (path.startsWith('/api/projects')) return { ...idle, data: { items: [], limit: 200, truncated: false } }
      return { ...idle, data: null, error: `unexpected request ${path}` }
    },
  }
})

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children, ...rest }) => createElement('a', { href: String(href ?? ''), ...rest }, children) }
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
const noop = () => {}
const business = { id: 'biz-1', code: 'BUS-1', name: 'Alpha Co', tenantId: 'ten-1' }
const task = (over = {}) => ({
  title: 'ส่งเอกสารสรุปยอดขาย',
  description: 'ภายในวันศุกร์',
  subtype: 'CHECKLIST_ITEM',
  status: 'PLANNED',
  weight: 2,
  createdBy: 'Local Owner',
  delegator: 'AI Agent',
  approver: 'คุณพรพร',
  ...over,
})

const valid = (plan) => {
  const parsed = zPlanEnvelope.safeParse(plan)
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  expect(validatePlanSemantics(plan)).toEqual([])
}

describe('the task envelope — standalone', () => {
  it('is a valid envelope that names the Business inbox Project and workstream', () => {
    const plan = buildTaskEnvelope({ business, task: task(), suffix: 'T1', generatedAt: '2026-09-03T00:00:00.000Z' })
    valid(plan)
    expect(plan.project).toEqual(inboxProjectFor(business))
    expect(plan.project.code).toBe('PRJ-BUS-1-INBOX')
    expect(plan.workstreams).toHaveLength(1)
    expect(plan.workstreams[0]).toMatchObject({ ...inboxWorkstreamFor(business), executionMode: 'OPERATIONS', progressStrategy: 'SLA_SCORE' })
    expect(plan.workstreams[0].code).toBe('WST-BUS-1-INBOX')
  })

  it('carries one item with the form\'s actors and marks it standalone', () => {
    const plan = buildTaskEnvelope({ business, task: task(), suffix: 'T1' })
    const [item] = plan.workstreams[0].items
    expect(item).toMatchObject({ title: 'ส่งเอกสารสรุปยอดขาย', subtype: 'CHECKLIST_ITEM', status: 'PLANNED', weight: 2 })
    expect(item.metadata).toEqual({
      description: 'ภายในวันศุกร์',
      createdBy: 'Local Owner',
      delegator: 'AI Agent',
      approver: 'คุณพรพร',
      isStandalone: true,
    })
    expect(item.code).toMatch(/^WI-.+-T1$/)
  })

  it('derives inbox codes from the Business code, so two Businesses never share one', () => {
    const other = { id: 'biz-2', code: 'BUS-2', name: 'Beta Co' }
    expect(inboxProjectFor(business).code).not.toBe(inboxProjectFor(other).code)
    expect(inboxWorkstreamFor(business).code).not.toBe(inboxWorkstreamFor(other).code)
  })

  it('names the Space by code only when the caller has one', () => {
    expect(buildTaskEnvelope({ business, task: task(), suffix: 'T1' })).not.toHaveProperty('scope')
    expect(buildTaskEnvelope({ business, task: task({ workspaceCode: 'WS-1' }), suffix: 'T1' }).scope).toEqual({ workspaceCode: 'WS-1' })
  })
})

describe('the task envelope — bound to a Project', () => {
  const project = { id: 'p-1', code: 'PRJ-A', name: 'Alpha Project', workspaceId: 'ws-1', workspace: { code: 'WS-1' } }
  const workstream = { id: 'w-1', code: 'WST-A-DEV', name: 'Dev', executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT', progressWeight: 2.5 }

  it('names the Project and workstream by code and carries their fields verbatim', () => {
    const plan = buildTaskEnvelope({ business, project, workstream, task: task({ subtype: 'TASK' }), suffix: 'T2' })
    valid(plan)
    expect(plan.project).toEqual({ code: 'PRJ-A', name: 'Alpha Project' })
    expect(plan.scope).toEqual({ workspaceCode: 'WS-1' })
    expect(plan.workstreams[0]).toMatchObject({ code: 'WST-A-DEV', name: 'Dev', executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT', progressWeight: 2.5 })
    expect(plan.workstreams[0].items[0].metadata.isStandalone).toBe(false)
  })

  it('never sends fields commit would treat as a change: no description, status or type on the Project', () => {
    const plan = buildTaskEnvelope({ business, project: { ...project, description: 'x', status: 'ACTIVE', type: 'GENERAL' }, workstream, task: task(), suffix: 'T2' })
    expect(Object.keys(plan.project).sort()).toEqual(['code', 'name'])
  })

  it('adds a general OPERATIONS workstream when the Project has none', () => {
    const plan = buildTaskEnvelope({ business, project, task: task(), suffix: 'T3' })
    valid(plan)
    expect(plan.workstreams[0]).toMatchObject(generalWorkstreamFor(project))
    expect(plan.workstreams[0].code).toBe('WST-PRJ-A-GENERAL')
  })
})

describe('the task envelope — mode contract and hygiene (BR-004)', () => {
  it('offers exactly the subtypes the target mode allows', () => {
    for (const [mode, contract] of Object.entries(EXECUTION_MODE_CONTRACTS)) {
      expect(allowedItemSubtypes(mode)).toEqual([...contract.itemSubtypes])
    }
    expect(allowedItemSubtypes('NOPE')).toEqual([])
  })

  it('falls back to the mode\'s first subtype rather than emit one the dry run would refuse', () => {
    const plan = buildTaskEnvelope({ business, task: task({ subtype: 'TASK' }), suffix: 'T4' })
    expect(plan.workstreams[0].items[0].subtype).toBe('CHECKLIST_ITEM')
    valid(plan)
  })

  it('keeps a subtype the mode does allow', () => {
    const plan = buildTaskEnvelope({ business, task: task({ subtype: 'ISSUE' }), suffix: 'T4' })
    expect(plan.workstreams[0].items[0].subtype).toBe('ISSUE')
  })

  it('requires a title, sanitises weight, and drops empty actors', () => {
    expect(() => buildTaskEnvelope({ business, task: task({ title: '  ' }) })).toThrow(/title/i)
    const plan = buildTaskEnvelope({ business, task: task({ weight: '-3', delegator: '  ', approver: '', description: '' }), suffix: 'T5' })
    const [item] = plan.workstreams[0].items
    expect(item.weight).toBe(1)
    expect(item.metadata).toEqual({ createdBy: 'Local Owner', isStandalone: true })
    valid(plan)
  })

  it('is deterministic for a fixed suffix, so a dry run and its commit describe the same codes', () => {
    const a = buildTaskEnvelope({ business, task: task(), suffix: 'FIXED', generatedAt: 'x' })
    const b = buildTaskEnvelope({ business, task: task(), suffix: 'FIXED', generatedAt: 'x' })
    expect(a).toEqual(b)
  })
})

describe('the Create Task modal (rendered inside a scoped provider)', () => {
  function render(props = {}, { inventory = sampleInventory(), selection = { businessId: 'biz-1' } } = {}) {
    h.fetched.length = 0
    const html = renderToStaticMarkup(
      createElement(ScopeProvider, { inventory, selection }, createElement(StandaloneTaskModal, { open: true, onClose: noop, ...props }))
    )
    return { html, fetched: h.fetched.filter(Boolean) }
  }
  const optionValues = (html, selectLabel) => {
    const start = html.indexOf(`aria-label="${selectLabel}"`)
    expect(start, `select ${selectLabel} not rendered`).toBeGreaterThan(-1)
    const end = html.indexOf('</select>', start)
    return [...html.slice(start, end).matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1])
  }

  it('offers only the subtypes the inbox workstream\'s mode allows when no Project is picked', () => {
    const { html } = render()
    expect(optionValues(html, 'ประเภท')).toEqual([...EXECUTION_MODE_CONTRACTS.OPERATIONS.itemSubtypes])
    expect(html).not.toContain('<option value="TASK"')
  })

  it('names the destination before anything is sent: the Business inbox for a standalone task', () => {
    const { html } = render()
    expect(html).toContain('PRJ-BUS-1-INBOX')
    expect(html).toContain('General Tasks &amp; Operations')
  })

  it('offers the dry run first; the confirm control does not exist before a preview', () => {
    const { html } = render()
    expect(html).toContain('ตรวจสอบ (Dry run)')
    expect(html).not.toContain('ยืนยันสร้าง Task')
    expect(html).not.toContain('สร้าง Task ทันที')
  })

  it('reads only the viewer and the Business-scoped project list until a Project is picked', () => {
    const { fetched } = render()
    expect(new Set(fetched)).toEqual(new Set(['/api/viewer', '/api/projects?businessId=biz-1']))
  })

  it('says so when the Business has no Space to land the task in, instead of guessing', () => {
    const inventory = sampleInventory()
    inventory.workspaces = inventory.workspaces.filter((w) => w.businessId !== 'biz-1')
    const { html } = render({}, { inventory })
    expect(html).toContain('ยังไม่มี Space')
  })

  it('fetches nothing while closed', () => {
    h.fetched.length = 0
    renderToStaticMarkup(createElement(ScopeProvider, { inventory: sampleInventory(), selection: { businessId: 'biz-1' } }, createElement(StandaloneTaskModal, { open: false, onClose: noop })))
    expect(h.fetched.filter(Boolean)).toEqual([])
  })
})

describe('source contract — the modal is an intake surface, not a write path', () => {
  const source = readFileSync(resolve(ROOT, 'src/modules/project-manager/components/StandaloneTaskModal.jsx'), 'utf8')

  it('never POSTs to the work or workstream routes', () => {
    expect(source).not.toMatch(/method:\s*'POST'/)
    expect(source).not.toContain("api('/api/work'")
    expect(source).not.toContain("api('/api/workstreams'")
  })

  it('builds the envelope with the shared builder and runs it through usePlanIntake with the shared preview', () => {
    expect(source).toContain("from '../import/task-envelope'")
    expect(source).toContain('buildTaskEnvelope({')
    expect(source).toContain('const intake = usePlanIntake()')
    expect(source).toContain('<PlanPreview dryRun={intake.dryRun} />')
    expect(source).toMatch(/\{intake\.dryRun && \(\s*<button[\s\S]*?onClick=\{confirm\}[\s\S]*?disabled=\{[^}]*!intake\.canConfirm\}/)
    expect(source).toContain('previewedKey.current !== formKey) intake.reset()')
  })

  it('sends the target Space explicitly on the dry run', () => {
    expect(source).toMatch(/intake\.preview\(plan, \{ workspaceId: targetWorkspace\.id \}\)/)
  })
})
