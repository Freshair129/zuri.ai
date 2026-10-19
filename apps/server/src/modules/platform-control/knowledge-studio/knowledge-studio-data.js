// @req FR-289 — project only graph-indexed documents and safe Markdown sources.
// @spec ADR-048 D1-D3
// @tested tests/unit/knowledge-studio/knowledge-studio-data.test.js

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const INCLUDED_NODE_TYPES = new Set(['domain', 'feature', 'requirement', 'adr', 'appendix', 'roadmap', 'document'])
const ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/
const MAX_NODES = 2048
const MAX_EDGES = 8192

function normalizeDocPath(value) {
  if (typeof value !== 'string' || !value.startsWith('docs/') || !value.endsWith('.md') || value.includes('\\') || value.includes('\0')) return null
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  return parts.join('/')
}

function isWithinDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function hash(value, length = 18) {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
}

function frontmatterValues(source) {
  if (typeof source !== 'string' || !source.startsWith('---')) return {}
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (!match) return {}
  const values = {}
  for (const key of ['domain', 'service', 'feature']) {
    const field = new RegExp(`^${key}:\\s*["']?([A-Za-z0-9_-]+)`, 'm').exec(match[1])
    if (field) values[key] = field[1]
  }
  return values
}

function candidateKind(node, sourcePath, metadata) {
  if (node.type === 'domain') return 'domain'
  if (node.type === 'feature' || metadata.feature) return 'feature'
  if (node.type === 'requirement') return 'requirement'
  if (node.type === 'adr') return 'adr'
  if (node.type === 'appendix') return 'appendix'
  if (node.type === 'roadmap') return 'roadmap'
  if (/^docs\/services\/[^/]+\/SERVICE\.md$/i.test(sourcePath)) return 'service'
  return 'document'
}

function candidatePriority(kind) {
  return ({ domain: 8, feature: 7, requirement: 6, adr: 5, appendix: 4, roadmap: 4, service: 4, document: 1 })[kind] || 0
}

function documentIdentity(node, sourcePath) {
  return node.document_identity || node.identity_migration?.previous_id || node.id || sourcePath
}

function componentNodeId(kind, node, sourcePath, indexedIdentity = null) {
  const identity = indexedIdentity || documentIdentity(node, sourcePath)
  let value
  if (kind === 'domain') value = 'domain-' + slug(node.id?.replace(/^domain:/, '') || path.basename(path.dirname(sourcePath)))
  else if (kind === 'service') value = 'service-' + slug(path.basename(path.dirname(sourcePath)))
  else if (kind === 'feature') value = 'feature-' + slug(identity)
  else if (kind === 'requirement') value = 'requirement-' + slug(identity)
  else if (kind === 'adr') value = 'adr-' + slug(identity)
  else if (kind === 'roadmap') value = 'roadmap-' + hash(sourcePath)
  else if (kind === 'appendix') value = 'appendix-' + slug(path.basename(sourcePath, '.md'))
  else value = 'doc-' + hash(sourcePath)
  return value.length <= 48 && ID_PATTERN.test(value) ? value : 'doc-' + hash(sourcePath, 24)
}

function truncate(value, max = 360) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function titleFor(node, kind, sourcePath, indexedIdentity = null) {
  const identity = indexedIdentity || node.document_identity || node.identity_migration?.previous_id || null
  const raw = node.title || node.label || node.row_text || path.basename(sourcePath, '.md')
  if (kind === 'domain') return truncate(node.title?.replace(/^Domain\s*[—:-]\s*/i, '') || path.basename(path.dirname(sourcePath)), 120)
  if (kind === 'service') return truncate(node.title || path.basename(path.dirname(sourcePath)), 120)
  if (kind === 'feature' || kind === 'requirement') {
    const head = String(raw).split(/[.;|]/, 1)[0].trim()
    return truncate((identity ? identity + ' — ' : '') + head, 150)
  }
  return truncate(raw, 150)
}

function descriptionFor(node, kind) {
  return truncate(node.row_text || node.label || node.description || node.title || kind, 800)
}

