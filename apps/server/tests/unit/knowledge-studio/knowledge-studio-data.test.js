import { afterEach, describe, expect, it } from 'vitest'
// @req FR-289 — verify graph projection, grouping, source mapping, and bounds.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildKnowledgeStudioProjection,
  getKnowledgeStudioProjection,
  readKnowledgeStudioDocument,
} from '@/modules/platform-control/knowledge-studio/knowledge-studio-data'

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function fixtureGraph() {
  return {
    nodes: [
      { id: 'domain:inventory', type: 'domain', path: 'docs/domains/inventory/CHARTER.md', title: 'Domain — inventory' },
      { id: 'domain:knowledge', type: 'domain', path: 'docs/domains/knowledge/CHARTER.md', title: 'Domain — knowledge' },
      { id: 'feat:FEAT-033', type: 'feature', document_identity: 'FEAT-033', canonical_path: 'docs/features/FEAT-033/feature.md', label: 'Knowledge data pipeline map' },
      { id: 'req:FR-212', type: 'requirement', document_identity: 'FR-212', canonical_path: 'docs/features/FEAT-033/requirements/FR-212.md', row_text: 'Knowledge pipeline map.' },
      { id: 'doc:explicit-owner', type: 'document', path: 'docs/operations/inventory-flow.md', title: 'Inventory flow' },
      { id: 'doc:shared', type: 'document', path: 'docs/architecture/shared-boundary.md', title: 'Shared boundary' },
      { id: 'doc:service', type: 'document', path: 'docs/services/scm/SERVICE.md', title: 'SCM service boundary' },
      { id: 'doc:missing', type: 'document', path: 'docs/missing.md', title: 'Missing source' },
      { id: 'doc:unsafe', type: 'document', path: 'docs/../private.md', title: 'Unsafe source' },
    ],
    edges: [
      { from: 'feat:FEAT-033', to: 'req:FR-212', type: 'bundles' },
      { from: 'doc:explicit-owner', to: 'domain:inventory', type: 'owned_by' },
      { from: 'doc:shared', to: 'domain:knowledge', type: 'references' },
      { from: 'doc:shared', to: 'domain:knowledge', type: 'relates' },
      { from: 'doc:shared', to: 'domain:knowledge', type: 'references' },
      { from: 'doc:shared', to: 'doc:service', type: 'references' },
    ],
  }
}

