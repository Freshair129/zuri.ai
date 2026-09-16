import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { workspacePath } from './workspace-path.mjs'

// @req FR-212 — the data pipeline map as a validated registry: where data enters
//   zuri-ai, where it is combined, who receives it, and how many chains that makes.
//   The flows are hand-maintained facts; everything that can be derived from the
//   tree (surface existence, requirement status, FEAT) is derived, and the
//   generator refuses a registry that contradicts it.
// @spec ADR-085 D2, D3, D4; ADR-081 D2; FR-124
// @tested tests/unit/data-pipeline-map.test.js

export const REGISTRY_PATH = 'docs/DATA-PIPELINE-MAP.md'

export const NODE_KINDS = ['SOURCE', 'ENTRY', 'PROCESS', 'STORE', 'RECIPIENT']
export const SYSTEMS = ['external', 'zuri-ai', 'edge']
export const SURFACE_TYPES = ['WORKER', 'FILE', 'MCP', 'ENDPOINT', 'UI']

/** Weakest first. An edge or a chain takes the weakest status it touches (ADR-085 D3). */
export const BUILD_STATUSES = ['BLOCKED', 'DECLARED', 'PARTIAL', 'CODE_TESTS', 'PRODUCTION']

/** Lowest first. A node's level is the highest surface it actually has. */
export const SURFACE_LEVELS = ['NONE', 'WORKER', 'MCP', 'ENDPOINT', 'UI']

const SURFACE_LEVEL_OF = { WORKER: 'WORKER', FILE: 'WORKER', MCP: 'MCP', ENDPOINT: 'ENDPOINT', UI: 'UI' }

const REGISTRY_BLOCK = /<!-- data-pipeline-registry:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- data-pipeline-registry:end -->/

const isInternal = (node) => node.kind !== 'SOURCE' && node.kind !== 'RECIPIENT'
const weakest = (statuses) => statuses.reduce((low, s) => (BUILD_STATUSES.indexOf(s) < BUILD_STATUSES.indexOf(low) ? s : low), 'PRODUCTION')
const highestSurface = (levels) => levels.reduce((high, l) => (SURFACE_LEVELS.indexOf(l) > SURFACE_LEVELS.indexOf(high) ? l : high), 'NONE')
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort()

export class DataPipelineMapError extends Error {
  constructor(problems) {
    super(`data pipeline registry is invalid:\n  - ${problems.join('\n  - ')}`)
    this.problems = problems
  }
}

/** The registry block out of the map document. Throws, never returns an empty map. */
export function parseRegistry(markdown) {
  const match = REGISTRY_BLOCK.exec(markdown || '')
  if (!match) {
    throw new DataPipelineMapError([`${REGISTRY_PATH} has no \`\`\`json block between <!-- data-pipeline-registry:start --> and <!-- data-pipeline-registry:end -->`])
  }
  try {
    return JSON.parse(match[1])
  } catch (error) {
    throw new DataPipelineMapError([`${REGISTRY_PATH} registry is not valid JSON: ${error.message}`])
  }
}

/** FR id → { status, title, feature } from the FR-124 snapshot, the one source of requirement status. */
export function requirementIndex(domainState) {
  const index = new Map()
  for (const feature of domainState?.features || []) {
    for (const requirement of feature.requirements || []) {
      index.set(requirement.id, { status: requirement.status, title: requirement.title, feature: feature.id })
    }
  }
  return index
}

function statusFromRequirements(statuses) {
  if (statuses.length && statuses.every((s) => s === 'verified')) return 'CODE_TESTS'
  if (statuses.some((s) => s === 'verified' || s === 'partial')) return 'PARTIAL'
  return 'DECLARED'
}

/**
 * Build the projection. Pure: every filesystem question is asked through
 * `surfaceExists(type, ref)` and `decisionExists(id)`, so the unit suite can
 * state a tree without having one.
 */
