import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { apiCheck, authorizationCheck, buildDomainState, STATUS_VALUES } from '../../scripts/domain-state.mjs'

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
  it('distinguishes an explicitly documented public mutation from an unguarded mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'zuri-domain-state-'))
    try {
      mkdirSync(join(root, 'src/app/api/public'), { recursive: true })
      mkdirSync(join(root, 'src/app/api/open'), { recursive: true })
      writeFileSync(
        join(root, 'src/app/api/public/route.js'),
        '// @public-mutation POST FR-046 — server-owned entry stub\nexport async function POST() {}\n',
      )
      writeFileSync(join(root, 'src/app/api/open/route.js'), 'export async function POST() {}\n')

      const result = authorizationCheck(root, [
        { kind: 'api', path: 'src/app/api/public/route.js' },
        { kind: 'api', path: 'src/app/api/open/route.js' },
      ])

      expect(result.status).toBe('partial')
      expect(result.details).toMatchObject({
        mutations: 2,
        guardedMutations: 0,
        publicMutations: 1,
        unguardedMutations: 1,
      })
      expect(result.gaps).toEqual([
        expect.objectContaining({
          id: 'AUTH-001',
          evidence: ['src/app/api/open/route.js#POST'],
        }),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not flag the documented public session bootstrap route', () => {
    const result = authorizationCheck(process.cwd(), [
      { kind: 'api', path: 'src/app/api/session/login/route.js' },
    ])

    expect(result.status).toBe('verified')
    expect(result.details).toMatchObject({ mutations: 1, publicMutations: 1, unguardedMutations: 0 })
    expect(result.gaps).toEqual([])
  })

  it('detects method-level drift when a documented path is missing a live route operation', () => {
    const root = mkdtempSync(join(tmpdir(), 'zuri-api-check-'))
    try {
      mkdirSync(join(root, 'docs', 'appendices'), { recursive: true })
      mkdirSync(join(root, 'src', 'modules', 'project-manager', 'api-docs'), { recursive: true })
      mkdirSync(join(root, 'src', 'app', 'api', 'example'), { recursive: true })
      writeFileSync(join(root, 'docs', 'appendices', 'A-api-spec.md'), '| Method | Path | Contract |\n|---|---|---|\n| GET | `/api/example` | test |\n')
      writeFileSync(join(root, 'src', 'modules', 'project-manager', 'api-docs', 'openapi.js'), "const routes = [['/api/example', ['GET']]]")
      writeFileSync(join(root, 'src', 'app', 'api', 'example', 'route.js'), 'export async function GET() {}\nexport async function DELETE() {}\n')

      const result = apiCheck(root, [{ kind: 'api', route: '/api/example', path: 'src/app/api/example/route.js' }])

      expect(result.status).toBe('partial')
      expect(result.gaps).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'API-INVENTORY-002', evidence: ['DELETE /api/example'] }),
        expect.objectContaining({ id: 'API-OPENAPI-002', evidence: ['DELETE /api/example'] }),
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
      'agent', 'crm', 'identity', 'integration', 'knowledge', 'market-intelligence', 'project-manager',
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
})
