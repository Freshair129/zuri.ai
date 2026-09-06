import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { workspaceRoot } from './workspace-path.mjs'
import { collectDocumentLinks } from './doc-links.mjs'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = workspaceRoot(app)
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const manifest = JSON.parse(read('docs/migrations/monorepo/source-manifest.json'))
const server = JSON.parse(read('docs/.doc-graph.json'))
const prior = JSON.parse(read('apps/edge/docs/.doc-graph.json'))
const disposition = new Map(manifest.edge.map(r => [r.source_path, r]))
const nodes = new Map(prior.nodes.map(n => [n.id, { ...n }]))
const bodies = new Map()
const digest = body => createHash('sha256').update(body).digest('hex')

// Retain registry identities, but prove each relocated file/requirement against actual content.
for (const node of nodes.values()) {
  const [file, anchor] = node.path.split('#')
  const row = disposition.get(file)
  if (!row) throw Error(`Unaccounted Edge identity: ${node.id}`)
  node.source_path = node.path
  node.source_commit = manifest.edge_commit
  if (node.hash) { node.registry_hash = node.hash; delete node.hash }
  if (!row.target_path) {
    node.external = true
    node.path = null
    node.provenance = `https://github.com/Freshair129/zuri-edge-device/blob/${manifest.edge_commit}/${file}`
    continue
  }
  const body = read(row.target_path)
  bodies.set(file, body)
  if (anchor && !body.includes(anchor)) throw Error(`Missing requirement declaration: ${node.id}`)
  node.path = row.target_path + (anchor ? `#${anchor}` : '')
  node.content_sha256 = digest(body)
}

// Discover new authored Markdown and annotated code/tests in the imported manifest as well.
const requirements = [...nodes.values()].filter(n => n.type === 'requirement')
const references = (text) => requirements.filter(n => {
  const id = n.id.slice(4).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Z0-9-])${id}(?![A-Z0-9-])`).test(text)
})
for (const row of manifest.edge.filter(r => r.target_path)) {
  const file = row.source_path
  if (!/\.(md|ts|js|mjs)$/.test(file)) continue
  const body = read(row.target_path)
  let type, id
  if (file.endsWith('.md')) { type = 'document'; id = `doc:${file}` }
  else if (/^tests\/.*\.test\.ts$/.test(file) && references(body).length) { type = 'test'; id = `test:${file}` }
  else if (file.startsWith('src/') && references([...body.matchAll(/@(?:req|spec)\s+([^\n]+)/g)].map(m => m[1]).join('\n')).length) { type = 'code_file'; id = `code:${file}` }
  if (!id) continue
  bodies.set(file, body)
  if (!nodes.has(id)) nodes.set(id, { id, type, path: row.target_path, source_path: file, source_commit: manifest.edge_commit, content_sha256: digest(body), status: 'current' })
}
const edges = new Map()
const add = (from, to, type, evidence) => {
  if (!nodes.has(from) || !nodes.has(to)) throw Error(`Dangling Edge edge: ${from} -> ${to}`)
  edges.set(`${from}|${type}|${to}`, { from, to, type, evidence })
}
for (const req of requirements) add(`doc:${req.source_path.split('#')[0]}`, req.id, 'defines', 'registry identity verified in relocated document')
for (const node of nodes.values()) {
  if (node.external || node.type === 'requirement') continue
  const body = bodies.get(node.source_path)
  if (!body) continue
  if (node.type === 'test' || node.type === 'code_file') {
    const text = node.type === 'test' ? body : [...body.matchAll(/@(?:req|spec)\s+([^\n]+)/g)].map(m => m[1]).join('\n')
    for (const req of references(text)) add(node.id, req.id, node.type === 'test' ? 'verified_by' : 'implements', 'relocated source annotation/reference')
  }
  if (node.type === 'document') {
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)\n]+)\)/g)) {
      const target = match[1].split('#')[0]
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(node.source_path), target))
      if (nodes.has(`doc:${resolved}`)) add(node.id, `doc:${resolved}`, 'references', 'relocated Markdown link')
    }
  }
}
// Every historical edge must have freshly reproducible evidence, or an explicit external hold.
const missing = []
for (const edge of prior.edges) {
  const key = `${edge.from}|${edge.type}|${edge.to}`
  if (edges.has(key)) continue
  if (nodes.get(edge.from)?.external || nodes.get(edge.to)?.external) add(edge.from, edge.to, edge.type, 'historical external-hold provenance')
  else missing.push(edge)
}
if (missing.length) throw Error(`Edge source edges not reproduced: ${JSON.stringify(missing.map(e => ({ from: e.from, to: e.to, type: e.type })))}`)
const mappedNodes = [...nodes.values()].map(n => ({ ...n, id: `edge::${n.id}`, source_id: n.id }))
const mappedEdges = [...edges.values()].map(e => ({ ...e, from: `edge::${e.from}`, to: `edge::${e.to}` }))
const combined = { version: 1, generated_from: 'Server live scanner plus Edge registry/content/annotation/Markdown scan', server_source: manifest.server_commit, edge_source: manifest.edge_commit, nodes: [...server.nodes, ...mappedNodes], edges: [...server.edges, ...mappedEdges] }
const documents = combined.nodes.filter(n => n.path?.endsWith('.md')).map(n => ({ nodeId: n.id, path: n.path, body: read(n.path) }))
const links = collectDocumentLinks(documents, combined.nodes)
if (links.findings.length) throw Error(`Monorepo document links: ${JSON.stringify(links.findings)}`)
for (const edge of links.edges) {
  if (!combined.edges.some(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)) combined.edges.push(edge)
}
const ids = new Set(combined.nodes.map(n => n.id))
if (ids.size !== combined.nodes.length) throw Error('Duplicate monorepo identity')
if (combined.edges.some(e => !ids.has(e.from) || !ids.has(e.to))) throw Error('Dangling monorepo edge')
combined.accounting = { server_nodes: server.nodes.length, edge_source_nodes: prior.nodes.length, edge_scanned_nodes: mappedNodes.length, edge_source_edges: prior.edges.length, edge_scanned_edges: mappedEdges.length, external_nodes: mappedNodes.filter(n => n.external).length, link_findings: 0, duplicate_ids: 0, dangling_edges: 0 }
const serialized = JSON.stringify(combined, null, 2) + '\n'
const target = 'docs/.monorepo-graph.json'
const canonical = text => {
  const graph = JSON.parse(text)
  for (const node of graph.nodes) delete node.status
  return JSON.stringify(graph)
}
if (process.argv.includes('--check')) {
  if (canonical(read(target)) !== canonical(serialized)) throw Error('Monorepo graph is stale')
} else fs.writeFileSync(path.join(root, target), serialized)
console.log(JSON.stringify(combined.accounting))
