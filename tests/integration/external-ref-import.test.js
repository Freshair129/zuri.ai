import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { lookupExternalRef, listExternalRefs } from '@/modules/project-manager/import/external-ref'
import { makeViewer } from '../factories/viewer'

// @req FR-065 — the pipeline now authorizes its target, so it takes a viewer.
// This suite is about external-id identity resolution; it runs as the owner of
// the Business it creates. Authorization itself is pinned in
// tests/integration/import-target-authorization.test.js.
let viewer
const dryRun = (plan, opts = {}) => dryRunPlan(plan, { viewer, ...opts })
const runCommit = (plan, opts = {}) => commitPlan(plan, { viewer, ...opts })

// @req FR-019 — a customer's existing core ids validated against our records:
// matched → update (relabel), new → insert + mapping, conflict → blocked.

let workspace

const envelope = (overrides = {}) => ({
  schemaVersion: '1.1',
  generatedBy: 'customer-erp',
  scope: { workspaceCode: 'WS-EXT' },
  project: {
    code: 'PRJ-EXT',
    name: 'Customer Rollout',
    status: 'ACTIVE',
    externalRefs: [{ system: 'SAP', id: 'PRJ-88421' }],
  },
  workstreams: [
    {
      code: 'WST-EXT-OPS',
      name: 'Store setup',
      executionMode: 'OPERATIONS',
      progressStrategy: 'SLA_SCORE',
      items: [
        {
          code: 'WI-EXT-1',
          subtype: 'CHECKLIST_ITEM',
          title: 'Install POS',
          status: 'PLANNED',
          externalRefs: [{ system: 'LEGACY_POS', id: 'TASK-1001' }],
        },
      ],
    },
  ],
  ...overrides,
})

