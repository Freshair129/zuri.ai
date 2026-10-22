import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildCanonicalGraphEntries,
  canonicalizeDeclaredIdentities,
  loadCanonicalDocumentRegistry,
} from '../../scripts/canonical-document-registry.mjs'
import { parseCanonicalRecord, validateReviewedProvenance } from '../../scripts/document-registry-format.mjs'

const sourceRevision = 'a'.repeat(40)
const sha256 = value => createHash('sha256').update(value).digest('hex')

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