export function buildDataPipelineMap({ registry, domainState, surfaceExists, decisionExists = () => true, documentChainIds = null }) {
  const problems = []
  const requirements = requirementIndex(domainState)
  const domains = new Set(Object.keys(domainState?.domains || {}))

  const rawNodes = Array.isArray(registry?.nodes) ? registry.nodes : []
  const rawEdges = Array.isArray(registry?.edges) ? registry.edges : []
  const rawChains = Array.isArray(registry?.chains) ? registry.chains : []
  if (!rawNodes.length) problems.push('registry has no nodes')
  if (!rawChains.length) problems.push('registry has no chains')

  const nodes = []
  const nodeById = new Map()
  for (const raw of rawNodes) {
    const id = raw?.id
    if (typeof id !== 'string' || !/^(src|in|p|s|r)\.[a-z0-9-]+$/.test(id)) { problems.push(`invalid node id ${JSON.stringify(id)}`); continue }
    if (nodeById.has(id)) { problems.push(`duplicate node ${id}`); continue }
    if (!NODE_KINDS.includes(raw.kind)) problems.push(`${id} has unknown kind ${raw.kind}`)
    if (!SYSTEMS.includes(raw.system)) problems.push(`${id} has unknown system ${raw.system}`)
    if (typeof raw.label !== 'string' || !raw.label.trim()) problems.push(`${id} has no label`)

    const node = {
      id,
      kind: raw.kind,
      system: raw.system,
      label: raw.label,
      detail: raw.detail || '',
      domain: raw.domain || null,
      requirements: [],
      features: [],
      decisions: [],
      surfaces: [],
      surfaceLevel: null,
      buildStatus: null,
      evidence: null,
      blocked: null,
    }

    if (isInternal(node)) {
      if (!node.domain && raw.system !== 'edge') problems.push(`${id} is internal and names no domain`)
      if (node.domain && !domains.has(node.domain)) problems.push(`${id} names unknown domain ${node.domain}`)

      const ids = Array.isArray(raw.requirements) ? raw.requirements : []
      if (!ids.length) problems.push(`${id} is internal and names no requirement`)
      const statuses = []
      for (const requirementId of ids) {
        const known = requirements.get(requirementId)
        if (!known) { problems.push(`${id} names ${requirementId}, which the FR-124 snapshot does not know`); continue }
        node.requirements.push({ id: requirementId, status: known.status, title: known.title })
        node.features.push(known.feature)
        statuses.push(known.status)
      }
      node.features = uniqueSorted(node.features)

      for (const decision of Array.isArray(raw.decisions) ? raw.decisions : []) {
        if (!/^ADR-\d{3}$/.test(decision) || !decisionExists(decision)) problems.push(`${id} names unknown decision ${decision}`)
        else node.decisions.push(decision)
      }

      const levels = []
      for (const surface of Array.isArray(raw.surfaces) ? raw.surfaces : []) {
        if (!SURFACE_TYPES.includes(surface?.type)) { problems.push(`${id} has a surface of unknown type ${surface?.type}`); continue }
        if (typeof surface.ref !== 'string' || !surface.ref) { problems.push(`${id} has a ${surface.type} surface with no ref`); continue }
        if (!surfaceExists(surface.type, surface.ref)) { problems.push(`${id} declares ${surface.type} ${surface.ref}, which does not exist`); continue }
        node.surfaces.push({ type: surface.type, ref: surface.ref })
        levels.push(SURFACE_LEVEL_OF[surface.type])
      }
      node.surfaceLevel = highestSurface(levels)

      if (typeof raw.blocked === 'string' && raw.blocked.trim()) {
        node.blocked = raw.blocked.trim()
        node.buildStatus = 'BLOCKED'
      } else if (raw.production !== undefined) {
        const evidence = typeof raw.production?.evidence === 'string' ? raw.production.evidence.trim() : ''
        if (!evidence) problems.push(`${id} claims production with no written evidence`)
        node.evidence = evidence || null
        node.buildStatus = evidence ? 'PRODUCTION' : statusFromRequirements(statuses)
      } else {
        node.buildStatus = statusFromRequirements(statuses)
      }
    } else if (raw.requirements || raw.surfaces || raw.production || raw.blocked) {
      problems.push(`${id} is a ${raw.kind} and may not carry requirements, surfaces or a status — those belong to the zuri-ai node it talks to`)
    }

    nodes.push(node)
    nodeById.set(id, node)
  }

  const edges = []
  const edgeById = new Map()
  const touched = new Set()
  for (const raw of rawEdges) {
    const id = raw?.id
    if (typeof id !== 'string' || !/^e\.[a-z0-9-]+$/.test(id)) { problems.push(`invalid edge id ${JSON.stringify(id)}`); continue }
    if (edgeById.has(id)) { problems.push(`duplicate edge ${id}`); continue }
    const from = nodeById.get(raw.from)
    const to = nodeById.get(raw.to)
    if (!from) problems.push(`${id} starts at unknown node ${raw.from}`)
    if (!to) problems.push(`${id} ends at unknown node ${raw.to}`)
    if (typeof raw.label !== 'string' || !raw.label.trim()) problems.push(`${id} has no label`)
    if (!from || !to) continue
    touched.add(from.id)
    touched.add(to.id)
    const joined = [from, to].filter(isInternal).map((n) => n.buildStatus)
    // An edge the registry marks unwired is a declaration however built its ends are.
    const status = raw.wired === false ? weakest([...joined, 'DECLARED']) : (joined.length ? weakest(joined) : 'DECLARED')
    const edge = { id, from: from.id, to: to.id, label: raw.label, wired: raw.wired !== false, status }
    edges.push(edge)
    edgeById.set(id, edge)
  }

  for (const node of nodes) {
    if (!touched.has(node.id)) problems.push(`${node.id} is not joined by any edge`)
  }

  const chains = []
  const chainIds = new Set()
  for (const raw of rawChains) {
    const id = raw?.id
    if (typeof id !== 'string' || !/^CH-\d{2}$/.test(id)) { problems.push(`invalid chain id ${JSON.stringify(id)}`); continue }
    if (chainIds.has(id)) { problems.push(`duplicate chain ${id}`); continue }
    chainIds.add(id)
    if (typeof raw.name !== 'string' || !raw.name.trim()) problems.push(`${id} has no name`)
    const pathIds = Array.isArray(raw.path) ? raw.path : []
    const branchIds = Array.isArray(raw.branches) ? raw.branches : []
    if (pathIds.length < 2) problems.push(`${id} path needs at least two edges`)
    const pathEdges = pathIds.map((edgeId) => edgeById.get(edgeId) || (problems.push(`${id} path names unknown edge ${edgeId}`), null)).filter(Boolean)
    const branchEdges = branchIds.map((edgeId) => edgeById.get(edgeId) || (problems.push(`${id} branch names unknown edge ${edgeId}`), null)).filter(Boolean)

    for (let i = 1; i < pathEdges.length; i += 1) {
      if (pathEdges[i - 1].to !== pathEdges[i].from) problems.push(`${id} path breaks between ${pathEdges[i - 1].id} and ${pathEdges[i].id}`)
    }
    if (pathEdges.length) {
      const first = nodeById.get(pathEdges[0].from)
      const last = nodeById.get(pathEdges[pathEdges.length - 1].to)
      if (first?.kind !== 'SOURCE') problems.push(`${id} path must start at a SOURCE, not ${first?.id}`)
      if (last?.kind !== 'RECIPIENT') problems.push(`${id} path must end at a RECIPIENT, not ${last?.id}`)
    }
    const pathNodeIds = new Set(pathEdges.flatMap((e) => [e.from, e.to]))
    for (const branch of branchEdges) {
      if (!pathNodeIds.has(branch.from) && !pathNodeIds.has(branch.to)) problems.push(`${id} branch ${branch.id} touches no node on its path`)
    }

    const all = [...pathEdges, ...branchEdges]
    const nodeIds = uniqueSorted(all.flatMap((e) => [e.from, e.to]))
    const internal = nodeIds.map((n) => nodeById.get(n)).filter((n) => n && isInternal(n))
    chains.push({
      id,
      name: raw.name,
      summary: raw.summary || '',
      path: pathEdges.map((e) => e.id),
      branches: branchEdges.map((e) => e.id),
      nodeIds,
      status: all.length ? weakest(all.map((e) => e.status)) : 'DECLARED',
      domains: uniqueSorted(internal.map((n) => n.domain)),
      features: uniqueSorted(internal.flatMap((n) => n.features)),
    })
  }

  // The document's prose names chains too; a chain listed there and missing
  // here (or the reverse) is exactly the drift that retired ARCHITECTURE-DIAGRAMS §3.
  if (Array.isArray(documentChainIds)) {
    const prose = new Set(documentChainIds)
    for (const chainId of chainIds) if (!prose.has(chainId)) problems.push(`${chainId} is in the registry but not in the document's chain table`)
    for (const chainId of prose) if (!chainIds.has(chainId)) problems.push(`${chainId} is in the document's chain table but not in the registry`)
  }

  if (problems.length) throw new DataPipelineMapError(problems)

  const countBy = (list, key) => Object.fromEntries(key.values.map((v) => [v, list.filter((x) => x[key.field] === v).length]))
  return {
    schemaVersion: '1.0',
    generatedBy: 'scripts/data-pipeline-map.mjs',
    source: REGISTRY_PATH,
    vocabulary: { nodeKinds: NODE_KINDS, buildStatuses: BUILD_STATUSES, surfaceLevels: SURFACE_LEVELS },
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      chains: chains.length,
      byKind: countBy(nodes, { field: 'kind', values: NODE_KINDS }),
      chainsByStatus: countBy(chains, { field: 'status', values: BUILD_STATUSES }),
      internalByStatus: countBy(nodes.filter(isInternal), { field: 'buildStatus', values: BUILD_STATUSES }),
      internalBySurface: countBy(nodes.filter(isInternal), { field: 'surfaceLevel', values: SURFACE_LEVELS }),
    },
    nodes,
    edges,
    chains,
  }
}