function servicePath(sourcePath) {
  const match = /^docs\/services\/([^/]+)\//.exec(sourcePath)
  return match ? match[1] : null
}

function normalizeDomain(value, domains) {
  if (typeof value !== 'string') return null
  const key = value.toLowerCase().replace(/^domain:/, '')
  return domains.has(key) ? key : null
}

function sectionIdForDomain(domain) {
  return 'domain-' + slug(domain)
}

function edgeId(edge) {
  return 'edge-' + hash(edge.from + '\0' + edge.to + '\0' + edge.type, 20)
}

export function buildKnowledgeStudioProjection({ graph, registryRecords = [], sourceTexts, existingPaths }) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError('Generated document graph is invalid')
  const available = existingPaths instanceof Set ? existingPaths : new Set(existingPaths || [])
  const textByPath = sourceTexts instanceof Map ? sourceTexts : new Map(Object.entries(sourceTexts || {}))
  const registryByPath = new Map((Array.isArray(registryRecords) ? registryRecords : [])
    .filter((record) => normalizeDocPath(record.path))
    .map((record) => [record.path, record]))
  const domainNodes = graph.nodes.filter((node) => node.type === 'domain' && normalizeDocPath(node.path) && available.has(node.path))
  const domainByGraphId = new Map(domainNodes.map((node) => [node.id, node.id.replace(/^domain:/, '').toLowerCase()]))
  const domainSlugs = new Set(domainByGraphId.values())

  const candidates = []
  for (const node of graph.nodes) {
    if (!INCLUDED_NODE_TYPES.has(node.type)) continue
    const sourcePath = normalizeDocPath(node.path || node.canonical_path)
    if (!sourcePath || !available.has(sourcePath)) continue
    const metadata = frontmatterValues(textByPath.get(sourcePath))
    const registryRecord = registryByPath.get(sourcePath)
    const kind = registryRecord?.family === 'FR' ? 'requirement' : candidateKind(node, sourcePath, metadata)
    candidates.push({
      node,
      sourcePath,
      metadata,
      registryRecord,
      kind,
      componentId: componentNodeId(kind, node, sourcePath, registryRecord?.id || metadata.feature),
      priority: candidatePriority(kind),
    })
  }

  const chosenByPath = new Map()
  for (const candidate of candidates) {
    const current = chosenByPath.get(candidate.sourcePath)
    if (!current || candidate.priority > current.priority || (candidate.priority === current.priority && String(candidate.node.id).localeCompare(String(current.node.id)) < 0)) {
      chosenByPath.set(candidate.sourcePath, candidate)
    }
  }

  const candidateByGraphId = new Map()
  for (const candidate of candidates) candidateByGraphId.set(candidate.node.id, chosenByPath.get(candidate.sourcePath))
  const graphIdToComponentId = new Map([...candidateByGraphId].filter(([, candidate]) => candidate).map(([id, candidate]) => [id, candidate.componentId]))
  const domainOwnerCandidates = new Map()
  const addDomainOwner = (graphId, domain) => {
    if (!domain || !graphIdToComponentId.has(graphId)) return
    const values = domainOwnerCandidates.get(graphId) || new Set()
    values.add(domain)
    domainOwnerCandidates.set(graphId, values)
  }

  for (const candidate of candidates) {
    const selected = chosenByPath.get(candidate.sourcePath)
    if (selected !== candidate) continue
    addDomainOwner(candidate.node.id, normalizeDomain(candidate.metadata.domain, domainSlugs))
    if (candidate.kind === 'domain') addDomainOwner(candidate.node.id, candidate.node.id.replace(/^domain:/, '').toLowerCase())
  }

  for (const edge of graph.edges) {
    if (edge.type === 'owned_by') {
      const fromDomain = domainByGraphId.get(edge.from)
      const toDomain = domainByGraphId.get(edge.to)
      if (fromDomain) addDomainOwner(edge.to, fromDomain)
      if (toDomain) addDomainOwner(edge.from, toDomain)
    }
    if (edge.type === 'bundles') {
      const feature = graph.nodes.find((node) => node.id === edge.from && node.type === 'feature')
      const requirement = graph.nodes.find((node) => node.id === edge.to && node.type === 'requirement')
      if (!feature || !requirement) continue
      const featureCandidate = candidateByGraphId.get(feature.id)
      if (!featureCandidate) continue
      const featureOwnerSet = domainOwnerCandidates.get(feature.id)
      if (!featureOwnerSet || featureOwnerSet.size !== 1) continue
      addDomainOwner(requirement.id, [...featureOwnerSet][0])
    }
  }

  const sectionSpecs = domainNodes
    .map((node) => {
      const slugValue = node.id.replace(/^domain:/, '').toLowerCase()
      return { id: sectionIdForDomain(slugValue), title: slugValue.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
  sectionSpecs.push({ id: 'services', title: 'Services (unassigned)' }, { id: 'shared', title: 'Shared / unassigned' })

  const nodes = []
  const sources = Object.create(null)
  const selectedByPath = [...chosenByPath.values()]
  for (const candidate of selectedByPath) {
    if (!ID_PATTERN.test(candidate.componentId)) continue
    const ownerSet = domainOwnerCandidates.get(candidate.node.id) || new Set()
    const ownerDomain = ownerSet.size === 1 ? [...ownerSet][0] : null
    const service = servicePath(candidate.sourcePath)
    const sectionId = ownerDomain
      ? sectionIdForDomain(ownerDomain)
      : service ? 'services' : 'shared'
    const identity = candidate.registryRecord?.id || documentIdentity(candidate.node, candidate.sourcePath)
    const detailSuffix = 'd' + nodes.length.toString(36)
    const details = [
      { id: 'source-path-' + detailSuffix, type: 'record', label: 'Source path', value: candidate.sourcePath },
      { id: 'node-kind-' + detailSuffix, type: 'record', label: 'Node kind', value: candidate.kind },
      { id: 'source-id-' + detailSuffix, type: 'record', label: 'Document ID', value: identity },
      ...(candidate.node.status ? [{ id: 'source-status-' + detailSuffix, type: 'record', label: 'Index status', value: truncate(candidate.node.status, 100) }] : []),
    ]
    nodes.push({
      id: candidate.componentId,
      title: titleFor(candidate.node, candidate.kind, candidate.sourcePath, candidate.registryRecord?.id || candidate.metadata.feature),
      sectionId,
      description: descriptionFor(candidate.node, candidate.kind),
      panel: { aliases: [], details, examples: [], avoid: '' },
    })
    sources[candidate.componentId] = candidate.sourcePath
  }

  const componentIds = new Set(nodes.map((node) => node.id))
  const uniqueEdges = new Map()
  for (const edge of graph.edges) {
    const source = graphIdToComponentId.get(edge.from)
    const target = graphIdToComponentId.get(edge.to)
    if (!source || !target || source === target || !componentIds.has(source) || !componentIds.has(target)) continue
    const key = source + '\0' + target
    const relation = truncate(edge.type || 'related', 48)
    const existing = uniqueEdges.get(key)
    if (existing) {
      existing.relations.add(relation)
      continue
    }
    uniqueEdges.set(key, { source, target, relations: new Set([relation]) })
  }
  const edges = [...uniqueEdges.values()].map((edge) => {
    const label = [...edge.relations].sort().join(' · ')
    return {
      id: edgeId({ from: edge.source, to: edge.target, type: label }),
      source: edge.source,
      target: edge.target,
      directed: true,
      label: truncate(label, 240),
    }
  })
  if (nodes.length > MAX_NODES) throw new RangeError('Document graph exceeds the local component node limit')
  if (edges.length > MAX_EDGES) throw new RangeError('Document graph exceeds the local component edge limit')

  const sectionIds = new Set(sectionSpecs.map((section) => section.id))
  for (const node of nodes) if (!sectionIds.has(node.sectionId)) node.sectionId = 'shared'
  const graphIdMap = new Map()
  for (const [graphId, candidate] of candidateByGraphId) {
    if (candidate) graphIdMap.set(graphId, candidate.componentId)
  }
  const selectedNodeIds = new Set([...graphIdMap.values()])
  const sortedNodes = nodes
    .filter((node) => selectedNodeIds.has(node.id))
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId) || a.id.localeCompare(b.id))

  return {
    dataset: {
      schemaVersion: 'dictionary-external-data/v2',
      title: 'Zuri.ai · Documentation graph',
      sections: sectionSpecs,
      nodes: sortedNodes,
      edges,
    },
    sources,
    sourceIds: Object.fromEntries(graphIdMap),
    counts: { nodes: sortedNodes.length, edges: edges.length, sections: sectionSpecs.length },
  }
}

