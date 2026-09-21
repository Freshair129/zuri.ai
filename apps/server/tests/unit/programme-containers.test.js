// @req FR-219, FR-216, FR-217 — the programme container generator: delivered ids,
//   subtasks, link state against the repository, the Delivery Telemetry blocks,
//   and the lane rules the meter depends on; the committed modules stay in step.
// @spec ADR-086 D2, D3, D6
// @tested tests/unit/programme-containers.test.js
import { describe, expect, it } from 'vitest'
import {
  ProgrammeDocumentError,
  buildRoadmapDag,
  buildContainers,
  extractDeliveredIds,
  generateProgrammeModules,
  parseContainerBlock,
  replaceUsageBlock,
  parseUsageBlock,
  repositoryFileExists,
  validateDeliveryPlan,
} from '../../scripts/programme-containers.mjs'
import { PROGRAMME_CONTAINERS } from '@/modules/platform-control/program-roadmap-containers'
import { PROGRAMME_LANES, PROGRAMME_SIZING } from '@/modules/platform-control/program-roadmap-telemetry'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { ROADMAP_SOT, ROADMAP_TASK_LEDGER, ROADMAP_TASK_STATUS } from '@/modules/platform-control/roadmap-sot'

const block = (extra = '') => `task_container_id: TC-TASK-ZAI-900
task_id: TASK-ZAI-900
parent_phase_id: PHASE-ZAI-01
parent_sprint_id: SPR-ZAI-02
title: Fixture task — FEAT-020, FR-154 to FR-156, FR-168
status: planned
version: 0.1.0
pic: Claude
executor: Claude
approver: Owen
auditor: ATHER
symbol_links:
  code: apps/server/src/present.js
  doc: docs/gone.md
  test: unavailable${extra}
definition_of_done:
  acceptance_criteria:
    - criterion: Given a, when b, then c
      checked: true
  success_criteria:
    - criterion: Given d, when e, then f
      checked: false
  exit_criteria:
    - criterion: Given g, when h, then i
      checked: false
changelog: Fixture.
created_at: 2026-09-13T00:00:00Z,Claude,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 1000
  total_token_usage: 0`

const documentWith = (containerText) => `| TASK-ZAI-900 | SPR-ZAI-02 | task | Fixture task | P1 | Claude | planned | TASK-ZAI-001; TASK-ZAI-002 | Section 3 |

### TC-TASK-ZAI-900

\`\`\`yaml
${containerText}
\`\`\`
`

describe('FR-219 delivered ids', () => {
  it('reads FR, NFR and FEAT ids from a title and expands ranges, ignoring sources', () => {
    expect(extractDeliveredIds('Inventory — FEAT-020, FR-154 to FR-156, FR-168')).toEqual(['FEAT-020', 'FR-154', 'FR-155', 'FR-156', 'FR-168'])
    expect(extractDeliveredIds('Asset — FEAT-015 to FEAT-017, NFR-008 per ADR-059 and BR-002')).toEqual(['FEAT-015', 'FEAT-016', 'FEAT-017', 'NFR-008'])
    expect(() => extractDeliveredIds('FR-100 to FR-190')).toThrow(ProgrammeDocumentError)
  })

  it('prefers an explicit delivers list, and treats delivers: [] as a statement, not an omission', () => {
    const exists = (link) => link === 'apps/server/src/present.js'
    const fromTitle = buildContainers({ markdown: documentWith(block()), fileExists: exists })['TASK-ZAI-900']
    expect(fromTitle.delivers).toEqual(['FEAT-020', 'FR-154', 'FR-155', 'FR-156', 'FR-168'])
    const explicit = buildContainers({ markdown: documentWith(block('\ndelivers: [FR-212, FEAT-033]')), fileExists: exists })['TASK-ZAI-900']
    expect(explicit.delivers).toEqual(['FR-212', 'FEAT-033'])
    const none = buildContainers({ markdown: documentWith(block('\ndelivers: []')), fileExists: exists })['TASK-ZAI-900']
    expect(none.delivers).toEqual([])
    expect(() => buildContainers({ markdown: documentWith(block('\ndelivers: [ADR-086]')), fileExists: exists })).toThrow(/not an FR, NFR or FEAT id/)
  })

  it('records whether each declared link still resolves, and the backlog priority', () => {
    const c = buildContainers({ markdown: documentWith(block()), fileExists: (link) => link === 'apps/server/src/present.js' })['TASK-ZAI-900']
    expect(c.linkState).toEqual({ code: 'present', doc: 'missing', test: 'unavailable' })
    expect(c.priority).toBe('P1')
    expect(c.dependsOn).toEqual(['TASK-ZAI-001', 'TASK-ZAI-002'])
  })
})