describe('Knowledge Studio document graph projection', () => {
  it('uses explicit owners and canonical relations, and leaves reference-only documents shared', () => {
    const graph = fixtureGraph()
    const existingPaths = new Set(graph.nodes.map((node) => node.path || node.canonical_path).filter((value) => value && !value.includes('..') && value !== 'docs/missing.md'))
    const sourceTexts = new Map([
      ['docs/features/FEAT-033/feature.md', '---\nfeature: FEAT-033\ndomain: knowledge\n---\n# Knowledge data pipeline map'],
      ['docs/services/scm/SERVICE.md', '---\nservice: scm\n---\n# SCM service'],
    ])
    const registryRecords = [{ id: 'FR-212', family: 'FR', path: 'docs/features/FEAT-033/requirements/FR-212.md' }]
    const projection = buildKnowledgeStudioProjection({ graph, registryRecords, sourceTexts, existingPaths })
    const byId = new Map(projection.dataset.nodes.map((node) => [node.id, node]))

    expect(projection.counts).toMatchObject({ nodes: 7, sections: 4 })
    expect(byId.get('feature-feat-033')).toMatchObject({ sectionId: 'domain-knowledge' })
    expect(byId.get('requirement-fr-212')).toMatchObject({ sectionId: 'domain-knowledge' })
    expect(byId.get('service-scm')).toMatchObject({ sectionId: 'services' })
    expect(projection.sources['service-scm']).toBe('docs/services/scm/SERVICE.md')
    expect([...byId.values()].find((node) => node.title === 'Shared boundary')).toMatchObject({ sectionId: 'shared' })
    expect([...byId.values()].find((node) => node.title === 'Inventory flow')).toMatchObject({ sectionId: 'domain-inventory' })
    expect(projection.dataset.nodes.some((node) => node.title === 'Missing source' || node.title === 'Unsafe source')).toBe(false)
    expect(projection.dataset.edges.some((edge) => edge.label === 'bundles' && edge.source === 'feature-feat-033' && edge.target === 'requirement-fr-212')).toBe(true)
    const sharedId = [...byId.values()].find((node) => node.title === 'Shared boundary').id
    const merged = projection.dataset.edges.filter((edge) => edge.source === sharedId && edge.target === 'domain-knowledge')
    expect(merged).toHaveLength(1)
    expect(merged[0].label).toBe('references · relates')
    expect(new Set(projection.dataset.edges.map((edge) => edge.source + '\0' + edge.target)).size).toBe(projection.dataset.edges.length)
  })

  it('produces stable bounded component data for the current generated document graph', async () => {
    const first = await getKnowledgeStudioProjection({ force: true })
    const second = await getKnowledgeStudioProjection({ force: true })
    expect(first).toEqual(second)
    expect(first.counts.nodes).toBeGreaterThan(1000)
    expect(first.counts.nodes).toBeLessThanOrEqual(2048)
    expect(first.counts.edges).toBeLessThanOrEqual(8192)
    expect(new Set(first.dataset.edges.map((edge) => edge.source + '\0' + edge.target)).size).toBe(first.dataset.edges.length)
    expect(first.dataset.sections.length).toBeLessThanOrEqual(32)
    expect(first.sources['domain-knowledge']).toBe('docs/domains/knowledge/CHARTER.md')
    expect(first.dataset.nodes.every((node) => node.panel.details.some((detail) => detail.label === 'Source path'))).toBe(true)
  })

  it('returns only the exact Markdown file mapped from a known node ID', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zuri-knowledge-studio-'))
    temporaryRoots.push(root)
    const sourcePath = 'docs/domains/knowledge/CHARTER.md'
    const content = '---\nstatus: active\n---\n\n# Knowledge\n'
    await mkdir(path.join(root, 'docs/domains/knowledge'), { recursive: true })
    await mkdir(path.join(root, 'registry/document-registry'), { recursive: true })
    await writeFile(path.join(root, sourcePath), content)
    await writeFile(path.join(root, 'docs/.doc-graph.json'), JSON.stringify({
      nodes: [{ id: 'domain:knowledge', type: 'domain', path: sourcePath, title: 'Domain — knowledge' }],
      edges: [],
    }))
    await writeFile(path.join(root, 'registry/document-registry/index.json'), JSON.stringify({ version: 1, records: [] }))

    const projection = await getKnowledgeStudioProjection({ root, force: true })
    const document = await readKnowledgeStudioDocument('domain-knowledge', { root })
    await expect(readFile(path.join(root, sourcePath), 'utf8')).resolves.toBe(content)
    expect(document).toEqual({ nodeId: 'domain-knowledge', path: sourcePath, markdown: content })
    await expect(readKnowledgeStudioDocument('private-path', { root })).resolves.toBeNull()
    expect(projection.counts.nodes).toBe(1)
  })

  it('uses the configured data root when the app runs outside the repository checkout', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zuri-knowledge-studio-root-'))
    temporaryRoots.push(root)
    const previousRoot = process.env.ZURI_KNOWLEDGE_STUDIO_ROOT
    const sourcePath = 'docs/domains/knowledge/CHARTER.md'
    await mkdir(path.join(root, 'docs/domains/knowledge'), { recursive: true })
    await mkdir(path.join(root, 'registry/document-registry'), { recursive: true })
    await writeFile(path.join(root, sourcePath), '# Knowledge\n')
    await writeFile(path.join(root, 'docs/.doc-graph.json'), JSON.stringify({
      nodes: [{ id: 'domain:knowledge', type: 'domain', path: sourcePath, title: 'Domain — knowledge' }],
      edges: [],
    }))
    await writeFile(path.join(root, 'registry/document-registry/index.json'), JSON.stringify({ version: 1, records: [] }))

    process.env.ZURI_KNOWLEDGE_STUDIO_ROOT = root
    try {
      const projection = await getKnowledgeStudioProjection({ force: true })
      const document = await readKnowledgeStudioDocument('domain-knowledge')
      expect(projection.counts.nodes).toBe(1)
      expect(document).toEqual({ nodeId: 'domain-knowledge', path: sourcePath, markdown: '# Knowledge\n' })
    } finally {
      if (previousRoot === undefined) delete process.env.ZURI_KNOWLEDGE_STUDIO_ROOT
      else process.env.ZURI_KNOWLEDGE_STUDIO_ROOT = previousRoot
    }
  })
})
