#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NAMESPACES = new Set(['ZAI', 'ZNEXT', 'edge'])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const SPLIT_OR_MERGE = /(?:split|merg|one[-_ ]to[-_ ]many|many[-_ ]to[-_ ]one)/i

export class DocumentIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DocumentIdentityError'
    this.code = code
    this.details = details
  }
}

function identityError(code, message, details) {
  return new DocumentIdentityError(code, message, details)
}

function assertIdentityParts(identity) {
  if (!identity || !NAMESPACES.has(identity.namespace) || typeof identity.id !== 'string' || !ID_PATTERN.test(identity.id)) {
    throw identityError('INVALID_IDENTITY_REFERENCE', 'Identity must have a supported namespace and a non-empty, unqualified ID.', { identity })
  }
}

/** Parse a serialized qualified identity. Bare IDs are intentionally handled by resolution, not parsing. */
export function parseQualifiedIdentity(reference) {
  if (typeof reference !== 'string') {
    throw identityError('INVALID_IDENTITY_REFERENCE', 'Identity reference must be a string.', { reference })
  }
  const value = reference.trim()
  let identity
  if (value.startsWith('edge::')) identity = { namespace: 'edge', id: value.slice('edge::'.length) }
  else {
    const match = /^(ZAI|ZNEXT):(.+)$/.exec(value)
    if (match) identity = { namespace: match[1], id: match[2] }
  }
  if (!identity) {
    if (!ID_PATTERN.test(value) || value.includes(':')) {
      throw identityError('INVALID_IDENTITY_REFERENCE', `Invalid qualified identity: ${reference}`, { reference })
    }
    return null
  }
  assertIdentityParts(identity)
  return identity
}

export function formatQualifiedIdentity(identity) {
  assertIdentityParts(identity)
  return identity.namespace === 'edge' ? `edge::${identity.id}` : `${identity.namespace}:${identity.id}`
}

function sameIdentity(left, right) {
  return left?.namespace === right?.namespace && left?.id === right?.id
}

function selectByLocator(records, selector = {}) {
  return records.filter(record =>
    (selector.revision === undefined || record.revision === selector.revision) &&
    (selector.path === undefined || record.path === selector.path) &&
    (selector.blob === undefined || record.blob === selector.blob) &&
    (selector.sha256 === undefined || record.sha256 === selector.sha256))
}

/** Resolve an exact qualified identity, or a globally unique bare ID, without choosing a revision implicitly. */
export function resolveDocumentIdentity(reference, { identities, revision, path: sourcePath, blob, sha256 } = {}) {
  if (!Array.isArray(identities)) {
    throw identityError('INVALID_IDENTITY_MANIFEST', 'Identity declarations must be an array.', {})
  }
  const parsed = parseQualifiedIdentity(reference)
  const candidates = identities.filter(record => parsed
    ? sameIdentity(record, parsed)
    : record?.id === reference.trim())
  const matches = selectByLocator(candidates, { revision, path: sourcePath, blob, sha256 })
  if (!matches.length) {
    throw identityError('IDENTITY_NOT_FOUND', `No identity declaration matches ${reference}.`, { reference, revision, path: sourcePath, blob, sha256 })
  }
  if (matches.length > 1) {
    throw identityError('AMBIGUOUS_IDENTITY', `Identity ${reference} has more than one matching declaration; supply its namespace and locator.`, {
      reference,
      candidates: matches.map(({ namespace, id, revision: foundRevision, path: foundPath, blob: foundBlob }) => ({
        namespace, id, revision: foundRevision, path: foundPath, blob: foundBlob,
      })),
    })
  }
  return { ...matches[0] }
}

function validateQualifiedIdentity(value, at, errors) {
  if (!value || typeof value !== 'object' || !NAMESPACES.has(value.namespace) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) {
    errors.push({ code: 'INVALID_IDENTITY_KEY', path: at, message: 'Expected a supported namespace and an unqualified ID.' })
    return false
  }
  return true
}