describe('FR-219 subtasks', () => {
  it('parses P0..P9 subtasks with title and status, and refuses a malformed one by name', () => {
    const y = parseContainerBlock(block('\nsubtasks:\n  - id: P0\n    title: First half\n    status: done\n  - id: P1\n    title: Second half: with a colon\n    status: planned'))
    expect(y.subtasks).toEqual([{ id: 'P0', title: 'First half', status: 'done' }, { id: 'P1', title: 'Second half: with a colon', status: 'planned' }])
    expect(() => buildContainers({ markdown: documentWith(block('\nsubtasks:\n  - id: Phase-1\n    title: x\n    status: done')), fileExists: () => true })).toThrow(/is not P0..P9/)
    expect(() => buildContainers({ markdown: documentWith(block('\nsubtasks:\n  - id: P0\n    title: x')), fileExists: () => true })).toThrow(/needs a title and a status/)
  })
})

describe('FR-217 lane rules', () => {
  const containers = {
    'TASK-ZAI-001': { phase: 'PHASE-ZAI-01' },
    'TASK-ZAI-002': { phase: 'PHASE-ZAI-01' },
    'TASK-ZAI-007': { phase: 'PHASE-ZAI-02' },
  }
  const sizing = { points: { 'C-1': 1, 'C-2': 2, 'C-3': 3 }, effortHours: { 'C-1': 2, 'C-2': 6, 'C-3': 16 }, activeGapCapMinutes: 15 }
  const plan = (lanes) => ({ sizing, lanes })

  it('accepts lanes inside one phase with branches of their own', () => {
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-001', 'TASK-ZAI-002'], branches: ['feat/a'] }]), containers)).not.toThrow()
  })

  it('refuses every lane the meter could not attribute honestly', () => {
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-001', 'TASK-ZAI-007'], branches: ['feat/a'] }]), containers)).toThrow(/spans phases/)
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-001'], branches: ['feat/a'] }, { id: 'LANE-B', tasks: ['TASK-ZAI-002'], branches: ['feat/a'] }]), containers)).toThrow(/claimed by LANE-A and LANE-B/)
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-001'], branches: ['main'] }]), containers)).toThrow(/cannot be attributed/)
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-999'], branches: ['feat/a'] }]), containers)).toThrow(/has no Task Container/)
    expect(() => validateDeliveryPlan(plan([{ id: 'LANE-A', tasks: ['TASK-ZAI-001'], branches: ['feat/a'] }, { id: 'LANE-B', tasks: ['TASK-ZAI-001'], branches: ['feat/b'] }]), containers)).toThrow(/is in LANE-A and LANE-B/)
    expect(() => validateDeliveryPlan({ sizing: { ...sizing, effortHours: {} }, lanes: [] }, containers)).toThrow(/no points or effort hours/)
  })

  it('rewrites only the usage block', () => {
    const doc = 'before\n<!-- programme-usage:start -->\n```json\n{"lanes":{}}\n```\n<!-- programme-usage:end -->\nafter'
    const next = replaceUsageBlock(doc, { meter: 'm', measuredThrough: '2026-09-13T00:00:00.000Z', lanes: {} })
    expect(next.startsWith('before\n')).toBe(true)
    expect(next.endsWith('\nafter')).toBe(true)
    expect(parseUsageBlock(next).measuredThrough).toBe('2026-09-13T00:00:00.000Z')
  })
})

