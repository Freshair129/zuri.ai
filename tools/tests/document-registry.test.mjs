import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { splitRow as splitLegacyRow } from '../../apps/server/scripts/id-anchors.mjs';
import { parseCanonicalIndex, parseCanonicalRecord, splitRow } from '../../apps/server/scripts/document-registry-format.mjs';
import { readCanonicalRegistry, registerReviewedRecord, writeCanonicalProjections } from '../document-registry.mjs';

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
  sourceRevision = SOURCE_REVISION,
} = {}) {
  const sourceRowSha256 = createHash('sha256').update(Buffer.from(row, 'utf8')).digest('hex');
  const storedRow = row.replace(/\r?\n$/, '');
  return `---\nid: ${id}\nnamespace: ${namespace}\nfamily: ${family}\nversion: 1\nstatus: source-preserved\nsource_revision: ${sourceRevision}\nsource_path: ${sourcePath}\nsource_row_eol: ${sourceRowEol}\nsource_row_sha256: ${sourceRowSha256}\nstatement_cell: ${statementCell}\nrequirement_cells: ${JSON.stringify(requirementCells)}\n${featureId ? `feature_id: ${featureId}\n` : ''}subject_anchor: stable subject\n---\n# ZAI:${id}\n\n<!-- canonical-row:start -->\n\`\`\`text\n${storedRow}\n\`\`\`\n<!-- canonical-row:end -->\n`;
}

function reviewedCanonicalRecord({
  id = 'FR-092',
  row = '| FR-092 | A separately reviewed capability | approved |\n',
  migrationBaseRevision = SOURCE_REVISION,
  migrationDocument = 'docs/change-requests/test/addendum.md',
} = {}) {
  const sourceRowSha256 = createHash('sha256').update(Buffer.from(row, 'utf8')).digest('hex');
  const storedRow = row.replace(/\r?\n$/, '');
  return `---\nid: ${id}\nnamespace: ZAI\nfamily: FR\nversion: 1\nstatus: reviewed-migration\nmigration_base_revision: ${migrationBaseRevision}\nmigration_document: ${migrationDocument}\nsource_path: docs/PRD-SDD-v1.0.md\nsource_row_eol: LF\nsource_row_sha256: ${sourceRowSha256}\nstatement_cell: 2\nrequirement_cells: []\n---\n# ZAI:${id}\n\n<!-- canonical-row:start -->\n\`\`\`text\n${storedRow}\n\`\`\`\n<!-- canonical-row:end -->\n`;
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

test('parseCanonicalRecord keeps reviewed additions distinct from source-preserved rows', () => {
  const record = parseCanonicalRecord(reviewedCanonicalRecord());
  assert.equal(record.id, 'FR-092');
  assert.equal(record.status, 'reviewed-migration');
  assert.equal(record.sourceRevision, undefined);
  assert.equal(record.migrationBaseRevision, SOURCE_REVISION);
  assert.equal(record.migrationDocument, 'docs/change-requests/test/addendum.md');
  assert.throws(() => parseCanonicalRecord(reviewedCanonicalRecord().replace('source_path:', `source_revision: ${SOURCE_REVISION}\nsource_path:`)), /must not claim source_revision/);
  assert.throws(() => parseCanonicalRecord(reviewedCanonicalRecord({ migrationDocument: '../private.md' })), /safe path under docs\/change-requests/);
});

test('readCanonicalRegistry verifies all pinned canonical records and explicit feature links', () => {
  const records = readCanonicalRegistry().filter(record => record.recordVersion === 1);
  assert.equal(records.length, 540);
  assert.deepEqual(records.reduce((counts, record) => {
    counts[record.family] = (counts[record.family] ?? 0) + 1;
    return counts;
  }, {}), { FEAT: 46, FR: 278, NFR: 25, BR: 44, SEC: 37, SDD: 110 });
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const feature of records.filter((record) => record.family === 'FEAT')) {
    for (const id of feature.requirementKeys) assert.equal(byId.get(id)?.family, 'FR', `${feature.id} -> ${id}`);
  }
  assert.equal(records.filter((record) => record.status === 'reviewed-migration').map((record) => record.id).join(','), 'FR-278');
  assert.ok(records.filter((record) => record.id !== 'FR-278').every((record) => record.namespace === 'ZAI' && record.recordVersion === 1 && record.status === 'source-preserved'));
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
  assert.equal(parseCanonicalIndex(JSON.stringify({ version: 2, sourceRevision: SOURCE_REVISION, records: [] })).version, 2);
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 3, sourceRevision: SOURCE_REVISION, records: [] })), /unsupported index version/);
  assert.equal(parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [{
    ...base, id: 'FR-092', path: 'docs/requirements/FR-092.md', status: 'reviewed-migration',
    migrationBaseRevision: SOURCE_REVISION, migrationDocument: 'docs/change-requests/test/addendum.md',
  }] })).records[0].status, 'reviewed-migration');
  assert.throws(() => parseCanonicalIndex(JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [{
    ...base, id: 'FR-092', path: 'docs/requirements/FR-092.md', status: 'reviewed-migration',
  }] })), /migrationBaseRevision/);
});

