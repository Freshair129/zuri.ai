import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  canonicalApprovalSnapshotContexts,
  canonicalApprovalSnapshotPaths,
  buildCanonicalGraphEntries,
  canonicalizeDeclaredIdentities,
  loadCanonicalDocumentRegistry,
} from '../../scripts/canonical-document-registry.mjs'
import { parseCanonicalRecord, validateReviewedProvenance } from '../../scripts/document-registry-format.mjs'
import { anchor } from '../../scripts/id-anchors.mjs'
import { authoredRecordMarkdown } from '../../../../tools/document-record-migration.mjs'
import { buildCanonicalIndex } from '../../../../tools/document-registry.mjs'

const sourceRevision = 'a'.repeat(40)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const migrationDir = 'docs/migrations/document-reintegration/record-migrations'
const recordPath = 'docs/requirements/FR-101.md'
const indexPath = 'registry/document-registry/index.json'
const ledgerPath = 'docs/.id-ledger.json'

function makeRecord({ id, family, statement, statusCell, requirementKeys = [], featureId }) {
  const feature = family === 'FEAT'
  const sourcePath = feature ? 'docs/FEATURES.md' : 'docs/PRD-SDD-v1.0.md'
  const recordPath = feature
    ? `docs/features/${id}/feature.md`
    : `docs/requirements/${id}.md`
  const membershipCell = requirementKeys.join(', ')
  const cells = feature
    ? [id, statement, membershipCell, statusCell]
    : [id, statement, statusCell]
  const row = `| ${cells.join(' | ')} |\n`
  const requirementCells = feature ? [3] : []
  const text = [
    '---',
    `id: ${id}`,
    `family: ${family}`,
    'namespace: ZAI',
    'version: 1',
    'status: source-preserved',
    `source_path: ${sourcePath}`,
    `source_revision: ${sourceRevision}`,
    ...(featureId ? [`feature_id: ${featureId}`] : []),
    `source_row_sha256: ${sha256(row)}`,
    'source_row_eol: LF',
    'statement_cell: 2',
    `requirement_cells: ${JSON.stringify(requirementCells)}`,
    '---',
    '<!-- canonical-row:start -->',
    '```text',
    row.trimEnd(),
    '```',
    '<!-- canonical-row:end -->',
    '',
  ].join('\n')
  const record = parseCanonicalRecord(text)
  const entry = {
    id,
    namespace: 'ZAI',
    family,
    recordVersion: 1,
    status: 'source-preserved',
    path: recordPath,
    sourcePath,
    sourceRowSha256: record.sourceRowSha256,
    recordSha256: sha256(text.replace(/\r\n/g, '\n')),
    statementCell: record.statementCell,
    requirementCells: record.requirementCells,
    ...(record.featureId ? { featureId: record.featureId } : {}),
  }
  return { entry, text, record }
}