function tuple(namespace, id) {
  return `${namespace}\u0000${id}`
}

function declarationKey(identity) {
  return `${tuple(identity.namespace, identity.id)}\u0000${identity.revision}`
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function provenanceError(row) {
  return !row || !isNonEmptyString(row.path) || !isNonEmptyString(row.revision) ||
    !isNonEmptyString(row.blob) || !isNonEmptyString(row.sha256) ||
    !(Number.isInteger(row.row) && row.row > 0) || !isNonEmptyString(row.sourceDisposition)
}

/** Validate the source inventory and grouped crosswalk without repairing either manifest. */
export function validateIdentityManifests({ identities, mappings } = {}) {
  const errors = []
  if (!Array.isArray(identities)) errors.push({ code: 'INVALID_IDENTITIES', path: 'identities', message: 'Expected an identity declaration array.' })
  if (!Array.isArray(mappings)) errors.push({ code: 'INVALID_MAPPINGS', path: 'mappings', message: 'Expected a mapping array.' })
  if (!Array.isArray(identities) || !Array.isArray(mappings)) return errors

  const declarationKeys = new Map()
  const declarationsByTuple = new Map()
  identities.forEach((identity, index) => {
    const at = `identities[${index}]`
    if (!validateQualifiedIdentity(identity, at, errors)) return
    for (const field of ['family', 'revision', 'path', 'blob', 'sha256', 'declarationKind', 'disposition', 'reviewStatus']) {
      if (!isNonEmptyString(identity[field])) errors.push({ code: 'INVALID_IDENTITY_DECLARATION', path: `${at}.${field}`, message: `${field} must be a non-empty string.` })
    }
    if (identity.sourceStatus !== null && !isNonEmptyString(identity.sourceStatus)) {
      errors.push({ code: 'INVALID_IDENTITY_DECLARATION', path: `${at}.sourceStatus`, message: 'sourceStatus must be a non-empty string or null when the source declaration omits it.' })
    }
    const key = declarationKey(identity)
    if (declarationKeys.has(key)) errors.push({ code: 'DUPLICATE_IDENTITY_DECLARATION', path: at, message: `Duplicate declaration for ${formatQualifiedIdentity(identity)} at revision ${identity.revision}.` })
    else declarationKeys.set(key, at)
    const idTuple = tuple(identity.namespace, identity.id)
    if (!declarationsByTuple.has(idTuple)) declarationsByTuple.set(idTuple, [])
    declarationsByTuple.get(idTuple).push(identity)
  })

  const mappingSources = new Map()
  const mappingRows = []
  mappings.forEach((mapping, index) => {
    const at = `mappings[${index}]`
    if (!mapping || typeof mapping !== 'object') {
      errors.push({ code: 'INVALID_MAPPING', path: at, message: 'Mapping must be an object.' })
      return
    }
    if (!validateQualifiedIdentity(mapping.source, `${at}.source`, errors)) return
    if (!isNonEmptyString(mapping.sourceRevision)) errors.push({ code: 'INVALID_MAPPING_SOURCE_REVISION', path: `${at}.sourceRevision`, message: 'sourceRevision must identify the source declaration revision.' })
    const sourceLocator = mapping.sourceLocator
    if (!sourceLocator || !isNonEmptyString(sourceLocator.path) || !isNonEmptyString(sourceLocator.blob) || !isNonEmptyString(sourceLocator.sha256)) {
      errors.push({ code: 'INVALID_MAPPING_SOURCE_LOCATOR', path: `${at}.sourceLocator`, message: 'sourceLocator requires path, blob, and sha256.' })
    }
    if (!isNonEmptyString(mapping.targetRevision)) errors.push({ code: 'INVALID_MAPPING_TARGET_REVISION', path: `${at}.targetRevision`, message: 'targetRevision must identify the target declaration snapshot.' })
    if (!Array.isArray(mapping.targets)) errors.push({ code: 'INVALID_MAPPING_TARGETS', path: `${at}.targets`, message: 'targets must be an array.' })
    if (!isNonEmptyString(mapping.sourceDisposition)) errors.push({ code: 'INVALID_MAPPING_DISPOSITION', path: `${at}.sourceDisposition`, message: 'sourceDisposition must be a non-empty string.' })
    if (!isNonEmptyString(mapping.reviewStatus)) errors.push({ code: 'INVALID_MAPPING_REVIEW_STATUS', path: `${at}.reviewStatus`, message: 'reviewStatus must be a non-empty string.' })
    if (!Array.isArray(mapping.provenance)) errors.push({ code: 'INVALID_MAPPING_PROVENANCE', path: `${at}.provenance`, message: 'provenance must be an array.' })

    const sourceKey = tuple(mapping.source.namespace, mapping.source.id)
    if (mappingSources.has(sourceKey)) errors.push({ code: 'DUPLICATE_MAPPING_SOURCE', path: at, message: `More than one grouped mapping exists for ${formatQualifiedIdentity(mapping.source)}.` })
    else mappingSources.set(sourceKey, at)
    const sourceDeclarations = declarationsByTuple.get(sourceKey) || []
    const sourceAtRevision = sourceDeclarations.filter(identity => identity.revision === mapping.sourceRevision)
    if (!sourceAtRevision.length) {
      errors.push({ code: 'MAPPING_SOURCE_NOT_DECLARED', path: `${at}.source`, message: `No source declaration matches ${formatQualifiedIdentity(mapping.source)} at ${mapping.sourceRevision}.` })
    } else if (sourceLocator && sourceAtRevision.length === 1 &&
      (sourceAtRevision[0].path !== sourceLocator.path || sourceAtRevision[0].blob !== sourceLocator.blob || sourceAtRevision[0].sha256 !== sourceLocator.sha256)) {
      errors.push({ code: 'MAPPING_SOURCE_LOCATOR_MISMATCH', path: `${at}.sourceLocator`, message: `sourceLocator does not match ${formatQualifiedIdentity(mapping.source)} at ${mapping.sourceRevision}.` })
    }

    const targets = Array.isArray(mapping.targets) ? mapping.targets : []
    const seenTargets = new Set()
    targets.forEach((target, targetIndex) => {
      const targetAt = `${at}.targets[${targetIndex}]`
      if (!validateQualifiedIdentity(target, targetAt, errors)) return
      const key = tuple(target.namespace, target.id)
      if (seenTargets.has(key)) errors.push({ code: 'DUPLICATE_MAPPING_TARGET', path: targetAt, message: `Duplicate target ${formatQualifiedIdentity(target)}.` })
      seenTargets.add(key)
      const targetDeclarations = declarationsByTuple.get(key) || []
      if (!targetDeclarations.some(identity => identity.revision === mapping.targetRevision)) {
        errors.push({ code: 'MAPPING_TARGET_NOT_DECLARED', path: targetAt, message: `No declaration exists for ${formatQualifiedIdentity(target)} at ${mapping.targetRevision}.` })
      }
    })

    if (Array.isArray(mapping.provenance)) {
      if (targets.length > 0 && mapping.provenance.length === 0) errors.push({ code: 'MAPPING_PROVENANCE_REQUIRED', path: `${at}.provenance`, message: 'Mapped targets require source crosswalk provenance.' })
      mapping.provenance.forEach((row, rowIndex) => {
        if (provenanceError(row) || !(row.targetId === null || isNonEmptyString(row.targetId))) {
          errors.push({ code: 'INVALID_MAPPING_PROVENANCE', path: `${at}.provenance[${rowIndex}]`, message: 'Each provenance row requires path, revision, blob, sha256, a positive row number, a string or null targetId, and sourceDisposition.' })
        } else {
          if (row.revision !== mapping.targetRevision) errors.push({ code: 'MAPPING_PROVENANCE_REVISION_MISMATCH', path: `${at}.provenance[${rowIndex}].revision`, message: 'Crosswalk provenance revision must match targetRevision.' })
          if (row.targetId !== null && !targets.some(target => target.id === row.targetId)) errors.push({ code: 'MAPPING_PROVENANCE_TARGET_MISMATCH', path: `${at}.provenance[${rowIndex}].targetId`, message: 'Provenance targetId is absent from the grouped target list.' })
        }
      })
    }
    mappingRows.push({ mapping, at })
  })

  for (const { mapping, at } of mappingRows) {
    if (mapping.reviewStatus !== 'approved-alias') continue
    const targets = Array.isArray(mapping.targets) ? mapping.targets : []
    const provenance = Array.isArray(mapping.provenance) ? mapping.provenance : []
    const validPair = mapping.source.namespace === 'ZAI' && targets.length === 1 && targets[0]?.namespace === 'ZNEXT'
    const targetExistsAtSnapshot = validPair && (declarationsByTuple.get(tuple(targets[0].namespace, targets[0].id)) || [])
      .some(identity => identity.revision === mapping.targetRevision)
    const sourceExistsAtRevision = (declarationsByTuple.get(tuple(mapping.source.namespace, mapping.source.id)) || [])
      .some(identity => identity.revision === mapping.sourceRevision)
    const rowTargetsMatch = validPair && provenance.length > 0 && provenance.every(row => row?.targetId === targets[0].id && row?.revision === mapping.targetRevision)
    if (!validPair || !sourceExistsAtRevision || !provenance.length || !targetExistsAtSnapshot || !rowTargetsMatch || SPLIT_OR_MERGE.test(mapping.sourceDisposition)) {
      errors.push({ code: 'INVALID_APPROVED_ALIAS', path: at, message: 'An approved alias must be a reviewed one-to-one ZAI→ZNEXT pair with exact source and target revision provenance.' })
    }
    if (validPair) {
      for (const { mapping: other, at: otherAt } of mappingRows) {
        if (otherAt === at || !(other.targets || []).some(target => sameIdentity(target, targets[0]))) continue
        errors.push({ code: 'ALIAS_TARGET_HAS_MULTIPLE_SOURCES', path: at, message: `Approved alias target ${formatQualifiedIdentity(targets[0])} is also mapped from ${formatQualifiedIdentity(other.source)}.` })
      }
    }
  }
  return errors
}

function aliasFailure(code, message, source, mapping) {
  throw identityError(code, message, { source, mapping })
}

/** Resolve a current ZNEXT ID to ZAI only through an exact reviewed inverse of the ZAI→ZNEXT crosswalk. */
export function resolveCanonicalDocumentIdentity(reference, options = {}) {
  const { identities, mappings } = options
  const source = resolveDocumentIdentity(reference, options)
  if (source.namespace !== 'ZNEXT') return { source, canonical: source, mapping: null, provenance: [] }
  if (!Array.isArray(mappings)) throw identityError('INVALID_IDENTITY_MANIFEST', 'Crosswalk mappings must be an array.', {})

  const matching = mappings.filter(mapping => mapping?.source?.namespace === 'ZAI' &&
    Array.isArray(mapping.targets) && mapping.targets.some(target => sameIdentity(target, source)))
  if (!matching.length) aliasFailure('IDENTITY_ALIAS_UNAVAILABLE', `No reviewed ZAI crosswalk source maps to ${formatQualifiedIdentity(source)}.`, source)
  if (matching.length !== 1) aliasFailure('IDENTITY_ALIAS_AMBIGUOUS', `More than one ZAI crosswalk source maps to ${formatQualifiedIdentity(source)}.`, source, matching)

  const mapping = matching[0]
  if (mapping.reviewStatus !== 'approved-alias') aliasFailure('IDENTITY_ALIAS_NOT_APPROVED', `Mapping for ${formatQualifiedIdentity(source)} is not an approved alias.`, source, mapping)
  if (mapping.targets?.length !== 1 || mapping.targets[0].namespace !== 'ZNEXT' || SPLIT_OR_MERGE.test(mapping.sourceDisposition || '')) {
    aliasFailure('IDENTITY_ALIAS_NOT_ONE_TO_ONE', `Mapping for ${formatQualifiedIdentity(source)} is a split, merge, or non-one-to-one relation.`, source, mapping)
  }
  const provenance = Array.isArray(mapping.provenance) ? mapping.provenance : []
  if (mapping.targetRevision !== source.revision || !provenance.length || !provenance.every(row => row?.revision === source.revision && row?.targetId === source.id)) {
    aliasFailure('IDENTITY_ALIAS_REVISION_MISMATCH', `Crosswalk provenance does not pin ${formatQualifiedIdentity(source)} at ${source.revision}.`, source, mapping)
  }
  if (!isNonEmptyString(mapping.sourceRevision)) {
    aliasFailure('IDENTITY_ALIAS_REVISION_MISMATCH', 'Crosswalk does not pin the ZAI source declaration revision.', source, mapping)
  }
  if (!mapping.sourceLocator || !isNonEmptyString(mapping.sourceLocator.path) || !isNonEmptyString(mapping.sourceLocator.blob) || !isNonEmptyString(mapping.sourceLocator.sha256)) {
    aliasFailure('IDENTITY_ALIAS_LOCATOR_MISMATCH', 'Crosswalk does not pin the ZAI source declaration locator.', source, mapping)
  }
  const canonical = resolveDocumentIdentity(formatQualifiedIdentity(mapping.source), {
    identities,
    revision: mapping.sourceRevision,
    path: mapping.sourceLocator?.path,
    blob: mapping.sourceLocator?.blob,
    sha256: mapping.sourceLocator?.sha256,
  })
  return { source, canonical, mapping: { ...mapping }, provenance: provenance.map(row => ({ ...row })) }
}

export function createDocumentIdentityResolver({ identities, mappings = [] } = {}) {
  if (!Array.isArray(identities) || !Array.isArray(mappings)) {
    throw identityError('INVALID_IDENTITY_MANIFEST', 'identities and mappings must be arrays.', {})
  }
  return Object.freeze({
    resolveIdentity: (reference, selector = {}) => resolveDocumentIdentity(reference, { identities, ...selector }),
    resolveCanonicalIdentity: (reference, selector = {}) => resolveCanonicalDocumentIdentity(reference, { identities, mappings, ...selector }),
  })
}

function runCheck(args) {
  const rootIndex = args.indexOf('--root')
  const root = rootIndex >= 0
    ? path.resolve(args[rootIndex + 1] || '')
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const unknown = args.filter((arg, index) => arg !== '--check' && arg !== '--root' && index !== rootIndex + 1)
  if (!args.includes('--check') || unknown.length || (rootIndex >= 0 && !args[rootIndex + 1])) {
    process.stderr.write('Usage: node tools/document-identity.mjs --check [--root <repo-root>]\n')
    return 2
  }
  const dir = path.join(root, 'registry', 'document-reintegration')
  let identities, mappings
  try {
    const identityManifest = JSON.parse(readFileSync(path.join(dir, 'identities.json'), 'utf8'))
    const mappingManifest = JSON.parse(readFileSync(path.join(dir, 'mappings.json'), 'utf8'))
    identities = Array.isArray(identityManifest) ? identityManifest : identityManifest?.identities
    mappings = Array.isArray(mappingManifest) ? mappingManifest : mappingManifest?.mappings
    if (!Array.isArray(identities) || !Array.isArray(mappings)) throw new Error('Expected identities.json.identities and mappings.json.mappings arrays.')
  } catch (error) {
    process.stderr.write(`Document identity manifest check failed: ${error.message}\n`)
    return 1
  }
  const errors = validateIdentityManifests({ identities, mappings })
  if (errors.length) {
    for (const error of errors) process.stderr.write(`${error.code} ${error.path}: ${error.message}\n`)
    process.stderr.write(`Document identity manifest check failed with ${errors.length} error(s).\n`)
    return 1
  }
  process.stdout.write(`Document identity manifests valid (${identities.length} declarations, ${mappings.length} mappings).\n`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCheck(process.argv.slice(2))
}
