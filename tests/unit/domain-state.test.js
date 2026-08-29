import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  buildDomainState,
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
  it('committed output validates against the public state schema', () => {
    const schema = JSON.parse(readFileSync('contracts/domain-state.schema.json', 'utf8'))
    const state = JSON.parse(readFileSync('docs/.domain-state.json', 'utf8'))
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
    expect(Object.keys(state.domains).sort()).toEqual([
      'agent', 'crm', 'identity', 'integration', 'knowledge', 'market-intelligence', 'platform-control', 'project-manager',
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
      generatedAt: '2026-08-18T00:00:00.000Z',
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
      generatedAt: '2026-08-18T00:00:00.000Z',
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
      generatedAt: '2026-08-18T00:00:00.000Z',
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
      generatedAt: '2026-08-30T00:00:00.000Z',
    })

    expect(state.schemaVersion).toBe('1.1')
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

  it('keeps one explicit use case for every committed projected feature', () => {
    const presentation = parseFeaturePresentation(process.cwd())
    const state = JSON.parse(readFileSync('docs/.domain-state.json', 'utf8'))

    // Compared with the committed projection rather than a literal count: the
    // rescued draft asserted 80, which is the shape of assertion that goes stale
    // on the next FR and proves nothing about coverage in the meantime.
    expect(presentation).toHaveLength(state.features.length)
    expect(new Set(presentation.map((row) => row.id)).size).toBe(presentation.length)
    expect(presentation.every((row) => row.useCase.trim().length > 0)).toBe(true)
    expect(new Set(presentation.map((row) => row.id)))
      .toEqual(new Set(state.features.map((feature) => feature.id)))
  })
})
