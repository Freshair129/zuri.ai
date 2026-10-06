import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readDomainModelSource } from '../../scripts/domain-model-source.mjs'
import { collectDomainObservations } from '../../scripts/domain-state.mjs'

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
    expect(() => readDomainModelSource(root, '../outside.sql')).toThrow(/outside-workspace/)
  })

  it('retains the flat Server Prisma default', () => {
    const root = fixture()
    put(root, 'prisma/schema.prisma', 'model Project {\n  id String @id\n}\n')
    expect([...readDomainModelSource(root).models]).toEqual(['Project'])
  })

  it('scopes MCP protocol proof to an owned adapter', () => {
    const root = fixture()
    put(root, 'src/modules/project-manager/mcp/transport.js', 'export function transport() {}')
    put(root, 'tests/unit/project-manager-mcp.test.js', "import '@/modules/project-manager/mcp/transport'\n// initialize tools/list tools/call")
    const nodes = [
      { id: 'domain:project-manager', type: 'domain', modules: ['project-manager'], owns_models: [] },
      { id: 'domain:file-management', type: 'domain', modules: [], owns_code: ['services/file-management/**'], owns_models: [] },
    ]
    const result = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(result['project-manager'].checks.mcp.status).toBe('verified')
    expect(result['file-management'].checks.mcp.status).toBe('not_applicable')
    put(root, 'services/file-management/src/mcp/transport.js', 'export function transport() {}')
    const withAdapter = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(withAdapter['file-management'].checks.mcp.status).toBe('partial')
    put(root, 'services/file-management/test/mcp-transport.test.js', "import '../src/mcp/transport.js'\n// initialize tools/list tools/call")
    const ownProof = collectDomainObservations({ root, nodes, edges: [], featureRequirements: new Map() })
    expect(ownProof['file-management'].checks.mcp.status).toBe('verified')
  })

  it('accepts a shared MCP adapter only through the domain requirement edges', () => {
    const root = fixture()
    put(root, 'src/app/api/mcp/route.js', 'export function POST() {}')
    put(root, 'tests/unit/knowledge-mcp.test.js', "import '@/app/api/mcp/route'\n// initialize tools/list tools/call")
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
})
