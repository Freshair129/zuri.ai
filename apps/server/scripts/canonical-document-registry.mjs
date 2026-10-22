import path from 'node:path'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { readCanonical } from './canonical-text.mjs'
import { anchor, opensWithRetirement, statementDigest, tableStatus } from './id-anchors.mjs'
import {
  parseCanonicalIndex,
  parseCanonicalRecord,
  validateAuthoredProvenance,
  validateCanonicalEntry,
  validateReviewedProvenance,
} from './document-registry-format.mjs'

const INDEX_PATH = 'registry/document-registry/index.json'
const REQUIREMENT_FAMILIES = new Set(['FR', 'NFR', 'BR', 'SEC', 'SDD'])

function unsafePath(value) {
  if (typeof value !== 'string' || value === '' || value.startsWith('/')
    || /[\\:\u0000-\u001f\u007f]/.test(value)) return true
  return value.split('/').some(part => part === '' || part === '.' || part === '..')
}

function withinRoot(root, relativePath) {
  if (unsafePath(relativePath)) throw new Error(`Unsafe canonical registry path: ${relativePath}`)
  const candidate = path.resolve(root, ...relativePath.split('/'))
  const lexicalRelative = path.relative(root, candidate)
  if (!lexicalRelative || lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Unsafe canonical registry path: ${relativePath}`)
  }

  let actual
  try {
    actual = realpathSync(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw new Error(`Missing canonical registry file: ${relativePath}`, { cause: error })
    }
    throw error
  }
  const realRelative = path.relative(root, actual)
  if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`Unsafe canonical registry path: ${relativePath}`)
  }
  return actual
}

/**
 * Load every canonical record named by the repository's generated index.
 * Index paths are lexical and realpath-checked before any record is read.
 */
export function loadCanonicalDocumentRegistry(repositoryRoot) {
  const root = realpathSync(path.resolve(repositoryRoot))
  const indexText = readCanonical(withinRoot(root, INDEX_PATH))
  const index = parseCanonicalIndex(indexText)
  const records = index.records.map(entry => {
    const recordPath = withinRoot(root, entry.path)
    const text = readCanonical(recordPath)
    const record = parseCanonicalRecord(text)
    validateCanonicalEntry(record, entry, index)
    const recordDigest = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
    if (!entry.recordSha256 || entry.recordSha256 !== recordDigest) {
      throw new Error(`${record.id} canonical record hash does not match index`)
    }
    const readSource = relativePath => Buffer.from(readCanonical(withinRoot(root, relativePath)), 'utf8')
    validateAuthoredProvenance(record, readSource)
    validateReviewedProvenance(record, readSource)
    return { entry, record, text }
  })
  validateCanonicalMembership(records)
  return { index, records }
}

/** Ensure FEAT rows and each FR's explicit feature_id make the same claim. */
export function validateCanonicalMembership(records) {
  const byId = new Map(records.map(item => [item.record.id, item.record]))
  const membershipByRequirement = new Map()

  for (const { record } of records) {
    if (record.family !== 'FEAT') continue
    if (!record.requirementKeys.length) throw new Error(`${record.id} must bundle at least one FR`)
    for (const id of record.requirementKeys) {
      if (byId.get(id)?.family !== 'FR' || membershipByRequirement.has(id)) {
        throw new Error(`${record.id} has invalid or duplicate membership for ${id}`)
      }
      membershipByRequirement.set(id, record.id)
    }
  }

  for (const { record } of records) {
    if (record.family !== 'FR') continue
    const expectedFeature = membershipByRequirement.get(record.id)
    if (record.featureId !== expectedFeature) {
      throw new Error(`${record.id} feature membership differs from its explicit FEAT row`)
    }
  }
}

/**
 * Replace requirement and feature identity declarations read from compatibility
 * exports with the canonical per-ID records. Other identity families retain
 * their existing declaration sources and duplicate/missing-registry findings.
 */
export function canonicalizeDeclaredIdentities(declarations, records) {
  const canonicalFamilies = new Set(['FR', 'NFR', 'BR', 'SEC', 'SDD', 'FEAT'])
  const familyOf = id => String(id).split('-', 1)[0]
  const result = new Map([...declarations].filter(([id]) => !canonicalFamilies.has(familyOf(id))))
  result.duplicates = (declarations.duplicates || []).filter(item => !canonicalFamilies.has(familyOf(item.id)))
  result.missing = (declarations.missing || []).filter(item => !item.families.every(family => canonicalFamilies.has(family)))

  const nodesById = new Map(buildCanonicalGraphEntries(records).nodes.map(node => [node.id, node]))
  for (const { entry, record } of records) {
    const node = nodesById.get(`${record.family === 'FEAT' ? 'feat' : 'req'}:${record.id}`)
    const statement = record.statement ?? ''
    result.set(record.id, {
      id: record.id,
      family: record.family,
      source: entry.path,
      statement,
      anchor: anchor(statement),
      statement_digest: statementDigest(statement),
      status: node.status,
      has_version_history: record.family !== 'FEAT',
      draft: false,
    })
  }
  return result
}

function lifecycle(record) {
  const label = String(record.statement ?? '').replace(/\s+/g, ' ').trim()
  const marker = record.cells.slice(record.statementCell + 1).join(' ')
  const planned = marker.includes('🔜') || marker.trim() === 'planned'
  const rowStatus = tableStatus(label, record.cells.slice(record.statementCell + 1))
  const status = rowStatus === 'superseded' ? rowStatus : planned ? 'planned' : 'current'
  return {
    label,
    marker,
    planned,
    status,
    declared: marker.includes('✅') ? 'done' : planned ? 'planned' : 'n/a',
  }
}

/** Pure projection from parsed canonical records to requirement/feature graph entries. */
export function buildCanonicalGraphEntries(records) {
  if (!Array.isArray(records)) throw new TypeError('Canonical graph records must be an array')
  validateCanonicalMembership(records)
  const nodes = []
  const edges = []

  for (const { entry, record } of records) {
    const { id, family } = record
    if (family === 'FEAT') {
      const members = record.requirementKeys ?? []
      if (!members.length) throw new Error(`${id} must bundle at least one FR`)
      const state = lifecycle(record)
      const membershipCell = record.requirementCells?.[0]
      const status = membershipCell === undefined ? '' : (record.cells[membershipCell + 1] ?? '')
      nodes.push({
        id: `feat:${id}`,
        type: 'feature',
        label: state.label,
        declared: status,
        status: state.status,
        retirement_marker: record.cells.slice(record.statementCell + 1).find(opensWithRetirement) ?? '',
        canonical_path: entry.path,
        namespace: entry.namespace,
      })
      for (const requirementId of members) {
        edges.push({
          from: `feat:${id}`,
          to: `req:${requirementId}`,
          type: 'bundles',
          status: 'current',
          source: 'canonical-registry',
        })
      }
      continue
    }

    if (!REQUIREMENT_FAMILIES.has(family)) throw new Error(`Unsupported canonical graph family: ${family}`)
    const state = lifecycle(record)
    nodes.push({
      id: `req:${id}`,
      type: 'requirement',
      family,
      label: state.label,
      defined_in: record.sourcePath ?? 'docs/PRD-SDD-v1.0.md',
      declared: state.declared,
      status: state.status,
      row_text: `${state.label} ${state.marker}`,
      canonical_path: entry.path,
      namespace: entry.namespace,
    })
  }

  return { nodes, edges }
}
