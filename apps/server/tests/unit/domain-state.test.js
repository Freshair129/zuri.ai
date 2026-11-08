import { workspacePath } from '../../scripts/workspace-path.mjs'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  buildDomainState,
  collectDomainObservations,
  parseFeaturePresentation,
  PROGRESS_METHODOLOGY,
  STATUS_VALUES,
} from '../../scripts/domain-state.mjs'

// @req docs governance — implementation readiness is one machine-readable,
// evidence-linked projection across all domain lanes.
// @req FR-124 — every projected feature has progress, readiness, domain and use-case metadata.
// @tested tests/unit/domain-state.test.js

const nodes = [
  { id: 'domain:project-manager', type: 'domain', path: 'docs/domains/project-manager/CHARTER.md', modules: ['project-manager'], owns_models: ['Project'], owns_routes: ['src/app/(pm)/**', 'src/app/api/**'] },
  { id: 'domain:crm', type: 'domain', path: 'docs/domains/crm/CHARTER.md', modules: ['crm'], owns_models: ['Person'], owns_routes: ['src/app/api/crm/**'] },
  { id: 'req:FR-003', type: 'requirement', family: 'FR', label: 'Project CRUD', declared: 'done' },
  { id: 'req:FR-069', type: 'requirement', family: 'FR', label: 'Plan intake', declared: 'planned' },
  { id: 'code:src/modules/project-manager/application/project-service.js', type: 'code_file', path: 'src/modules/project-manager/application/project-service.js' },
  { id: 'test:tests/integration/project-core.test.js', type: 'test', path: 'tests/integration/project-core.test.js' },
  { id: 'route:page:/projects', type: 'route', kind: 'page', route: '/projects', path: 'src/app/(pm)/projects/page.jsx' },
]

const edges = [
  { from: 'route:page:/projects', to: 'domain:project-manager', type: 'owned_by' },
  { from: 'code:src/modules/project-manager/application/project-service.js', to: 'req:FR-003', type: 'implements' },
  { from: 'test:tests/integration/project-core.test.js', to: 'req:FR-003', type: 'verifies' },
]

