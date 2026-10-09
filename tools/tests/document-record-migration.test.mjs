import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { anchor } from '../../apps/server/scripts/id-anchors.mjs';
import { evaluateIdStability } from '../../apps/server/scripts/id-stability.mjs';
import { parseCanonicalRecord, validateAuthoredProvenance } from '../../apps/server/scripts/document-registry-format.mjs';
import { applyRecordMigration, planRecordMigration } from '../document-record-migration.mjs';
import { readCanonicalRegistry, registerReviewedRecord, writeCanonicalProjections } from '../document-registry.mjs';
import { loadDocumentQueryContext, resolveQueryTarget } from '../document-query.mjs';
import { renderDocumentViews } from '../generate-document-views.mjs';

const sha256 = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const sourceRoot = new URL('../../', import.meta.url);
const original = readCanonicalRegistry().find(record => record.family === 'FR' && !record.featureId);
const originalIndex = JSON.parse(readFileSync(new URL('registry/document-registry/index.json', sourceRoot))).records.find(entry => entry.id === original.id);
const manifestPath = 'docs/migrations/document-reintegration/record-migrations/receiver-fixture.manifest.json';
const approvedPath = 'docs/change-requests/marketing/receiver.md';
const put = (root, file, text) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
const git = (root, args) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const protectedPaths = ['registry/document-registry/index.json', 'docs/.id-ledger.json', 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md', original.path];
const hashes = root => Object.fromEntries(protectedPaths.map(file => [file, sha256(readFileSync(path.join(root, file), 'utf8'))]));

const reviewedRecord = (id, revision) => {
  const row = `| ${id} | Later reviewed capability. | approved |\n`;
  return `---\nid: ${id}\nnamespace: ZAI\nfamily: FR\nversion: 1\nstatus: reviewed-migration\nmigration_base_revision: ${revision}\nmigration_document: docs/change-requests/test/reviewed.md\nsource_path: docs/PRD-SDD-v1.0.md\nsource_row_eol: LF\nsource_row_sha256: ${sha256(row)}\nstatement_cell: 2\nrequirement_cells: []\n---\n\n<!-- canonical-row:start -->\n\`\`\`text\n${row}\`\`\`\n<!-- canonical-row:end -->\n`;
};

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-record-migration-'));
  put(root, 'monorepo.json', '{}');
  for (const file of ['id-ledger.mjs', 'id-anchors.mjs', 'id-stability.mjs', 'workspace-path.mjs', 'canonical-text.mjs']) {
    put(root, `apps/server/scripts/${file}`, readFileSync(new URL(`apps/server/scripts/${file}`, sourceRoot)));
  }
  put(root, original.path, readFileSync(new URL(original.path, sourceRoot)));
  put(root, 'registry/document-registry/index.json', `${JSON.stringify({ version: 1, sourceRevision: original.sourceRevision, records: [originalIndex] }, null, 2)}\n`);
  put(root, 'registry/document-registry/PRD-SDD-v1.0.template.md', `# Requirements\n\n{{CANONICAL_ROW:${original.id}}}`);
  put(root, 'registry/document-registry/FEATURES.template.md', '# Features\n');
  put(root, 'docs/PRD-SDD-v1.0.md', `# Requirements\n\n${original.row}`);
  put(root, 'docs/FEATURES.md', '# Features\n');
  put(root, 'docs/appendices/E-risk-matrix.md', '# Risks\n');
  put(root, 'docs/domains/market-intelligence/SRS.md', '# MI\n');
  for (const dir of ['docs/decisions', 'docs/changes']) mkdirSync(path.join(root, dir), { recursive: true });
  put(root, approvedPath, '---\nstatus: approved\nversion: "1.0.0"\n---\n# Approved receiver fixture\n');
  execFileSync(process.execPath, ['scripts/id-ledger.mjs', '--write'], { cwd: path.join(root, 'apps/server'), windowsHide: true, stdio: 'pipe' });
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Record migration fixture']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'approved base fixture']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const records = [
    ['FR-900', 'Report credential isolation: synthetic report-only permission.'],
    ['FR-901', 'Atomic intake boundary: immutable synthetic evidence and receipt.'],
    ['FR-902', 'Private reader boundary: synthetic source preservation.'],
    ['SDD-900', 'Receiver storage design: synthetic transaction and replay.'],
  ].map(([id, statement]) => ({ id, family: id.split('-')[0], statement, statementSha256: sha256(statement), subjectAnchor: anchor(statement) }));
  const manifest = { version: 1, migrationId: 'receiver-fixture', base: { commit,
    indexSha256: hashes(root)['registry/document-registry/index.json'], ledgerSha256: hashes(root)['docs/.id-ledger.json'] },
    approval: { path: approvedPath, revision: commit, version: '1.0.0', sha256: sha256(readFileSync(path.join(root, approvedPath), 'utf8')) }, records };
  const save = () => put(root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  save();
  return { root, manifest, save, cleanup() {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('zuri-record-migration-'));
    rmSync(root, { recursive: true, force: true });
  } };
}