function repoRootFromProcess() {
  const configuredRoot = process.env.ZURI_KNOWLEDGE_STUDIO_ROOT
  if (typeof configuredRoot === 'string' && configuredRoot.trim()) return path.resolve(configuredRoot)
  return path.resolve(process.cwd(), '../..')
}

async function existingMarkdownPaths(graph, root) {
  const possible = new Set()
  for (const node of graph.nodes || []) {
    if (!INCLUDED_NODE_TYPES.has(node.type)) continue
    const sourcePath = normalizeDocPath(node.path || node.canonical_path)
    if (sourcePath) possible.add(sourcePath)
  }
  const docsRoot = await realpath(path.join(root, 'docs'))
  const existing = new Set()
  const texts = new Map()
  await Promise.all([...possible].map(async (sourcePath) => {
    const filePath = path.resolve(root, ...sourcePath.split('/'))
    if (!isWithinDirectory(docsRoot, filePath)) return
    try {
      const resolved = await realpath(filePath)
      if (!isWithinDirectory(docsRoot, resolved)) return
      const details = await stat(resolved)
      if (!details.isFile() || details.size > 1024 * 1024) return
      existing.add(sourcePath)
      if (sourcePath.includes('/features/') || /\/SERVICE\.md$/i.test(sourcePath)) {
        texts.set(sourcePath, await readFile(resolved, 'utf8'))
      }
    } catch {
      // The generated graph may be stale; only existing files are exposed.
    }
  }))
  return { existing, texts }
}

