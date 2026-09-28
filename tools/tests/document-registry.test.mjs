import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCanonicalIndex, parseCanonicalRecord, splitRow } from '../../apps/server/scripts/document-registry-format.mjs';
import { readCanonicalRegistry, writeCanonicalProjections } from '../document-registry.mjs';

const SOURCE_REVISION = 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e';

function canonicalRecord({
  id = 'FR-091',
  family = 'FR',
  row = '| FR-091 | statement with \\| a pipe | ✅ |\r\n',
  statementCell = 2,
  requirementCells = [],
  featureId = family === 'FR' ? 'FEAT-009' : undefined,
  namespace = 'ZAI',
  sourceRowEol = 'CRLF',
  sourcePath = family === 'FEAT' ? 'docs/FEATURES.md' : 'docs/PRD-SDD-v1.0.md',
} = {}) {
  const sourceRowSha256 = createHash('sha256').update(Buffer.from(row, 'utf8')).digest('hex');
  const storedRow = row.replace(/\r?\n$/, '');
  return `---\nid: ${id}\nnamespace: ${namespace}\nfamily: ${family}\nversion: 1\nstatus: source-preserved\nsource_revision: ${SOURCE_REVISION}\nsource_path: ${sourcePath}\nsource_row_eol: ${sourceRowEol}\nsource_row_sha256: ${sourceRowSha256}\nstatement_cell: ${statementCell}\nrequirement_cells: ${JSON.stringify(requirementCells)}\n${featureId ? `feature_id: ${featureId}\n` : ''}subject_anchor: stable subject\n---\n# ZAI:${id}\n\n<!-- canonical-row:start -->\n\`\`\`text\n${storedRow}\n\`\`\`\n<!-- canonical-row:end -->\n`;
}

test('splitRow retains outer empty cells and matches legacy escaped-pipe behavior', () => {
  assert.deepEqual(splitRow('| FR-001 | A \\| B | ready |\r\n'), [
    '', 'FR-001', 'A | B', 'ready', '',
  ]);
});

test('parseCanonicalRecord preserves the source row bytes and uses explicit cell indexes', () => {
  const row = '| FEAT-009 | feature description | FR-091, FR-092 | live |\r\n';
  const record = parseCanonicalRecord(canonicalRecord({
    id: 'FEAT-009',
    family: 'FEAT',
    row,
    statementCell: 2,
    requirementCells: [3],
    featureId: undefined,
  }));
  assert.equal(record.row, row);
  assert.equal(record.cells[1], 'FEAT-009');
  assert.equal(record.statement, 'feature description');
  assert.deepEqual(record.requirementKeys, ['FR-091', 'FR-092']);
  assert.equal(record.sourceRowSha256, createHash('sha256').update(Buffer.from(row)).digest('hex'));
  assert.equal(record.sourceRevision, SOURCE_REVISION);
});

test('parseCanonicalRecord rejects changed row bytes and non-ZAI namespace', () => {
  const source = canonicalRecord();
  assert.throws(() => parseCanonicalRecord(source.replace('statement with', 'changed statement with')), /hash does not match/);
  assert.throws(() => parseCanonicalRecord(canonicalRecord({ namespace: 'ZNEXT' })), /namespace must be ZAI/);
  const duplicateMembership = canonicalRecord({
    id: 'FEAT-009', family: 'FEAT', row: '| FEAT-009 | feature | FR-091, FR-091 | live |\n',
    sourceRowEol: 'LF', requirementCells: [3], featureId: undefined,
  });
  assert.throws(() => parseCanonicalRecord(duplicateMembership), /duplicate FR membership/);
});

test('readCanonicalRegistry verifies all pinned canonical records and explicit feature links', () => {
  const records = readCanonicalRegistry();
  assert.equal(records.length, 539);
  assert.deepEqual(records.reduce((counts, record) => {
    counts[record.family] = (counts[record.family] ?? 0) + 1;
    return counts;
  }, {}), { FEAT: 46, FR: 277, NFR: 25, BR: 44, SEC: 37, SDD: 110 });
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const feature of records.filter((record) => record.family === 'FEAT')) {
    for (const id of feature.requirementKeys) assert.equal(byId.get(id)?.family, 'FR', `${feature.id} -> ${id}`);
  }
  assert.ok(records.every((record) => record.namespace === 'ZAI' && record.recordVersion === 1 && record.status === 'source-preserved'));
});

test('parseCanonicalIndex preserves additive fields and validates unique keys and paths', () => {
  const base = {
    id: 'FR-091', namespace: 'ZAI', family: 'FR', path: 'docs/features/FEAT-009/requirements/FR-091.md',
    sourceRowSha256: 'a'.repeat(64), recordSha256: 'b'.repeat(64), recordVersion: 1, status: 'source-preserved', futureField: true,
  };
  const parsed = parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [base] }));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.sourceRevision, SOURCE_REVISION);
  assert.equal(parsed.records[0].futureField, true);
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [base, { ...base, path: 'docs/requirements/FR-092.md' }] })), /duplicate id/);
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [base, { ...base, id: 'FR-092' }] })), /duplicate path/);
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [{ ...base, path: 'docs/requirements/../secret.md' }] })), /unsafe path/);
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 2, sourceRevision: SOURCE_REVISION, records: [] })), /unsupported index version/);
});

test('writer refreshes authored wrapper hashes while preserving source rows and export bytes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-registry-writer-'));
  const relative = 'docs/requirements/FR-091.md';
  const original = canonicalRecord();
  const row = parseCanonicalRecord(original).row;
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const put = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  const entry = { id: 'FR-091', namespace: 'ZAI', family: 'FR', path: relative, recordVersion: 1,
    status: 'source-preserved', sourcePath: 'docs/PRD-SDD-v1.0.md', sourceRowSha256: digest(row),
    recordSha256: digest(original), statementCell: 2, requirementCells: [], featureId: 'FEAT-009',
    exportDocument: 'docs/PRD-SDD-v1.0.md', exportOrder: 0 };
  try {
    put(relative, original);
    put('registry/document-registry/index.json', JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [entry] }));
    put('registry/document-registry/PRD-SDD-v1.0.template.md', '{{CANONICAL_ROW:FR-091}}');
    put('registry/document-registry/FEATURES.template.md', '# Features\n');
    put('docs/PRD-SDD-v1.0.md', row);
    put('docs/FEATURES.md', '# Features\n');
    const authored = `${original}\nSource explanation with a reviewed link.\n`;
    put(relative, authored);
    assert.throws(() => writeCanonicalProjections(root, { check: true }), /hash does not match/);
    writeCanonicalProjections(root, { check: false });
    writeCanonicalProjections(root, { check: true });
    assert.equal(readFileSync(path.join(root, relative), 'utf8'), authored);
    assert.equal(readFileSync(path.join(root, 'docs/PRD-SDD-v1.0.md'), 'utf8'), row);
    assert.equal(readCanonicalRegistry(root)[0].recordSha256, digest(authored));
    put(relative, authored.replace('statement with', 'different subject with'));
    assert.throws(() => writeCanonicalProjections(root, { check: false }), /source row hash/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('zuri-registry-writer-'));
    rmSync(root, { recursive: true, force: true });
  }
});