test('plan is read-only; apply pins four authored records without changing imported rows/subjects', () => {
  const f = fixture();
  try {
    const before = hashes(f.root);
    const ledgerBefore = JSON.parse(readFileSync(path.join(f.root, 'docs/.id-ledger.json')));
    assert.equal(planRecordMigration(f.root, manifestPath).status, 'PLANNED');
    assert.deepEqual(hashes(f.root), before);
    const receipt = applyRecordMigration(f.root, manifestPath);
    assert.equal(receipt.status, 'APPLIED');
    const records = readCanonicalRegistry(f.root);
    assert.equal(records.length, 5);
    assert.equal(records.find(record => record.id === original.id).row, original.row);
    assert.equal(sha256(readFileSync(path.join(f.root, original.path), 'utf8')), before[original.path]);
    const ledgerAfter = JSON.parse(readFileSync(path.join(f.root, 'docs/.id-ledger.json')));
    assert.deepEqual(ledgerAfter.ids[original.id], ledgerBefore.ids[original.id]);
    for (const item of f.manifest.records) assert.equal(ledgerAfter.ids[item.id].history.at(-1).anchor, item.subjectAnchor);
    assert.equal(readFileSync(path.join(f.root, 'docs/FEATURES.md'), 'utf8'), '# Features\n');
    assert.ok(readFileSync(path.join(f.root, 'docs/PRD-SDD-v1.0.md'), 'utf8').startsWith(`# Requirements\n\n${original.row}`));
    writeCanonicalProjections(f.root, { check: true });
    const graph = { version: '2.0.0', nodes: records.map(record => ({ id: `req:${record.id}`, type: 'requirement', namespace: 'ZAI', status: 'current' })), edges: [] };
    put(f.root, 'docs/.doc-graph.json', JSON.stringify(graph));
    const target = resolveQueryTarget('ZAI:FR-900', loadDocumentQueryContext({ root: f.root }));
    assert.equal(target.statement, f.manifest.records[0].statement);
    assert.equal(target.provenance, 'authored');
    assert.equal(target.sourceRevision, null);
    assert.equal(target.authoredBaseRevision, f.manifest.base.commit);
    assert.equal(renderDocumentViews({ root: f.root, records, graph }).size, 4);
    const after = hashes(f.root);
    assert.equal(applyRecordMigration(f.root, manifestPath).status, 'ALREADY_APPLIED');
    assert.deepEqual(hashes(f.root), after);
    // The sealed approval remains usable after the live note is revised.
    put(f.root, approvedPath, '---\nstatus: draft\nversion: "2.0.0"\n---\n');
    assert.equal(readCanonicalRegistry(f.root).length, 5);
  } finally { f.cleanup(); }
});

for (const fault of ['unsupported-version', 'wrong-family', 'collision', 'reserved', 'burnt', 'namespace', 'stale-base', 'stale-index', 'stale-ledger', 'wrong-anchor', 'duplicate', 'unknown-field', 'inherit-subject']) {
  test(`rejects ${fault} before changing tracked sources`, () => {
    const f = fixture();
    try {
      if (fault === 'unsupported-version') f.manifest.version = 3;
      if (fault === 'wrong-family') f.manifest.records[0].family = 'SEC';
      if (fault === 'collision') f.manifest.records[0].id = original.id;
      if (fault === 'namespace') f.manifest.records[0].namespace = 'ZNEXT';
      if (fault === 'stale-base') f.manifest.base.commit = 'f'.repeat(40);
      if (fault === 'stale-index') f.manifest.base.indexSha256 = 'f'.repeat(64);
      if (fault === 'stale-ledger') f.manifest.base.ledgerSha256 = 'f'.repeat(64);
      if (fault === 'wrong-anchor') f.manifest.records[0].subjectAnchor = 'different subject';
      if (fault === 'duplicate') f.manifest.records[1] = structuredClone(f.manifest.records[0]);
      if (fault === 'unknown-field') f.manifest.retire = [original.id];
      if (fault === 'inherit-subject') {
        f.manifest.records[0].statement = original.statement;
        f.manifest.records[0].statementSha256 = sha256(original.statement);
        f.manifest.records[0].subjectAnchor = anchor(original.statement);
      }
      if (fault === 'reserved' || fault === 'burnt') {
        const file = path.join(f.root, 'docs/.id-ledger.json');
        const ledger = JSON.parse(readFileSync(file));
        if (fault === 'reserved') ledger.reserved_ids = ['FR-900'];
        else ledger.roster.push('FR-900');
        put(f.root, 'docs/.id-ledger.json', `${JSON.stringify(ledger, null, 2)}\n`);
        git(f.root, ['add', 'docs/.id-ledger.json']);
        git(f.root, ['commit', '--quiet', '-m', 'reserved fixture']);
        f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
        f.manifest.base.ledgerSha256 = hashes(f.root)['docs/.id-ledger.json'];
      }
      f.save();
      const before = hashes(f.root);
      assert.throws(() => applyRecordMigration(f.root, manifestPath));
      assert.deepEqual(hashes(f.root), before);
      assert.ok(!existsSync(path.join(f.root, 'docs/requirements/FR-900.md')));
    } finally { f.cleanup(); }
  });
}

