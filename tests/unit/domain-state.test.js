import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { buildDomainState, STATUS_VALUES } from '../../scripts/domain-state.mjs'

// @req docs governance — implementation readiness is one machine-readable,
// evidence-linked projection across all domain lanes.
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
    expect(Object.keys(state.domains).sort()).toEqual(['agent', 'crm', 'identity', 'integration', 'knowledge', 'project-manager'])
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
})
