import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { anchor, sameAnchor } from '../apps/server/scripts/id-anchors.mjs';
import { reservedBranchIds } from '../apps/server/scripts/id-stability.mjs';
import { parseCanonicalRecord, validateApprovalSource, validateAuthoredProvenance, validateCanonicalEntry } from '../apps/server/scripts/document-registry-format.mjs';
import { authoredRecordMarkdown } from './document-record-migration.mjs';
import { buildCanonicalIndex, readCanonicalRegistry, renderCanonicalExports, writeCanonicalProjections } from './document-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'registry/document-registry/index.json';
const LEDGER = 'docs/.id-ledger.json';
const MIGRATIONS = 'docs/migrations/document-reintegration/record-migrations';
const PROJECTION_BASE_FILES = [
  'registry/document-registry/PRD-SDD-v1.0.template.md',
  'registry/document-registry/FEATURES.template.md',
  'docs/PRD-SDD-v1.0.md',
  'docs/FEATURES.md',
];
const sha256 = value => createHash('sha256').update(value.toString().replace(/\r\n/g, '\n')).digest('hex');
const normalized = value => value.toString().replace(/\r\n/g, '\n');
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  insist(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  insist(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing/unknown fields`);
}

function git(root, args) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: root, windowsHide: true, encoding: null, maxBuffer: 16 * 1024 * 1024,
  });
}

function gitText(root, args) {
  return git(root, args).toString('utf8');
}

function destination(root, relative) {
  insist(typeof relative === 'string' && relative && !/[\\:\u0000-\u001f\u007f]/.test(relative), 'unsafe amendment path');
  const parts = relative.split('/');
  insist(parts.every(part => part && part !== '.' && part !== '..'), 'unsafe amendment path');
  let current = realpathSync(root);
  for (const part of parts) {
    current = path.join(current, part);
    let entry;
    try { entry = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    insist(!entry?.isSymbolicLink(), `symlink amendment destination: ${relative}`);
  }
  return current;
}

function digestFile(file) {
  return sha256(readFileSync(file));
}

function blobAt(root, revision, file) {
  if (gitText(root, ['ls-tree', '--name-only', revision, '--', file]).trim() !== file) return null;
  return git(root, ['show', `${revision}:${file}`]);
}

function readAt(root, revision, file) {
  const blob = blobAt(root, revision, file);
  insist(blob !== null, `missing committed provenance: ${file} at ${revision}`);
  return normalized(blob);
}

function digestAt(root, revision, file) {
  const blob = blobAt(root, revision, file);
  return blob === null ? null : sha256(blob);
}

function isAncestor(root, ancestor, descendant) {
  try {
    git(root, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function validateRecordItem(item, label = 'record') {
  exactKeys(item, ['id', 'family', 'statement', 'statementSha256', 'subjectAnchor'], label);
  insist(item.family === 'FR' && /^FR-[0-9]{3,}$/.test(item.id), 'amendment must retain one standalone FR identity');
  insist(typeof item.statement === 'string' && item.statement.length > 0 && item.statement.length <= 16_384
    && !/[\r\n\u0000-\u001f\u007f]/.test(item.statement) && item.statement === item.statement.trim()
    && !/\||~~/.test(item.statement), 'statement must be bounded single-cell text');
  insist(item.statementSha256 === sha256(item.statement) && item.subjectAnchor === anchor(item.statement), 'statement digest/anchor mismatch');
}

function validateManifest(manifest, manifestPath) {
  exactKeys(manifest, ['version', 'migrationId', 'base', 'approval', 'records'], 'manifest');
  insist(manifest.version === 1 && /^[a-z][a-z0-9-]{0,79}$/.test(manifest.migrationId), 'unsupported amendment identity/version');
  insist(manifestPath === `${MIGRATIONS}/${manifest.migrationId}.manifest.json`, 'manifest path must match amendment identity');
  exactKeys(manifest.base, ['commit', 'indexSha256', 'ledgerSha256'], 'manifest base');
  exactKeys(manifest.approval, ['path', 'revision', 'version', 'sha256'], 'manifest approval');
  insist(SHA1.test(manifest.base.commit) && SHA1.test(manifest.approval.revision), 'invalid amendment revision');
  insist(SHA256.test(manifest.base.indexSha256) && SHA256.test(manifest.base.ledgerSha256) && SHA256.test(manifest.approval.sha256), 'invalid amendment digest');
  insist(typeof manifest.approval.path === 'string' && /^docs\/change-requests\/.+\.md$/.test(manifest.approval.path)
    && !/[\\:\u0000-\u001f\u007f]/.test(manifest.approval.path)
    && manifest.approval.path.split('/').every(part => part && part !== '.' && part !== '..')
    && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.approval.version), 'invalid amendment approval locator/version');
  insist(Array.isArray(manifest.records) && manifest.records.length === 1, 'amendment must select exactly one existing record');
  validateRecordItem(manifest.records[0]);
}

function recordRow(item) {
  return `| ${item.id} | ${item.statement.replace(/\\\|/g, '|').replace(/\|/g, '\\|')} | planned |`;
}

function validateApprovedRow(text, item) {
  const normalizedText = normalized(text);
  insist(/^##\s+(?:การอนุมัติ|Approval)\s*$/im.test(normalizedText), 'amendment approval needs an explicit Approval section');
  const heading = `### \`ZAI:${item.id}\``;
  const lines = normalizedText.split('\n');
  const sectionOffsets = lines.map((line, index) => line === heading ? index : -1).filter(index => index >= 0);
  insist(sectionOffsets.length === 1, 'approved proposal must have one canonical section for the selected ID');
  const start = sectionOffsets[0] + 1;
  const nextHeading = lines.findIndex((line, index) => index >= start && /^#{1,3} /.test(line));
  const section = lines.slice(start, nextHeading < 0 ? lines.length : nextHeading);
  const rowId = line => line.match(/^\s*\|\s*([^|]+?)\s*\|/)?.[1]?.trim();
  const matchingRows = lines.map((line, index) => ({ line, index })).filter(entry => rowId(entry.line) === item.id);
  insist(matchingRows.length === 1 && matchingRows[0].line === recordRow(item), 'approved proposal must contain only the exact selected-ID row');
  const sectionEnd = nextHeading < 0 ? lines.length : nextHeading;
  insist(matchingRows[0].index >= start && matchingRows[0].index < sectionEnd, 'approved amendment row must be inside its selected-ID section');
  const fences = [];
  let openFence = null;
  for (let index = start; index < sectionEnd; index += 1) {
    const fence = lines[index].match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (!fence) continue;
    if (!openFence) openFence = { start: index, language: fence[1] };
    else {
      fences.push({ ...openFence, end: index });
      openFence = null;
    }
  }
  insist(!openFence, 'approved selected-ID section has an unclosed code fence');
  insist(fences.length === 1 && fences[0].language === 'text', 'approved selected-ID section must have one text fence');
  const expectedRow = recordRow(item);
  const fenceBody = lines.slice(fences[0].start + 1, fences[0].end);
  insist(fenceBody.length === 1 && fenceBody[0] === expectedRow && matchingRows[0].index === fences[0].start + 1,
    'approved proposal text fence must contain only the exact amendment row');
}

function validateApprovalAt(root, manifest, item, { requireCurrent = true } = {}) {
  insist(isAncestor(root, manifest.approval.revision, manifest.base.commit), 'approval revision must be an ancestor of the amendment base');
  const approval = readAt(root, manifest.approval.revision, manifest.approval.path);
  validateApprovalSource(approval, manifest.approval.version, manifest.approval.sha256);
  validateApprovedRow(approval, item);
  if (requireCurrent) {
    const livePath = destination(root, manifest.approval.path);
    insist(existsSync(livePath) && digestFile(livePath) === manifest.approval.sha256, 'approval source is not the pinned committed version');
  }
  return approval;
}

function validateAuthoredManifest(manifest, manifestPath) {
  exactKeys(manifest, ['version', 'migrationId', 'base', 'approval', 'records'], 'prior manifest');
  insist(manifest.version === 1 && /^[a-z][a-z0-9-]{0,79}$/.test(manifest.migrationId), 'invalid prior authored manifest identity');
  insist(manifestPath === `${MIGRATIONS}/${manifest.migrationId}.manifest.json`, 'prior manifest path does not match its identity');
  exactKeys(manifest.base, ['commit', 'indexSha256', 'ledgerSha256'], 'prior manifest base');
  exactKeys(manifest.approval, ['path', 'revision', 'version', 'sha256'], 'prior manifest approval');
  insist(SHA1.test(manifest.base.commit) && SHA1.test(manifest.approval.revision), 'invalid prior authored revision');
  insist(SHA256.test(manifest.base.indexSha256) && SHA256.test(manifest.base.ledgerSha256) && SHA256.test(manifest.approval.sha256), 'invalid prior authored digest');
  insist(typeof manifest.approval.path === 'string' && /^docs\/change-requests\/.+\.md$/.test(manifest.approval.path)
    && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.approval.version), 'invalid prior authored approval locator/version');
  insist(Array.isArray(manifest.records) && manifest.records.length >= 1 && manifest.records.length <= 4, 'invalid prior authored records');
  const ids = new Set();
  const subjects = new Set();
  for (const [index, item] of manifest.records.entries()) {
    exactKeys(item, ['id', 'family', 'statement', 'statementSha256', 'subjectAnchor'], `prior record ${index}`);
    insist(['FR', 'SDD'].includes(item.family) && new RegExp(`^${item.family}-[0-9]{3}$`).test(item.id), 'invalid prior authored family/ID');
    insist(typeof item.statement === 'string' && item.statement.length > 0 && item.statement.length <= 16_384
      && !/[\r\n\u0000-\u001f\u007f]/.test(item.statement) && item.statement === item.statement.trim()
      && !/\||~~/.test(item.statement), 'invalid prior authored statement');
    insist(item.statementSha256 === sha256(item.statement) && item.subjectAnchor === anchor(item.statement), 'prior authored statement digest/anchor mismatch');
    insist(!ids.has(item.id) && !subjects.has(`${item.family}:${item.subjectAnchor}`), 'duplicate prior authored ID/subject');
    ids.add(item.id);
    subjects.add(`${item.family}:${item.subjectAnchor}`);
  }
}

function authoredReceiptOrigins(root, historyTip, priorBase, receiptPath, receiptText, manifestPath, manifestText, migrationOwned, outputs) {
  const receiptSha256 = sha256(receiptText);
  const additions = gitText(root, ['log', '--full-history', '--diff-merges=separate', '--diff-filter=A', '--no-patch', '--format=%H', historyTip, '--', receiptPath])
    .split(/\s+/).filter(revision => SHA1.test(revision));
  const candidates = [...new Set(additions)].filter(revision => isAncestor(root, priorBase, revision));
  const bound = candidates.filter(revision => {
    if (digestAt(root, revision, receiptPath) !== receiptSha256
      || digestAt(root, revision, manifestPath) !== sha256(manifestText)) return false;
    const parents = gitText(root, ['rev-list', '--parents', '-n', '1', revision]).trim().split(/\s+/).slice(1);
    if (parents.length && parents.every(parent => digestAt(root, parent, receiptPath) === receiptSha256)) return false;
    return true;
  });
  return { bound, compatible: bound.filter(revision => migrationOwned.every(file => digestAt(root, revision, file) === outputs[file])) };
}

function verifyPriorReceipt(root, base, previous, previousManifest, previousManifestText, previousManifestPath, { skipWorkingRecordId } = {}) {
  const receiptPath = previous.manifestPath.replace(/\.manifest\.json$/, '.receipt.json');
  const receiptText = readAt(root, base, receiptPath);
  const receipt = JSON.parse(receiptText);
  exactKeys(receipt, ['version', 'migrationId', 'status', 'manifestSha256', 'base', 'ids', 'before', 'outputs'], 'prior receipt');
  insist(receipt.version === 1 && receipt.status === 'APPLIED' && receipt.migrationId === previousManifest.migrationId
    && receipt.manifestSha256 === sha256(previousManifestText), 'prior authored receipt identity/provenance mismatch');
  const expected = [...previousManifest.records.map(item => `docs/requirements/${item.id}.md`),
    previous.manifestPath.replace(/\.manifest\.json$/, '.approval.md'), INDEX, LEDGER,
    'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'].sort();
  insist(isDeepStrictEqual(receipt.base, previousManifest.base)
    && isDeepStrictEqual(receipt.ids, previousManifest.records.map(item => item.id)), 'prior authored receipt base/ID inventory mismatch');
  insist(receipt.before && isDeepStrictEqual(Object.keys(receipt.before).sort(), expected), 'prior authored receipt before inventory mismatch');
  insist(receipt.outputs && isDeepStrictEqual(Object.keys(receipt.outputs).sort(), expected), 'prior authored receipt output inventory mismatch');
  for (const file of expected) {
    insist(receipt.before[file] === digestAt(root, previousManifest.base.commit, file), `prior authored receipt before snapshot drift: ${file}`);
    insist(SHA256.test(receipt.outputs[file]), `prior authored receipt output digest invalid: ${file}`);
  }

  const migrationOwned = [...previousManifest.records.map(item => `docs/requirements/${item.id}.md`),
    previous.manifestPath.replace(/\.manifest\.json$/, '.approval.md')];
  // Legacy authored-v2 receipts bind immutable records and sealed approval copies.
  // Their index/export digests are retained as first-write diagnostics: those
  // shared projections are regenerated by later canonical edits. Keep this
  // compatibility limited to prior receipts; new amendment receipts bind every output.
  const origins = authoredReceiptOrigins(root, base, previousManifest.base.commit, receiptPath, receiptText,
    previousManifestPath, previousManifestText, migrationOwned, receipt.outputs);
  insist(origins.bound.length > 0, `prior authored receipt has no committed origin after its base: ${receiptPath}`);
  insist(origins.compatible.length > 0, `prior authored historical migration-owned output drift: ${receiptPath}`);
  for (const file of migrationOwned) {
    insist(digestAt(root, base, file) === receipt.outputs[file], `prior authored migration-owned artifact changed after apply: ${file}`);
  }
  const workingOwned = migrationOwned.filter(file => file !== `docs/requirements/${skipWorkingRecordId}.md`);
  for (const file of [receiptPath, previousManifestPath, ...workingOwned]) {
    const working = destination(root, file);
    insist(existsSync(working) && digestFile(working) === digestAt(root, base, file), `prior authored artifact is modified in the working tree: ${file}`);
  }
  return { receipt, receiptPath };
}

/** Validate the previous authored record and its full immutable apply evidence at the pinned base. */
function verifyPriorAtBase(root, base, id, { requireCurrent = true } = {}) {
  const indexText = readAt(root, base, INDEX);
  const index = JSON.parse(indexText);
  const entries = index.records?.filter(entry => entry.id === id) ?? [];
  insist(entries.length === 1, `selected authored record is not present exactly once at the amendment base: ${id}`);
  const entry = entries[0];
  insist(entry.recordVersion === 2 && entry.namespace === 'ZAI' && entry.family === 'FR'
    && entry.status === 'active' && entry.provenance === 'authored'
    && entry.path === `docs/requirements/${id}.md` && entry.exportDocument === 'docs/PRD-SDD-v1.0.md'
    && entry.featureId === undefined && isDeepStrictEqual(entry.requirementCells ?? [], []),
  'only an active standalone authored-v2 FR record can be amended');

  const previousText = readAt(root, base, entry.path);
  const previous = parseCanonicalRecord(previousText);
  validateCanonicalEntry(previous, entry, index);
  insist(previous.recordVersion === 2 && previous.status === 'active' && previous.family === 'FR'
    && !previous.featureId && isDeepStrictEqual(previous.requirementCells ?? [], []), 'selected prior record is not an active standalone authored-v2 FR');
  const priorManifestPath = previous.manifestPath;
  insist(typeof priorManifestPath === 'string', 'selected prior record has no authored manifest');
  const priorManifestText = readAt(root, base, priorManifestPath);
  const priorManifest = JSON.parse(priorManifestText);
  validateAuthoredManifest(priorManifest, priorManifestPath);
  insist(sha256(priorManifestText) === previous.manifestSha256, 'prior authored manifest digest mismatch');
  validateAuthoredProvenance(previous, file => readAt(root, base, file));
  insist(isAncestor(root, priorManifest.base.commit, base), 'prior authored base is not an ancestor of the amendment base');
  insist(isAncestor(root, priorManifest.approval.revision, priorManifest.base.commit), 'prior authored approval is not an ancestor of its base');

  for (const item of priorManifest.records) {
    const priorRecordPath = `docs/requirements/${item.id}.md`;
    const priorRecordText = readAt(root, base, priorRecordPath);
    const serialized = authoredRecordMarkdown(item, priorManifest, priorManifestPath, previous.manifestSha256);
    insist(priorRecordText === serialized, `prior authored record serialization drift: ${priorRecordPath}`);
  }

  const priorItems = priorManifest.records.filter(item => item.id === id);
  insist(priorItems.length === 1 && priorItems[0].family === previous.family
    && priorItems[0].statement === previous.statement && priorItems[0].statementSha256 === previous.statementSha256
    && priorItems[0].subjectAnchor === previous.subjectAnchor, 'selected prior record does not match its authored manifest');
  const priorApproval = readAt(root, priorManifest.approval.revision, priorManifest.approval.path);
  validateApprovalSource(priorApproval, priorManifest.approval.version, priorManifest.approval.sha256);
  insist(sha256(readAt(root, base, priorManifestPath.replace(/\.manifest\.json$/, '.approval.md'))) === previous.approvalSha256,
    'prior sealed approval copy drift');

  const priorReceipt = verifyPriorReceipt(root, base, previous, priorManifest, priorManifestText, priorManifestPath,
    { skipWorkingRecordId: requireCurrent ? undefined : id });
  if (requireCurrent) {
    const ledger = JSON.parse(readFileSync(destination(root, LEDGER), 'utf8'));
    insist(!reservedBranchIds(ledger).has(id), `selected authored ID is reserved: ${id}`);
    const pin = ledger.ids?.[id];
    insist(pin?.family === 'FR' && pin.source === 'docs/PRD-SDD-v1.0.md' && pin.status === 'current'
      && sameAnchor(pin.history?.at(-1)?.anchor, previous.subjectAnchor), 'selected authored subject is absent from the current ID ledger');
    for (const file of [entry.path, priorManifestPath, priorManifestPath.replace(/\.manifest\.json$/, '.approval.md'), priorReceipt.receiptPath]) {
      const working = destination(root, file);
      insist(existsSync(working) && digestFile(working) === digestAt(root, base, file), `prior authored artifact is modified in the working tree: ${file}`);
    }
  }
  return { previous, previousText, entry, index, priorManifest, priorManifestPath, priorManifestText, priorReceipt };
}

function validateNewIdentity(previousInfo, item, manifest) {
  const { previous, priorManifest } = previousInfo;
  insist(item.id === previous.id && item.family === previous.family, 'amendment cannot add or move a canonical identity');
  insist(item.statement !== previous.statement, 'amendment statement must change the existing record');
  insist(sameAnchor(item.subjectAnchor, previous.subjectAnchor) && sameAnchor(anchor(item.statement), previous.subjectAnchor),
    'amendment cannot change the pinned subject anchor');
  insist(manifest.migrationId !== priorManifest.migrationId, 'amendment must use a new immutable manifest identity');
}

function validateEvidencePathsAbsentAtBase(root, manifest, manifestPath) {
  insist(digestAt(root, manifest.base.commit, manifestPath) === null,
    `amendment manifest path already exists at the pinned base: ${manifestPath}`);
  for (const file of [`${MIGRATIONS}/${manifest.migrationId}.approval.md`, `${MIGRATIONS}/${manifest.migrationId}.receipt.json`]) {
    insist(digestAt(root, manifest.base.commit, file) === null,
      `amendment evidence path already exists at the pinned base: ${file}`);
  }
}

function validateFreshBase(root, manifest, manifestPath) {
  insist(gitText(root, ['rev-parse', 'HEAD']).trim() === manifest.base.commit, 'stale amendment base commit');
  validateEvidencePathsAbsentAtBase(root, manifest, manifestPath);
  for (const [file, expected] of [[INDEX, manifest.base.indexSha256], [LEDGER, manifest.base.ledgerSha256]]) {
    const pathAtRoot = destination(root, file);
    insist(digestFile(pathAtRoot) === expected && digestAt(root, manifest.base.commit, file) === expected, `stale amendment base digest: ${file}`);
  }
  for (const file of PROJECTION_BASE_FILES) {
    const pathAtRoot = destination(root, file);
    const expected = digestAt(root, manifest.base.commit, file);
    insist(expected && existsSync(pathAtRoot) && digestFile(pathAtRoot) === expected,
      `stale amendment projection preimage differs from its committed base: ${file}`);
  }
}

function makePlan(root, manifestPath, manifest, manifestText, manifestSha256, previousInfo, approval) {
  const item = manifest.records[0];
  validateNewIdentity(previousInfo, item, manifest);
  const approvalCopyPath = `${MIGRATIONS}/${manifest.migrationId}.approval.md`;
  const receiptPath = `${MIGRATIONS}/${manifest.migrationId}.receipt.json`;
  insist(!existsSync(destination(root, approvalCopyPath)), `approval evidence path already exists: ${approvalCopyPath}`);
  insist(!existsSync(destination(root, receiptPath)), `amendment receipt path already exists: ${receiptPath}`);

  const content = authoredRecordMarkdown(item, manifest, manifestPath, manifestSha256);
  const parsed = parseCanonicalRecord(content);
  insist(parsed.statement === item.statement && parsed.id === previousInfo.previous.id, 'authored amendment serialization changed identity/statement');
  const replacement = {
    ...previousInfo.previous,
    ...parsed,
    path: previousInfo.entry.path,
    recordSha256: sha256(content),
    exportDocument: previousInfo.entry.exportDocument,
    exportOrder: previousInfo.entry.exportOrder,
  };
  const records = readCanonicalRegistry(root).map(record => record.id === item.id ? replacement : record);
  const index = buildCanonicalIndex(records, root);
  const oldEntries = new Map(previousInfo.index.records.map(entry => [entry.id, entry]));
  for (const entry of index.records) {
    if (entry.id === item.id) continue;
    insist(isDeepStrictEqual(entry, oldEntries.get(entry.id)), `amendment unexpectedly changes unrelated index record: ${entry.id}`);
  }
  const outputs = [
    { path: approvalCopyPath, content: approval },
    { path: previousInfo.entry.path, content },
    { path: INDEX, content: `${JSON.stringify(index, null, 2)}\n` },
    ...renderCanonicalExports(root, index, records).map(({ path: file, output }) => ({ path: file, content: output })),
  ];
  for (const output of outputs) {
    destination(root, output.path);
    insist(typeof output.content === 'string', `planned amendment output is not text: ${output.path}`);
  }
  return { status: 'PLANNED', manifest, manifestSha256, receiptPath, approvalCopyPath, ids: [item.id], outputs };
}

function verifyCommittedReceipt(root, base, receiptPath, manifest, manifestSha256, receipt) {
  if (gitText(root, ['ls-tree', '--name-only', 'HEAD', '--', receiptPath]).trim() !== receiptPath) return false;
  const migrationOwned = [...manifest.records.map(item => `docs/requirements/${item.id}.md`),
    `${MIGRATIONS}/${manifest.migrationId}.approval.md`];
  const manifestPath = `${MIGRATIONS}/${manifest.migrationId}.manifest.json`;
  const expected = [...migrationOwned, INDEX, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'];
  const receiptText = normalized(readFileSync(destination(root, receiptPath)));
  const additions = gitText(root, ['log', '--full-history', '--diff-merges=separate', '--diff-filter=A', '--no-patch', '--format=%H', 'HEAD', '--', receiptPath])
    .split(/\s+/).filter(revision => SHA1.test(revision));
  const candidates = [...new Set(additions)].filter(revision => isAncestor(root, base, revision));
  const origins = candidates.filter(revision => {
    if (digestAt(root, revision, receiptPath) !== sha256(receiptText)
      || digestAt(root, revision, manifestPath) !== manifestSha256) return false;
    const parents = gitText(root, ['rev-list', '--parents', '-n', '1', revision]).trim().split(/\s+/).slice(1);
    if (parents.length && parents.every(parent => digestAt(root, parent, receiptPath) === sha256(receiptText))) return false;
    return expected.every(file => digestAt(root, revision, file) === receipt.outputs[file]);
  });
  insist(origins.length > 0, `applied amendment receipt has no compatible committed output origin: ${receiptPath}`);
  return true;
}

function verifyApplied(root, manifestPath, manifest, manifestSha256, receiptPath, receipt) {
  validateEvidencePathsAbsentAtBase(root, manifest, manifestPath);
  const item = manifest.records[0];
  insist(receipt.version === 1 && receipt.status === 'APPLIED' && receipt.migrationId === manifest.migrationId
    && receipt.manifestSha256 === manifestSha256, 'amendment identity already has different or partial output');
  const expected = [
    `docs/requirements/${item.id}.md`, `${MIGRATIONS}/${manifest.migrationId}.approval.md`,
    INDEX, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md',
  ].sort();
  insist(receipt.outputs && isDeepStrictEqual(Object.keys(receipt.outputs).sort(), expected), 'applied amendment output inventory mismatch');
  insist(receipt.before && isDeepStrictEqual(Object.keys(receipt.before).sort(), expected), 'applied amendment before inventory mismatch');
  insist(isDeepStrictEqual(receipt.base, manifest.base) && isDeepStrictEqual(receipt.ids, [item.id]), 'applied amendment base/ID inventory mismatch');
  insist(isAncestor(root, manifest.base.commit, gitText(root, ['rev-parse', 'HEAD']).trim()), 'applied amendment base is not in current history');
  for (const file of expected) {
    insist(receipt.before[file] === digestAt(root, manifest.base.commit, file), `applied amendment before snapshot drift: ${file}`);
    insist(SHA256.test(receipt.outputs[file]), `applied amendment output digest invalid: ${file}`);
  }
  const previousInfo = verifyPriorAtBase(root, manifest.base.commit, item.id, { requireCurrent: false });
  validateNewIdentity(previousInfo, item, manifest);
  const approval = validateApprovalAt(root, manifest, item, { requireCurrent: false });
  const approvalCopyPath = `${MIGRATIONS}/${manifest.migrationId}.approval.md`;
  const recordFile = destination(root, previousInfo.entry.path);
  const expectedRecord = authoredRecordMarkdown(item, manifest, manifestPath, manifestSha256);
  insist(receipt.outputs[approvalCopyPath] === manifest.approval.sha256
    && digestFile(destination(root, approvalCopyPath)) === manifest.approval.sha256, `applied amendment approval copy drift: ${approvalCopyPath}`);
  insist(receipt.outputs[previousInfo.entry.path] === sha256(expectedRecord)
    && existsSync(recordFile) && digestFile(recordFile) === sha256(expectedRecord), `applied amendment record drift: ${previousInfo.entry.path}`);
  const currentRecords = readCanonicalRegistry(root);
  const current = currentRecords.find(record => record.id === item.id);
  insist(current?.migrationId === manifest.migrationId && current?.manifestSha256 === manifestSha256
    && current?.statement === item.statement && current?.subjectAnchor === previousInfo.previous.subjectAnchor
    && current?.exportOrder === previousInfo.entry.exportOrder, 'applied amendment current record drift');
  insist(sha256(approval) === manifest.approval.sha256, 'pinned amendment approval source drift');
  const committedReceipt = verifyCommittedReceipt(root, manifest.base.commit, receiptPath, manifest, manifestSha256, receipt);
  if (!committedReceipt) {
    for (const file of expected) {
      const output = destination(root, file);
      insist(existsSync(output) && digestFile(output) === receipt.outputs[file], `uncommitted amendment output digest drift: ${file}`);
    }
  }
  writeCanonicalProjections(root, { check: true });
  return { status: 'ALREADY_APPLIED', manifestSha256, receiptPath, ids: [item.id] };
}

/** Planning reads and verifies; applying re-plans and never invokes the ID ledger writer. */
export function planRecordAmendment(root = ROOT, manifestPath) {
  const manifestFile = destination(root, manifestPath);
  const manifestText = normalized(readFileSync(manifestFile));
  const manifestSha256 = sha256(manifestText);
  const manifest = JSON.parse(manifestText);
  validateManifest(manifest, manifestPath);
  const receiptPath = `${MIGRATIONS}/${manifest.migrationId}.receipt.json`;
  const receiptFile = destination(root, receiptPath);
  if (existsSync(receiptFile)) {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    return verifyApplied(root, manifestPath, manifest, manifestSha256, receiptPath, receipt);
  }

  validateFreshBase(root, manifest, manifestPath);
  writeCanonicalProjections(root, { check: true });
  const records = readCanonicalRegistry(root);
  const priorMatches = records.filter(record => record.id === manifest.records[0].id);
  insist(priorMatches.length === 1, `selected authored record is not present exactly once: ${manifest.records[0].id}`);
  const previousInfo = verifyPriorAtBase(root, manifest.base.commit, manifest.records[0].id);
  const current = priorMatches[0];
  insist(current.recordVersion === 2 && current.path === previousInfo.entry.path
    && current.recordSha256 === previousInfo.entry.recordSha256
    && current.statement === previousInfo.previous.statement
    && current.subjectAnchor === previousInfo.previous.subjectAnchor, 'selected working record differs from its committed authored base');
  validateNewIdentity(previousInfo, manifest.records[0], manifest);
  const approval = validateApprovalAt(root, manifest, manifest.records[0]);
  return makePlan(root, manifestPath, manifest, manifestText, manifestSha256, previousInfo, approval);
}

export function applyRecordAmendment(root = ROOT, manifestPath, { write = writeFileSync } = {}) {
  const plan = planRecordAmendment(root, manifestPath);
  if (plan.status === 'ALREADY_APPLIED') return plan;
  const touched = plan.outputs.map(output => output.path);
  const before = Object.fromEntries(touched.map(file => [file, existsSync(destination(root, file)) ? digestFile(destination(root, file)) : null]));
  try {
    for (const output of plan.outputs) {
      const file = destination(root, output.path);
      mkdirSync(path.dirname(file), { recursive: true });
      write(file, output.content, 'utf8');
    }
    writeCanonicalProjections(root, { check: true });
    const receipt = {
      version: 1,
      migrationId: plan.manifest.migrationId,
      status: 'APPLIED',
      manifestSha256: plan.manifestSha256,
      base: plan.manifest.base,
      ids: plan.ids,
      before,
      outputs: Object.fromEntries(touched.map(file => [file, digestFile(destination(root, file))])),
    };
    write(destination(root, plan.receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  } catch (error) {
    const remaining = touched.filter(file => (existsSync(destination(root, file)) ? digestFile(destination(root, file)) : null) !== before[file]);
    const recovery = { version: 1, status: 'PARTIAL', migrationId: plan.manifest.migrationId,
      manifestSha256: plan.manifestSha256, receiptPath: plan.receiptPath, before, remaining };
    try { writeFileSync(destination(root, plan.receiptPath), `${JSON.stringify(recovery, null, 2)}\n`); } catch { /* return recovery data even if the path is unwritable */ }
    throw Object.assign(new Error(`Record amendment failed; inspect recovery receipt and exact remaining paths: ${remaining.join(', ')}`, { cause: error }), { recovery });
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  try {
    const [mode, manifestPath, ...extra] = process.argv.slice(2);
    insist(['--plan', '--apply'].includes(mode) && manifestPath && !extra.length,
      'Usage: node tools/document-record-amendment.mjs --plan|--apply docs/migrations/document-reintegration/record-migrations/<name>.manifest.json');
    const result = mode === '--apply' ? applyRecordAmendment(ROOT, manifestPath) : planRecordAmendment(ROOT, manifestPath);
    console.log(JSON.stringify({ ...result, outputs: mode === '--plan' ? result.outputs?.map(output => ({ path: output.path, sha256: sha256(output.content) })) : result.outputs }, null, 2));
  } catch (error) {
    console.error(error.message);
    if (error.recovery) console.error(JSON.stringify(error.recovery));
    process.exitCode = 1;
  }
}