test('historical branch reservation preserves active pins and refuses every issuance path', () => {
  const f = fixture();
  const reason = 'Preserve all issued branch-only numbers after main-first reconciliation without replacing published identities.';
  const run = args => execFileSync(process.execPath, ['scripts/id-ledger.mjs', ...args],
    { cwd: path.join(f.root, 'apps/server'), windowsHide: true, stdio: 'pipe' });
  try {
    applyRecordMigration(f.root, manifestPath);
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '--quiet', '-m', 'historical branch issuance']);
    const historical = git(f.root, ['rev-parse', 'HEAD']);
    git(f.root, ['checkout', '--quiet', f.manifest.base.commit]);
    const before = JSON.parse(readFileSync(path.join(f.root, 'docs/.id-ledger.json')));
    const args = ['--reserve-branch', historical, '--reason', reason, '--declared-in', `${approvedPath}#1.0.0`];
    run(args);
    const ledger = JSON.parse(readFileSync(path.join(f.root, 'docs/.id-ledger.json')));
    assert.deepEqual(ledger.ids, before.ids);
    assert.deepEqual(ledger.roster, before.roster);
    assert.deepEqual(ledger.reserved_ids, ['FR-900', 'FR-901', 'FR-902', 'SDD-900']);
    const reservedBytes = readFileSync(path.join(f.root, 'docs/.id-ledger.json'), 'utf8');
    run(args);
    assert.equal(readFileSync(path.join(f.root, 'docs/.id-ledger.json'), 'utf8'), reservedBytes);
    assert.throws(() => run(args.map(value => value === `${approvedPath}#1.0.0` ? `${approvedPath}#2.0.0` : value)));
    put(f.root, 'docs/change-requests/test/reviewed.md', '---\nstatus: approved\n---\n\n## Approval\nOwner approved.\n');
    put(f.root, 'docs/requirements/FR-900.md', reviewedRecord('FR-900', f.manifest.base.commit));
    assert.throws(() => registerReviewedRecord(f.root, 'docs/requirements/FR-900.md'), /previously used/);
    const declaration = new Map([['FR-900', { family: 'FR', source: 'docs/PRD-SDD-v1.0.md', anchor: 'later reviewed capability', status: 'current' }]]);
    assert.ok(evaluateIdStability({ declared: declaration, ledger }).some(result => result.severity === 'critical' && result.title.includes('reservation')));
    put(f.root, 'docs/PRD-SDD-v1.0.md', `${readFileSync(path.join(f.root, 'docs/PRD-SDD-v1.0.md'), 'utf8')}\n| FR-900 | Later reviewed capability. | planned |\n`);
    assert.throws(() => run(['--write']), /reserved/);
    assert.equal(readFileSync(path.join(f.root, 'docs/.id-ledger.json'), 'utf8'), reservedBytes);
    ledger.reserved_ids = ledger.reserved_ids.filter(id => id !== 'FR-900');
    put(f.root, 'docs/.id-ledger.json', JSON.stringify(ledger));
    assert.throws(() => run(['--write']), /inventory was removed/);
    assert.throws(() => writeCanonicalProjections(f.root, { check: true }), /inventory was removed/);
    assert.throws(() => registerReviewedRecord(f.root, 'docs/requirements/FR-900.md'), /inventory was removed/);
    assert.ok(evaluateIdStability({ declared: declaration, ledger }).some(result => result.severity === 'critical' && result.title.includes('inventory removed')));
    ledger.reservation_history[0].ids = 'FR-900';
    put(f.root, 'docs/.id-ledger.json', JSON.stringify(ledger));
    assert.throws(() => run(['--write']), /Invalid historical/);
    assert.throws(() => writeCanonicalProjections(f.root, { check: true }), /Invalid historical/);
    assert.ok(evaluateIdStability({ declared: declaration, ledger }).some(result => result.severity === 'critical' && result.title.includes('Invalid historical')));
  } finally { f.cleanup(); }
});

