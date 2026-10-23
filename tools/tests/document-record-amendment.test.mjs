import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { anchor } from '../../apps/server/scripts/id-anchors.mjs';
import { parseCanonicalRecord } from '../../apps/server/scripts/document-registry-format.mjs';
import { authoredRecordMarkdown } from '../document-record-migration.mjs';
import { buildCanonicalIndex, readCanonicalRegistry, renderCanonicalExports, writeCanonicalProjections } from '../document-registry.mjs';

const sourceRoot = new URL('../../', import.meta.url);
const sourcePath = 'docs/change-requests/test/FR-291-amendment.md';
const migrationDir = 'docs/migrations/document-reintegration/record-migrations';
const priorMigrationId = 'fixture-line-product-facts-v1';
const migrationId = 'fixture-line-product-facts-v2';
const amendmentManifestPath = `${migrationDir}/${migrationId}.manifest.json`;
const priorManifestPath = `${migrationDir}/${priorMigrationId}.manifest.json`;
const priorApprovalCopyPath = `${migrationDir}/${priorMigrationId}.approval.md`;
const priorReceiptPath = `${migrationDir}/${priorMigrationId}.receipt.json`;
const recordPath = 'docs/requirements/FR-291.md';
const indexPath = 'registry/document-registry/index.json';
const ledgerPath = 'docs/.id-ledger.json';
const sha256 = value => createHash('sha256').update(value.toString().replace(/\r\n/g, '\n')).digest('hex');
const oldStatement = 'Customer LINE product facts: the original approved product facts stay bounded.';
const newStatement = 'Customer LINE product facts: recognize bounded natural-language requests for TEST ONLY SKUs and read actual persisted stock and price evidence without guessing.';
const row = (statement, id = 'FR-291') => `| ${id} | ${statement} | planned |`;

