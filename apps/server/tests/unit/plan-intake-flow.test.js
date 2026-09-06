// @req FR-012, FR-017, FR-018 — the two /work plan modals POSTed to an
// import/plan route that never existed (D3-pm-plan-intake-01): every
// submission failed, and no dry run or preview happened before it. They now
// travel the canonical pipeline — POST /api/import/dry-run, a human confirms
// the preview, POST /api/import/commit with the very envelope previewed — and
// the Plan Mode form is serialized by the shared builder into an envelope the
// strict schema accepts.
// @spec BR-009, SDD-009, BR-003
// @tested tests/unit/plan-intake-flow.test.js
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IDLE_PLAN_INTAKE,
  PLAN_COMMIT_PATH,
  PLAN_DRY_RUN_PATH,
  canConfirmPlan,
  createPlanIntake,
  importTarget,
  readDryRun,
  requestPlanCommit,
  requestPlanDryRun,
} from '@/modules/project-manager/components/usePlanIntake'
import { buildPlanModeEnvelope } from '@/modules/project-manager/import/plan-mode-envelope'
import { zPlanEnvelope, validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'
import { EXECUTION_MODE_CONTRACTS, MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'

const ROOT = process.cwd()
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8')

const PLAN = { schemaVersion: '1.0', project: { code: 'PRJ-X', name: 'X' }, workstreams: [] }
const VALID_DRY_RUN = {
  valid: true,
  errors: [],
  workspace: { id: 'ws-1', code: 'WS-1', name: 'Alpha Space' },
  preview: { inserts: [{ kind: 'project', code: 'PRJ-X', title: 'X' }], updates: [], conflicts: [], dependencyCount: 0 },
}
const CONFLICT_DRY_RUN = {
  valid: false,
  errors: ['Conflict: "PRJ-X" exists in another workspace'],
  preview: { inserts: [], updates: [], conflicts: [{ kind: 'project', code: 'PRJ-X', reason: 'exists elsewhere' }], dependencyCount: 0 },
}
const INVALID_DRY_RUN = { valid: false, errors: ['workstreams: Required'], preview: null }
const RECEIPT = { committed: true, projectId: 'p-1', projectCode: 'PRJ-X' }

function fakeServer({ dryRun = VALID_DRY_RUN, commit = RECEIPT } = {}) {
  const calls = []
  const request = async (path, init) => {
    calls.push({ path, method: init?.method, body: structuredClone(init?.body ?? null) })
    if (path === PLAN_DRY_RUN_PATH) return typeof dryRun === 'function' ? dryRun(init.body) : dryRun
    if (path === PLAN_COMMIT_PATH) return typeof commit === 'function' ? commit(init.body) : commit
    throw new Error(`Request failed (404): ${path}`)
  }
  return { calls, request }
}

describe('the two legs of the pipeline as the modals call them', () => {
  it('dry run: POST /api/import/dry-run with the envelope under `plan` and the target beside it', async () => {
    const { calls, request } = fakeServer()
    await requestPlanDryRun(PLAN, { workspaceId: 'ws-1' }, { request })
    expect(calls).toEqual([{ path: PLAN_DRY_RUN_PATH, method: 'POST', body: { plan: PLAN, workspaceId: 'ws-1' } }])
  })

  it('commit: POST /api/import/commit with the same body shape', async () => {
    const { calls, request } = fakeServer()
    await requestPlanCommit(PLAN, { projectId: 'p-9' }, { request })
    expect(calls).toEqual([{ path: PLAN_COMMIT_PATH, method: 'POST', body: { plan: PLAN, projectId: 'p-9' } }])
  })

  it('never sends the keys the dead route was given (`envelope`, `dryRun: false`)', async () => {
    const { calls, request } = fakeServer()
    await requestPlanDryRun(PLAN, { workspaceId: 'ws-1' }, { request })
    await requestPlanCommit(PLAN, { workspaceId: 'ws-1' }, { request })
    for (const call of calls) {
      expect(call.body).not.toHaveProperty('envelope')
      expect(call.body).not.toHaveProperty('dryRun')
    }
  })

  it('sends only a defined target, so an undefined workspaceId never shadows a projectId', () => {
    expect(importTarget({ workspaceId: undefined, projectId: 'p-1' })).toEqual({ projectId: 'p-1' })
    expect(importTarget({ workspaceId: '', projectId: '' })).toEqual({})
    expect(importTarget()).toEqual({})
  })

  it('reads a dry-run result the way the project import panel does', () => {
    expect(readDryRun(VALID_DRY_RUN)).toEqual({ dryRun: VALID_DRY_RUN, errors: null })
    expect(readDryRun(CONFLICT_DRY_RUN)).toEqual({ dryRun: CONFLICT_DRY_RUN, errors: CONFLICT_DRY_RUN.errors })
    expect(readDryRun(INVALID_DRY_RUN)).toEqual({ dryRun: null, errors: INVALID_DRY_RUN.errors })
    expect(readDryRun(null).dryRun).toBeNull()
    expect(readDryRun({ valid: false }).errors).toHaveLength(1)
  })

  it('only a valid preview can be confirmed', () => {
    expect(canConfirmPlan(VALID_DRY_RUN)).toBe(true)
    expect(canConfirmPlan(CONFLICT_DRY_RUN)).toBe(false)
    expect(canConfirmPlan(INVALID_DRY_RUN)).toBe(false)
    expect(canConfirmPlan(null)).toBe(false)
    expect(canConfirmPlan({ valid: true, preview: null })).toBe(false)
  })
})

describe('preview-then-confirm (BR-009 / SDD-009)', () => {
  it('previews first, commits second, and commits exactly the envelope it previewed', async () => {
    const { calls, request } = fakeServer()
    const intake = createPlanIntake({ request })

    const previewed = await intake.preview(PLAN, { workspaceId: 'ws-1' })
    expect(previewed).toMatchObject({ dryRun: VALID_DRY_RUN, errors: null, committed: null, busy: false })
    expect(canConfirmPlan(previewed.dryRun)).toBe(true)

    const confirmed = await intake.confirm()
    expect(confirmed.committed).toEqual(RECEIPT)
    expect(confirmed.errors).toBeNull()
    expect(confirmed.dryRun).toBeNull()

    expect(calls.map((c) => c.path)).toEqual([PLAN_DRY_RUN_PATH, PLAN_COMMIT_PATH])
    expect(calls[1].body).toEqual(calls[0].body)
    expect(calls[1].body).toEqual({ plan: PLAN, workspaceId: 'ws-1' })
  })

  it('refuses to commit before any preview — no request is made', async () => {
    const { calls, request } = fakeServer()
    const intake = createPlanIntake({ request })
    const state = await intake.confirm()
    expect(calls).toEqual([])
    expect(state.committed).toBeNull()
    expect(state.errors.join(' ')).toMatch(/dry run/i)
  })

  it('a plan that fails validation has no preview and cannot be confirmed', async () => {
    const { calls, request } = fakeServer({ dryRun: INVALID_DRY_RUN })
    const intake = createPlanIntake({ request })
    const state = await intake.preview(PLAN, { workspaceId: 'ws-1' })
    expect(state.dryRun).toBeNull()
    expect(state.errors).toEqual(INVALID_DRY_RUN.errors)
    await intake.confirm()
    expect(calls.map((c) => c.path)).toEqual([PLAN_DRY_RUN_PATH])
  })

  it('a preview with conflicts is shown but cannot be confirmed', async () => {
    const { calls, request } = fakeServer({ dryRun: CONFLICT_DRY_RUN })
    const intake = createPlanIntake({ request })
    const state = await intake.preview(PLAN, { workspaceId: 'ws-1' })
    expect(state.dryRun).toEqual(CONFLICT_DRY_RUN)
    expect(state.errors).toEqual(CONFLICT_DRY_RUN.errors)
    expect(canConfirmPlan(state.dryRun)).toBe(false)
    const refused = await intake.confirm()
    expect(refused.committed).toBeNull()
    expect(calls.map((c) => c.path)).toEqual([PLAN_DRY_RUN_PATH])
  })

  it('a commit the server refuses surfaces its errors and stays uncommitted', async () => {
    const { request } = fakeServer({ commit: { committed: false, errors: ['Workspace changed under you'] } })
    const intake = createPlanIntake({ request })
    await intake.preview(PLAN, { workspaceId: 'ws-1' })
    const state = await intake.confirm()
    expect(state.committed).toBeNull()
    expect(state.errors).toEqual(['Workspace changed under you'])
  })

  it('a transport failure on either leg becomes an error message, never a throw into the form', async () => {
    const boom = async () => {
      throw new Error('Request failed (401)')
    }
    const previewFailed = await createPlanIntake({ request: boom }).preview(PLAN, {})
    expect(previewFailed.errors).toEqual(['Request failed (401)'])
    expect(previewFailed.busy).toBe(false)

    const { request } = fakeServer({ commit: () => Promise.reject(new Error('Request failed (409)')) })
    const intake = createPlanIntake({ request })
    await intake.preview(PLAN, { workspaceId: 'ws-1' })
    const state = await intake.confirm()
    expect(state.errors).toEqual(['Request failed (409)'])
    expect(state.committed).toBeNull()
  })

  it('adopts the dry run the Excel leg returns and commits that envelope through the same commit leg', async () => {
    const { calls, request } = fakeServer()
    const intake = createPlanIntake({ request })
    const converted = { ...PLAN, project: { code: 'PRJ-XLSX', name: 'From workbook' } }
    intake.adopt(converted, { workspaceId: 'ws-1' }, { ...VALID_DRY_RUN, envelope: converted })
    const state = await intake.confirm()
    expect(state.committed).toEqual(RECEIPT)
    expect(calls.map((c) => c.path)).toEqual([PLAN_COMMIT_PATH])
    expect(calls[0].body).toEqual({ plan: converted, workspaceId: 'ws-1' })
  })

  it('reset returns to idle and forgets the previewed envelope', async () => {
    const { calls, request } = fakeServer()
    const intake = createPlanIntake({ request })
    await intake.preview(PLAN, { workspaceId: 'ws-1' })
    expect(intake.reset()).toEqual(IDLE_PLAN_INTAKE)
    await intake.confirm()
    expect(calls.map((c) => c.path)).toEqual([PLAN_DRY_RUN_PATH])
  })

  it('reports every transition to onChange, busy while a leg is in flight', async () => {
    const { request } = fakeServer()
    const seen = []
    const intake = createPlanIntake({ request, onChange: (s) => seen.push({ busy: s.busy, dryRun: Boolean(s.dryRun), committed: Boolean(s.committed) }) })
    await intake.preview(PLAN, { workspaceId: 'ws-1' })
    await intake.confirm()
    expect(seen).toEqual([
      { busy: true, dryRun: false, committed: false },
      { busy: false, dryRun: true, committed: false },
      { busy: true, dryRun: true, committed: false },
      { busy: false, dryRun: false, committed: true },
    ])
  })
})

describe('the Plan Mode Customizer envelope', () => {
  const input = () => ({
    objective: 'ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020',
    description: 'สกัดข้อมูลคำสั่งซื้อย้อนหลัง',
    workspaceCode: 'WS-1',
    delegator: 'AI Planning Agent',
    approver: 'คุณสมชาย',
    suffix: 'PM001',
    generatedAt: '2026-09-02T00:00:00.000Z',
    streams: [
      { name: 'Data Extraction & Audit 2020', mode: 'DATA_MIGRATION', itemsText: 'สกัดประวัติการสั่งซื้อ\nตรวจสอบยอดชำระ' },
      { name: 'Monthly Inventory Audit', mode: 'OPERATIONS', itemsText: 'พิมพ์รายงานสต็อก' },
    ],
  })

  it('is a valid, semantically clean PlanEnvelope — the old hand-rolled one was not', () => {
    const plan = buildPlanModeEnvelope(input())
    const parsed = zPlanEnvelope.safeParse(plan)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(validatePlanSemantics(plan)).toEqual([])
    // The strict schema has no top-level metadata block.
    expect(plan).not.toHaveProperty('metadata')
  })

  it('binds Delegator and Approver where the schema carries them: generatedBy and item metadata', () => {
    const plan = buildPlanModeEnvelope(input())
    expect(plan.generatedBy).toBe('AI Planning Agent')
    const items = plan.workstreams.flatMap((ws) => ws.items)
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.metadata).toEqual({ delegator: 'AI Planning Agent', approver: 'คุณสมชาย' })
    }
  })

  it('takes progressStrategy and item subtype from each mode contract, never a guess', () => {
    const plan = buildPlanModeEnvelope(input())
    for (const ws of plan.workstreams) {
      expect(ws.progressStrategy).toBe(MODE_DEFAULT_STRATEGY[ws.executionMode])
      for (const item of ws.items) {
        expect(EXECUTION_MODE_CONTRACTS[ws.executionMode].itemSubtypes).toContain(item.subtype)
      }
    }
  })

  it('targets the chosen Space by code and keeps the builder defaults otherwise', () => {
    const plan = buildPlanModeEnvelope(input())
    expect(plan.scope).toEqual({ workspaceCode: 'WS-1' })
    expect(plan.project).toMatchObject({ name: 'ดึงรายชื่อลูกค้าที่เคยซื้อสินค้าช่วงปี 2020', status: 'PLANNED' })
    expect(plan.generatedAt).toBe('2026-09-02T00:00:00.000Z')
  })

  it('leaves items untouched and generatedBy at the builder default when no actors are given', () => {
    const plan = buildPlanModeEnvelope({ ...input(), delegator: '  ', approver: '' })
    expect(plan.generatedBy).not.toBe('  ')
    for (const item of plan.workstreams.flatMap((ws) => ws.items)) expect(item).not.toHaveProperty('metadata')
    expect(zPlanEnvelope.safeParse(plan).success).toBe(true)
  })
})