function pageRoutes(appDir) {
  const routes = new Set()
  if (!existsSync(appDir)) return routes
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        // Route groups `(pm)` and parallel/private folders do not appear in the URL.
        const next = /^\(.*\)$/.test(entry) ? segments : [...segments, entry]
        walk(full, next)
      } else if (entry === 'page.jsx' || entry === 'page.js') {
        routes.add(`/${segments.join('/')}`.replace(/\/$/, '') || '/')
      }
    }
  }
  walk(appDir, [])
  return routes
}

function mcpToolNames(root) {
  const file = path.join(root, 'src', 'modules', 'project-manager', 'mcp', 'transport.js')
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  return new Set([...text.matchAll(/name:\s*'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]))
}

/**
 * The filesystem-backed generator `doc-graph.mjs` calls on every regeneration.
 * Returns null only for a tree that has no map document or no application tree —
 * the governance CLI fixtures build throwaway checkouts of docs and scripts with
 * neither `src/app` nor the surfaces the registry names. In the real checkout both
 * always exist, and a document without its registry block still throws: absent is
 * a different tree, empty is a broken map.
 */
export function generateDataPipelineMap({ root, domainState }) {
  const markdownPath = workspacePath(root, REGISTRY_PATH)
  if (!existsSync(markdownPath) || !existsSync(path.join(root, 'src', 'app'))) return null
  const markdown = readFileSync(markdownPath, 'utf8')
  const registry = parseRegistry(markdown)
  const prose = markdown.replace(REGISTRY_BLOCK, '')
  const documentChainIds = [...new Set([...prose.matchAll(/^\| (CH-\d{2}) \|/gm)].map((m) => m[1]))]
  const appDir = path.join(root, 'src', 'app')
  const pages = pageRoutes(appDir)
  const tools = mcpToolNames(root)
  const decisionsDir = workspacePath(root, 'docs', 'decisions')
  const decisionFiles = existsSync(decisionsDir) ? readdirSync(decisionsDir) : []

  const surfaceExists = (type, ref) => {
    if (type === 'ENDPOINT') return ref.startsWith('/api/') && existsSync(path.join(appDir, ...ref.split('/').filter(Boolean), 'route.js'))
    if (type === 'UI') return pages.has(ref)
    if (type === 'MCP') return tools.has(ref)
    return !ref.startsWith('/') && !ref.includes('..') && existsSync(workspacePath(root, ref))
  }
  const decisionExists = (id) => decisionFiles.some((file) => file.startsWith(`${id}-`))
  return buildDataPipelineMap({ registry, domainState, surfaceExists, decisionExists, documentChainIds })
}