let amendmentApi;
try {
  amendmentApi = await import('../document-record-amendment.mjs');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

function requireApi() {
  assert.ok(amendmentApi, 'the writer-only amendment companion must be implemented');
  return amendmentApi;
}

function put(root, file, text) {
  const destination = path.join(root, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, text);
}

function git(root, args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '--no-replace-objects', ...args], {
    cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function digestAt(root, revision, file) {
  if (git(root, ['ls-tree', '--name-only', revision, '--', file]) !== file) return null;
  const blob = execFileSync('git', ['-c', 'core.autocrlf=false', '--no-replace-objects', 'show', `${revision}:${file}`], {
    cwd: root, windowsHide: true, encoding: null,
  });
  return sha256(blob);
}

function sourceDocument(statement, { status = 'approved', version = '0.1.0', id = 'FR-291' } = {}) {
  return [
    '---', `status: ${status}`, `version: "${version}"`, '---', '',
    '## Canonical amendment and provenance', '', `### \`ZAI:${id}\``, '', '```text', row(statement, id), '```', '',
    '## Approval', '', 'The approved amendment preserves the existing subject and standalone identity.', '',
  ].join('\n');
}

function fixture({ mergePriorApply = false, stalePriorSharedProjectionDigests = false, forgedPriorRecordDigest = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zuri-record-amendment-'));
  const putInitial = (file, text) => put(root, file, text);
  const oldApprovalPath = 'docs/change-requests/test/FR-291-original.md';
  const oldApproval = sourceDocument(oldStatement, { version: '1.0.0' });

  putInitial('registry/document-registry/index.json', `${JSON.stringify({ version: 2, sourceRevision: 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e', records: [] }, null, 2)}\n`);
  putInitial('registry/document-registry/PRD-SDD-v1.0.template.md', '# Requirements\n');
  putInitial('registry/document-registry/FEATURES.template.md', '# Features\n');
  putInitial('docs/PRD-SDD-v1.0.md', '# Requirements\n');
  putInitial('docs/FEATURES.md', '# Features\n');
  putInitial(ledgerPath, `${JSON.stringify({ version: 1, ids: {}, roster: [], not_ids: [], reserved_ids: [], reservation_history: [], burnt_families: [] }, null, 2)}\n`);
  putInitial(oldApprovalPath, oldApproval);

  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Record amendment fixture']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'approved original record base']);
  git(root, ['branch', '-M', 'fixture-main']);
  const priorBase = git(root, ['rev-parse', 'HEAD']);
  if (mergePriorApply) {
    git(root, ['switch', '-c', 'authored-apply']);
    put(root, 'authored-apply-source.txt', 'source branch change\n');
    git(root, ['add', 'authored-apply-source.txt']);
    git(root, ['commit', '--quiet', '-m', 'prepare original record apply branch']);
    git(root, ['switch', 'fixture-main']);
    put(root, 'fixture-mainline.txt', 'independent mainline change\n');
    git(root, ['add', 'fixture-mainline.txt']);
    git(root, ['commit', '--quiet', '-m', 'advance mainline independently']);
    git(root, ['merge', '--no-ff', '--no-commit', '--quiet', 'authored-apply']);
  }

  const priorManifest = {
    version: 1,
    migrationId: priorMigrationId,
    base: { commit: priorBase, indexSha256: sha256(readFileSync(path.join(root, indexPath))), ledgerSha256: sha256(readFileSync(path.join(root, ledgerPath))) },
    approval: { path: oldApprovalPath, revision: priorBase, version: '1.0.0', sha256: sha256(oldApproval) },
    records: [{ id: 'FR-291', family: 'FR', statement: oldStatement, statementSha256: sha256(oldStatement), subjectAnchor: anchor(oldStatement) }],
  };
  const priorManifestText = `${JSON.stringify(priorManifest, null, 2)}\n`;
  put(root, priorManifestPath, priorManifestText);
  put(root, priorApprovalCopyPath, oldApproval);
  const priorManifestSha256 = sha256(priorManifestText);
  const priorRecordText = authoredRecordMarkdown(priorManifest.records[0], priorManifest, priorManifestPath, priorManifestSha256);
  put(root, recordPath, priorRecordText);

  const priorRecord = {
    ...parseCanonicalRecord(priorRecordText),
    path: recordPath,
    recordSha256: sha256(priorRecordText),
    exportDocument: 'docs/PRD-SDD-v1.0.md',
    exportOrder: 0,
  };
  const priorIndex = buildCanonicalIndex([priorRecord], root);
  const priorIndexText = `${JSON.stringify(priorIndex, null, 2)}\n`;
  put(root, indexPath, priorIndexText);
  for (const output of renderCanonicalExports(root, priorIndex, [priorRecord])) put(root, output.path, output.output);

  const pinnedLedger = {
    version: 1,
    ids: { 'FR-291': { family: 'FR', source: 'docs/PRD-SDD-v1.0.md', status: 'current', history: [{ anchor: anchor(oldStatement), since: '2026-10-23', reason: 'declared' }] } },
    roster: [], not_ids: [], reserved_ids: [], reservation_history: [], burnt_families: [],
  };
  put(root, ledgerPath, `${JSON.stringify(pinnedLedger, null, 2)}\n`);

  const priorTouched = [priorApprovalCopyPath, recordPath, indexPath, ledgerPath, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'];
  const before = Object.fromEntries(priorTouched.map(file => [file, digestAt(root, priorBase, file)]));
  const outputs = Object.fromEntries(priorTouched.map(file => [file, sha256(readFileSync(path.join(root, file)))]));
  const priorReceipt = {
    version: 1,
    migrationId: priorMigrationId,
    status: 'APPLIED',
    manifestSha256: priorManifestSha256,
    base: priorManifest.base,
    ids: ['FR-291'],
    before,
    outputs,
  };
  if (stalePriorSharedProjectionDigests) {
    priorReceipt.outputs[indexPath] = 'f'.repeat(64);
    priorReceipt.outputs['docs/FEATURES.md'] = 'e'.repeat(64);
  }
  if (forgedPriorRecordDigest) priorReceipt.outputs[recordPath] = 'd'.repeat(64);
  put(root, priorReceiptPath, `${JSON.stringify(priorReceipt, null, 2)}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', mergePriorApply ? 'merge original authored-v2 record' : 'apply original authored-v2 record']);

  const amendmentApproval = sourceDocument(newStatement);
  put(root, sourcePath, amendmentApproval);
  git(root, ['add', sourcePath]);
  git(root, ['commit', '--quiet', '-m', 'approve the FR-291 natural-language amendment']);
  const baseCommit = git(root, ['rev-parse', 'HEAD']);
  const manifest = {
    version: 1,
    migrationId,
    base: { commit: baseCommit, indexSha256: sha256(readFileSync(path.join(root, indexPath))), ledgerSha256: sha256(readFileSync(path.join(root, ledgerPath))) },
    approval: { path: sourcePath, revision: baseCommit, version: '0.1.0', sha256: sha256(amendmentApproval) },
    records: [{ id: 'FR-291', family: 'FR', statement: newStatement, statementSha256: sha256(newStatement), subjectAnchor: anchor(newStatement) }],
  };
  put(root, amendmentManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    root, manifest, cleanup() {
      assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('zuri-record-amendment-'));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function snapshot(root, files = [recordPath, priorManifestPath, priorApprovalCopyPath, priorReceiptPath, indexPath, ledgerPath, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']) {
  return Object.fromEntries(files.map(file => [file, existsSync(path.join(root, file)) ? sha256(readFileSync(path.join(root, file))) : null]));
}

test('amends the selected authored-v2 row in place and replays idempotently with all old lineage immutable', () => {
  const f = fixture();
  try {
    const { planRecordAmendment, applyRecordAmendment } = requireApi();
    const protectedBefore = snapshot(f.root);
    const ledgerBefore = readFileSync(path.join(f.root, ledgerPath));
    const plan = planRecordAmendment(f.root, amendmentManifestPath);
    assert.equal(plan.status, 'PLANNED');
    assert.deepEqual(snapshot(f.root), protectedBefore);

    const receipt = applyRecordAmendment(f.root, amendmentManifestPath);
    assert.equal(receipt.status, 'APPLIED');
    const records = readCanonicalRegistry(f.root);
    const amended = records.find(record => record.id === 'FR-291');
    assert.equal(records.length, 1);
    assert.equal(amended.statement, newStatement);
    assert.equal(amended.family, 'FR');
    assert.equal(amended.path, recordPath);
    assert.equal(amended.status, 'active');
    assert.deepEqual(amended.requirementCells, []);
    assert.equal(amended.featureId, undefined);
    assert.equal(amended.exportDocument, 'docs/PRD-SDD-v1.0.md');
    assert.equal(amended.exportOrder, 0);
    assert.equal(amended.subjectAnchor, anchor(oldStatement));
    assert.deepEqual(readFileSync(path.join(f.root, ledgerPath)), ledgerBefore);
    assert.deepEqual(snapshot(f.root, [priorManifestPath, priorApprovalCopyPath, priorReceiptPath]), {
      [priorManifestPath]: protectedBefore[priorManifestPath],
      [priorApprovalCopyPath]: protectedBefore[priorApprovalCopyPath],
      [priorReceiptPath]: protectedBefore[priorReceiptPath],
    });
    assert.equal(planRecordAmendment(f.root, amendmentManifestPath).status, 'ALREADY_APPLIED');

    const receiptPath = amendmentManifestPath.replace('.manifest.json', '.receipt.json');
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '--quiet', '-m', 'commit authored-v2 amendment outputs']);
    assert.equal(planRecordAmendment(f.root, amendmentManifestPath).status, 'ALREADY_APPLIED');
    assert.equal(JSON.parse(readFileSync(path.join(f.root, receiptPath), 'utf8')).status, 'APPLIED');
  } finally { f.cleanup(); }
});

for (const stale of ['base-commit', 'index', 'ledger']) {
  test(`rejects stale amendment ${stale} before changing any file`, () => {
    const f = fixture();
    try {
      if (stale === 'base-commit') f.manifest.base.commit = 'f'.repeat(40);
      if (stale === 'index') f.manifest.base.indexSha256 = 'f'.repeat(64);
      if (stale === 'ledger') f.manifest.base.ledgerSha256 = 'f'.repeat(64);
      put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
      const before = snapshot(f.root);
      assert.throws(() => requireApi().applyRecordAmendment(f.root, amendmentManifestPath));
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.cleanup(); }
  });
}

for (const corrupt of ['missing-old-manifest', 'tampered-old-manifest', 'missing-old-approval', 'tampered-old-approval', 'missing-old-receipt', 'tampered-old-receipt', 'tampered-old-record']) {
  test(`refuses amendment when prior authored provenance is ${corrupt}`, () => {
    const f = fixture();
    try {
      const file = corrupt.includes('manifest') ? priorManifestPath
        : corrupt.includes('approval') ? priorApprovalCopyPath
          : corrupt.includes('receipt') ? priorReceiptPath : recordPath;
      if (corrupt.startsWith('missing-')) rmSync(path.join(f.root, file));
      else put(f.root, file, `${readFileSync(path.join(f.root, file), 'utf8')}\nforged\n`);
      const before = snapshot(f.root);
      assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath));
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.cleanup(); }
  });
}

for (const invalid of ['unapproved', 'wrong-row', 'duplicate-record-section', 'missing-approval-section',
  'duplicate-same-id-outside-section', 'conflicting-same-id-inside-fence', 'same-id-row-outside-fence',
  'expected-row-not-fenced', 'multiple-text-fences']) {
  test(`requires an approved proposal with one exact row section (${invalid})`, () => {
    const f = fixture();
    try {
      let proposal = readFileSync(path.join(f.root, sourcePath), 'utf8');
      if (invalid === 'unapproved') proposal = proposal.replace('status: approved', 'status: proposed');
      if (invalid === 'wrong-row') proposal = proposal.replace(row(newStatement), row(`${newStatement} altered`));
      if (invalid === 'duplicate-record-section') proposal = `${proposal}\n### \`ZAI:FR-291\`\n\n\`${row(newStatement)}\`\n`;
      if (invalid === 'missing-approval-section') proposal = proposal.replace('## Approval', '## Notes');
      if (invalid === 'duplicate-same-id-outside-section') proposal = `${proposal}\n${row(newStatement)}\n`;
      if (invalid === 'conflicting-same-id-inside-fence') proposal = proposal.replace(row(newStatement), `${row(newStatement)}\n${row(`${newStatement} conflict`)}`);
      if (invalid === 'same-id-row-outside-fence') proposal = proposal.replace('## Approval', `${row(newStatement)}\n\n## Approval`);
      if (invalid === 'expected-row-not-fenced') proposal = proposal.replace(`\`\`\`text\n${row(newStatement)}\n\`\`\``, row(newStatement));
      if (invalid === 'multiple-text-fences') proposal = proposal.replace('## Approval', '```text\ncontext\n```\n\n## Approval');
      put(f.root, sourcePath, proposal);
      git(f.root, ['add', sourcePath]);
      git(f.root, ['commit', '--quiet', '-m', `invalid proposal: ${invalid}`]);
      const nextHead = git(f.root, ['rev-parse', 'HEAD']);
      f.manifest.base.commit = nextHead;
      f.manifest.approval.revision = nextHead;
      f.manifest.approval.sha256 = sha256(proposal);
      f.manifest.base.indexSha256 = sha256(readFileSync(path.join(f.root, indexPath)));
      f.manifest.base.ledgerSha256 = sha256(readFileSync(path.join(f.root, ledgerPath)));
      put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
      const before = snapshot(f.root);
      assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath));
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.cleanup(); }
  });
}

