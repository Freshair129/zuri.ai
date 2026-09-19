// @req FR-212 — the data pipeline map is a validated registry: surfaces, statuses
//   and FEATs are derived, and a registry that contradicts the tree is refused by name.
// @spec ADR-085 D2, D3, D4
// @tested tests/unit/data-pipeline-map.test.js
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DataPipelineMapError,
  buildDataPipelineMap,
  generateDataPipelineMap,
  parseRegistry,
} from '../../scripts/data-pipeline-map.mjs'

const domainState = {
  domains: { crm: {}, 'line-oa-studio': {} },
  features: [
    { id: 'FEAT-009', requirements: [{ id: 'FR-091', status: 'verified', title: 'Inbox' }] },
    { id: 'FEAT-019', requirements: [{ id: 'FR-149', status: 'verified', title: 'Transport' }, { id: 'FR-150', status: 'partial', title: 'Edge' }] },
    { id: 'FR-128', requirements: [{ id: 'FR-128', status: 'planned', title: 'Brief' }] },
  ],
}

const existing = new Set(['ENDPOINT /api/hook', 'UI /inbox', 'WORKER apps/server/scripts/worker.mjs'])
const surfaceExists = (type, ref) => existing.has(`${type} ${ref}`)

function registry(overrides = {}) {
  return {
    nodes: [
      { id: 'src.users', kind: 'SOURCE', system: 'external', label: 'Users' },
      { id: 'in.hook', kind: 'ENTRY', system: 'zuri-ai', domain: 'line-oa-studio', label: 'Hook', requirements: ['FR-149'], surfaces: [{ type: 'ENDPOINT', ref: '/api/hook' }], production: { evidence: 'deployed abc123' } },
      { id: 'p.jobs', kind: 'PROCESS', system: 'zuri-ai', domain: 'line-oa-studio', label: 'Jobs', requirements: ['FR-149', 'FR-150'], surfaces: [{ type: 'WORKER', ref: 'apps/server/scripts/worker.mjs' }] },
      { id: 's.crm', kind: 'STORE', system: 'zuri-ai', domain: 'crm', label: 'CRM', requirements: ['FR-091'], surfaces: [{ type: 'UI', ref: '/inbox' }] },
      { id: 'p.brief', kind: 'PROCESS', system: 'zuri-ai', domain: 'crm', label: 'Brief', requirements: ['FR-128'] },
      { id: 'r.line', kind: 'RECIPIENT', system: 'external', label: 'LINE' },
    ],
    edges: [
      { id: 'e.in', from: 'src.users', to: 'in.hook', label: 'events' },
      { id: 'e.jobs', from: 'in.hook', to: 'p.jobs', label: 'job' },
      { id: 'e.out', from: 'p.jobs', to: 'r.line', label: 'reply' },
      { id: 'e.crm', from: 'p.jobs', to: 's.crm', label: 'messages' },
      { id: 'e.brief-in', from: 's.crm', to: 'p.brief', label: 'history' },
      { id: 'e.brief-out', from: 'p.brief', to: 'r.line', label: 'brief', wired: false },
    ],
    chains: [
      { id: 'CH-01', name: 'Turn', path: ['e.in', 'e.jobs', 'e.out'], branches: ['e.crm'] },
    ],
    ...overrides,
  }
}

const build = (reg, extra = {}) => buildDataPipelineMap({ registry: reg, domainState, surfaceExists, ...extra })
const problemsOf = (fn) => {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(DataPipelineMapError)
    return error.problems
  }
  throw new Error('expected the registry to be refused')
}

