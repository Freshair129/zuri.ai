// @req FR-016 — idempotent sample-data seed (4 tenants, 7-mode sample project)
// @spec NFR-007 — safe to re-run: every record is upserted by its unique human code.
// @tested tests/e2e/smoke.spec.js — the whole e2e suite asserts against this data
const { PrismaClient } = require('@prisma/client')
const { randomBytes, scryptSync } = require('node:crypto')

// @req FR-041 - seed Business Strategy horizons for the Business-first Overview.
// @spec ADR-013
// @tested tests/e2e/fr041-business-first.spec.js

const prisma = new PrismaClient()

function hashSeedPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('ZURI_SEED_OWNER_PASSWORD must be at least 8 characters')
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${derivedKey}`
}

async function main() {
  // ---- Portfolio / Tenants / Businesses (4 isolated tenants) ---------------
  const portfolio = await prisma.portfolio.upsert({
    where: { code: 'PF-001' },
    update: {},
    create: { code: 'PF-001', name: 'Business Group' },
  })

  const tenantSpecs = [
    { code: 'TNT-001', business: { code: 'BUS-001', name: 'Business 01' } },
    { code: 'TNT-002', business: { code: 'BUS-002', name: 'Business 02' } },
    { code: 'TNT-003', business: { code: 'BUS-003', name: 'Business 03' } },
    { code: 'TNT-004', business: { code: 'BUS-004', name: 'Business 04' } },
  ]
  const tenants = {}
  const businesses = {}
  for (const spec of tenantSpecs) {
    const tenant = await prisma.tenant.upsert({
      where: { code: spec.code },
      update: {},
      create: { code: spec.code, name: `Tenant ${spec.code.slice(-3)}`, portfolioId: portfolio.id },
    })
    tenants[spec.code] = tenant
    businesses[spec.business.code] = await prisma.business.upsert({
      where: { code: spec.business.code },
      update: {},
      create: { code: spec.business.code, name: spec.business.name, tenantId: tenant.id },
    })
  }

  // Legal entity for Business 01 (identifiers are external IDs, not PKs).
  const legalEntity = await prisma.legalEntity.upsert({
    where: { code: 'LE-001' },
    update: {},
    create: { code: 'LE-001', legalName: 'Business 01 Co., Ltd.', portfolioId: portfolio.id },
  })
  await prisma.legalEntityIdentifier.upsert({
    where: { country_type_value: { country: 'TH', type: 'TH_TAX_ID', value: '0105500000001' } },
    update: {},
    create: { legalEntityId: legalEntity.id, country: 'TH', type: 'TH_TAX_ID', value: '0105500000001' },
  })
  await prisma.business.update({
    where: { code: 'BUS-001' },
    data: { legalEntityId: legalEntity.id },
  })

  // Branch under Business 01 (branch != tenant).
  await prisma.branch.upsert({
    where: { code: 'BR-001' },
    update: {},
    create: {
      code: 'BR-001',
      name: 'Head Office',
      tenantId: tenants['TNT-001'].id,
      businessId: businesses['BUS-001'].id,
    },
  })

  // Seeded account identity. A credential is provisioned only when the caller
  // explicitly supplies ZURI_SEED_OWNER_PASSWORD; there is no password fallback.
  const owner = await prisma.person.upsert({
    where: { code: 'PER-OWNER' },
    update: { email: 'owner@local' },
    create: { code: 'PER-OWNER', displayName: 'Local Owner', email: 'owner@local' },
  })
  const seedOwnerPassword = process.env.ZURI_SEED_OWNER_PASSWORD
  if (seedOwnerPassword) {
    const passwordHash = hashSeedPassword(seedOwnerPassword)
    await prisma.personCredential.upsert({
      where: { personId: owner.id },
      update: { passwordHash },
      create: { personId: owner.id, passwordHash },
    })
  }
  const existingMembership = await prisma.membership.findFirst({
    where: { personId: owner.id, tenantId: tenants['TNT-001'].id },
  })
  if (!existingMembership) {
    await prisma.membership.create({
      data: { personId: owner.id, tenantId: tenants['TNT-001'].id, businessId: businesses['BUS-001'].id, role: 'OWNER' },
    })
  }

  // ---- Workspaces ----------------------------------------------------------
  const wsPlatform = await prisma.workspace.upsert({
    where: { code: 'WS-PLATFORM' },
    update: {},
    create: {
      code: 'WS-PLATFORM',
      name: 'Shared Platform Engineering',
      scopeType: 'PORTFOLIO',
      portfolioId: portfolio.id,
    },
  })
  for (const [busCode, wsCode] of [
    ['BUS-001', 'WS-B01-MIG'],
    ['BUS-002', 'WS-B02-MIG'],
    ['BUS-003', 'WS-B03-MIG'],
    ['BUS-004', 'WS-B04-MIG'],
  ]) {
    const business = businesses[busCode]
    await prisma.workspace.upsert({
      where: { code: wsCode },
      update: {},
      create: {
        code: wsCode,
        name: `${busCode.replace('BUS-', 'Business ')} Migration`,
        scopeType: 'BUSINESS',
        businessId: business.id,
        tenantId: business.tenantId,
        portfolioId: portfolio.id,
      },
    })
  }
  const wsBusiness = await prisma.workspace.findUnique({ where: { code: 'WS-B01-MIG' } })

  // ---- Business Strategy (FR-041) -----------------------------------------
  // Strategy is intentionally Business-level; the shared portfolio project
  // below remains unowned by a Business and is not attributed to this roadmap.
  const strategyRoadmap = await prisma.businessRoadmap.upsert({
    where: { code: 'RM-B01-2026' },
    update: { title: 'Business 01 Direction 2026', status: 'ACTIVE' },
    create: {
      code: 'RM-B01-2026',
      businessId: businesses['BUS-001'].id,
      title: 'Business 01 Direction 2026',
      description: 'Business-level direction above project execution.',
      status: 'ACTIVE',
      startAt: new Date('2026-01-01'),
      targetAt: new Date('2026-12-31'),
    },
  })
  const horizon = async (key, label, position, targetAt) =>
    prisma.businessRoadmapHorizon.upsert({
      where: { roadmapId_position: { roadmapId: strategyRoadmap.id, position } },
      update: { key, label, targetAt: new Date(targetAt) },
      create: { roadmapId: strategyRoadmap.id, key, label, position, targetAt: new Date(targetAt) },
    })
  const shortHorizon = await horizon('SHORT', 'Short term', 1, '2026-03-31')
  const mediumHorizon = await horizon('MEDIUM', 'Medium term', 2, '2026-08-31')
  const longHorizon = await horizon('LONG', 'Long term', 3, '2026-12-31')
  const goal = async (code, title, horizonId, progress, priority = 'MEDIUM') =>
    prisma.businessGoal.upsert({
      where: { code },
      update: { title, horizonId, progress, priority, status: progress >= 100 ? 'DONE' : 'ACTIVE' },
      create: {
        code,
        businessId: businesses['BUS-001'].id,
        roadmapId: strategyRoadmap.id,
        horizonId,
        title,
        progress,
        priority,
        status: progress >= 100 ? 'DONE' : 'ACTIVE',
      },
    })
  await goal('GOAL-B01-FOUNDATION', 'Stabilize the operating foundation', shortHorizon.id, 72, 'HIGH')
  await goal('GOAL-B01-GROWTH', 'Reach the next growth milestone', mediumHorizon.id, 38, 'HIGH')
  await goal('GOAL-B01-EXPANSION', 'Prepare the next business expansion', longHorizon.id, 12, 'MEDIUM')

  // ---- Demo project: one workstream per execution mode ---------------------
  // @req FR-087, FR-088 — `priority` and `pic` are set on `update` as well as
  // `create`, because the demo database predates both columns: a seed that only
  // filled them on first insert would leave every existing row null and the
  // Dashboard permanently empty on any machine that had seeded before.
  const project = await prisma.project.upsert({
    where: { code: 'PRJ-B01-TRANSFORM' },
    update: {
      businessId: businesses['BUS-001'].id,
      workspaceId: wsBusiness.id,
      priority: 'CRITICAL',
      picPersonId: owner.id,
    },
    create: {
      code: 'PRJ-B01-TRANSFORM',
      businessId: businesses['BUS-001'].id,
      workspaceId: wsBusiness.id,
      name: 'Business 01 Transformation Program',
      description: 'Mixed-mode demo project covering all seven execution modes.',
      type: 'TRANSFORMATION',
      status: 'ACTIVE',
      priority: 'CRITICAL',
      picPersonId: owner.id,
      startAt: new Date('2026-07-01'),
      targetAt: new Date('2026-12-20'),
    },
  })

  // @req FR-089 — two Teams so the Dashboard's team count is a number a reader
  // can check against something, and so the many-to-many link is exercised by
  // the demo data rather than only by tests (ADR-037 D3).
  const team = async (code, name, description) =>
    prisma.team.upsert({
      where: { code },
      update: { name, businessId: businesses['BUS-001'].id },
      create: { code, name, description, businessId: businesses['BUS-001'].id },
    })
  const platformTeam = await team('TEAM-B01-PLATFORM', 'Platform Squad', 'Runs the migration and operations workstreams.')
  const growthTeam = await team('TEAM-B01-GROWTH', 'Growth Squad', 'Runs the campaign and sales workstreams.')

  for (const t of [platformTeam, growthTeam]) {
    // `upsert` on the composite unique keeps a re-seed from stacking duplicate
    // links — the same idempotency the rest of this file holds to.
    await prisma.projectTeam.upsert({
      where: { projectId_teamId: { projectId: project.id, teamId: t.id } },
      update: {},
      create: { projectId: project.id, teamId: t.id },
    })
  }
  await prisma.teamMembership.upsert({
    where: { teamId_personId: { teamId: platformTeam.id, personId: owner.id } },
    update: {},
    create: { teamId: platformTeam.id, personId: owner.id },
  })

  const ws = async (code, name, executionMode, progressStrategy, progressWeight, viewConfig = {}) =>
    prisma.workstream.upsert({
      where: { code },
      update: { viewConfigJson: JSON.stringify(viewConfig) },
      create: {
        code,
        projectId: project.id,
        name,
        executionMode,
        progressStrategy,
        progressWeight,
        status: 'ACTIVE',
        viewConfigJson: JSON.stringify(viewConfig),
      },
    })

  const container = async (code, workstreamId, subtype, title, status = 'ACTIVE', metadata = {}) =>
    prisma.workContainer.upsert({
      where: { code },
      update: {},
      create: { code, workstreamId, subtype, title, status, metadataJson: JSON.stringify(metadata) },
    })

  const item = async (code, workstreamId, containerId, subtype, title, fields = {}) =>
    prisma.workItem.upsert({
      where: { code },
      update: {
        status: fields.status || 'PLANNED',
        metricDataJson: JSON.stringify(fields.metrics || {}),
      },
      create: {
        code,
        workstreamId,
        containerId,
        subtype,
        title,
        status: fields.status || 'PLANNED',
        weight: fields.weight ?? 1,
        numericValue: fields.numericValue ?? null,
        probability: fields.probability ?? null,
        metricDataJson: JSON.stringify(fields.metrics || {}),
        metadataJson: JSON.stringify(fields.metadata || {}),
        targetAt: fields.targetAt ? new Date(fields.targetAt) : null,
      },
    })

  const milestone = async (code, workstreamId, title, fields = {}) =>
    prisma.milestone.upsert({
      where: { code },
      update: { status: fields.status || 'PLANNED' },
      create: {
        code,
        projectId: project.id,
        workstreamId,
        title,
        status: fields.status || 'PLANNED',
        weight: fields.weight ?? 1,
        targetAt: fields.targetAt ? new Date(fields.targetAt) : null,
        completedAt: fields.status === 'DONE' ? new Date('2026-08-01') : null,
      },
    })

  const gate = async (code, workstreamId, title, fields = {}) =>
    prisma.gate.upsert({
      where: { code },
      update: { status: fields.status || 'OPEN' },
      create: {
        code,
        projectId: project.id,
        workstreamId,
        title,
        status: fields.status || 'OPEN',
        required: fields.required ?? true,
        evidenceJson: JSON.stringify(fields.evidence || {}),
        targetAt: fields.targetAt ? new Date(fields.targetAt) : null,
      },
    })

  // 1. SOFTWARE_SPRINT
  const wsDev = await ws('WST-ZURI-DEV', 'Zuri Core Development', 'SOFTWARE_SPRINT', 'TASK_WEIGHT', 1.2)
  const sprint12 = await container('SPR-012', wsDev.id, 'SPRINT', 'Sprint 12')
  await item('ZURI-421', wsDev.id, sprint12.id, 'TASK', 'External identity model', { status: 'IN_PROGRESS', weight: 5 })
  await item('ZURI-422', wsDev.id, sprint12.id, 'TASK', 'Workspace scope selectors', { status: 'DONE', weight: 3 })
  await item('ZURI-423', wsDev.id, sprint12.id, 'TASK', 'Plan import dry run UI', { status: 'REVIEW', weight: 3 })
  await item('ZURI-424', wsDev.id, sprint12.id, 'BUG', 'Progress cache staleness', { status: 'IN_PROGRESS', weight: 2 })
  await item('ZURI-425', wsDev.id, sprint12.id, 'TASK', 'Audit event browser', { status: 'DONE', weight: 2 })
  await gate('GATE-REL-12', wsDev.id, 'Release 12 quality gate', { status: 'OPEN', evidence: { checklist: 'regression pending' } })

  // 2. DATA_MIGRATION
  const wsData = await ws('WST-DATA', 'Legacy Data Migration', 'DATA_MIGRATION', 'RECORD_VALIDATION', 1.5)
  const migStage = await container('MIG-STG-01', wsData.id, 'MIGRATION_STAGE', 'Normalize + Validate')
  await item('DATA-CUSTOMER', wsData.id, migStage.id, 'DATASET', 'Customer records', {
    status: 'IN_PROGRESS',
    metrics: { recordsTotal: 8200, processed: 4412, validated: 4328, failed: 84, reconciled: 4100 },
  })
  await item('DATA-ORDERS', wsData.id, migStage.id, 'DATASET', 'Order history', {
    status: 'IN_PROGRESS',
    metrics: { recordsTotal: 15400, processed: 15400, validated: 14790, failed: 610, reconciled: 14790 },
  })
  await item('DATA-PRODUCTS', wsData.id, migStage.id, 'DATASET', 'Product catalog', {
    status: 'DONE',
    metrics: { recordsTotal: 1240, processed: 1240, validated: 1240, failed: 0, reconciled: 1240 },
  })
  await gate('GATE-DATA-ID', wsData.id, 'Identity-critical data ready', { status: 'OPEN', required: true })

  // 3. B2B_SALES
  const wsSales = await ws('WST-B2B', 'Enterprise Sales Pipeline', 'B2B_SALES', 'WEIGHTED_PIPELINE', 1.0, {
    revenueTarget: 2500000,
  })
  const pipeline = await container('PIPE-ENT', wsSales.id, 'SALES_PIPELINE', 'Enterprise Pipeline Q3')
  await item('DEAL-ACME', wsSales.id, pipeline.id, 'DEAL', 'ACME Group platform deal', {
    status: 'IN_PROGRESS', numericValue: 1200000, probability: 0.6, metadata: { stage: 'Proposal' },
  })
  await item('DEAL-BETA', wsSales.id, pipeline.id, 'DEAL', 'Beta Foods rollout', {
    status: 'IN_PROGRESS', numericValue: 800000, probability: 0.35, metadata: { stage: 'Discovery' },
  })
  await item('DEAL-GAMMA', wsSales.id, pipeline.id, 'DEAL', 'Gamma Retail pilot', {
    status: 'DONE', numericValue: 450000, probability: 1, metadata: { stage: 'Won' },
  })
  await item('DEAL-DELTA', wsSales.id, pipeline.id, 'DEAL', 'Delta Logistics upsell', {
    status: 'IN_PROGRESS', numericValue: 300000, probability: 0.8, metadata: { stage: 'Negotiation' },
  })

  // 4. B2C_CAMPAIGN
  const wsCampaign = await ws('WST-B2C', 'Q3 Acquisition Campaign', 'B2C_CAMPAIGN', 'KPI_ATTAINMENT', 0.8, {
    kpis: [
      { key: 'leads', label: 'Leads', target: 5000, weight: 2 },
      { key: 'conversions', label: 'Conversions', target: 600, weight: 3 },
      { key: 'revenue', label: 'Revenue (THB)', target: 900000, weight: 3 },
      { key: 'spend', label: 'Spend vs budget (THB)', target: 400000, weight: 2, direction: 'down' },
    ],
  })
  const wave1 = await container('CAMP-W1', wsCampaign.id, 'CAMPAIGN_WAVE', 'Wave 1 — Social')
  await item('CRE-VIDEO-A', wsCampaign.id, wave1.id, 'CREATIVE', 'Hero video A', {
    status: 'DONE', metrics: { leads: 2100, conversions: 260, revenue: 380000, spend: 150000 },
  })
  await item('CRE-CAROUSEL', wsCampaign.id, wave1.id, 'CREATIVE', 'Product carousel', {
    status: 'IN_PROGRESS', metrics: { leads: 1400, conversions: 150, revenue: 210000, spend: 110000 },
  })
  await item('EXP-LANDING', wsCampaign.id, wave1.id, 'EXPERIMENT', 'Landing page A/B', {
    status: 'IN_PROGRESS', metrics: { leads: 500, conversions: 80, revenue: 90000, spend: 40000 },
  })

  // 5. PRODUCT_LAUNCH
  const wsLaunch = await ws('WST-LAUNCH', 'POS 2.0 Launch', 'PRODUCT_LAUNCH', 'MILESTONE_READINESS', 1.0)
  const phasePrep = await container('LNCH-PREP', wsLaunch.id, 'LAUNCH_PHASE', 'Preparation')
  await item('DEL-PRICING', wsLaunch.id, phasePrep.id, 'DELIVERABLE', 'Pricing sheet', { status: 'DONE' })
  await item('DEL-TRAINING', wsLaunch.id, phasePrep.id, 'DELIVERABLE', 'Staff training kit', { status: 'IN_PROGRESS' })
  await milestone('MS-LNCH-BETA', wsLaunch.id, 'Closed beta complete', { status: 'DONE', weight: 2, targetAt: '2026-07-25' })
  await milestone('MS-LNCH-MKT', wsLaunch.id, 'Marketing assets ready', { status: 'IN_PROGRESS', weight: 1, targetAt: '2026-08-20' })
  await milestone('MS-LNCH-GA', wsLaunch.id, 'General availability', { status: 'PLANNED', weight: 3, targetAt: '2026-09-15' })
  await gate('GATE-LNCH-SEC', wsLaunch.id, 'Security review', { status: 'PASSED' })
  await gate('GATE-LNCH-OPS', wsLaunch.id, 'Support readiness', { status: 'OPEN' })

  // 6. OPERATIONS
  const wsOps = await ws('WST-OPS', 'Store Operations Q3', 'OPERATIONS', 'SLA_SCORE', 0.7)
  const opsPeriod = await container('OPS-2026-Q3', wsOps.id, 'OPS_PERIOD', 'Q3 2026')
  await item('OPS-CHK-OPEN', wsOps.id, opsPeriod.id, 'CHECKLIST_ITEM', 'Daily opening checklist', {
    status: 'DONE', metrics: { slaMet: 58, slaTotal: 62 },
  })
  await item('OPS-CHK-STOCK', wsOps.id, opsPeriod.id, 'CHECKLIST_ITEM', 'Stock reconciliation', {
    status: 'IN_PROGRESS', metrics: { slaMet: 40, slaTotal: 62, backlog: 3 },
  })
  await item('OPS-ISSUE-POS', wsOps.id, opsPeriod.id, 'ISSUE', 'POS printer failures', {
    status: 'IN_PROGRESS', metrics: { incidents: 4 },
  })

  // 7. BUSINESS_EXPANSION
  const wsExpand = await ws('WST-EXPAND', 'Chiang Mai Branch Expansion', 'BUSINESS_EXPANSION', 'EXPANSION_READINESS', 1.0)
  const site = await container('EXP-CNX', wsExpand.id, 'EXPANSION_SITE', 'Chiang Mai — Nimman')
  await item('EXP-LEGAL-REG', wsExpand.id, site.id, 'APPROVAL', 'Branch registration (DBD)', {
    status: 'DONE', weight: 2, metadata: { dimension: 'legal' },
  })
  await item('EXP-LOC-LEASE', wsExpand.id, site.id, 'SETUP_ACTION', 'Sign lease agreement', {
    status: 'DONE', weight: 2, metadata: { dimension: 'location' },
  })
  await item('EXP-BUDGET', wsExpand.id, site.id, 'APPROVAL', 'CapEx budget approval', {
    status: 'IN_PROGRESS', weight: 1, metadata: { dimension: 'budget' },
  })
  await item('EXP-HIRE-MGR', wsExpand.id, site.id, 'SETUP_ACTION', 'Hire branch manager', {
    status: 'IN_PROGRESS', weight: 2, metadata: { dimension: 'hiring' },
  })
  await item('EXP-VENDOR-FIT', wsExpand.id, site.id, 'SETUP_ACTION', 'Fit-out vendor contract', {
    status: 'PLANNED', weight: 1, metadata: { dimension: 'vendors' },
  })
  await gate('GATE-EXP-GOLIVE', wsExpand.id, 'Go-live readiness', { status: 'OPEN' })
  await milestone('MS-EXP-OPEN', wsExpand.id, 'Store opening', { status: 'PLANNED', weight: 1, targetAt: '2026-11-01' })

  // ---- Assignees ------------------------------------------------------------
  // @req FR-086 — the Dashboard's "People with work assigned" counts distinct
  // `WorkItem.assigneeRef`. No seeded item carried one, so the card read 0 on a
  // freshly seeded database and looked broken rather than empty. A second
  // Person also makes the count something other than 1, which is the number a
  // bug would most plausibly produce.
  const delivery = await prisma.person.upsert({
    where: { code: 'PER-DELIVERY' },
    update: {},
    create: { code: 'PER-DELIVERY', displayName: 'Delivery Lead', email: 'delivery@local' },
  })
  const existingDeliveryMembership = await prisma.membership.findFirst({
    where: { personId: delivery.id, tenantId: tenants['TNT-001'].id },
  })
  if (!existingDeliveryMembership) {
    await prisma.membership.create({
      data: {
        personId: delivery.id,
        tenantId: tenants['TNT-001'].id,
        businessId: businesses['BUS-001'].id,
        // MEMBER, not OWNER: `resolveViewer` builds `ownedBusinessIds` from
        // OWNER memberships, so a second owner in the demo data would quietly
        // widen what the seeded account can write.
        role: 'MEMBER',
      },
    })
  }
  await prisma.teamMembership.upsert({
    where: { teamId_personId: { teamId: growthTeam.id, personId: delivery.id } },
    update: {},
    create: { teamId: growthTeam.id, personId: delivery.id },
  })

  // Deterministic split by code order, so a re-seed assigns the same items to
  // the same people and the headcount does not drift between runs.
  const assignable = await prisma.workItem.findMany({
    where: { deletedAt: null, workstream: { projectId: project.id } },
    orderBy: { code: 'asc' },
    select: { id: true },
  })
  await Promise.all(assignable.map((workItem, index) => prisma.workItem.update({
    where: { id: workItem.id },
    data: { assigneeRef: index % 2 === 0 ? owner.id : delivery.id },
  })))

  // ---- Repository metadata (local only, no GitHub API) ---------------------
  const repo = await prisma.repository.upsert({
    where: { code: 'REP-ZURI' },
    // @req FR-073 — set on update too, so re-seeding an existing database gives
    // this row an owner instead of leaving it ungoverned and unwritable.
    update: { businessId: businesses['BUS-001'].id },
    create: {
      code: 'REP-ZURI',
      businessId: businesses['BUS-001'].id,
      provider: 'github',
      fullName: 'Freshair129/zuri',
      ownerName: 'Freshair129',
      repoName: 'zuri',
      url: 'https://github.com/Freshair129/zuri',
      defaultBranch: 'main',
    },
  })
  const existingLink = await prisma.projectRepository.findFirst({
    where: { projectId: project.id, repoId: repo.id, role: 'REFERENCE' },
  })
  if (!existingLink) {
    await prisma.projectRepository.create({
      data: { projectId: project.id, repoId: repo.id, role: 'REFERENCE', pathScope: 'src/' },
    })
  }

  // Cross-workstream dependency: data gate blocks dev release gate.
  const gateData = await prisma.gate.findUnique({ where: { code: 'GATE-DATA-ID' } })
  const gateRel = await prisma.gate.findUnique({ where: { code: 'GATE-REL-12' } })
  const depExists = await prisma.dependency.findFirst({
    where: { sourceId: gateData.id, targetId: gateRel.id, dependencyType: 'BLOCKS' },
  })
  if (!depExists) {
    await prisma.dependency.create({
      data: {
        sourceType: 'GATE',
        sourceId: gateData.id,
        targetType: 'GATE',
        targetId: gateRel.id,
        dependencyType: 'BLOCKS',
      },
    })
  }

  // @req FR-043 - additive backfill for existing Business-space Projects.
  // Shared portfolio/tenant Projects intentionally remain ownerless.
  const legacyProjects = await prisma.project.findMany({
    where: { businessId: null },
    select: { id: true, workspace: { select: { businessId: true } } },
  })
  for (const legacy of legacyProjects) {
    if (legacy.workspace?.businessId) {
      await prisma.project.update({ where: { id: legacy.id }, data: { businessId: legacy.workspace.businessId } })
    }
  }

  // @req FR-073 - additive backfill for Repositories that predate the owning
  // Business. Derived from links, and only where they agree: a Repository whose
  // Projects span two Businesses has no single owner to infer, so it is left
  // ownerless rather than assigned by guess. Ownerless means refused for every
  // principal, which is the honest outcome — scripts/backfill-repository-business.mjs
  // reports those so an owner can decide.
  const legacyRepos = await prisma.repository.findMany({
    where: { businessId: null },
    select: { id: true, projects: { select: { project: { select: { businessId: true } } } } },
  })
  for (const legacy of legacyRepos) {
    const owners = [...new Set(legacy.projects.map((l) => l.project?.businessId).filter(Boolean))]
    if (owners.length === 1) {
      await prisma.repository.update({ where: { id: legacy.id }, data: { businessId: owners[0] } })
    }
  }

  const auditCount = await prisma.auditEvent.count({ where: { action: 'SEEDED' } })
  if (auditCount === 0) {
    await prisma.auditEvent.create({
      data: {
        entityType: 'SNAPSHOT',
        entityId: 'seed',
        action: 'SEEDED',
        actorType: 'SYSTEM',
        payloadJson: JSON.stringify({ note: 'Demo dataset seeded' }),
      },
    })
  }

  console.log('Seed complete: PF-001, 4 tenants, 5 workspaces, Business 01 project with 7 workstreams.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
