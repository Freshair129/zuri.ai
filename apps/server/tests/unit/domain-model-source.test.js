import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modelSourceFromFrontmatter, readDomainModelSource } from '../../scripts/domain-model-source.mjs'
import { buildDomainState, collectDomainObservations } from '../../scripts/domain-state.mjs'

const roots = []
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zai-domain-source-'))
  roots.push(root)
  return root
}
function put(root, name, body) {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body)
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('declared domain model source', () => {
  it('recognizes concrete standalone SQL models and leaves planned models absent', () => {
    const root = fixture()
    const source = 'services/file-management/migrations/0001_file_management.sql'
    put(root, source, `-- CREATE TABLE ghost_model (id text);
      CREATE TABLE IF NOT EXISTS zuri_files.file_record (id uuid);
      CREATE TABLE zuri_files.file_version (id uuid);
      CREATE TABLE "zuri_files"."file_operation" (id uuid);`)
    const found = readDomainModelSource(root, source)
    expect([...found.models]).toEqual(['FileRecord', 'FileVersion', 'FileOperation'])
    expect(found.models.has('FileUsageReference')).toBe(false)

    const domain = { id: 'domain:file-management', type: 'domain', model_source: source,
      owns_models: ['FileRecord', 'FileVersion', 'FileOperation', 'FileUsageReference'], modules: [], owns_code: [] }
    const result = collectDomainObservations({ root, nodes: [domain], edges: [], featureRequirements: new Map() })
    expect(result['file-management'].checks.database).toEqual(expect.objectContaining({
      status: 'partial', evidence: [source], details: { models: 4, present: 3 },
      gaps: [expect.objectContaining({ id: 'DB-001', evidence: ['FileUsageReference'] })],
    }))
    expect(result['file-management'].checks.mcp.status).toBe('not_applicable')
  })

  it('fails closed on a missing or escaping declared source', () => {
    const root = fixture()
    const domain = { id: 'domain:file-management', type: 'domain', model_source: 'services/file-management/migrations/missing.sql', owns_models: ['FileRecord'] }
    const result = collectDomainObservations({ root, nodes: [domain], edges: [], featureRequirements: new Map() })
    expect(result['file-management'].checks.database.status).toBe('blocked')
    const emptyClaims = collectDomainObservations({ root, nodes: [{ ...domain, owns_models: [] }], edges: [], featureRequirements: new Map() })
    expect(emptyClaims['file-management'].checks.database.status).toBe('blocked')
    expect(() => readDomainModelSource(root, '../outside.sql')).toThrow(/outside-workspace/)
  })

  it('parses an inline YAML comment and rejects unsupported or duplicate declarations', () => {
    const source = 'services/file-management/migrations/0001_file_management.sql'
    expect(modelSourceFromFrontmatter(`model_source: ${source} # checked SQL evidence\n`)).toBe(source)
    expect(modelSourceFromFrontmatter(`model_source: "${source}" # checked SQL evidence\n`)).toBe(source)
    expect(() => modelSourceFromFrontmatter('model_source: [services/file-management/schema.sql]\n')).toThrow(/Invalid model_source declaration/)
    expect(() => modelSourceFromFrontmatter('model_source: \n')).toThrow(/Invalid model_source declaration/)
    expect(() => modelSourceFromFrontmatter(`model_source: ${source}\nmodel_source: ${source}\n`)).toThrow(/Duplicate/)
  })

  it('lists a declared standalone source in domain-state lineage', () => {
    const source = 'services/file-management/migrations/0001_file_management.sql'
    const state = buildDomainState({ nodes: [{ id: 'domain:file-management', type: 'domain', model_source: source }], edges: [] })
    expect(state.generatedFrom).toContain(source)
  })

  it('retains the flat Server Prisma default', () => {
    const root = fixture()
    put(root, 'prisma/schema.prisma', 'model Project {\n  id String @id\n}\n')
    expect([...readDomainModelSource(root).models]).toEqual(['Project'])
  })

  it('scopes MCP protocol proof to an owned adapter', () => {
    const root = fixture()
    put(root, 'src/modules/project-manager/mcp/transport.js', "export function handle(message) { if (message.method === 'initialize') {} if (message.method === 'tools/list') {} if (message.method !== 'tools/call') {} }")
    put(root, 'tests/unit/project-manager-mcp.test.js', "import '@/modules/project-manager/mcp/transport'\n// initialize tools/list tools/call")
    const nodes = [
      { id: 'domain:project-manager', type: 'domain', modules: ['project-manager'], owns_models: [] },
      { id: 'domain:file-management', type: 'domain', modules: [], owns_code: ['services/file-management/**'], owns_models: [] },
    ]
    const result = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(result['project-manager'].checks.mcp.status).toBe('partial')
    expect(result['file-management'].checks.mcp.status).toBe('not_applicable')
    put(root, 'tests/unit/project-manager-mcp.test.js', "import { handle } from '@/modules/project-manager/mcp/transport'\nawait handle({ method: 'initialize' }); await handle({ method: 'tools/list' }); await handle({ method: 'tools/call' }); expect(true).toBe(true)")
    const withProtocolProof = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(withProtocolProof['project-manager'].checks.mcp.status).toBe('verified')
    put(root, 'services/file-management/src/mcp/transport.js', "export function handle(message) { if (message.method === 'initialize') {} if (message.method === 'tools/list') {} if (message.method !== 'tools/call') {} }")
    const withAdapter = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(withAdapter['file-management'].checks.mcp.status).toBe('partial')
    put(root, 'services/file-management/test/mcp-transport.test.js', "import { handle } from '../src/mcp/transport.js'\nawait handle({ method: 'initialize' }); await handle({ method: 'tools/list' }); await handle({ method: 'tools/call' }); expect(true).toBe(true)")
    const ownProof = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(ownProof['file-management'].checks.mcp.status).toBe('verified')
  })

  it('does not treat comment-only dispatch words as an MCP adapter', () => {
    const root = fixture()
    put(root, 'src/modules/project-manager/mcp/transport.js', "export const placeholder = true // message.method === 'initialize'\n// message.method === 'tools/list'\n// message.method !== 'tools/call'")
    put(root, 'tests/unit/project-manager-mcp.test.js', "import '@/modules/project-manager/mcp/transport'\nawait handle({ method: 'initialize' }); await handle({ method: 'tools/list' }); await handle({ method: 'tools/call' }); expect(true).toBe(true)")
    const result = collectDomainObservations({ root,
      nodes: [{ id: 'domain:project-manager', type: 'domain', modules: ['project-manager'], owns_models: [] }],
      edges: [], featureRequirements: new Map() })
    expect(result['project-manager'].checks.mcp.status).toBe('not_applicable')
  })

  it('accepts a shared MCP adapter only through the domain requirement edges', () => {
    const root = fixture()
    put(root, 'src/app/api/mcp/route.js', 'export async function POST() { return transport.handle({}) }')
    put(root, 'tests/unit/knowledge-mcp.test.js', "import '@/app/api/mcp/route'\nawait transport.handle({ method: 'initialize' }); await transport.handle({ method: 'tools/list' }); await transport.handle({ method: 'tools/call' }); expect(true).toBe(true)")
    const domain = { id: 'domain:knowledge', type: 'domain', modules: ['knowledge'], owns_models: [] }
    // Build the fixture ID: a literal here would turn this synthetic test into
    // a real requirement verification edge in the documentation graph.
    const requirementId = ['FR', '173'].join('-')
    const requirement = { id: `req:${requirementId}`, type: 'requirement', family: 'FR', declared: 'done' }
    const code = { id: 'code:src/app/api/mcp/route.js', type: 'code_file', path: 'src/app/api/mcp/route.js' }
    const test = { id: 'test:tests/unit/knowledge-mcp.test.js', type: 'test', path: 'tests/unit/knowledge-mcp.test.js' }
    const edges = [
      { from: code.id, to: requirement.id, type: 'implements' },
      { from: test.id, to: requirement.id, type: 'verifies' },
    ]
    const result = collectDomainObservations({ root, nodes: [domain, requirement, code, test], edges,
      featureRequirements: new Map([['knowledge', [requirementId]]]) })
    expect(result.knowledge.checks.mcp.status).toBe('verified')
    const unrelated = collectDomainObservations({ root, nodes: [domain, requirement, code, test], edges: edges.slice(0, 1),
      featureRequirements: new Map([['knowledge', [requirementId]]]) })
    expect(unrelated.knowledge.checks.mcp.status).toBe('partial')
  })

  it('does not infer MCP delivery from UI mock data or future/prohibition prose', () => {
    const root = fixture()
    put(root, 'src/modules/line-crm/LineCrmAiMcp.jsx', "'use client'\nimport { MCP_TOOLS } from './mockData'\nexport default function Panel() { return MCP_TOOLS }")
    put(root, 'docs/domains/agent/features/future.md', 'A future MCP tool needs a separate requirement ID.')
    put(root, 'docs/domains/identity/features/auth.md', 'Mcp-Session-Id must not be used as authorization.')
    const nodes = [
      { id: 'domain:crm', type: 'domain', modules: ['line-crm'], owns_models: [] },
      { id: 'domain:line-oa-studio', type: 'domain', modules: ['line-crm'], owns_models: [] },
      { id: 'domain:agent', type: 'domain', modules: [], owns_models: [] },
      { id: 'domain:identity', type: 'domain', modules: [], owns_models: [] },
    ]
    const result = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    for (const domain of ['crm', 'line-oa-studio', 'agent', 'identity']) {
      expect(result[domain].checks.mcp.status).toBe('not_applicable')
    }
  })

  it('keeps a declared Asset acceptance channel visible without an adapter', () => {
    const root = fixture()
    const requirementId = ['FR', '133'].join('-')
    const charter = 'docs/domains/asset-management/CHARTER.md'
    const feature = 'docs/domains/asset-management/features/foundation.md'
    put(root, charter, '## Intake contract\nWeb, Agent/MCP and LINE converge on AssetIntakeEnvelope.\n')
    put(root, feature, `---\nfeature: ${requirementId}\n---\n## User stories and acceptance criteria\n- Draft accepts Web, API and Agent/MCP as declared channels.\n`)
    const result = collectDomainObservations({ root,
      nodes: [{ id: 'domain:asset-management', type: 'domain', path: charter, modules: ['asset-management'], owns_models: [] }],
      edges: [], featureRequirements: new Map() })
    expect(result['asset-management'].checks.mcp).toEqual(expect.objectContaining({
      status: 'not_implemented', evidence: [charter, feature],
      gaps: [expect.objectContaining({ id: 'MCP-TRANSPORT-001' })],
    }))
  })

  it('keeps generated MCP statuses aligned with explicit contract evidence', () => {
    const state = JSON.parse(readFileSync(new URL('../../runtime/domain-state.json', import.meta.url), 'utf8'))
    expect(state.domains['asset-management'].checks.mcp.status).toBe('not_implemented')
    for (const domain of ['crm', 'line-oa-studio', 'agent', 'identity']) {
      expect(state.domains[domain].checks.mcp.status).toBe('not_applicable')
    }
    expect(state.domains['project-manager'].checks.mcp.status).toBe('verified')
    expect(state.domains.knowledge.checks.mcp.status).toBe('verified')
  })
})
