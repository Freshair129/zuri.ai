// @spec docs/GOVERNANCE-LINK-METADATA.md
// @tested tests/unit/doc-identities.test.js
import path from 'node:path'

export function assertUniqueNodeIds(nodes) {
  const seen = new Map()
  for (const node of nodes) {
    if (seen.has(node.id)) throw Error(`Duplicate graph node ID: ${node.id} (${seen.get(node.id)}; ${node.path || node.type})`)
    seen.set(node.id, node.path || node.type)
  }
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
