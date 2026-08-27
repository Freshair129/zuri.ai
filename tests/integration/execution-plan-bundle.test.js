import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { dryRunBundle } from '@/modules/project-manager/import/bundle/bundle-dry-run'
import { commitBundle } from '@/modules/project-manager/import/bundle/bundle-commit-service'
import { BUNDLE_STEP_KEY, BUNDLE_AUDIT_ACTION } from '@/modules/project-manager/import/bundle/bundle-receipt'

// @req FR-108 — the ExecutionPlanBundle round trip against a seeded database:
// combined dry-run → single confirmation → one-transaction commit → receipt,
// idempotent replay, hash-conflict refusal, and the fail-closed symbol and
// scope rules (ADR-049 D4/D5/D7/D8/D9).
// @spec ADR-049, SDD-056, BR-007, BR-009, SEC-001, SEC-002
//
// Uses the worked sample from contracts/ so the normative example is proven
// importable, not merely illustrative.

const samplePath = path.resolve(__dirname, '../../contracts/sample-execution-plan-bundle.json')
const sampleBundle = () => JSON.parse(readFileSync(samplePath, 'utf8'))

let business
let otherBusiness
let otherWorkspace
let viewer
let nonOwnerViewer

describe('ExecutionPlanBundle import (FR-108)', () => {
  beforeAll(async () => {
    // The scope chain the sample bundle names.
    const portfolio = await createPortfolio({ name: 'Bundle Group', code: 'PF-001' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Bundle Tenant', code: 'TNT-001' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Bundle Business', code: 'BUS-001' })
    await createWorkspace({ name: 'Transformation', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-B01-TRANSFORMATION' })

    // A second Business the same principal owns — proves the bundle ceiling is
    // ONE Business even for a viewer with wider authority.
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'Other Business', code: 'BUS-FR108-OTHER' })
    otherWorkspace = await createWorkspace({ name: 'Other WS', scopeType: 'BUSINESS', businessId: otherBusiness.id, code: 'WS-FR108-OTHER' })

    viewer = makeViewer({
      visibleBusinessIds: [business.id, otherBusiness.id],
      ownedBusinessIds: [business.id, otherBusiness.id],
    })
    // OWNER somewhere else, only sees the target — the attacker shape.
    nonOwnerViewer = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
  })

  it('dry-runs the sample bundle into one combined committable preview', async () => {
    const dry = await dryRunBundle(sampleBundle(), { viewer })
    expect(dry.errors).toEqual([])
    expect(dry.valid).toBe(true)
    expect(dry.business.code).toBe('BUS-001')
    expect(dry.preview.counts.strategy).toEqual({
      roadmaps: { insert: 1, update: 0 },
      horizons: { insert: 2, update: 0, remove: 0 },
      goals: { insert: 1, update: 0 },
    })
    expect(dry.preview.counts.projects.count).toBe(2)
    expect(dry.preview.counts.dependencies).toBe(1)
    // The NEW goal has no UUID yet, so both projects carry it as a pending
    // symbol rather than a fabricated id (D4).
    expect(dry.preview.symbols.goals['GOAL-KNOWLEDGE'].status).toBe('NEW')
    for (const project of dry.preview.projects) {
      expect(project.valid).toBe(true)
      expect(project.pendingGoalRefs).toEqual(['GOAL-KNOWLEDGE'])
    }
    // Read-only: nothing was written by the preview.
    expect(await prisma.businessRoadmap.count({ where: { code: 'RM-KNOWLEDGE' } })).toBe(0)
    expect(await prisma.project.count({ where: { code: { in: ['PRJ-MSP', 'PRJ-GKS'] } } })).toBe(0)
  })

  it('refuses the whole bundle when a symbolic ref does not resolve — fail closed, no guess', async () => {
    const bundle = sampleBundle()
    bundle.projects[0].goalRefs = ['GOAL-NOT-DECLARED']
    const dry = await dryRunBundle(bundle, { viewer })
    expect(dry.valid).toBe(false)
    expect(dry.errors.join('\n')).toContain('unknown goalRef "GOAL-NOT-DECLARED"')

    const commit = await commitBundle(bundle, { viewer })
    expect(commit.committed).toBe(false)
  })

  it('refuses a non-owner viewer before any preview, indistinguishably from a missing Business', async () => {
    const dry = await dryRunBundle(sampleBundle(), { viewer: nonOwnerViewer })
    expect(dry.valid).toBe(false)
    expect(dry.preview).toBeNull()
    expect(dry.errors).toHaveLength(1)

    const missing = await dryRunBundle(
      { ...sampleBundle(), scope: { businessCode: 'BUS-DOES-NOT-EXIST' } },
      { viewer: nonOwnerViewer }
    )
    // Same wording for "not yours" and "not there": no enumeration oracle.
    expect(missing.errors[0].replace('BUS-DOES-NOT-EXIST', 'BUS-001')).toBe(dry.errors[0])
  })

  it('refuses a project entry that targets a Workspace outside the bundle Business — even one the viewer owns', async () => {
    const bundle = sampleBundle()
    bundle.projects[1].workspaceCode = otherWorkspace.code
    const dry = await dryRunBundle(bundle, { viewer })
    expect(dry.valid).toBe(false)
    expect(dry.errors.join('\n')).toContain('does not match a workspace in the bundle\'s Business scope')
  })

  it('commits the sample bundle in one transaction: strategy, both Projects, the cross-Project edge, and the receipt', async () => {
    const result = await commitBundle(sampleBundle(), { viewer })
    expect(result.errors ?? []).toEqual([])
    expect(result.committed).toBe(true)
    expect(result.replay).toBe(false)
    expect(result.receipt.projects).toHaveLength(2)

    // Strategy landed under the bundle's own codes, inside the one Business.
    const roadmap = await prisma.businessRoadmap.findUnique({
      where: { code: 'RM-KNOWLEDGE' },
      include: { horizons: true },
    })
    expect(roadmap?.businessId).toBe(business.id)
    expect(roadmap?.horizons.map((horizon) => horizon.key).sort()).toEqual(['H1', 'H2'])
    const goal = await prisma.businessGoal.findUnique({ where: { code: 'GOAL-KNOWLEDGE' } })
    expect(goal?.businessId).toBe(business.id)
    expect(goal?.horizonId).toBe(roadmap.horizons.find((horizon) => horizon.key === 'H2')?.id)

    // Both Projects exist and are linked to the goal the same commit created.
    const projects = await prisma.project.findMany({ where: { code: { in: ['PRJ-MSP', 'PRJ-GKS'] } } })
    expect(projects).toHaveLength(2)
    const links = await prisma.projectGoal.findMany({ where: { goalId: goal.id } })
    expect(links.map((link) => link.projectId).sort()).toEqual(projects.map((project) => project.id).sort())

    // The cross-Project dependency edge.
    const msp = projects.find((project) => project.code === 'PRJ-MSP')
    const gks = projects.find((project) => project.code === 'PRJ-GKS')
    const edge = await prisma.dependency.findFirst({
      where: { sourceType: 'PROJECT', sourceId: msp.id, targetType: 'PROJECT', targetId: gks.id },
    })
    expect(edge?.dependencyType).toBe('BLOCKS')

    // The bundle receipt row reuses the PlanImportReceipt ledger under its own
    // stepKey, and the audit lineage names both per-Project runs (D9).
    const receiptRow = await prisma.planImportReceipt.findUnique({ where: { idempotencyKey: 'zuri-knowledge-2026-v1' } })
    expect(receiptRow?.stepKey).toBe(BUNDLE_STEP_KEY)
    expect(receiptRow?.executionRunId).toBe(result.receipt.bundleRunId)
    const auditEvent = await prisma.auditEvent.findUnique({ where: { id: receiptRow.auditEventId } })
    expect(auditEvent?.action).toBe(BUNDLE_AUDIT_ACTION)
    const lineage = JSON.parse(auditEvent.payloadJson).receipt.projects
    expect(lineage.map((entry) => entry.projectCode).sort()).toEqual(['PRJ-GKS', 'PRJ-MSP'])
    for (const entry of lineage) expect(entry.executionRunId).toBeTruthy()
  })

  it('replays an accepted idempotency key: prior receipt back, no duplicates written', async () => {
    const before = {
      roadmaps: await prisma.businessRoadmap.count({ where: { code: 'RM-KNOWLEDGE' } }),
      goals: await prisma.businessGoal.count({ where: { code: 'GOAL-KNOWLEDGE' } }),
      dependencies: await prisma.dependency.count({ where: { sourceType: 'PROJECT', targetType: 'PROJECT' } }),
      audits: await prisma.auditEvent.count({ where: { action: BUNDLE_AUDIT_ACTION } }),
    }
    const first = await prisma.planImportReceipt.findUnique({ where: { idempotencyKey: 'zuri-knowledge-2026-v1' } })

    const replay = await commitBundle(sampleBundle(), { viewer })
    expect(replay.committed).toBe(true)
    expect(replay.replay).toBe(true)
    expect(replay.receipt.bundleRunId).toBe(first.executionRunId)

    expect(await prisma.businessRoadmap.count({ where: { code: 'RM-KNOWLEDGE' } })).toBe(before.roadmaps)
    expect(await prisma.businessGoal.count({ where: { code: 'GOAL-KNOWLEDGE' } })).toBe(before.goals)
    expect(await prisma.dependency.count({ where: { sourceType: 'PROJECT', targetType: 'PROJECT' } })).toBe(before.dependencies)
    // Replay never rewrites history: no second BUNDLE_IMPORTED event.
    expect(await prisma.auditEvent.count({ where: { action: BUNDLE_AUDIT_ACTION } })).toBe(before.audits)
  })

  it('refuses the same idempotency key with a different payload hash', async () => {
    const bundle = sampleBundle()
    bundle.manifest.title = 'Same key, different bundle'
    const result = await commitBundle(bundle, { viewer })
    expect(result.committed).toBe(false)
    expect(result.errors.join('\n')).toContain('already used with a different payload')
  })

  it('rolls the whole programme back when any part fails mid-commit — atomic mode, no partial state', async () => {
    // Build a bundle whose combined dry-run PASSES, but whose second Project
    // fails only inside the transaction: both nested plans are schemaVersion
    // 1.2 sharing ONE idempotency key with different payloads, so Project A's
    // commit writes the per-Project receipt and Project B's commit refuses the
    // key reuse. The dry-run cannot see that (receipts are a commit concern),
    // which makes this a genuine in-transaction failure.
    const bundle = sampleBundle()
    bundle.trace.idempotencyKey = 'fr108-atomicity-probe'
    bundle.manifest.code = 'FR108-ATOMICITY'
    bundle.strategy.roadmap.code = 'RM-FR108-ATOMIC'
    bundle.strategy.goals[0].code = 'GOAL-FR108-ATOMIC'
    const recode = (entry, suffix) => {
      entry.plan.schemaVersion = '1.2'
      entry.plan.trace = { correlationId: 'fr108-atomic', idempotencyKey: 'fr108-shared-nested-key' }
      entry.plan.project.code = `PRJ-FR108-${suffix}`
      for (const workstream of entry.plan.workstreams) {
        workstream.code = `${workstream.code}-${suffix}`
        for (const container of workstream.containers || []) container.code = `${container.code}-${suffix}`
        for (const item of workstream.items || []) {
          item.code = `${item.code}-${suffix}`
          if (item.containerCode) item.containerCode = `${item.containerCode}-${suffix}`
        }
      }
    }
    recode(bundle.projects[0], 'A')
    recode(bundle.projects[1], 'B')

    const dry = await dryRunBundle(bundle, { viewer })
    expect(dry.valid).toBe(true) // the failure below is invisible to the preview

    const result = await commitBundle(bundle, { viewer })
    expect(result.committed).toBe(false)
    expect(result.errors.join('\n')).toContain('already used with a different payload')
    // Nothing landed: not the strategy, not Project A, not any receipt.
    expect(await prisma.businessRoadmap.count({ where: { code: 'RM-FR108-ATOMIC' } })).toBe(0)
    expect(await prisma.businessGoal.count({ where: { code: 'GOAL-FR108-ATOMIC' } })).toBe(0)
    expect(await prisma.project.count({ where: { code: { in: ['PRJ-FR108-A', 'PRJ-FR108-B'] } } })).toBe(0)
    expect(await prisma.planImportReceipt.count({
      where: { idempotencyKey: { in: ['fr108-atomicity-probe', 'fr108-shared-nested-key'] } },
    })).toBe(0)
  })
})