function makeFixture({
  includeFeature = true,
  omitRequirementRecord = false,
  corruptRequirementRecord = false,
  mismatchedRequirementFeatureId = false,
  omitFeatureRequirement = false,
  retireFeature = false,
  corruptRecordHash = false,
  mutateEntry,
  compatibilityExports = true,
} = {}) {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'canonical-document-registry-'))
  const requirement = makeRecord({
    id: 'FR-101',
    family: 'FR',
    statement: 'Canonical requirement statement',
    statusCell: '✅ implemented; the old implementation is retired',
    featureId: includeFeature ? (mismatchedRequirementFeatureId ? 'FEAT-102' : 'FEAT-101') : undefined,
  })
  const retiredRequirement = makeRecord({
    id: 'FR-102',
    family: 'FR',
    statement: '~~Canonical retired statement~~',
    statusCell: 'replaced by FR-101',
  })
  const feature = makeRecord({
    id: 'FEAT-101',
    family: 'FEAT',
    statement: retireFeature ? '~~Canonical retired feature~~' : 'Canonical feature statement',
    statusCell: retireFeature ? 'superseded by ADR-110 D5' : 'building',
    requirementKeys: omitFeatureRequirement ? [] : ['FR-101'],
  })
  const entries = [requirement.entry, retiredRequirement.entry]
  if (includeFeature) entries.push(feature.entry)
  if (corruptRecordHash) entries[0].recordSha256 = '0'.repeat(64)
  if (mutateEntry) mutateEntry(entries[0])

  const index = { version: 1, sourceRevision, records: entries }
  const indexPath = path.join(repositoryRoot, 'registry/document-registry/index.json')
  mkdirSync(path.dirname(indexPath), { recursive: true })
  writeFileSync(indexPath, JSON.stringify(index), 'utf8')

  const writeRecord = ({ entry, text }) => {
    const filePath = path.join(repositoryRoot, entry.path)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, text, 'utf8')
  }
  if (!omitRequirementRecord) writeRecord(requirement)
  if (!corruptRequirementRecord) writeRecord(retiredRequirement)
  else {
    const corruptPath = path.join(repositoryRoot, retiredRequirement.entry.path)
    mkdirSync(path.dirname(corruptPath), { recursive: true })
    writeFileSync(corruptPath, 'not a canonical record', 'utf8')
  }
  if (includeFeature) writeRecord(feature)

  if (compatibilityExports) {
    const prdPath = path.join(repositoryRoot, 'docs/PRD-SDD-v1.0.md')
    const featurePath = path.join(repositoryRoot, 'docs/FEATURES.md')
    mkdirSync(path.dirname(prdPath), { recursive: true })
    writeFileSync(prdPath, [
      '| FR-101 | Contradictory PRD label | planned |',
      '| FR-102 | Contradictory active label | ✅ |',
    ].join('\n'), 'utf8')
    writeFileSync(featurePath, '| FEAT-101 | Contradictory feature label | FR-102 | retired |', 'utf8')
  }
  return { repositoryRoot, index, entries, close: () => rmSync(repositoryRoot, { recursive: true, force: true }) }
}

function git(root, args) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

function digestAt(root, revision, relativePath) {
  if (git(root, ['ls-tree', '--name-only', revision, '--', relativePath]) !== relativePath) return null
  return sha256(execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${relativePath}`], {
    cwd: root, windowsHide: true, encoding: null, stdio: ['ignore', 'pipe', 'pipe'],
  }))
}

function put(root, relativePath, text) {
  const destination = path.join(root, relativePath)
  mkdirSync(path.dirname(destination), { recursive: true })
  writeFileSync(destination, text, 'utf8')
}

function writeReceipt(root, state, { amendment = false } = {}) {
  const { manifestPath, approvalCopyPath, manifest } = state
  const outputs = [recordPath, approvalCopyPath, indexPath, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']
  if (!amendment) outputs.push(ledgerPath)
  const before = Object.fromEntries(outputs.map(file => [file, digestAt(root, manifest.base.commit, file)]))
  const outputDigests = Object.fromEntries(outputs.map(file => [file, sha256(readFileSync(path.join(root, file)))]))
  const receiptPath = manifestPath.replace(/\.manifest\.json$/, '.receipt.json')
  const receipt = {
    version: 1,
    migrationId: manifest.migrationId,
    status: 'APPLIED',
    manifestSha256: sha256(readFileSync(path.join(root, manifestPath))),
    base: manifest.base,
    ids: manifest.records.map(item => item.id),
    before,
    outputs: outputDigests,
  }
  put(root, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  return { ...state, receiptPath, receipt }
}

function approvalDocument(version, statement) {
  return [
    '---', 'status: approved', `version: "${version}"`, '---', '',
    '## Canonical amendment and provenance', '', '### `ZAI:FR-101`', '', '```text',
    `| FR-101 | ${statement} | planned |`, '```', '', '## Approval', '', 'Approved for the fixture.', '',
  ].join('\n')
}