test('rejects approval metadata the strict canonical provenance reader cannot parse', () => {
  const f = fixture();
  try {
    let proposal = readFileSync(path.join(f.root, sourcePath), 'utf8');
    proposal = proposal.replace('version: "0.1.0"\n---', 'version: "0.1.0"\nrelations:\n  - type: references\n    target: ZAI:FR-291\n---');
    put(f.root, sourcePath, proposal);
    git(f.root, ['add', sourcePath]);
    git(f.root, ['commit', '--quiet', '-m', 'approve proposal with typed relations']);
    const nextHead = git(f.root, ['rev-parse', 'HEAD']);
    f.manifest.base.commit = nextHead;
    f.manifest.approval.revision = nextHead;
    f.manifest.approval.sha256 = sha256(proposal);
    put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /unsupported frontmatter line/);
  } finally { f.cleanup(); }
});

test('accepts the committed prior authored receipt when its application first appears through a merge', () => {
  const f = fixture({ mergePriorApply: true });
  try {
    assert.equal(requireApi().planRecordAmendment(f.root, amendmentManifestPath).status, 'PLANNED');
  } finally { f.cleanup(); }
});

test('retains legacy prior receipt projection digests as auxiliary when wrapper lineage is bound', () => {
  const f = fixture({ stalePriorSharedProjectionDigests: true });
  try {
    assert.equal(requireApi().planRecordAmendment(f.root, amendmentManifestPath).status, 'PLANNED');
  } finally { f.cleanup(); }
});

