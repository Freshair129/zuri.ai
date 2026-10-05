// @spec docs/GOVERNANCE-LINK-METADATA.md
// @tested tests/unit/doc-identities.test.js
import path from 'node:path'

const REINTEGRATION_INDEXES = new Set([
  'docs/product/README.md', 'docs/architecture/README.md',
  'docs/operations/README.md', 'docs/governance/README.md',
])

export function isGeneratedDocumentView(file) {
  return REINTEGRATION_INDEXES.has(file)
    || /^docs\/features\/FEAT-\d{3}\/(?:design|verification)\.md$/.test(file)
}

/** Registry records and explanatory feature notes are separate document roles. */
export function collectDocumentClaims(paths, canonicalPaths = new Set()) {
  const claims = new Map()
  const claim = (id, file) => claims.set(id, [...(claims.get(id) || []), file])
  for (const file of paths) {
    const base = path.posix.basename(file)
    const adr = /^ADR-(\d{3})/.exec(base)
    if (adr) claim(`ADR-${adr[1]}`, file)
    const cr = /^ZV2-CR-(\d{3})-(?!W\d+-)/.exec(base)
    if (cr) claim(`ZV2-CR-${cr[1]}`, file)
    // Only records present in the separately validated unique canonical index
    // have this role. An unindexed copy still competes with the existing note.
    if (file.includes('/features/') && !canonicalPaths.has(file)) {
      const fr = /^(FR-\d{3})/.exec(base)
      if (fr) claim(fr[1], file)
    }
  }
  return claims
}

export function assertUniqueNodeIds(nodes) {
  const seen = new Map()
  for (const node of nodes) {
    if (seen.has(node.id)) throw Error(`Duplicate graph node ID: ${node.id} (${seen.get(node.id)}; ${node.path || node.type})`)
    seen.set(node.id, node.path || node.type)
  }
}

/** Identity targets retain source status but are not superseded content needing a successor. */
export function requiresSuccessor(node) {
  return node.type !== 'document-identity'
    && (node.status === 'superseded' || /supersed/i.test(node.doc_status || ''))
}

/** Bind every declaration collected from its existing owner registry to one ZAI graph identity. */
export function indexDeclaredIdentities(declarations, nodes) {
  const qualified = new Map()
  for (const [id, declaration] of declarations) {
    const family = declaration.family
    const nodeId = family === 'FEAT' ? `feat:${id}`
      : ['FR', 'NFR', 'BR', 'SEC', 'SDD'].includes(family) ? `req:${id}` : null
    let node = nodeId ? nodes.find(candidate => candidate.id === nodeId)
      : family === 'ADR' ? nodes.find(candidate => candidate.type === 'adr' && candidate.id.startsWith(`spec:${id}-`))
        : family === 'ZV2-CR' ? nodes.find(candidate => candidate.path === declaration.source) : null
    if (!node) {
      node = { id: `identity:ZAI:${id}`, type: 'document-identity', defined_in: declaration.source, status: declaration.status }
      nodes.push(node)
    }
    node.namespace = 'ZAI'
    node.document_identity = id
    node.identity_family = family
    node.defined_in = declaration.source
    node.canonical_path ||= `${declaration.source}#${id}`
    if (qualified.has(`ZAI:${id}`)) throw Error(`Duplicate declared identity: ZAI:${id}`)
    qualified.set(`ZAI:${id}`, node)
  }
  return qualified
}

/** Only ambiguous document basenames change; business registry IDs never do. */
export function qualifyDocumentIds(nodes) {
  const groups = new Map()
  for (const node of nodes) {
    if (!groups.has(node.id)) groups.set(node.id, [])
    groups.get(node.id).push(node)
  }
  for (const [oldId, group] of groups) {
    if (group.length < 2) continue
    if (!oldId.startsWith('doc:') || group.some(n => !n.path) || new Set(group.map(n => n.path)).size !== group.length) {
      throw Error(`Duplicate graph node ID: ${oldId}`)
    }
    for (const node of group) {
      const sourcePath = path.posix.normalize(node.path.replaceAll('\\', '/'))
      node.id = `doc:${sourcePath.replace(/\.md$/, '')}`
      node.identity_migration = { repository: 'Freshair129/zuri.ai', previous_id: oldId, source_path: sourcePath }
    }
  }
  assertUniqueNodeIds(nodes)
}