function writeAuthoredState(root, { migrationId, baseCommit, baseIndexSha256, baseLedgerSha256,
  approvalPath, approvalText, approvalVersion, statement }) {
  const manifestPath = `${migrationDir}/${migrationId}.manifest.json`
  const approvalCopyPath = `${migrationDir}/${migrationId}.approval.md`
  const item = {
    id: 'FR-101',
    family: 'FR',
    statement,
    statementSha256: sha256(statement),
    subjectAnchor: anchor(statement),
  }
  const manifest = {
    version: 1,
    migrationId,
    base: { commit: baseCommit, indexSha256: baseIndexSha256, ledgerSha256: baseLedgerSha256 },
    approval: { path: approvalPath, revision: baseCommit, version: approvalVersion, sha256: sha256(approvalText) },
    records: [item],
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  const manifestSha256 = sha256(manifestText)
  const recordText = authoredRecordMarkdown(item, manifest, manifestPath, manifestSha256)
  put(root, manifestPath, manifestText)
  put(root, approvalCopyPath, approvalText)
  put(root, recordPath, recordText)
  const parsed = parseCanonicalRecord(recordText)
  const record = {
    ...parsed,
    path: recordPath,
    recordSha256: sha256(recordText),
    exportDocument: 'docs/PRD-SDD-v1.0.md',
    exportOrder: 0,
  }
  const index = buildCanonicalIndex([record], root)
  put(root, indexPath, `${JSON.stringify(index, null, 2)}\n`)
  return { manifestPath, approvalCopyPath, manifest, record }
}

function makeAuthoredHistoryFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'canonical-approval-history-'))
  const oldStatement = 'Customer product facts: use only the bounded original behavior.'
  const currentStatement = 'Customer product facts: allow the reviewed bounded natural-language behavior.'
  const oldApprovalPath = 'docs/change-requests/test/FR-101-original.md'
  const currentApprovalPath = 'docs/change-requests/test/FR-101-amended.md'
  const oldApproval = approvalDocument('1.0.0', oldStatement)
  const currentApproval = approvalDocument('1.1.0', currentStatement)
  const emptyIndex = `${JSON.stringify({ version: 1, sourceRevision, records: [] }, null, 2)}\n`
  const ledger = `${JSON.stringify({ version: 1, ids: {}, roster: [], not_ids: [], reserved_ids: [], reservation_history: [], burnt_families: [] }, null, 2)}\n`

  put(root, indexPath, emptyIndex)
  put(root, ledgerPath, ledger)
  put(root, 'registry/document-registry/PRD-SDD-v1.0.template.md', '# Requirements\n')
  put(root, 'registry/document-registry/FEATURES.template.md', '# Features\n')
  put(root, 'docs/PRD-SDD-v1.0.md', '# Requirements\n')
  put(root, 'docs/FEATURES.md', '# Features\n')
  put(root, oldApprovalPath, oldApproval)
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.name', 'Canonical registry fixture'])
  git(root, ['config', 'user.email', 'fixture@example.test'])
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'create original approval base'])
  const originalBase = git(root, ['rev-parse', 'HEAD'])

  const original = writeAuthoredState(root, {
    migrationId: 'fixture-fr-101-v1',
    baseCommit: originalBase,
    baseIndexSha256: sha256(emptyIndex),
    baseLedgerSha256: sha256(ledger),
    approvalPath: oldApprovalPath,
    approvalText: oldApproval,
    approvalVersion: '1.0.0',
    statement: oldStatement,
  })
  const originalApplied = writeReceipt(root, original)
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'apply original authored record'])

  put(root, currentApprovalPath, currentApproval)
  git(root, ['add', currentApprovalPath])
  git(root, ['commit', '--quiet', '-m', 'approve amended authored record'])
  const currentBase = git(root, ['rev-parse', 'HEAD'])
  const priorIndexText = readFileSync(path.join(root, indexPath), 'utf8')
  const current = writeAuthoredState(root, {
    migrationId: 'fixture-fr-101-v2',
    baseCommit: currentBase,
    baseIndexSha256: sha256(priorIndexText),
    baseLedgerSha256: sha256(readFileSync(path.join(root, ledgerPath))),
    approvalPath: currentApprovalPath,
    approvalText: currentApproval,
    approvalVersion: '1.1.0',
    statement: currentStatement,
  })
  const currentApplied = writeReceipt(root, current, { amendment: true })
  const orphanApprovalPath = `${migrationDir}/unregistered.approval.md`
  put(root, orphanApprovalPath, approvalDocument('9.9.9', 'An unregistered document repeating FR-101.'))

  return {
    root,
    current: currentApplied,
    original: originalApplied,
    original,
    currentApproval,
    currentStatement,
    oldApprovalPath,
    currentApprovalPath,
    orphanApprovalPath,
    cleanup() { rmSync(root, { recursive: true, force: true }) },
  }
}

function makeOriginalAuthoredHistoryFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'canonical-original-authored-'))
  const statement = 'Original authored requirement remains unchanged.'
  const approvalPath = 'docs/change-requests/test/FR-101-original-only.md'
  const approvalText = approvalDocument('1.0.0', statement)
  const emptyIndex = `${JSON.stringify({ version: 1, sourceRevision, records: [] }, null, 2)}\n`
  const ledger = `${JSON.stringify({ version: 1, ids: {}, roster: [], not_ids: [], reserved_ids: [], reservation_history: [], burnt_families: [] }, null, 2)}\n`
  put(root, indexPath, emptyIndex)
  put(root, ledgerPath, ledger)
  put(root, 'registry/document-registry/PRD-SDD-v1.0.template.md', '# Requirements\n')
  put(root, 'registry/document-registry/FEATURES.template.md', '# Features\n')
  put(root, 'docs/PRD-SDD-v1.0.md', '# Requirements\n')
  put(root, 'docs/FEATURES.md', '# Features\n')
  put(root, approvalPath, approvalText)
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.name', 'Canonical registry fixture'])
  git(root, ['config', 'user.email', 'fixture@example.test'])
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'create original-only base'])
  const base = git(root, ['rev-parse', 'HEAD'])
  const state = writeAuthoredState(root, {
    migrationId: 'fixture-fr-101-original',
    baseCommit: base,
    baseIndexSha256: sha256(emptyIndex),
    baseLedgerSha256: sha256(ledger),
    approvalPath,
    approvalText,
    approvalVersion: '1.0.0',
    statement,
  })
  const applied = writeReceipt(root, state)
  git(root, ['add', '.'])
  git(root, ['commit', '--quiet', '-m', 'apply original-only authored record'])
  // Re-root the same files to model a repository rewrite that leaves the
  // recorded original base outside current HEAD history.
  git(root, ['checkout', '--quiet', '--orphan', 'rewritten-history'])
  git(root, ['add', '-A'])
  git(root, ['commit', '--quiet', '-m', 'rewrite authored record history'])
  return { root, applied, cleanup() { rmSync(root, { recursive: true, force: true }) } }
}

test('canonical records supply requirement labels, lifecycle, feature labels, and membership', () => {
  const fixture = makeFixture()
  try {
    const loaded = loadCanonicalDocumentRegistry(fixture.repositoryRoot)
    const graph = buildCanonicalGraphEntries(loaded.records)
    const requirement = graph.nodes.find(node => node.id === 'req:FR-101')
    const retiredRequirement = graph.nodes.find(node => node.id === 'req:FR-102')
    const feature = graph.nodes.find(node => node.id === 'feat:FEAT-101')

    assert.equal(requirement.label, 'Canonical requirement statement')
    assert.equal(requirement.declared, 'done')
    assert.equal(requirement.status, 'current')
    assert.equal(retiredRequirement.label, '~~Canonical retired statement~~')
    assert.equal(retiredRequirement.status, 'superseded')
    assert.equal(feature.label, 'Canonical feature statement')
    assert.equal(feature.declared, 'building')
    assert.deepEqual(graph.edges, [{
      from: 'feat:FEAT-101',
      to: 'req:FR-101',
      type: 'bundles',
      status: 'current',
      source: 'canonical-registry',
    }])
    assert.equal(JSON.stringify(graph).includes('Contradictory'), false)
  } finally {
    fixture.close()
  }
})

test('canonical feature lifecycle follows the pinned statement and retirement marker', () => {
  const fixture = makeFixture({ retireFeature: true })
  try {
    const loaded = loadCanonicalDocumentRegistry(fixture.repositoryRoot)
    const graph = buildCanonicalGraphEntries(loaded.records)
    const feature = graph.nodes.find(node => node.id === 'feat:FEAT-101')

    assert.equal(feature.label, '~~Canonical retired feature~~')
    assert.equal(feature.status, 'superseded')
    assert.equal(feature.retirement_marker, 'superseded by ADR-110 D5')
  } finally {
    fixture.close()
  }
})