test('rejects a prior receipt whose committed migration-owned output digest does not match its apply origin', () => {
  const f = fixture({ forgedPriorRecordDigest: true });
  try {
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /historical.*output drift/i);
  } finally { f.cleanup(); }
});

test('rejects paired uncommitted projection-template/export drift from the pinned base', () => {
  const f = fixture();
  try {
    const templatePath = 'registry/document-registry/PRD-SDD-v1.0.template.md';
    put(f.root, templatePath, `${readFileSync(path.join(f.root, templatePath), 'utf8')}\n<!-- uncommitted projection drift -->\n`);
    const currentIndex = JSON.parse(readFileSync(path.join(f.root, indexPath), 'utf8'));
    const records = readCanonicalRegistry(f.root);
    for (const output of renderCanonicalExports(f.root, currentIndex, records)) put(f.root, output.path, output.output);
    const before = snapshot(f.root, [templatePath, 'registry/document-registry/FEATURES.template.md',
      'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md', indexPath, ledgerPath, recordPath]);
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /projection.*base|base.*projection|preimage/i);
    assert.deepEqual(snapshot(f.root, Object.keys(before)), before);
  } finally { f.cleanup(); }
});

test('requires every new amendment output digest to match a committed apply origin', () => {
  const f = fixture();
  try {
    const { applyRecordAmendment, planRecordAmendment } = requireApi();
    applyRecordAmendment(f.root, amendmentManifestPath);
    const receiptPath = amendmentManifestPath.replace('.manifest.json', '.receipt.json');
    const receipt = JSON.parse(readFileSync(path.join(f.root, receiptPath), 'utf8'));
    receipt.outputs[indexPath] = 'f'.repeat(64);
    put(f.root, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    git(f.root, ['add', receiptPath]);
    git(f.root, ['commit', '--quiet', '-m', 'commit forged amendment receipt digest']);
    assert.throws(() => planRecordAmendment(f.root, amendmentManifestPath), /output.*origin|historical output/i);
  } finally { f.cleanup(); }
});

for (const violation of ['new-id', 'changed-subject', 'reserved-id', 'changed-export-order', 'changed-status', 'added-membership']) {
  test(`refuses amendment identity drift (${violation})`, () => {
    const f = fixture();
    try {
      if (violation === 'new-id') {
        f.manifest.records[0].id = 'FR-292';
        f.manifest.records[0].statement = newStatement.replace('FR-291', 'FR-292');
        f.manifest.records[0].statementSha256 = sha256(f.manifest.records[0].statement);
        f.manifest.records[0].subjectAnchor = anchor(f.manifest.records[0].statement);
      }
      if (violation === 'changed-subject') {
        f.manifest.records[0].statement = 'Inventory product facts: this has a different subject anchor.';
        f.manifest.records[0].statementSha256 = sha256(f.manifest.records[0].statement);
        f.manifest.records[0].subjectAnchor = anchor(f.manifest.records[0].statement);
      }
      if (violation === 'reserved-id') {
        const ledger = JSON.parse(readFileSync(path.join(f.root, ledgerPath), 'utf8'));
        ledger.reserved_ids = ['FR-291'];
        put(f.root, ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
        git(f.root, ['add', ledgerPath]);
        git(f.root, ['commit', '--quiet', '-m', 'reserve selected id']);
        f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
        f.manifest.base.ledgerSha256 = sha256(readFileSync(path.join(f.root, ledgerPath)));
      }
      if (violation === 'changed-export-order') {
        const index = JSON.parse(readFileSync(path.join(f.root, indexPath), 'utf8'));
        index.records[0].exportOrder = 1;
        put(f.root, indexPath, `${JSON.stringify(index, null, 2)}\n`);
        git(f.root, ['add', indexPath]);
        git(f.root, ['commit', '--quiet', '-m', 'change canonical export order']);
        f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
        f.manifest.base.indexSha256 = sha256(readFileSync(path.join(f.root, indexPath)));
      }
      if (violation === 'changed-status') {
        const record = readFileSync(path.join(f.root, recordPath), 'utf8').replace('status: active', 'status: superseded');
        put(f.root, recordPath, record);
      }
      if (violation === 'added-membership') {
        const record = readFileSync(path.join(f.root, recordPath), 'utf8').replace('family: FR\n', 'family: FR\nfeature_id: FEAT-001\n');
        put(f.root, recordPath, record);
      }
      put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
      const before = snapshot(f.root);
      assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath));
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.cleanup(); }
  });
}