let cache = null

export async function getKnowledgeStudioProjection({ root = repoRootFromProcess(), force = false } = {}) {
  const graphPath = path.join(root, 'docs', '.doc-graph.json')
  const registryPath = path.join(root, 'registry', 'document-registry', 'index.json')
  const [graphStat, registryStat] = await Promise.all([stat(graphPath), stat(registryPath)])
  const revision = graphStat.mtimeMs + ':' + registryStat.mtimeMs + ':' + graphStat.size + ':' + registryStat.size
  if (!force && cache?.root === root && cache.revision === revision) return cache.value
  const [graphText, registryText] = await Promise.all([readFile(graphPath, 'utf8'), readFile(registryPath, 'utf8')])
  const graph = JSON.parse(graphText)
  const registry = JSON.parse(registryText)
  if (!Array.isArray(registry.records)) throw new TypeError('Canonical document registry is invalid')
  const { existing, texts } = await existingMarkdownPaths(graph, root)
  const value = buildKnowledgeStudioProjection({ graph, registryRecords: registry.records, sourceTexts: texts, existingPaths: existing })
  cache = { root, revision, value }
  return value
}

export async function readKnowledgeStudioDocument(nodeId, { root = repoRootFromProcess() } = {}) {
  if (typeof nodeId !== 'string' || !ID_PATTERN.test(nodeId)) return null
  const projection = await getKnowledgeStudioProjection({ root })
  const sourcePath = projection.sources[nodeId]
  if (!sourcePath) return null
  const normalized = normalizeDocPath(sourcePath)
  if (!normalized) return null
  const docsRoot = await realpath(path.join(root, 'docs'))
  const filePath = path.resolve(root, ...normalized.split('/'))
  if (!isWithinDirectory(docsRoot, filePath)) return null
  const resolved = await realpath(filePath)
  if (!isWithinDirectory(docsRoot, resolved)) return null
  const details = await stat(resolved)
  if (!details.isFile() || details.size > 512 * 1024) return null
  return { nodeId, path: normalized, markdown: await readFile(resolved, 'utf8') }
}
