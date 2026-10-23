import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { readCanonical } from './canonical-text.mjs'
import { anchor, opensWithRetirement, statementDigest, tableStatus } from './id-anchors.mjs'
import {
  parseCanonicalIndex,
  parseCanonicalRecord,
  validateApprovalSource,
  validateAuthoredProvenance,
  validateCanonicalEntry,
  validateReviewedProvenance,
} from './document-registry-format.mjs'

const INDEX_PATH = 'registry/document-registry/index.json'
const LEDGER_PATH = 'docs/.id-ledger.json'
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

function canonicalTextHash(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
  return createHash('sha256').update(Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')).digest('hex')
}

function committedText(root, revision, relativePath) {
  return execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${relativePath}`], {
    cwd: root, windowsHide: true, encoding: null, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function committedDigest(root, revision, relativePath) {
  if (unsafePath(relativePath)) throw new Error(`Unsafe canonical registry path: ${relativePath}`)
  const listed = execFileSync('git', ['--no-replace-objects', 'ls-tree', '--name-only', revision, '--', relativePath], {
    cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  return listed === relativePath ? canonicalTextHash(committedText(root, revision, relativePath)) : null
}

function hasAncestor(root, ancestor, descendant) {
  try {
    execFileSync('git', ['--no-replace-objects', 'merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root, windowsHide: true, stdio: 'ignore',
    })
    return true
  } catch (error) {
    if (error?.status === 1) return false
    throw error
  }
}

function requireAncestor(root, ancestor, descendant, message) {
  try {
    execFileSync('git', ['--no-replace-objects', 'merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: root, windowsHide: true, stdio: 'ignore',
    })
  } catch {
    throw new Error(message)
  }
}

function addApprovalContext(contexts, snapshotPath, approvalPath) {
  const existing = contexts.get(snapshotPath)
  if (existing !== undefined && existing !== approvalPath) {
    throw new Error(`authored approval snapshot has conflicting source context: ${snapshotPath}`)
  }
  contexts.set(snapshotPath, approvalPath)
}

const SHA1 = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const PROJECTION_PATHS = ['docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']

function expectedReceiptPaths(manifest, manifestPath) {
  const approvalCopyPath = manifestPath.replace(/\.manifest\.json$/, '.approval.md')
  const recordPaths = manifest.records.map(item => `docs/requirements/${item.id}.md`)
  const addition = [...recordPaths, approvalCopyPath, INDEX_PATH, LEDGER_PATH, ...PROJECTION_PATHS].sort()
  const amendment = manifest.records.length === 1
    ? [...recordPaths, approvalCopyPath, INDEX_PATH, ...PROJECTION_PATHS].sort()
    : null
  return { addition, amendment, approvalCopyPath, recordPaths }
}

function exactObjectKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
}

function readReceiptText(root, relativePath, revision) {
  return revision === null
    ? readCanonical(withinRoot(root, relativePath))
    : committedText(root, revision, relativePath).toString('utf8').replace(/\r\n/g, '\n')
}

function verifyReceiptOrigin(root, revision, receiptPath, manifestPath, manifestText, receiptText, receipt, expected,
  { checkAllOutputs = false } = {}) {
  const history = execFileSync('git', [
    '--no-replace-objects', 'log', '--full-history', '--diff-merges=separate', '--diff-filter=A',
    '--no-patch', '--format=%H', revision, '--', receiptPath,
  ], { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split(/\s+/).filter(item => SHA1.test(item))
  const candidates = [...new Set(history)].filter(candidate => hasAncestor(root, receipt.base.commit, candidate))
  const receiptHash = canonicalTextHash(receiptText)
  const manifestHash = canonicalTextHash(manifestText)
  const requiredOutputs = checkAllOutputs ? expected : [...expected.filter(file => file.startsWith('docs/requirements/')),
    ...expected.filter(file => file.endsWith('.approval.md'))]
  const origins = candidates.filter(candidate => {
    if (committedDigest(root, candidate, receiptPath) !== receiptHash
      || committedDigest(root, candidate, manifestPath) !== manifestHash) return false
    const parents = execFileSync('git', ['--no-replace-objects', 'rev-list', '--parents', '-n', '1', candidate], {
      cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split(/\s+/).slice(1)
    if (parents.length && parents.every(parent => committedDigest(root, parent, receiptPath) === receiptHash)) return false
    return requiredOutputs.every(file => committedDigest(root, candidate, file) === receipt.outputs[file])
  })
  if (!origins.length) throw new Error(`authored receipt has no compatible committed origin: ${receiptPath}`)
}

function validateAppliedReceipt(root, { revision, manifestPath, manifestText, manifest, recordPath, receiptText,
  currentWorktree = false, requireHistory = false }) {
  const receiptPath = manifestPath.replace(/\.manifest\.json$/, '.receipt.json')
  let receipt
  try { receipt = JSON.parse(receiptText) } catch { throw new Error(`invalid authored receipt JSON: ${receiptPath}`) }
  const { addition, amendment, approvalCopyPath, recordPaths } = expectedReceiptPaths(manifest, manifestPath)
  const receiptKeys = ['version', 'migrationId', 'status', 'manifestSha256', 'base', 'ids', 'before', 'outputs']
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || !isDeepStrictEqual(Object.keys(receipt).sort(), [...receiptKeys].sort())
    || receipt.version !== 1 || receipt.status !== 'APPLIED' || receipt.migrationId !== manifest.migrationId
    || receipt.manifestSha256 !== canonicalTextHash(manifestText)
    || !isDeepStrictEqual(receipt.base, manifest.base)
    || !isDeepStrictEqual(receipt.ids, manifest.records.map(item => item.id))) {
    throw new Error(`authored receipt identity/provenance mismatch: ${receiptPath}`)
  }
  const receiptPaths = exactObjectKeys(receipt.before, addition) && exactObjectKeys(receipt.outputs, addition)
    ? addition
    : amendment && exactObjectKeys(receipt.before, amendment) && exactObjectKeys(receipt.outputs, amendment)
      ? amendment
      : null
  if (!receiptPaths) throw new Error(`authored receipt inventory mismatch: ${receiptPath}`)
  const amendmentReceipt = receiptPaths === amendment
  for (const file of receiptPaths) {
    if (receipt.before[file] !== committedDigest(root, manifest.base.commit, file)) {
      throw new Error(`authored receipt before snapshot drift: ${file}`)
    }
    if (typeof receipt.outputs[file] !== 'string' || !SHA256.test(receipt.outputs[file])) {
      throw new Error(`authored receipt output digest invalid: ${file}`)
    }
  }

  if (amendmentReceipt) {
    if (committedDigest(root, manifest.base.commit, INDEX_PATH) !== manifest.base.indexSha256
      || committedDigest(root, manifest.base.commit, LEDGER_PATH) !== manifest.base.ledgerSha256) {
      throw new Error(`authored amendment base index/ledger digest mismatch: ${receiptPath}`)
    }
  }

  const head = execFileSync('git', ['--no-replace-objects', 'rev-parse', '--verify', 'HEAD'], {
    cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (amendmentReceipt && currentWorktree && !hasAncestor(root, manifest.base.commit, head)) {
    throw new Error(`authored amendment base is not in current history: ${manifest.base.commit}`)
  }

  const manifestBlob = revision === null
    ? canonicalTextHash(readCanonical(withinRoot(root, manifestPath)))
    : committedDigest(root, revision, manifestPath)
  if (manifestBlob !== canonicalTextHash(manifestText)) throw new Error(`authored manifest changed: ${manifestPath}`)
  const receiptBlob = revision === null ? null : committedDigest(root, revision, receiptPath)
  const committedCurrentReceipt = currentWorktree && committedDigest(root, head, receiptPath) === canonicalTextHash(receiptText)
  const mustCheckCurrentOutputs = currentWorktree && !committedCurrentReceipt
  const ownedOutputs = [...recordPaths, approvalCopyPath]
  for (const file of ownedOutputs) {
    const digest = currentWorktree
      ? canonicalTextHash(readCanonical(withinRoot(root, file)))
      : committedDigest(root, revision, file)
    if (digest !== receipt.outputs[file]) throw new Error(`authored receipt output drift: ${file}`)
  }
  if (mustCheckCurrentOutputs) {
    for (const file of receiptPaths) {
      if (canonicalTextHash(readCanonical(withinRoot(root, file))) !== receipt.outputs[file]) {
        throw new Error(`authored receipt output drift: ${file}`)
      }
    }
  }

  if (requireHistory || committedCurrentReceipt) {
    if (revision !== null && receiptBlob !== canonicalTextHash(receiptText)) {
      throw new Error(`authored receipt changed at its indexed revision: ${receiptPath}`)
    }
    verifyReceiptOrigin(root, revision ?? head, receiptPath, manifestPath, manifestText, receiptText, receipt, receiptPaths,
      { checkAllOutputs: amendmentReceipt })
  }
  return { receipt, receiptPath, approvalCopyPath, amendmentReceipt }
}

function assertSameAuthoredIdentity(currentEntry, currentRecord, priorEntry, priorRecord) {
  for (const key of ['id', 'namespace', 'family', 'recordVersion', 'status', 'provenance', 'path', 'exportDocument', 'exportOrder', 'featureId']) {
    if (priorEntry[key] !== currentEntry[key]) throw new Error(`${currentRecord.id} authored history changes ${key}`)
  }
  if (!isDeepStrictEqual(priorEntry.requirementCells ?? [], currentEntry.requirementCells ?? [])
    || priorRecord.status !== 'active' || priorRecord.provenance !== 'authored'
    || priorRecord.family !== 'FR' || priorRecord.featureId !== undefined
    || !isDeepStrictEqual(priorRecord.requirementCells ?? [], [])
    || priorRecord.subjectAnchor !== currentRecord.subjectAnchor) {
    throw new Error(`${currentRecord.id} authored history changes status, membership, or subject anchor`)
  }
}

/**
 * Return current and historically proven authored approval snapshots, mapped
 * to the source approval document used for link-context checks. Historical
 * copies are followed only through a real amendment receipt whose before-image
 * contains the prior record. An original-add receipt has a null record
 * before-image and ends the walk without requiring its historical base to be
 * reachable from current HEAD.
 */
export function canonicalApprovalSnapshotContexts(registry, repositoryRoot) {
  const root = realpathSync(path.resolve(repositoryRoot))
  const contexts = new Map()

  for (const { entry } of registry.records) {
    if (entry.recordVersion !== 2) continue
    const recordText = readCanonical(withinRoot(root, entry.path))
    const record = parseCanonicalRecord(recordText)
    validateCanonicalEntry(record, entry, registry.index)
    if (canonicalTextHash(recordText) !== entry.recordSha256) {
      throw new Error(`${record.id} canonical record hash does not match index`)
    }
    const readCurrent = relativePath => Buffer.from(readCanonical(withinRoot(root, relativePath)), 'utf8')
    const currentManifest = validateAuthoredProvenance(record, readCurrent)
    if (!currentManifest) throw new Error(`${record.id} authored provenance is missing`)

    const currentManifestText = readCanonical(withinRoot(root, record.manifestPath))
    const currentSnapshot = record.manifestPath.replace(/\.manifest\.json$/, '.approval.md')
    const currentApproval = readCanonical(withinRoot(root, currentSnapshot))
    validateApprovalSource(currentApproval, record.approvalVersion, record.approvalSha256)
    addApprovalContext(contexts, currentSnapshot, record.approvalPath)

    const receiptPath = record.manifestPath.replace(/\.manifest\.json$/, '.receipt.json')
    if (!existsSync(withinRoot(root, receiptPath))) continue
    const currentReceiptText = readReceiptText(root, receiptPath, null)
    let currentReceipt
    try { currentReceipt = JSON.parse(currentReceiptText) } catch { throw new Error(`invalid authored receipt JSON: ${receiptPath}`) }
    // Original adds have no predecessor record. Keep their existing acceptance
    // independent from whether their pinned base survived a repository rewrite.
    if (currentReceipt?.before?.[entry.path] === null) continue
    if (!currentReceipt || typeof currentReceipt !== 'object' || currentReceipt.before?.[entry.path] === undefined) {
      throw new Error(`authored receipt does not prove an amendment predecessor: ${receiptPath}`)
    }

    const currentReceiptInfo = validateAppliedReceipt(root, {
      revision: null,
      manifestPath: record.manifestPath,
      manifestText: currentManifestText,
      manifest: currentManifest,
      recordPath: entry.path,
      receiptText: currentReceiptText,
      currentWorktree: true,
    })
    if (!currentReceiptInfo.amendmentReceipt || !SHA256.test(currentReceipt.before[entry.path])) {
      throw new Error(`authored receipt does not prove an amendment predecessor: ${receiptPath}`)
    }

    let stateEntry = entry
    let stateRecord = record
    let stateManifest = currentManifest
    let stateRevision = null
    const visited = new Set()
    while (true) {
      const base = stateManifest.base.commit
      if (visited.has(base)) throw new Error(`${record.id} authored provenance history contains a cycle`)
      visited.add(base)
      const head = execFileSync('git', ['--no-replace-objects', 'rev-parse', '--verify', 'HEAD'], {
        cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      const descendant = stateRevision ?? head
      requireAncestor(root, base, descendant, `${record.id} amendment base ${base} is not an ancestor of ${descendant}`)

      const indexBytes = committedText(root, base, INDEX_PATH)
      if (canonicalTextHash(indexBytes) !== stateManifest.base.indexSha256) {
        throw new Error(`${record.id} authored history index digest does not match ${base}`)
      }
      const ledgerBytes = committedText(root, base, LEDGER_PATH)
      if (canonicalTextHash(ledgerBytes) !== stateManifest.base.ledgerSha256) {
        throw new Error(`${record.id} authored history ledger digest does not match ${base}`)
      }

      const historicalIndex = parseCanonicalIndex(indexBytes.toString('utf8').replace(/\r\n/g, '\n'))
      const priorEntries = historicalIndex.records.filter(candidate => candidate.id === record.id)
      if (priorEntries.length !== 1 || priorEntries[0].recordVersion !== 2) {
        throw new Error(`${record.id} amendment base does not contain exactly one authored-v2 predecessor`)
      }
      const priorEntry = priorEntries[0]
      const priorText = committedText(root, base, priorEntry.path).toString('utf8').replace(/\r\n/g, '\n')
      if (canonicalTextHash(priorText) !== priorEntry.recordSha256) {
        throw new Error(`${record.id} authored history record hash does not match index`)
      }
      const priorRecord = parseCanonicalRecord(priorText)
      validateCanonicalEntry(priorRecord, priorEntry, historicalIndex)
      assertSameAuthoredIdentity(stateEntry, stateRecord, priorEntry, priorRecord)
      if (priorRecord.statement === stateRecord.statement) {
        throw new Error(`${record.id} amendment predecessor has the same statement`)
      }

      const readHistorical = relativePath => committedText(root, base, relativePath)
      const priorManifest = validateAuthoredProvenance(priorRecord, readHistorical)
      if (!priorManifest) throw new Error(`${record.id} authored history is missing its manifest`)
      requireAncestor(root, priorManifest.base.commit, base,
        `${record.id} prior authored base ${priorManifest.base.commit} is not an ancestor of amendment base ${base}`)
      requireAncestor(root, priorManifest.approval.revision, priorManifest.base.commit,
        `${record.id} prior approval revision is not an ancestor of its authored base`)

      const priorManifestText = readHistorical(priorRecord.manifestPath).toString('utf8').replace(/\r\n/g, '\n')
      const currentPriorManifestText = readCanonical(withinRoot(root, priorRecord.manifestPath))
      if (currentPriorManifestText !== priorManifestText) {
        throw new Error(`historical approval manifest changed: ${priorRecord.manifestPath}`)
      }
      const priorSnapshot = priorRecord.manifestPath.replace(/\.manifest\.json$/, '.approval.md')
      const historicalApprovalText = readHistorical(priorSnapshot).toString('utf8').replace(/\r\n/g, '\n')
      const currentPriorApprovalText = readCanonical(withinRoot(root, priorSnapshot))
      if (currentPriorApprovalText !== historicalApprovalText) {
        throw new Error(`historical approval snapshot changed: ${priorSnapshot}`)
      }
      const priorSourceText = committedText(root, priorManifest.approval.revision, priorManifest.approval.path)
        .toString('utf8').replace(/\r\n/g, '\n')
      validateApprovalSource(priorSourceText, priorManifest.approval.version, priorManifest.approval.sha256)
      addApprovalContext(contexts, priorSnapshot, priorRecord.approvalPath)

      const priorReceiptPath = priorRecord.manifestPath.replace(/\.manifest\.json$/, '.receipt.json')
      const priorReceiptText = readReceiptText(root, priorReceiptPath, base)
      const priorReceiptInfo = validateAppliedReceipt(root, {
        revision: base,
        manifestPath: priorRecord.manifestPath,
        manifestText: priorManifestText,
        manifest: priorManifest,
        recordPath: priorEntry.path,
        receiptText: priorReceiptText,
        currentWorktree: false,
        requireHistory: true,
      })
      const priorRecordBefore = priorReceiptInfo.receipt.before[priorEntry.path]
      if (priorRecordBefore === null) break
      if (!priorReceiptInfo.amendmentReceipt || !SHA256.test(priorRecordBefore)) {
        throw new Error(`${record.id} prior receipt has an invalid amendment before-image`)
      }
      if (priorRecordBefore !== committedDigest(root, priorManifest.base.commit, priorEntry.path)) {
        throw new Error(`${record.id} prior amendment before-image differs from its pinned base`)
      }

      stateEntry = priorEntry
      stateRecord = priorRecord
      stateManifest = priorManifest
      stateRevision = base
    }
  }

  return contexts
}

/** Frozen approval copies are provenance, not live ID declarations. */
export function canonicalApprovalSnapshotPaths(registry, repositoryRoot) {
  return new Set(canonicalApprovalSnapshotContexts(registry, repositoryRoot).keys())
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