test('canonical registry loader fails closed for missing, corrupt, mismatched, and unsafe records', () => {
  const missing = makeFixture({ omitRequirementRecord: true })
  const corrupt = makeFixture({ corruptRequirementRecord: true })
  const mismatched = makeFixture({ mutateEntry: entry => { entry.statementCell = 1 } })
  const unsafe = makeFixture({ mutateEntry: entry => { entry.path = '../outside.md' } })
  const badHash = makeFixture({ corruptRecordHash: true })
  const badMembershipBackref = makeFixture({ mismatchedRequirementFeatureId: true })
  const badMembershipForwardRef = makeFixture({ omitFeatureRequirement: true })
  try {
    assert.throws(() => loadCanonicalDocumentRegistry(missing.repositoryRoot), /missing|ENOENT|canonical record/i)
    assert.throws(() => loadCanonicalDocumentRegistry(corrupt.repositoryRoot), /canonical|frontmatter|record/i)
    assert.throws(() => loadCanonicalDocumentRegistry(mismatched.repositoryRoot), /mismatch|statementCell|canonical/i)
    assert.throws(() => loadCanonicalDocumentRegistry(unsafe.repositoryRoot), /unsafe|path|registry/i)
    assert.throws(() => loadCanonicalDocumentRegistry(badHash.repositoryRoot), /record hash/i)
    assert.throws(() => loadCanonicalDocumentRegistry(badMembershipBackref.repositoryRoot), /membership differs/i)
    assert.throws(() => loadCanonicalDocumentRegistry(badMembershipForwardRef.repositoryRoot), /membership differs|at least one FR/i)
  } finally {
    missing.close()
    corrupt.close()
    mismatched.close()
    unsafe.close()
    badHash.close()
    badMembershipBackref.close()
    badMembershipForwardRef.close()
  }
})

test('canonical identity declarations replace compatibility-export requirements and features', () => {
  const fixture = makeFixture()
  try {
    const loaded = loadCanonicalDocumentRegistry(fixture.repositoryRoot)
    const legacy = new Map([
      ['FR-999', { id: 'FR-999', family: 'FR', statement: 'Stale export statement' }],
      ['FEAT-999', { id: 'FEAT-999', family: 'FEAT', statement: 'Stale feature' }],
      ['RSK-001', { id: 'RSK-001', family: 'RSK', statement: 'Risk source remains' }],
    ])
    legacy.duplicates = [{ id: 'FR-999' }, { id: 'RSK-002' }]
    legacy.missing = [{ families: ['FR', 'NFR', 'BR', 'SEC', 'SDD'] }, { families: ['FEAT'] }, { families: ['ADR'] }]
    const declarations = canonicalizeDeclaredIdentities(legacy, loaded.records)

    assert.equal(declarations.get('FR-101').statement, 'Canonical requirement statement')
    assert.equal(declarations.get('FR-101').source, 'docs/requirements/FR-101.md')
    assert.equal(declarations.get('FR-101').status, 'current')
    assert.equal(declarations.has('FR-999'), false)
    assert.equal(declarations.has('FEAT-999'), false)
    assert.equal(declarations.has('RSK-001'), true)
    assert.deepEqual(declarations.duplicates.map(item => item.id), ['RSK-002'])
    assert.deepEqual(declarations.missing, [{ families: ['ADR'] }])
  } finally {
    fixture.close()
  }
})

test('reviewed migration approval accepts unrelated YAML list frontmatter', () => {
  const record = {
    status: 'reviewed-migration',
    migrationBaseRevision: sourceRevision,
    migrationDocument: 'docs/change-requests/example/APPROVED.md',
  }
  const text = [
    '---',
    'status: approved',
    'relations:',
    '  - type: references',
    '    target: docs/requirements/FR-286.md',
    '---',
    '',
    '# Reviewed migration',
    '',
    '## Approval',
    'Approved against the recorded source evidence.',
    '',
  ].join('\n')

  const provenance = validateReviewedProvenance(record, path => {
    assert.equal(path, record.migrationDocument)
    return Buffer.from(text, 'utf8')
  })

  assert.equal(provenance.migrationDocument, record.migrationDocument)
  assert.equal(provenance.migrationDocumentSha256, sha256(text))
  assert.throws(() => validateReviewedProvenance(record, () => Buffer.from(
    text.replace('status: approved', 'status: pending\nstatus: approved'), 'utf8'),
  ), /approval mismatch/)
  assert.throws(() => validateReviewedProvenance(record, () => Buffer.from(
    text.replace('## Approval', '## Review'), 'utf8'),
  ), /approval mismatch/)
})