describe('FR-105 / FR-219 committed modules', () => {
  it('keeps ADR-081 generated views out of link-state even after CI builds them', () => {
    const exists = () => true
    expect(repositoryFileExists('C:/repo', 'docs/FEATURE-MAP.md', exists)).toBe(false)
    expect(repositoryFileExists('C:/repo', 'docs/DOMAIN-MAP.md', exists)).toBe(false)
    expect(repositoryFileExists('C:/repo', 'docs/roadmap/ROADMAP.md', exists)).toBe(true)
  })

  it('are exactly what the generator writes from the programme document', () => {
    const { drift, containers } = generateProgrammeModules({ check: true })
    expect(drift).toEqual([])
    expect(Object.keys(containers)).toHaveLength(PROGRAMME_TASKS.length)
  })

  it('carry a container for every task, and lanes the plan declares', () => {
    for (const [id] of PROGRAMME_TASKS) {
      expect(PROGRAMME_CONTAINERS[id]).toBeTruthy()
      expect(['present', 'missing', 'unavailable']).toContain(PROGRAMME_CONTAINERS[id].linkState.code)
      expect(PROGRAMME_CONTAINERS[id].priority).toMatch(/^P\d$/)
    }
    expect(PROGRAMME_SIZING.effortHours['C-3']).toBeGreaterThan(PROGRAMME_SIZING.effortHours['C-1'])
    expect(PROGRAMME_LANES.find((lane) => lane.id === 'LANE-DELIVERY-TELEMETRY').tasks).toEqual(['TASK-ZAI-064', 'TASK-ZAI-065', 'TASK-ZAI-066', 'TASK-ZAI-067', 'TASK-ZAI-068'])
  })

  it('uses ROADMAP.md as the one status source and keeps GenesisRAG17 evidence scoped', () => {
    const roadmap = generateProgrammeModules({ check: true })
    expect(roadmap.ledger).toHaveLength(PROGRAMME_TASKS.length)
    expect(ROADMAP_TASK_LEDGER).toHaveLength(PROGRAMME_TASKS.length)
    expect(ROADMAP_TASK_STATUS['TASK-ZAI-052']).toBe('done')
    expect(ROADMAP_TASK_STATUS['TASK-ZAI-061']).toBe('done')
    expect(ROADMAP_TASK_STATUS['TASK-ZAI-077']).toBe('done')
    expect(PROGRAMME_TASKS.find(([id]) => id === 'TASK-ZAI-052')?.[6]).toBe('done')
    expect(PROGRAMME_TASKS.find(([id]) => id === 'TASK-ZAI-077')?.[6]).toBe('done')
    expect(ROADMAP_SOT.coverage).toHaveLength(17)
    expect(ROADMAP_SOT.subplans.find((plan) => plan.id === 'SUBPLAN-KI-PRODUCTION-ACTIVATION')).toMatchObject({ status: 'planned', proofScope: 'SPEC' })
    expect(ROADMAP_SOT.subplans.filter((plan) => plan.duplicateKey === 'KI-CATALOG-PUBLISH')).toHaveLength(2)
    expect(ROADMAP_SOT.subplans.find((plan) => plan.id === 'SUBPLAN-ROADMAP-MOBILE')).toMatchObject({
      status: 'planned',
      proofScope: 'SPEC',
      implementationState: 'NOT_STARTED',
      duplicateKey: 'PLATFORM-ROADMAP-UI',
    })
    const dag = buildRoadmapDag(new Map(ROADMAP_TASK_LEDGER.map((row) => [row.id, row])))
    expect(dag).toEqual(ROADMAP_SOT.dag)
    expect(dag).toMatchObject({ nodeCount: PROGRAMME_TASKS.length, edgeCount: 135, waveCount: 21, missingDependencies: [], cycles: [] })
    expect(dag.waves[0].taskIds).toContain('TASK-ZAI-001')
    expect(dag.waves[0].taskIds).toContain('TASK-ZAI-116')
    expect(dag.waves.at(-1).taskIds).toEqual(['TASK-ZAI-115'])
    expect(roadmap.drift).toEqual([])
  })
})