test('reviewed registration after authored issuance maintains unique export order and immutable receipts', () => {
  const f = fixture();
  try {
    applyRecordMigration(f.root, manifestPath);
    const receiptPath = manifestPath.replace('.manifest.json', '.receipt.json');
    const receipt = readFileSync(path.join(f.root, receiptPath), 'utf8');
    put(f.root, 'docs/change-requests/test/reviewed.md', '---\nstatus: approved\n---\n\n## Approval\nOwner approved.\n');
    put(f.root, 'docs/requirements/FR-903.md', reviewedRecord('FR-903', f.manifest.base.commit));
    registerReviewedRecord(f.root, 'docs/requirements/FR-903.md');
    writeCanonicalProjections(f.root, { check: true });
    const index = JSON.parse(readFileSync(path.join(f.root, 'registry/document-registry/index.json')));
    assert.deepEqual(index.records.map(record => record.exportOrder).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
    assert.equal(index.records.find(record => record.id === 'FR-903').exportOrder, 1);
    assert.equal(index.records.find(record => record.id === 'FR-900').exportOrder, 2);
    assert.equal(readFileSync(path.join(f.root, receiptPath), 'utf8'), receipt);
    assert.throws(() => applyRecordMigration(f.root, manifestPath), /output|drift/);
  } finally { f.cleanup(); }
});

test('rejects a path escape and changed reapplication; parser refuses imported provenance on authored records', () => {
  const f = fixture();
  try {
    assert.throws(() => planRecordMigration(f.root, '../escape.manifest.json'), /unsafe/);
    applyRecordMigration(f.root, manifestPath);
    const text = readFileSync(path.join(f.root, 'docs/requirements/FR-900.md'), 'utf8');
    assert.throws(() => parseCanonicalRecord(text.replace('provenance: authored', `provenance: authored\nsource_revision: ${f.manifest.base.commit}`)), /unsupported authored field/);
    f.manifest.records[0].statement += ' Changed';
    f.manifest.records[0].statementSha256 = sha256(f.manifest.records[0].statement);
    f.manifest.records[0].subjectAnchor = anchor(f.manifest.records[0].statement);
    f.save();
    assert.throws(() => applyRecordMigration(f.root, manifestPath), /different\/partial/);
  } finally { f.cleanup(); }
});

for (const target of ['record', 'receipt', 'ancestor']) {
  test(`rejects a dangling ${target} link before any migration writes`, () => {
    const f = fixture();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'zuri-record-outside-'));
    try {
      const link = target === 'record' ? 'docs/requirements/FR-900.md'
        : target === 'receipt' ? manifestPath.replace('.manifest.json', '.receipt.json') : path.posix.dirname(manifestPath);
      if (target === 'ancestor') rmSync(path.join(f.root, link), { recursive: true });
      const missing = path.join(outside, 'missing');
      // Windows junctions exercise the same dangling-link guard without symlink privileges.
      symlinkSync(missing, path.join(f.root, link), process.platform === 'win32' ? 'junction' : target === 'ancestor' ? 'dir' : 'file');
      let writes = 0;
      assert.throws(() => applyRecordMigration(f.root, manifestPath, { write() { writes += 1; } }), /symlink migration destination/);
      assert.equal(writes, 0);
      assert.ok(!existsSync(missing));
    } finally {
      f.cleanup();
      assert.ok(path.resolve(outside).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(outside).startsWith('zuri-record-outside-'));
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('partial filesystem failure emits an exact recovery receipt and never reports issuance', () => {
  const f = fixture();
  try {
    const before = hashes(f.root);
    let writes = 0;
    assert.throws(() => applyRecordMigration(f.root, manifestPath, { write(file, content, encoding) {
      if (++writes === 3) throw new Error('injected filesystem fault');
      writeFileSync(file, content, encoding);
    } }), error => {
      assert.equal(error.recovery.status, 'PARTIAL');
      assert.deepEqual(error.recovery.remaining, [manifestPath.replace('.manifest.json', '.approval.md'), 'docs/requirements/FR-900.md']);
      return true;
    });
    assert.deepEqual(hashes(f.root), before);
    assert.throws(() => applyRecordMigration(f.root, manifestPath), /different\/partial/);
  } finally { f.cleanup(); }
});

test('authored provenance rejects a forged sealed approval and a changed manifest', () => {
  const f = fixture();
  try {
    applyRecordMigration(f.root, manifestPath);
    const record = readCanonicalRegistry(f.root).find(record => record.id === 'FR-900');
    const read = file => readFileSync(path.join(f.root, file));
    const approvalFile = manifestPath.replace('.manifest.json', '.approval.md');
    const saved = read(approvalFile);
    put(f.root, approvalFile, saved.toString().replace('approved', 'draft'));
    assert.throws(() => validateAuthoredProvenance(record, read), /approval provenance/);
    put(f.root, approvalFile, saved);
    put(f.root, manifestPath, read(manifestPath).toString() + ' ');
    assert.throws(() => validateAuthoredProvenance(record, read), /manifest digest/);
  } finally { f.cleanup(); }
});