describe('the modals are wired to the pipeline, not to a route that does not exist', () => {
  const planMode = read('src/modules/project-manager/components/PlanModeCustomizerModal.jsx')
  const upload = read('src/modules/project-manager/components/UploadPlanModal.jsx')

  it('neither modal names the dead route', () => {
    for (const source of [planMode, upload]) {
      expect(source).not.toContain("'/api/import/plan'")
      expect(source).not.toMatch(/api\/import\/plan['"`]/)
      expect(source).not.toContain('dryRun: false')
    }
  })

  it('both go through usePlanIntake and show the shared preview before the confirm control exists', () => {
    for (const source of [planMode, upload]) {
      expect(source).toContain("from './usePlanIntake'")
      expect(source).toContain('const intake = usePlanIntake()')
      expect(source).toContain('<PlanPreview dryRun={intake.dryRun} />')
      // The confirm button is rendered only once a dry run exists, and is
      // disabled unless that dry run is valid.
      expect(source).toMatch(/\{intake\.dryRun && \(\s*<button[\s\S]*?onClick=\{confirm\}[\s\S]*?disabled=\{[^}]*!intake\.canConfirm\}/)
      // Editing after a preview discards it: confirm commits what was seen.
      expect(source).toContain('previewedKey.current !== formKey) intake.reset()')
    }
  })

  it('the Plan Mode form is serialized by the shared builder, not a hand-rolled envelope', () => {
    expect(planMode).toContain("from '../import/plan-mode-envelope'")
    expect(planMode).toContain('buildPlanModeEnvelope({')
    expect(planMode).not.toContain("schemaVersion: '1.0'")
  })

  it('the Upload modal honours its own label: Excel goes through the FR-018 converter, then the same commit leg', () => {
    expect(upload).toContain('accept=".json,.xlsx"')
    expect(upload).toContain("export const XLSX_INTAKE_PATH = '/api/import/xlsx'")
    expect(upload).toContain('intake.adopt(result.envelope || null')
  })
})

describe('every API path these client files name is a route that exists', () => {
  // The defect class behind D3-pm-plan-intake-01/-05: a mounted component
  // fetching a path with no route.js behind it. Static literals only; a
  // `${…}` segment matches any `[param]` directory.
  const CLIENT_FILES = [
    'src/modules/project-manager/components/PlanModeCustomizerModal.jsx',
    'src/modules/project-manager/components/UploadPlanModal.jsx',
    'src/modules/project-manager/components/StandaloneTaskModal.jsx',
    'src/modules/project-manager/components/usePlanIntake.js',
    'src/modules/project-manager/views/universal/AllWorkView.jsx',
    'src/app/(pm)/platform/sot-pipeline/page.jsx',
    'src/app/(pm)/platform/sot-pipeline/inbox/page.jsx',
    'src/app/(pm)/platform/sot-pipeline/graph/page.jsx',
  ]
  const API_ROOT = resolve(ROOT, 'src/app/api')

  function apiPathsIn(source) {
    const paths = new Set()
    for (const match of source.matchAll(/['"`](\/api\/[^'"`\s?]*)/g)) paths.add(match[1])
    return [...paths]
  }

  function routeExists(pathname) {
    const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    let dirs = [API_ROOT]
    for (const segment of segments) {
      const wildcard = segment.includes('${')
      const next = []
      for (const dir of dirs) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          const dynamic = entry.name.startsWith('[')
          if (wildcard ? dynamic : entry.name === segment || dynamic) next.push(join(dir, entry.name))
        }
      }
      dirs = next
      if (dirs.length === 0) return false
    }
    return dirs.some((dir) => existsSync(join(dir, 'route.js')))
  }

  it('the checker itself tells a real route from a dead one', () => {
    expect(routeExists('/api/import/dry-run')).toBe(true)
    expect(routeExists('/api/work/${id}')).toBe(true)
    expect(routeExists('/api/import/plan')).toBe(false)
    expect(routeExists('/api/businesses')).toBe(false)
    expect(routeExists('/api/workspaces')).toBe(false)
  })

  for (const file of CLIENT_FILES) {
    it(`${file} names only routes that exist`, () => {
      const paths = apiPathsIn(read(file))
      expect(paths.length).toBeGreaterThan(0)
      const dead = paths.filter((p) => !routeExists(p))
      expect(dead, `dead fetch targets: ${dead.join(', ')}`).toEqual([])
    })
  }
})