describe('external id intake', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Ext Group', code: 'PF-EXT' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Ext Tenant', code: 'TNT-EXT' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Ext Business', code: 'BUS-EXT' })
    workspace = await createWorkspace({ name: 'Ext WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-EXT' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('accepts a 1.0 envelope unchanged — external refs are additive', async () => {
    const legacy = envelope()
    legacy.schemaVersion = '1.0'
    delete legacy.project.externalRefs
    delete legacy.workstreams[0].items[0].externalRefs
    legacy.project.code = 'PRJ-EXT-LEGACY'
    legacy.workstreams[0].code = 'WST-EXT-LEGACY'
    legacy.workstreams[0].items[0].code = 'WI-EXT-LEGACY'
    const dry = await dryRun(legacy)
    expect(dry.valid).toBe(true)
    expect(dry.preview.externalRefCount).toBe(0)
    expect((await runCommit(legacy)).committed).toBe(true)
  })

  it('first import: unknown ids are reported as new mappings and then persisted', async () => {
    const dry = await dryRun(envelope())
    expect(dry.valid).toBe(true)
    expect(dry.preview.externalRefCount).toBe(2)
    expect(dry.preview.matchedByExternalId).toBe(0)
    expect(dry.preview.inserts.find((i) => i.code === 'PRJ-EXT').matchedBy).toBe('newMapping')

    // Dry run stays read-only: nothing was mapped yet.
    expect(await lookupExternalRef('SAP', 'PRJ-88421')).toBeNull()

    const commit = await runCommit(envelope())
    expect(commit.committed).toBe(true)
    const mapped = await lookupExternalRef('SAP', 'PRJ-88421')
    expect(mapped.ref.entityType).toBe('PROJECT')
    expect(mapped.record.code).toBe('PRJ-EXT')
    expect(mapped.ref.verifiedAt).toBeTruthy()
  })

  it('second import: a known id matches and updates that record — our code is never overwritten', async () => {
    // The customer sends its own id with a code we have never seen.
    const relabelled = envelope()
    relabelled.project.code = 'PRJ-CUSTOMER-RENAME'
    relabelled.project.name = 'Customer Rollout (renamed upstream)'
    relabelled.workstreams[0].items[0].code = 'WI-CUSTOMER-RENAME'
    relabelled.workstreams[0].items[0].title = 'Install POS terminals'

    const dry = await dryRun(relabelled)
    expect(dry.valid).toBe(true)
    expect(dry.preview.matchedByExternalId).toBe(2)
    const projectRow = dry.preview.updates.find((u) => u.kind === 'project')
    expect(projectRow.code).toBe('PRJ-EXT') // our namespace wins
    expect(projectRow.planCode).toBe('PRJ-CUSTOMER-RENAME')

    const commit = await runCommit(relabelled)
    expect(commit.committed).toBe(true)
    expect(commit.projectCode).toBe('PRJ-EXT')

    const project = await prisma.project.findUnique({ where: { code: 'PRJ-EXT' } })
    expect(project.name).toBe('Customer Rollout (renamed upstream)')
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-CUSTOMER-RENAME' } })).toBeNull()

    const item = await prisma.workItem.findUnique({ where: { code: 'WI-EXT-1' } })
    expect(item.title).toBe('Install POS terminals')
  })

  it('re-importing the same batch is idempotent (one mapping per id)', async () => {
    await runCommit(envelope())
    const refs = await prisma.externalRef.findMany({ where: { system: 'SAP', value: 'PRJ-88421' } })
    expect(refs).toHaveLength(1)
  })

  it('conflict: an id already mapped to a different kind of record is blocked', async () => {
    const wrong = envelope()
    // SAP:PRJ-88421 is mapped to a PROJECT — claiming it for a work item is ambiguous.
    wrong.project.code = 'PRJ-EXT-2'
    delete wrong.project.externalRefs
    wrong.workstreams[0].code = 'WST-EXT-2'
    wrong.workstreams[0].items[0].code = 'WI-EXT-2'
    wrong.workstreams[0].items[0].externalRefs = [{ system: 'SAP', id: 'PRJ-88421' }]

    const dry = await dryRun(wrong)
    expect(dry.valid).toBe(false)
    expect(dry.errors.join(' ')).toMatch(/already mapped to a PROJECT, not a WORK_ITEM/)
    const commit = await runCommit(wrong)
    expect(commit.committed).toBe(false)
  })

  it('conflict: the plan code already belongs to a different record', async () => {
    const clash = envelope()
    // SAP:PRJ-88421 → PRJ-EXT, but the plan calls it PRJ-EXT-LEGACY (a real other project).
    clash.project.code = 'PRJ-EXT-LEGACY'
    const dry = await dryRun(clash)
    expect(dry.valid).toBe(false)
    expect(dry.errors.join(' ')).toMatch(/already belongs to a different record/)
  })

  it('conflict: the same external id claimed twice in one batch', async () => {
    const dup = envelope()
    dup.workstreams[0].items.push({
      code: 'WI-EXT-DUP',
      subtype: 'CHECKLIST_ITEM',
      title: 'Duplicate claim',
      externalRefs: [{ system: 'LEGACY_POS', id: 'TASK-1001' }],
    })
    const dry = await dryRun(dup)
    expect(dry.valid).toBe(false)
    expect(dry.errors.join(' ')).toMatch(/claimed twice/)
  })

  it('conflict: two ids on one entity pointing at different records', async () => {
    // A second system already knows the legacy project under its own id.
    const legacyProject = await prisma.project.findUnique({ where: { code: 'PRJ-EXT-LEGACY' } })
    await prisma.externalRef.create({
      data: { entityType: 'PROJECT', entityId: legacyProject.id, system: 'ERP', value: 'LEGACY-9' },
    })
    const split = envelope()
    split.project.externalRefs = [
      { system: 'SAP', id: 'PRJ-88421' },
      { system: 'ERP', id: 'LEGACY-9' },
    ]
    const dry = await dryRun(split)
    expect(dry.valid).toBe(false)
    expect(dry.errors.join(' ')).toMatch(/different records — cannot merge/)
  })

  it('exposes the customer ids back through resolve + listing helpers', async () => {
    const project = await prisma.project.findUnique({ where: { code: 'PRJ-EXT' } })
    const refs = await listExternalRefs({ entityType: 'PROJECT', entityId: project.id })
    expect(refs).toEqual([expect.objectContaining({ system: 'SAP', value: 'PRJ-88421', labelAs: true })])
  })

  it('honours labelAs:false for ids that should not become display labels', async () => {
    const quiet = envelope()
    quiet.project.externalRefs = [{ system: 'SAP', id: 'PRJ-88421', labelAs: false }]
    await runCommit(quiet)
    const hit = await lookupExternalRef('SAP', 'PRJ-88421')
    expect(hit.ref.labelAs).toBe(false)
  })

  it('records the external-id activity in the audit payload', async () => {
    const project = await prisma.project.findUnique({ where: { code: 'PRJ-EXT' } })
    const events = await prisma.auditEvent.findMany({
      where: { entityId: project.id, action: 'PLAN_IMPORTED' },
      orderBy: { occurredAt: 'desc' },
    })
    const payload = JSON.parse(events[0].payloadJson)
    expect(payload.schemaVersion).toBe('1.1')
    expect(payload.externalRefs).toBeGreaterThan(0)
  })
})