test('reviewed registration validates provenance and generates slot, index, order, and export', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-reviewed-registration-'));
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const initial = canonicalRecord({ id: 'FR-001', row: '| FR-001 | Stable capability | existing |\n', sourceRowEol: 'LF', featureId: null });
  const parsedInitial = parseCanonicalRecord(initial);
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const initialEntry = {
    id: 'FR-001', namespace: 'ZAI', family: 'FR', recordVersion: 1,
    status: 'source-preserved', path: 'docs/requirements/FR-001.md', sourcePath: 'docs/PRD-SDD-v1.0.md',
    sourceRowSha256: parsedInitial.sourceRowSha256, recordSha256: digest(initial), statementCell: 2,
    requirementCells: [], exportDocument: 'docs/PRD-SDD-v1.0.md', exportOrder: 0,
  };
  const template = '# Requirements\n{{CANONICAL_ROW:FR-001}}\n## 1.4 Non-functional requirements\n';
  try {
    put('docs/requirements/FR-001.md', initial);
    put('registry/document-registry/index.json', `${JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [initialEntry] }, null, 2)}\n`);
    put('registry/document-registry/PRD-SDD-v1.0.template.md', template);
    put('registry/document-registry/FEATURES.template.md', '# Features\n');
    put('docs/PRD-SDD-v1.0.md', template.replace('{{CANONICAL_ROW:FR-001}}', parsedInitial.row));
    put('docs/FEATURES.md', '# Features\n');
    put('docs/.id-ledger.json', JSON.stringify({
      ids: { 'FR-001': { family: 'FR', history: [{ anchor: 'stable capability' }] } }, roster: ['FR-001'],
    }));
    put('docs/change-requests/test/addendum.md', '---\nstatus: approved\n---\n\n## Approval\nOwner approved this migration.\n');
    execFileSync('git', ['init'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Registry test'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'registry test base'], { cwd: root, windowsHide: true, stdio: 'ignore' });
    const baseRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    const candidate = reviewedCanonicalRecord({ migrationBaseRevision: baseRevision });
    put('docs/requirements/FR-092.md', candidate);

    assert.equal(registerReviewedRecord(root, 'docs/requirements/FR-092.md'), 'FR-092');
    const index = JSON.parse(readFileSync(path.join(root, 'registry/document-registry/index.json'), 'utf8'));
    const registered = index.records.find((record) => record.id === 'FR-092');
    assert.equal(registered.status, 'reviewed-migration');
    assert.equal(registered.migrationBaseRevision, baseRevision);
    assert.equal(registered.exportOrder, 1);
    assert.equal(index.records.find((record) => record.id === 'FR-001').sourceRowSha256, parsedInitial.sourceRowSha256);
    assert.deepEqual(readCanonicalRegistry(root).map((record) => record.id), ['FR-001', 'FR-092']);
    assert.match(readFileSync(path.join(root, 'docs/PRD-SDD-v1.0.md'), 'utf8'), /\| FR-001 \| Stable capability \| existing \|\n\| FR-092 \| A separately reviewed capability \| approved \|/);
    writeCanonicalProjections(root, { check: true });

    put('docs/requirements/FR-003.md', reviewedCanonicalRecord({
      id: 'FR-003', row: '| FR-003 | Stable capability: another slice | approved |\n', migrationBaseRevision: baseRevision,
    }));
    assert.throws(() => registerReviewedRecord(root, 'docs/requirements/FR-003.md'), /inherits the pinned subject of FR-001/);
    put('docs/change-requests/test/addendum.md', '---\nstatus: draft\n---\n\n## Approval\nNot approved.\n');
    assert.throws(() => writeCanonicalProjections(root, { check: true }), /must have status: approved/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('zuri-reviewed-registration-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('writer refreshes authored wrapper hashes while preserving source rows and export bytes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-registry-writer-'));
  const relative = 'docs/requirements/FR-091.md';
  const original = canonicalRecord({ featureId: null });
  const row = parseCanonicalRecord(original).row;
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const put = (file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
  const entry = { id: 'FR-091', namespace: 'ZAI', family: 'FR', path: relative, recordVersion: 1,
    status: 'source-preserved', sourcePath: 'docs/PRD-SDD-v1.0.md', sourceRowSha256: digest(row),
    recordSha256: digest(original), statementCell: 2, requirementCells: [],
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

test('writer rollback rehearsal preserves legacy rows before and after a canonical write', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-registry-rollback-'));
  const relative = 'docs/requirements/FR-091.md';
  const legacyPath = 'docs/PRD-SDD-v1.0.md';
  const indexPath = 'registry/document-registry/index.json';
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  const initialRow = '| FR-091 | stable behavior | ✅ |\r\n';
  const initialRecord = canonicalRecord({ featureId: null, row: initialRow });
  const initialParsed = parseCanonicalRecord(initialRecord);
  const entry = {
    id: 'FR-091', namespace: 'ZAI', family: 'FR', path: relative,
    recordVersion: 1, status: 'source-preserved', sourcePath: legacyPath,
    sourceRowSha256: initialParsed.sourceRowSha256, recordSha256: digest(initialRecord),
    statementCell: 2, requirementCells: [], exportDocument: legacyPath, exportOrder: 0,
  };
  const template = '# PRD\n\n| ID | Statement | Status |\n|---|---|---|\n{{CANONICAL_ROW:FR-091}}\n';

  try {
    put(relative, initialRecord);
    put(indexPath, `${JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: [entry] }, null, 2)}\n`);
    put('registry/document-registry/PRD-SDD-v1.0.template.md', template);
    put('registry/document-registry/FEATURES.template.md', '# Features\n');
    put(legacyPath, template.replace('{{CANONICAL_ROW:FR-091}}', initialRow));
    put('docs/FEATURES.md', '# Features\n');

    const preWriteExport = readFileSync(path.join(root, legacyPath), 'utf8');
    writeCanonicalProjections(root);
    assert.equal(readFileSync(path.join(root, legacyPath), 'utf8'), preWriteExport);
    writeCanonicalProjections(root, { check: true });

    const postRow = '| FR-091 | stable behavior with an approved clarification | ✅ |\r\n';
    const postRecord = canonicalRecord({ featureId: null, row: postRow });
    const postParsed = parseCanonicalRecord(postRecord);
    put(relative, postRecord);
    put(indexPath, `${JSON.stringify({
      version: 1,
      sourceRevision: SOURCE_REVISION,
      records: [{ ...entry, sourceRowSha256: postParsed.sourceRowSha256, recordSha256: digest(postRecord) }],
    }, null, 2)}\n`);

    writeCanonicalProjections(root);
    const postWriteExport = readFileSync(path.join(root, legacyPath), 'utf8');
    assert.equal(readCanonicalRegistry(root)[0].row, postRow);
    rmSync(path.join(root, relative));
    rmSync(path.join(root, indexPath));
    const rollbackTable = readFileSync(path.join(root, legacyPath), 'utf8');
    assert.equal(rollbackTable, postWriteExport);
    assert.equal(rollbackTable.includes(postRow.trimEnd()), true);
    const legacyRow = rollbackTable.split(/\r?\n/).find((line) => line.startsWith('| FR-091 |'));
    assert.equal(`${legacyRow}\r\n`, postRow);
    assert.deepEqual(splitLegacyRow(legacyRow).slice(1, 3), [
      'FR-091', 'stable behavior with an approved clarification',
    ]);
    assert.deepEqual(splitRow(legacyRow), splitLegacyRow(legacyRow));
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('zuri-registry-rollback-'));
    rmSync(root, { recursive: true, force: true });
  }
});

test('registry rejects reverse membership drift even with matching wrapper and index hashes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-membership-'));
  const records = readCanonicalRegistry().filter(record => ['FEAT-009', 'FR-091', 'FR-093'].includes(record.id));
  const entries = JSON.parse(readFileSync(new URL('../../registry/document-registry/index.json', import.meta.url), 'utf8')).records.filter(entry => records.some(record => record.id === entry.id));
  const putIndex = () => writeFileSync(path.join(root, 'registry/document-registry/index.json'), JSON.stringify({ version: 1, sourceRevision: SOURCE_REVISION, records: entries }));
  try {
    mkdirSync(path.join(root, 'registry/document-registry'), { recursive: true });
    for (const entry of entries) {
      mkdirSync(path.dirname(path.join(root, entry.path)), { recursive: true });
      writeFileSync(path.join(root, entry.path), readFileSync(new URL(`../../${entry.path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
    }
    putIndex();
    assert.equal(readCanonicalRegistry(root).length, 3);
    const entry = entries.find(item => item.id === 'FR-091');
    const changed = readFileSync(path.join(root, entry.path), 'utf8').replace('feature_id: FEAT-009', 'feature_id: FEAT-999');
    writeFileSync(path.join(root, entry.path), changed);
    entry.featureId = 'FEAT-999';
    entry.recordSha256 = createHash('sha256').update(changed).digest('hex');
    putIndex();
    assert.throws(() => readCanonicalRegistry(root), /membership/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('zuri-membership-'));
    rmSync(root, { recursive: true, force: true });
  }
});