test('apply reports a partial receipt and blocks an unsafe retry after a write failure', () => {
  const f = fixture();
  try {
    const { applyRecordAmendment, planRecordAmendment } = requireApi();
    let writes = 0;
    assert.throws(() => applyRecordAmendment(f.root, amendmentManifestPath, {
      write(file, content, encoding) {
        writes += 1;
        if (writes === 2) throw new Error('injected write failure');
        writeFileSync(file, content, encoding);
      },
    }), /recovery receipt/);
    const recoveryPath = amendmentManifestPath.replace('.manifest.json', '.receipt.json');
    assert.equal(JSON.parse(readFileSync(path.join(f.root, recoveryPath), 'utf8')).status, 'PARTIAL');
    assert.throws(() => planRecordAmendment(f.root, amendmentManifestPath), /partial|different|recovery/i);
  } finally { f.cleanup(); }
});

test('refuses a pre-existing amendment approval-copy path without overwriting it', () => {
  const f = fixture();
  try {
    const approvalCopyPath = `${migrationDir}/${migrationId}.approval.md`;
    put(f.root, approvalCopyPath, 'unrelated existing evidence\n');
    const before = snapshot(f.root, [approvalCopyPath, recordPath, indexPath, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']);
    assert.throws(() => requireApi().applyRecordAmendment(f.root, amendmentManifestPath), /approval evidence path already exists/);
    assert.deepEqual(snapshot(f.root, Object.keys(before)), before);
  } finally { f.cleanup(); }
});

test('keeps the v1 manifest schema closed', () => {
  const f = fixture();
  try {
    f.manifest.amendmentOf = 'line-product-facts-20261023';
    put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
    const before = snapshot(f.root);
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /missing\/unknown fields/);
    assert.deepEqual(snapshot(f.root), before);
  } finally { f.cleanup(); }
});

test('refuses to reuse an amendment manifest path already present at the pinned base', () => {
  const f = fixture();
  try {
    put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
    git(f.root, ['add', amendmentManifestPath]);
    git(f.root, ['commit', '--quiet', '-m', 'reserve the amendment manifest path']);
    f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
    put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
    const protectedPaths = [amendmentManifestPath, recordPath, indexPath, ledgerPath,
      'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md', priorManifestPath, priorApprovalCopyPath, priorReceiptPath];
    const before = snapshot(f.root, protectedPaths);
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /manifest.*already exists at.*base/i);
    assert.deepEqual(snapshot(f.root, protectedPaths), before);
  } finally { f.cleanup(); }
});