describe('domain state projection', () => {
  it('recognizes the exact deployment-authenticated MSP retention route without widening other routes', () => {
    const api = { id: 'route:api:/api/agent/memory-retention', type: 'route', kind: 'api', route: '/api/agent/memory-retention', path: 'src/app/api/agent/memory-retention/route.js' }
    const observe = route => { const input = { nodes: [...nodes, route], edges: [...edges, { from: route.id, to: 'domain:project-manager', type: 'owned_by' }] }
      return buildDomainState({ ...input, observations: collectDomainObservations({ ...input, root: process.cwd(), featureRequirements: new Map() }) }) }
    const state = observe(api)
    expect(state.domains['project-manager'].checks.authorization.status).toBe('verified')
    const other = { ...api, route: '/api/untrusted' }
    const denied = observe(other)
    expect(denied.domains['project-manager'].checks.authorization.status).toBe('partial')
  })
  it('serializes identical source inputs identically across different generation times', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-09-12T12:42:27.274Z'))
      const first = JSON.stringify(buildDomainState({ nodes, edges }))
      vi.setSystemTime(new Date('2026-09-12T13:00:14.773Z'))
      const second = JSON.stringify(buildDomainState({ nodes, edges }))
      expect(second).toBe(first)
      expect(JSON.parse(second)).not.toHaveProperty('generatedAt')
    } finally {
      vi.useRealTimers()
    }
  })

  it('committed output validates against the public state schema', () => {
    const schema = JSON.parse(readFileSync('contracts/domain-state.schema.json', 'utf8'))
    const state = JSON.parse(readFileSync(workspacePath(process.cwd(), 'docs/.domain-state.json'), 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)

    expect(validate(state), JSON.stringify(validate.errors)).toBe(true)
    // Derived from the filesystem, so this list must track `ls docs/domains/`. It is
    // spelled out rather than globbed on purpose: a domain appearing or vanishing is a
    // structural change someone should have to acknowledge here.
    //
    // `market-intelligence` was added to main in 3a0f72f but nobody regenerated
    // docs/.domain-state.json, so the committed projection kept claiming six domains
    // and this assertion kept passing against a file that had stopped being true. CI
    // did not catch it either: its staleness step checks FEATURE-MAP, DOMAIN-MAP,
    // TRACE and D-traceability, and .domain-state.json is not in that list.
    // `inventory` joined on 2026-09-06 (FR-154/FR-155, DOM-INVENTORY);
    // `commerce` on 2026-09-07 (FR-166/FR-163, DOM-COMMERCE);
    // `procurement` on 2026-09-07 (FR-164/FR-165, DOM-PROCUREMENT).
    expect(Object.keys(state.domains).sort()).toEqual([
      'agent', 'asset-management', 'commerce', 'crm', 'file-management', 'identity', 'integration', 'inventory', 'knowledge', 'line-oa-studio', 'market-intelligence', 'marketing', 'platform-control', 'procurement', 'project-manager',
    ])
  })

  it('uses a stable status vocabulary and derives partial readiness from planned requirements', () => {
    const state = buildDomainState({
      nodes,
      edges,
      featureRequirements: new Map([['project-manager', ['FR-069']]]),
      observations: {
        'project-manager': {
          checks: {
            ui: { status: 'verified', evidence: ['docs/INTERFACE-INVENTORY.md'] },
            httpApi: { status: 'partial', evidence: ['docs/appendices/A-api-spec.md'] },
          },
        },
      },
    })

    expect(STATUS_VALUES).toEqual([
      'verified',
      'partial',
      'planned',
      'blocked',
      'not_implemented',
      'not_applicable',
      'unknown',
    ])
    expect(state.overall.status).toBe('partial')
    expect(state.domains['project-manager'].status).toBe('partial')
    expect(state.domains['project-manager'].requirements).toEqual([
      expect.objectContaining({ id: 'FR-003', status: 'verified', codeCount: 1, testCount: 1 }),
      expect.objectContaining({ id: 'FR-069', status: 'planned', codeCount: 0, testCount: 0 }),
    ])
    expect(state.domains.crm.status).toBe('not_applicable')
    expect(state.domains['project-manager'].checks.httpApi.status).toBe('partial')
    expect(state.domains['project-manager'].checks.mcp.status).toBe('unknown')
  })

  it('recognizes unprefixed OAuth callbacks and signed provider webhooks as governed endpoints', () => {
    const state = JSON.parse(readFileSync(workspacePath(process.cwd(), 'docs/.domain-state.json'), 'utf8'))
    const integration = state.domains.integration

    expect(integration.checks.httpApi).toEqual(expect.objectContaining({
      status: 'verified',
      details: expect.objectContaining({ missingFromOpenApi: 0 }),
      gaps: [],
    }))
    expect(integration.checks.authorization.status).toBe('verified')
  })

  it('keeps evidence and gaps attached to the check that produced them', () => {
    const state = buildDomainState({
      nodes,
      edges,
      featureRequirements: new Map(),
      observations: {
        'project-manager': {
          checks: {
            jsonSchema: {
              status: 'blocked',
              evidence: ['contracts/plan-envelope.schema.json'],
              gaps: [{ id: 'SCHEMA-001', severity: 'high', summary: 'Schema drift', evidence: ['contracts/plan-envelope.schema.json'] }],
            },
          },
        },
      },
    })

    expect(state.domains['project-manager'].checks.jsonSchema).toEqual({
      status: 'blocked',
      evidence: ['contracts/plan-envelope.schema.json'],
      gaps: [{ id: 'SCHEMA-001', severity: 'high', summary: 'Schema drift', evidence: ['contracts/plan-envelope.schema.json'] }],
    })
    expect(state.domains['project-manager'].gaps).toEqual([
      { id: 'SCHEMA-001', severity: 'high', check: 'jsonSchema', summary: 'Schema drift', evidence: ['contracts/plan-envelope.schema.json'] },
    ])
  })

  it('counts explicitly owned shared shell code for a domain requirement', () => {
    const sharedNodes = [
      ...nodes.map((node) => node.id === 'domain:project-manager'
        ? { ...node, owns_code: ['src/components/layouts/**'] }
        : node),
      { id: 'req:FR-033', type: 'requirement', family: 'FR', label: 'Topbar', declared: 'done' },
      { id: 'code:src/components/layouts/Topbar.jsx', type: 'code_file', path: 'src/components/layouts/Topbar.jsx' },
      { id: 'test:tests/unit/topbar.test.js', type: 'test', path: 'tests/unit/topbar.test.js' },
    ]
    const sharedEdges = [
      ...edges,
      { from: 'code:src/components/layouts/Topbar.jsx', to: 'req:FR-033', type: 'implements' },
      { from: 'test:tests/unit/topbar.test.js', to: 'req:FR-033', type: 'verifies' },
    ]
    const state = buildDomainState({
      nodes: sharedNodes,
      edges: sharedEdges,
      featureRequirements: new Map([['project-manager', ['FR-033']]]),
      observations: {},
    })

    expect(state.domains['project-manager'].requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'FR-033', status: 'verified', codeCount: 1, testCount: 1 }),
    ]))
  })

  const featureNodes = [
    ...nodes,
    { id: 'feat:FEAT-999', type: 'feature', label: 'Project bundle', declared: 'live' },
  ]
  const featureEdges = [
    ...edges,
    { from: 'feat:FEAT-999', to: 'req:FR-003', type: 'bundles' },
  ]

  it('projects complete features with visible methodology and separate readiness', () => {
    const featurePresentation = [
      { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates and reviews a project.' },
      { id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews an execution plan.' },
    ]
    const state = buildDomainState({
      nodes: featureNodes,
      edges: featureEdges,
      featurePresentation,
    })

    expect(state.schemaVersion).toBe('2.0')
    expect(state.progressMethodology).toEqual(PROGRESS_METHODOLOGY)
    expect(state.overall).toEqual(expect.objectContaining({
      featureCount: 2,
      readyFeatureCount: 1,
      requirementCount: 2,
      verifiedRequirementCount: 1,
      progressPercent: 50,
    }))
    expect(state.features).toEqual([
      expect.objectContaining({ id: 'FEAT-999', progressPercent: 100, ready: true, primaryDomain: 'project-manager' }),
      expect.objectContaining({ id: 'FR-069', progressPercent: 0, ready: false, blockers: ['FR-069 is planned'] }),
    ])
    expect(state.domains['project-manager']).toEqual(expect.objectContaining({
      featureIds: ['FEAT-999', 'FR-069'],
      featureCount: 2,
      readyFeatureCount: 1,
      progressPercent: 50,
    }))
    // A domain that owns no projected feature reports null, not 0 — "nothing is
    // claimed here" is a different statement from "nothing has been built".
    expect(state.domains.crm.progressPercent).toBeNull()
    expect(state.domains.crm.featureCount).toBe(0)
  })

  it('keeps superseded capabilities in history and excludes them from active rollups', () => {
    const retiredNodes = [
      ...featureNodes,
      { id: 'feat:FEAT-998', type: 'feature', label: 'Retired delivery control', declared: 'superseded by ADR-113', status: 'superseded' },
    ]
    const retiredEdges = [
      ...featureEdges,
      { from: 'feat:FEAT-998', to: 'req:FR-069', type: 'bundles' },
    ]
    const state = buildDomainState({
      nodes: retiredNodes,
      edges: retiredEdges,
      featurePresentation: [
        { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates and reviews a project.' },
        { id: 'FEAT-998', primaryDomain: 'project-manager', useCase: 'Historical delivery control record.' },
      ],
    })

    expect(state.features.map((feature) => feature.id)).toEqual(['FEAT-999'])
    expect(state.historicalFeatures).toEqual([
      expect.objectContaining({ id: 'FEAT-998', requirementIds: ['FR-069'] }),
    ])
    expect(state.historicalFeatures[0]).toMatchObject({
      registryStatus: 'superseded by ADR-113',
      progressPercent: 0,
      requirements: [expect.objectContaining({ id: 'FR-069', status: 'not_applicable', progressPercent: 0 })],
    })
    expect(state.historicalFeatures[0].requirements[0].title).toMatch(/^\[historical\]/)
    expect(state.overall).toEqual(expect.objectContaining({
      featureCount: 1,
      readyFeatureCount: 1,
      requirementCount: 1,
      verifiedRequirementCount: 1,
      progressPercent: 100,
    }))
    expect(state.overall.gaps.filter((item) => item.id === 'REQ-FR-069')).toEqual([])
    expect(state.domains['project-manager']).toEqual(expect.objectContaining({
      featureIds: ['FEAT-999'],
      featureCount: 1,
      readyFeatureCount: 1,
      progressPercent: 100,
    }))
  })

  it('keeps one superseded FEAT member resolvable while readiness uses only its active member', () => {
    const retiredRequirement = {
      id: 'req:FR-189',
      type: 'requirement',
      family: 'FR',
      label: '~~Edge answers SmartGift catalog queries~~',
      declared: 'n/a',
      status: 'superseded',
    }
    const retiredCode = {
      id: 'code:apps/edge/src/rag/retired-edge.js',
      type: 'code_file',
      path: 'apps/edge/src/rag/retired-edge.js',
    }
    const retiredTest = {
      id: 'test:apps/edge/tests/retired-edge.test.js',
      type: 'test',
      path: 'apps/edge/tests/retired-edge.test.js',
    }
    const state = buildDomainState({
      nodes: [...featureNodes, retiredRequirement, retiredCode, retiredTest],
      edges: [
        ...featureEdges,
        { from: 'feat:FEAT-999', to: 'req:FR-189', type: 'bundles' },
        { from: retiredCode.id, to: retiredRequirement.id, type: 'implements' },
        { from: retiredTest.id, to: retiredRequirement.id, type: 'verifies' },
      ],
      featureRequirements: new Map([['project-manager', ['FR-189']]]),
      featurePresentation: [
        { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates and reviews a project.' },
        { id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews an execution plan.' },
      ],
    })
    const feature = state.features.find((item) => item.id === 'FEAT-999')

    expect(feature.requirementIds).toEqual(['FR-003'])
    expect(feature.requirements.map((item) => item.id)).toEqual(['FR-003'])
    expect(feature.requirements.some((item) => item.id === 'FR-189')).toBe(false)
    expect(feature).toMatchObject({ progressPercent: 100, ready: true, blockers: [] })
    expect(state.domains['project-manager'].requirements.map((item) => item.id)).toEqual(['FR-003', 'FR-189'])
    expect(state.domains['project-manager'].requirements.find((item) => item.id === 'FR-189')).toMatchObject({
      title: '[historical] Edge answers SmartGift catalog queries',
      status: 'not_applicable',
    })
    expect(state.domains['project-manager'].progressPercent).toBe(50)
    expect(state.overall).toMatchObject({ requirementCount: 2, verifiedRequirementCount: 1, progressPercent: 50 })
    expect(new Set(state.features.flatMap((item) => item.requirements.map((requirement) => requirement.id))).size)
      .toBe(state.overall.requirementCount)
    expect(state.domains['project-manager'].gaps.filter((item) => item.id === 'REQ-FR-189')).toEqual([])
    expect(state.overall.gaps.filter((item) => item.id === 'REQ-FR-189')).toEqual([])
  })

  it('does not let historical FR evidence create active tests or runtime-contract findings', () => {
    const retiredRequirement = {
      id: 'req:FR-189',
      type: 'requirement',
      family: 'FR',
      label: '~~Edge answers SmartGift catalog queries~~',
      declared: 'n/a',
      status: 'superseded',
    }
    const retiredTest = {
      id: 'test:apps/edge/tests/retired-edge.test.js',
      type: 'test',
      path: 'apps/edge/tests/retired-edge.test.js',
    }
    const retiredNodes = [nodes[0], retiredRequirement, retiredTest]
    const retiredEdges = [{ from: retiredTest.id, to: retiredRequirement.id, type: 'verifies' }]
    const featureRequirements = new Map([['project-manager', ['FR-189']]])
    const excludedRequirementIds = new Set(['FR-189'])
    const observations = collectDomainObservations({
      root: process.cwd(),
      nodes: retiredNodes,
      edges: retiredEdges,
      featureRequirements,
      excludedRequirementIds,
    })
    const state = buildDomainState({
      nodes: retiredNodes,
      edges: retiredEdges,
      featureRequirements,
      observations,
    })

    expect(observations['project-manager'].checks.tests).toMatchObject({ status: 'not_applicable', gaps: [] })
    expect(observations['project-manager'].checks.runtimeContract).toMatchObject({ status: 'not_applicable', gaps: [] })
    expect(state.domains['project-manager'].requirements).toContainEqual(
      expect.objectContaining({ id: 'FR-189', title: '[historical] Edge answers SmartGift catalog queries', status: 'not_applicable' }),
    )
    expect(state.domains['project-manager'].gaps.filter((item) => ['TEST-001', 'CONTRACT-001', 'REQ-FR-189'].includes(item.id))).toEqual([])
  })

  it('keeps a current FEAT with no active members in history without an empty or ready projection', () => {
    const retiredRequirement = {
      id: 'req:FR-189',
      type: 'requirement',
      family: 'FR',
      label: '~~Edge answers SmartGift catalog queries~~',
      declared: 'n/a',
      status: 'superseded',
    }
    const state = buildDomainState({
      nodes: [...featureNodes, retiredRequirement],
      edges: [
        ...edges,
        { from: 'feat:FEAT-999', to: 'req:FR-189', type: 'bundles' },
      ],
      featureRequirements: new Map([['project-manager', ['FR-189']]]),
      featurePresentation: [
        { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates and reviews a project.' },
        { id: 'FR-003', primaryDomain: 'project-manager', useCase: 'A PM creates a project.' },
        { id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews an execution plan.' },
      ],
    })
    const feature = state.historicalFeatures.find((item) => item.id === 'FEAT-999')
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(JSON.parse(readFileSync('contracts/domain-state.schema.json', 'utf8')))

    expect(state.features.some((item) => item.id === 'FEAT-999')).toBe(false)
    expect(feature).toMatchObject({
      registryStatus: 'live',
      requirementIds: ['FR-189'],
      progressPercent: 0,
      ready: false,
      blockers: ['FEAT-999 has no active requirements'],
      requirements: [{
        id: 'FR-189',
        title: '[historical] Edge answers SmartGift catalog queries',
        status: 'not_applicable',
        progressPercent: 0,
      }],
    })
    expect(state.overall).toMatchObject({ requirementCount: 2, verifiedRequirementCount: 1, progressPercent: 50 })
    expect(state.domains['project-manager'].progressPercent).toBe(50)
    expect(state.overall.gaps.filter((item) => item.id === 'REQ-FR-189')).toEqual([])
    expect(validate(state), JSON.stringify(validate.errors)).toBe(true)
  })

  it('keeps a current FR active when its declaration annotation lags', () => {
    const laggingRequirement = {
      id: 'req:FR-003',
      type: 'requirement',
      family: 'FR',
      label: 'Project CRUD',
      declared: 'n/a',
      status: 'current',
    }
    const laggingNodes = [
      ...featureNodes.filter((node) => node.id !== 'req:FR-003'),
      laggingRequirement,
    ]
    const state = buildDomainState({
      nodes: laggingNodes,
      edges: featureEdges,
      featurePresentation: [
        { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates and reviews a project.' },
        { id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews an execution plan.' },
      ],
    })

    expect(state.features.find((item) => item.id === 'FEAT-999')).toMatchObject({
      requirementIds: ['FR-003'],
      progressPercent: 100,
      requirements: [expect.objectContaining({ id: 'FR-003', status: 'verified', progressPercent: 100 })],
    })
    expect(state.overall.requirementCount).toBe(2)
    expect(state.domains['project-manager'].requirements).toContainEqual(
      expect.objectContaining({ id: 'FR-003', declared: 'n/a', status: 'verified' }),
    )
  })

  it('fails closed when projected feature presentation metadata is incomplete', () => {
    expect(() => buildDomainState({
      nodes: featureNodes,
      edges: featureEdges,
      featurePresentation: [
        { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates a project.' },
      ],
    })).toThrow('Readiness metadata is missing projected features: FR-069')
  })

  // The guard's own blind spot, pinned. An earlier draft returned `[]` for an
  // empty presentation array, so a `readiness-metadata` block containing `[]`
  // projected no features and reported success — the check could not see the
  // one input that defeats it. `null` (no argument at all) still means "this
  // fixture is not exercising the feature half"; `[]` is now a real answer and
  // a wrong one.
  it('treats an empty metadata array as a wrong answer, not as an opt-out', () => {
    expect(() => buildDomainState({
      nodes: featureNodes,
      edges: featureEdges,
      featurePresentation: [],
    })).toThrow(/missing projected features: FEAT-999, FR-069/)

    expect(buildDomainState({ nodes: featureNodes, edges: featureEdges }).features).toEqual([])
  })

  it('rejects metadata that duplicates, invents or under-specifies an entry', () => {
    const build = (featurePresentation) => () => buildDomainState({ nodes: featureNodes, edges: featureEdges, featurePresentation })
    const valid = [
      { id: 'FEAT-999', primaryDomain: 'project-manager', useCase: 'A PM creates a project.' },
      { id: 'FR-069', primaryDomain: 'project-manager', useCase: 'A Human previews a plan.' },
    ]
    // Assembled rather than written out: the doc-graph scans this file for
    // requirement ids and would read a literal `FR-` + three digits as a real
    // reference, making an undeclared id in a negative test a dangling edge.
    const undeclared = ['FR', '777'].join('-')

    expect(build([...valid, valid[0]])).toThrow('Duplicate readiness metadata for FEAT-999')
    expect(build([...valid, { id: undeclared, primaryDomain: 'crm', useCase: 'Nobody.' }]))
      .toThrow(new RegExp(`names non-projected features: ${undeclared}`))
    expect(build([valid[0], { ...valid[1], primaryDomain: 'no-such-domain' }]))
      .toThrow('FR-069 names unknown primary domain no-such-domain')
    expect(build([valid[0], { ...valid[1], useCase: '   ' }]))
      .toThrow('FR-069 has no example use case')
  })

  it('rejects mismatched wire kind and ID prefix in schema 2.0', () => {
    const schema = JSON.parse(readFileSync('contracts/domain-state.schema.json', 'utf8'))
    const state = JSON.parse(readFileSync(workspacePath(process.cwd(), 'docs/.domain-state.json'), 'utf8'))
    const ajv = new Ajv2020({ strict: true, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    expect(validate(state)).toBe(true)
    const item = state.features.find(row => row.id.startsWith('FR-'))
    item.kind = 'bundle'
    expect(validate(state)).toBe(false)
  })

  it('keeps one explicit use case for every committed projected feature', () => {
    const presentation = parseFeaturePresentation(process.cwd())
    const state = JSON.parse(readFileSync(workspacePath(process.cwd(), 'docs/.domain-state.json'), 'utf8'))

    // Compared with the committed projection rather than a literal count: the
    // rescued draft asserted 80, which is the shape of assertion that goes stale
    // on the next FR and proves nothing about coverage in the meantime.
    const allFeatures = [...state.features, ...state.historicalFeatures]
    expect(presentation).toHaveLength(allFeatures.length)
    expect(new Set(presentation.map((row) => row.id)).size).toBe(presentation.length)
    expect(presentation.every((row) => row.useCase.trim().length > 0)).toBe(true)
    expect(new Set(presentation.map((row) => row.id)))
      .toEqual(new Set(allFeatures.map((feature) => feature.id)))
  })
})


it('retains requirement membership when code paths move under apps/server', () => {
  const relocated = nodes.map(n => ({ ...n, path: /^(src|tests)\//.test(n.path) ? `apps/server/${n.path}` : n.path }))
  const before = buildDomainState({ nodes, edges })
  const after = buildDomainState({ nodes: relocated, edges })
  expect(JSON.stringify(after).replaceAll('apps/server/', '')).toEqual(JSON.stringify(before))
})