describe('FR-212 data pipeline map generator', () => {
  it('derives build status, surface level and FEATs, and takes the weakest status for edges and chains', () => {
    const map = build(registry())
    const node = (id) => map.nodes.find((n) => n.id === id)
    expect(node('in.hook')).toMatchObject({ buildStatus: 'PRODUCTION', surfaceLevel: 'ENDPOINT', features: ['FEAT-019'], evidence: 'deployed abc123' })
    expect(node('p.jobs')).toMatchObject({ buildStatus: 'PARTIAL', surfaceLevel: 'WORKER' })
    expect(node('s.crm')).toMatchObject({ buildStatus: 'CODE_TESTS', surfaceLevel: 'UI', features: ['FEAT-009'] })
    expect(node('p.brief')).toMatchObject({ buildStatus: 'DECLARED', surfaceLevel: 'NONE' })
    expect(node('src.users')).toMatchObject({ buildStatus: null, surfaceLevel: null, requirements: [] })

    const edge = (id) => map.edges.find((e) => e.id === id)
    expect(edge('e.in').status).toBe('PRODUCTION')
    expect(edge('e.jobs').status).toBe('PARTIAL')
    expect(edge('e.brief-out')).toMatchObject({ wired: false, status: 'DECLARED' })

    expect(map.chains[0]).toMatchObject({ id: 'CH-01', status: 'PARTIAL', domains: ['crm', 'line-oa-studio'], features: ['FEAT-009', 'FEAT-019'] })
    expect(map.summary).toMatchObject({ nodes: 6, edges: 6, chains: 1, chainsByStatus: { PARTIAL: 1 } })
  })

  it('refuses a surface that does not exist, an unknown requirement and a production claim without evidence', () => {
    const reg = registry()
    reg.nodes[1].surfaces.push({ type: 'UI', ref: '/missing' })
    reg.nodes[2].requirements.push('UNDECLARED-ID')
    reg.nodes[3].production = { evidence: '  ' }
    const problems = problemsOf(() => build(reg))
    expect(problems).toContain('in.hook declares UI /missing, which does not exist')
    expect(problems).toContain('p.jobs names UNDECLARED-ID, which the FR-124 snapshot does not know')
    expect(problems).toContain('s.crm claims production with no written evidence')
  })

  it('refuses dangling edges, orphan nodes and chains that do not join or do not run source to recipient', () => {
    const reg = registry({
      chains: [
        { id: 'CH-01', name: 'Broken', path: ['e.in', 'e.out'] },
        { id: 'CH-02', name: 'Starts inside', path: ['e.jobs', 'e.out'] },
      ],
    })
    reg.nodes.push({ id: 's.orphan', kind: 'STORE', system: 'zuri-ai', domain: 'crm', label: 'Orphan', requirements: ['FR-091'] })
    reg.edges.push({ id: 'e.nowhere', from: 'p.jobs', to: 'r.nobody', label: 'lost' })
    const problems = problemsOf(() => build(reg))
    expect(problems).toContain('e.nowhere ends at unknown node r.nobody')
    expect(problems).toContain('s.orphan is not joined by any edge')
    expect(problems).toContain('CH-01 path breaks between e.in and e.out')
    expect(problems).toContain('CH-02 path must start at a SOURCE, not in.hook')
  })

  it('refuses status on external nodes, internal nodes without a domain or requirement, and chains the document does not list', () => {
    const reg = registry()
    reg.nodes[0].requirements = ['FR-091']
    reg.nodes[4] = { id: 'p.brief', kind: 'PROCESS', system: 'zuri-ai', label: 'Brief' }
    const problems = problemsOf(() => build(reg, { documentChainIds: ['CH-01', 'CH-09'] }))
    expect(problems).toContain('src.users is a SOURCE and may not carry requirements, surfaces or a status — those belong to the zuri-ai node it talks to')
    expect(problems).toContain('p.brief is internal and names no domain')
    expect(problems).toContain('p.brief is internal and names no requirement')
    expect(problems).toContain('CH-09 is in the document\'s chain table but not in the registry')
  })

  it('marks a blocked node BLOCKED whatever its requirements say', () => {
    const reg = registry()
    reg.nodes[3].blocked = 'waiting on an attestation'
    const map = build(reg)
    expect(map.nodes.find((n) => n.id === 's.crm')).toMatchObject({ buildStatus: 'BLOCKED', blocked: 'waiting on an attestation' })
    expect(map.chains[0].status).toBe('BLOCKED')
  })

  it('refuses a document with no registry block', () => {
    expect(() => parseRegistry('# nothing here')).toThrow(DataPipelineMapError)
  })

  it('the committed runtime projection is exactly what the registry generates today', () => {
    const root = process.cwd()
    const committedDomainState = JSON.parse(readFileSync(path.join(root, 'runtime', 'domain-state.json'), 'utf8'))
    const generated = JSON.stringify(generateDataPipelineMap({ root, domainState: committedDomainState }), null, 2) + '\n'
    expect(readFileSync(path.join(root, 'runtime', 'data-pipeline-map.json'), 'utf8')).toBe(generated)
  })

  it('answers how many chains there are from the registry, with every chain running source to recipient', () => {
    const map = JSON.parse(readFileSync(path.join(process.cwd(), 'runtime', 'data-pipeline-map.json'), 'utf8'))
    expect(map.summary.chains).toBe(map.chains.length)
    expect(map.chains.length).toBeGreaterThanOrEqual(20)
    const nodeById = new Map(map.nodes.map((n) => [n.id, n]))
    const edgeById = new Map(map.edges.map((e) => [e.id, e]))
    for (const chain of map.chains) {
      expect(nodeById.get(edgeById.get(chain.path[0]).from).kind, chain.id).toBe('SOURCE')
      expect(nodeById.get(edgeById.get(chain.path.at(-1)).to).kind, chain.id).toBe('RECIPIENT')
    }
    // No projection field carries Business data: only ids, labels, paths and statuses.
    expect(JSON.stringify(map)).not.toMatch(/tenantId|businessId"|@example|lineUserId/)
  })
})