test('approved historical snapshot copies are classified from the indexed authored-record base chain', () => {
  const fixture = makeAuthoredHistoryFixture()
  try {
    const registry = loadCanonicalDocumentRegistry(fixture.root)
    const contexts = canonicalApprovalSnapshotContexts(registry, fixture.root)
    const snapshots = canonicalApprovalSnapshotPaths(registry, fixture.root)
    assert.deepEqual([...snapshots].sort(), [
      fixture.current.approvalCopyPath,
      fixture.original.approvalCopyPath,
    ].sort())
    assert.deepEqual([...contexts].sort(([left], [right]) => left.localeCompare(right)), [
      [fixture.current.approvalCopyPath, fixture.currentApprovalPath],
      [fixture.original.approvalCopyPath, fixture.oldApprovalPath],
    ].sort(([left], [right]) => left.localeCompare(right)))
    assert.equal(snapshots.has(fixture.orphanApprovalPath), false)
    assert.equal(contexts.has(fixture.orphanApprovalPath), false)
  } finally {
    fixture.cleanup()
  }
})

test('an original authored record stops at its current snapshot when its base was rewritten out of HEAD', () => {
  const fixture = makeOriginalAuthoredHistoryFixture()
  try {
    const registry = loadCanonicalDocumentRegistry(fixture.root)
    const snapshots = canonicalApprovalSnapshotPaths(registry, fixture.root)
    assert.deepEqual([...snapshots], [fixture.applied.approvalCopyPath])
  } finally {
    fixture.cleanup()
  }
})

test('amendment receipt output hashes must bind the current indexed amendment outputs', () => {
  const fixture = makeAuthoredHistoryFixture()
  try {
    const receiptPath = path.join(fixture.root, fixture.current.receiptPath)
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    receipt.outputs[indexPath] = 'f'.repeat(64)
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    const registry = loadCanonicalDocumentRegistry(fixture.root)
    assert.throws(() => canonicalApprovalSnapshotContexts(registry, fixture.root), /receipt output drift/)
  } finally {
    fixture.cleanup()
  }
})

for (const evidence of ['approval copy', 'manifest']) {
  test(`historical ${evidence} drift fails closed instead of hiding the changed file`, () => {
    const fixture = makeAuthoredHistoryFixture()
    try {
      const file = evidence === 'approval copy' ? fixture.original.approvalCopyPath : fixture.original.manifestPath
      const target = path.join(fixture.root, file)
      writeFileSync(target, `${readFileSync(target, 'utf8')}\n<!-- local drift -->\n`, 'utf8')
      const registry = loadCanonicalDocumentRegistry(fixture.root)
      assert.throws(() => canonicalApprovalSnapshotContexts(registry, fixture.root),
        evidence === 'approval copy' ? /historical approval snapshot changed/ : /historical approval manifest changed/)
    } finally {
      fixture.cleanup()
    }
  })
}

for (const evidence of ['index', 'ledger']) {
  test(`authored historical snapshots require the manifest-pinned base ${evidence} digest`, () => {
    const fixture = makeAuthoredHistoryFixture()
    try {
      const base = fixture.current.manifest.base
      const current = writeAuthoredState(fixture.root, {
        migrationId: fixture.current.manifest.migrationId,
        baseCommit: base.commit,
        baseIndexSha256: evidence === 'index' ? 'f'.repeat(64) : base.indexSha256,
        baseLedgerSha256: evidence === 'ledger' ? 'e'.repeat(64) : base.ledgerSha256,
        approvalPath: fixture.currentApprovalPath,
        approvalText: fixture.currentApproval,
        approvalVersion: fixture.current.manifest.approval.version,
        statement: fixture.currentStatement,
      })
      fixture.current = writeReceipt(fixture.root, current, { amendment: true })
      const registry = loadCanonicalDocumentRegistry(fixture.root)
      assert.throws(() => canonicalApprovalSnapshotContexts(registry, fixture.root),
        /authored amendment base index\/ledger digest mismatch/)
    } finally {
      fixture.cleanup()
    }
  })
}