for (const evidence of ['approval-copy', 'receipt']) {
  test(`refuses a committed ${evidence} path even when it is deleted from the working tree`, () => {
    const f = fixture();
    try {
      const evidencePath = evidence === 'approval-copy'
        ? `${migrationDir}/${migrationId}.approval.md`
        : `${migrationDir}/${migrationId}.receipt.json`;
      put(f.root, evidencePath, `orphan ${evidence} evidence\n`);
      git(f.root, ['add', evidencePath]);
      git(f.root, ['commit', '--quiet', '-m', `reserve orphan ${evidence} path`]);
      f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
      put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
      rmSync(path.join(f.root, evidencePath));
      const protectedPaths = [evidencePath, amendmentManifestPath, recordPath, indexPath, ledgerPath,
        'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md', priorManifestPath, priorApprovalCopyPath, priorReceiptPath];
      const before = snapshot(f.root, protectedPaths);
      assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /evidence path.*already exists at.*base/i);
      assert.deepEqual(snapshot(f.root, protectedPaths), before);
    } finally { f.cleanup(); }
  });
}

test('rejects an applied replay whose declared pinned base already contains its evidence paths', () => {
  const f = fixture();
  try {
    requireApi().applyRecordAmendment(f.root, amendmentManifestPath);
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '--quiet', '-m', 'commit complete amendment apply']);
    f.manifest.base.commit = git(f.root, ['rev-parse', 'HEAD']);
    put(f.root, amendmentManifestPath, `${JSON.stringify(f.manifest, null, 2)}\n`);
    const before = snapshot(f.root, [amendmentManifestPath, `${migrationDir}/${migrationId}.approval.md`,
      `${migrationDir}/${migrationId}.receipt.json`, recordPath, indexPath, ledgerPath,
      'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md']);
    assert.throws(() => requireApi().planRecordAmendment(f.root, amendmentManifestPath), /manifest path.*already exists at.*base/i);
    assert.deepEqual(snapshot(f.root, Object.keys(before)), before);
  } finally { f.cleanup(); }
});

test('keeps the add-only migration interface unchanged', () => {
  const migrationTool = readFileSync(new URL('../document-record-migration.mjs', import.meta.url), 'utf8');
  assert.match(migrationTool, /\['--plan', '--apply'\]/);
  assert.doesNotMatch(migrationTool, /--amend/);
});
