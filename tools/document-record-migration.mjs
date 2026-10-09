import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { anchor, collectDeclared, sameAnchor } from '../apps/server/scripts/id-anchors.mjs';
import { inheritedFrom, reservedBranchIds } from '../apps/server/scripts/id-stability.mjs';
import { parseCanonicalRecord, validateApprovalSource } from '../apps/server/scripts/document-registry-format.mjs';
import { buildCanonicalIndex, readCanonicalRegistry, renderCanonicalExports, writeCanonicalProjections } from './document-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'registry/document-registry/index.json';
const LEDGER = 'docs/.id-ledger.json';
const MIGRATIONS = 'docs/migrations/document-reintegration/record-migrations';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.toString().replace(/\r\n/g, '\n');
const digestFile = file => sha256(normalized(readFileSync(file)));
const git = (root, args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

function insist(condition, message) {
  if (!condition) throw new Error(message);
}

function exactKeys(value, keys, label) {
  insist(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  insist(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing/unknown fields`);
}

/** Refuse path escapes and symlink/junction destinations, including ancestors. */
function destination(root, relative) {
  insist(typeof relative === 'string' && relative && !/[\\:\u0000-\u001f\u007f]/.test(relative), 'unsafe migration path');
  const parts = relative.split('/');
  insist(parts.every(part => part && part !== '.' && part !== '..'), 'unsafe migration path');
  let current = realpathSync(root);
  for (const part of parts) {
    current = path.join(current, part);
    let entry;
    try { entry = lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    insist(!entry?.isSymbolicLink(), `symlink migration destination: ${relative}`);
  }
  return current;
}

function validateManifest(manifest, manifestPath) {
  exactKeys(manifest, ['version', 'migrationId', 'base', 'approval', 'records'], 'manifest');
  insist(manifest.version === 1 && /^[a-z][a-z0-9-]{0,79}$/.test(manifest.migrationId), 'unsupported migration identity/version');
  insist(manifestPath === `${MIGRATIONS}/${manifest.migrationId}.manifest.json`, 'manifest path must match migration identity');
  exactKeys(manifest.base, ['commit', 'indexSha256', 'ledgerSha256'], 'base');
  exactKeys(manifest.approval, ['path', 'revision', 'version', 'sha256'], 'approval');
  for (const value of [manifest.base.commit, manifest.approval.revision]) insist(/^[a-f0-9]{40}$/.test(value), 'invalid migration revision');
  for (const value of [manifest.base.indexSha256, manifest.base.ledgerSha256, manifest.approval.sha256]) insist(/^[a-f0-9]{64}$/.test(value), 'invalid migration digest');
  insist(/^docs\/change-requests\/.+\.md$/.test(manifest.approval.path) && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.approval.version), 'invalid approval locator/version');
  insist(Array.isArray(manifest.records) && manifest.records.length > 0 && manifest.records.length <= 4, 'migration must add 1–4 records');
  const ids = new Set();
  const subjects = new Set();
  for (const record of manifest.records) {
    exactKeys(record, ['id', 'family', 'statement', 'statementSha256', 'subjectAnchor'], 'record');
    insist(['FR', 'SDD'].includes(record.family) && new RegExp(`^${record.family}-[0-9]{3}$`).test(record.id), 'unsupported authored family/ID');
    insist(typeof record.statement === 'string' && record.statement.length > 0 && record.statement.length <= 16_384
      && !/[\r\n\u0000-\u001f\u007f]/.test(record.statement) && record.statement === record.statement.trim()
      && !/\||~~/.test(record.statement), 'statement must be bounded single-cell text');
    insist(record.statementSha256 === sha256(record.statement) && record.subjectAnchor === anchor(record.statement), 'statement digest/anchor mismatch');
    insist(!ids.has(record.id) && !subjects.has(`${record.family}:${record.subjectAnchor}`), 'duplicate authored identity/subject');
    ids.add(record.id);
    subjects.add(`${record.family}:${record.subjectAnchor}`);
  }
}

export function authoredRecordMarkdown(item, manifest, manifestPath, manifestSha256) {
  const row = `| ${item.id} | ${item.statement.replace(/\\\|/g, '|').replace(/\|/g, '\\|')} | planned |\n`;
  return [
    '---', `id: ${item.id}`, 'namespace: ZAI', `family: ${item.family}`, 'version: 2',
    'status: active', 'superseded_by: null', 'provenance: authored',
    `authored_base_revision: ${manifest.base.commit}`, `approval_revision: ${manifest.approval.revision}`,
    `approval_path: ${manifest.approval.path}`, `approval_version: ${manifest.approval.version}`,
    `approval_sha256: ${manifest.approval.sha256}`, `migration_id: ${manifest.migrationId}`,
    `manifest_path: ${manifestPath}`, `manifest_sha256: ${manifestSha256}`,
    `row_sha256: ${sha256(row)}`, `statement_sha256: ${item.statementSha256}`, `subject_anchor: ${item.subjectAnchor}`,
    '---', '', `# ZAI:${item.id}`, '', '<!-- canonical-row:start -->', '```text', row.trimEnd(),
    '```', '<!-- canonical-row:end -->', '',
  ].join('\n');
}

function verifyApplied(root, manifest, receipt, manifestSha256) {
  insist(receipt.version === 1 && receipt.migrationId === manifest.migrationId && receipt.status === 'APPLIED' && receipt.manifestSha256 === manifestSha256, 'migration identity already has different/partial output');
  const expected = [...manifest.records.map(item => `docs/requirements/${item.id}.md`),
    `${MIGRATIONS}/${manifest.migrationId}.approval.md`, INDEX, LEDGER, 'docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'].sort();
  insist(receipt.outputs && JSON.stringify(Object.keys(receipt.outputs).sort()) === JSON.stringify(expected), 'applied receipt output inventory mismatch');
  const records = readCanonicalRegistry(root);
  for (const item of manifest.records) insist(records.some(record => record.id === item.id && record.migrationId === manifest.migrationId
    && record.manifestSha256 === manifestSha256 && record.statementSha256 === item.statementSha256), 'applied migration record drift');
  for (const [file, digest] of Object.entries(receipt.outputs)) insist(digestFile(destination(root, file)) === digest, `applied migration output drift: ${file}`);
  verifyPinnedSubjects(root, manifest);
  writeCanonicalProjections(root, { check: true });
}

function verifyPinnedSubjects(root, manifest) {
  const ledger = JSON.parse(readFileSync(destination(root, LEDGER), 'utf8'));
  const before = JSON.parse(git(root, ['show', `${manifest.base.commit}:${LEDGER}`]));
  for (const [id, entry] of Object.entries(before.ids)) insist(JSON.stringify(ledger.ids[id]) === JSON.stringify(entry), `existing pinned metadata changed: ${id}`);
  for (const item of manifest.records) insist(ledger.ids[item.id]?.status === 'current'
    && ledger.ids[item.id]?.history.at(-1).anchor === item.subjectAnchor, 'sanctioned ID writer did not pin authored subject');
}

/** Plan is read-only. Apply re-plans and uses the existing add-only ID writer. */
export function planRecordMigration(root = ROOT, manifestPath) {
  const manifestFile = destination(root, manifestPath);
  const text = normalized(readFileSync(manifestFile));
  const manifestSha256 = sha256(text);
  const manifest = JSON.parse(text);
  validateManifest(manifest, manifestPath);
  const receiptPath = `${MIGRATIONS}/${manifest.migrationId}.receipt.json`;
  const receiptFile = destination(root, receiptPath);
  if (existsSync(receiptFile)) {
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    verifyApplied(root, manifest, receipt, manifestSha256);
    return { status: 'ALREADY_APPLIED', manifestSha256, receiptPath, ids: manifest.records.map(item => item.id) };
  }
  insist(git(root, ['rev-parse', 'HEAD']).trim() === manifest.base.commit, 'stale migration base commit');
  for (const [file, expected] of [[INDEX, manifest.base.indexSha256], [LEDGER, manifest.base.ledgerSha256]]) {
    insist(digestFile(destination(root, file)) === expected && sha256(normalized(git(root, ['show', `${manifest.base.commit}:${file}`]))) === expected, `stale migration base digest: ${file}`);
  }
  const approval = normalized(git(root, ['show', `${manifest.approval.revision}:${manifest.approval.path}`]));
  validateApprovalSource(approval, manifest.approval.version, manifest.approval.sha256);
  insist(digestFile(destination(root, manifest.approval.path)) === manifest.approval.sha256, 'approval source is not the pinned approved version');
  git(root, ['merge-base', '--is-ancestor', manifest.approval.revision, manifest.base.commit]);
  writeCanonicalProjections(root, { check: true });
  const records = readCanonicalRegistry(root);
  const ledger = JSON.parse(readFileSync(destination(root, LEDGER), 'utf8'));
  const declared = collectDeclared(path.join(root, 'apps/server'));
  insist(!declared.missing.length && !declared.duplicates.length, 'incomplete/duplicate ID declarations');
  for (const [id, entry] of Object.entries(ledger.ids)) {
    insist(declared.has(id) && sameAnchor(entry.history.at(-1).anchor, declared.get(id).anchor), `existing pinned subject drift: ${id}`);
  }
  insist([...declared.keys()].every(id => ledger.ids[id]), 'unrelated unpinned declaration');
  const reserved = new Set([...(ledger.roster ?? []), ...(ledger.not_ids ?? []), ...reservedBranchIds(ledger), ...Object.keys(ledger.ids), ...declared.keys()]);
  const approvalCopyPath = `${MIGRATIONS}/${manifest.migrationId}.approval.md`;
  insist(!existsSync(destination(root, approvalCopyPath)), 'approval evidence path already exists');
  const outputs = [{ path: approvalCopyPath, content: approval }];
  for (const item of manifest.records) {
    insist(!reserved.has(item.id) && !(ledger.burnt_families ?? []).includes(item.family), `issued/burnt/reserved ID collision: ${item.id}`);
    const file = `docs/requirements/${item.id}.md`;
    insist(!existsSync(destination(root, file)), `authored record path already exists: ${file}`);
    const content = authoredRecordMarkdown(item, manifest, manifestPath, manifestSha256);
    const parsed = parseCanonicalRecord(content);
    insist(parsed.statement === item.statement, 'authored serialization changed statement');
    records.push({ ...parsed, path: file, recordSha256: sha256(content), exportDocument: 'docs/PRD-SDD-v1.0.md',
      exportOrder: records.filter(record => record.exportDocument === 'docs/PRD-SDD-v1.0.md').length });
    declared.set(item.id, { family: item.family, anchor: item.subjectAnchor, status: 'current', source: 'docs/PRD-SDD-v1.0.md', statement: item.statement });
    outputs.push({ path: file, content });
  }
  insist(!inheritedFrom(declared, ledger.ids).size, 'new ID inherits an existing subject');
  const index = buildCanonicalIndex(records, root);
  outputs.push({ path: INDEX, content: `${JSON.stringify(index, null, 2)}\n` },
    ...renderCanonicalExports(root, index, records).map(({ path: file, output }) => ({ path: file, content: output })));
  for (const output of outputs) {
    destination(root, output.path);
    insist(typeof output.content === 'string', 'planned output has no serialized content');
  }
  destination(root, 'apps/server/scripts/id-ledger.mjs');
  return { status: 'PLANNED', manifest, manifestSha256, receiptPath, ids: manifest.records.map(item => item.id), outputs };
}

export function applyRecordMigration(root = ROOT, manifestPath, { write = writeFileSync } = {}) {
  const plan = planRecordMigration(root, manifestPath);
  if (plan.status === 'ALREADY_APPLIED') return plan;
  const touched = [...plan.outputs.map(output => output.path), LEDGER];
  const before = Object.fromEntries(touched.map(file => [file, existsSync(destination(root, file)) ? digestFile(destination(root, file)) : null]));
  try {
    for (const output of plan.outputs) {
      const file = destination(root, output.path);
      mkdirSync(path.dirname(file), { recursive: true });
      write(file, output.content, 'utf8');
    }
    execFileSync(process.execPath, ['scripts/id-ledger.mjs', '--write'], { cwd: path.join(root, 'apps/server'), windowsHide: true, stdio: 'pipe' });
    verifyPinnedSubjects(root, plan.manifest);
    writeCanonicalProjections(root, { check: true });
    const receipt = { version: 1, migrationId: plan.manifest.migrationId, status: 'APPLIED', manifestSha256: plan.manifestSha256,
      base: plan.manifest.base, ids: plan.ids, before, outputs: Object.fromEntries(touched.map(file => [file, digestFile(destination(root, file))])) };
    write(destination(root, plan.receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return receipt;
  } catch (error) {
    const remaining = touched.filter(file => (existsSync(destination(root, file)) ? digestFile(destination(root, file)) : null) !== before[file]);
    const recovery = { version: 1, status: 'PARTIAL', migrationId: plan.manifest.migrationId, manifestSha256: plan.manifestSha256, receiptPath: plan.receiptPath, before, remaining };
    // Recovery data is emitted even when the destination itself cannot be written.
    try { writeFileSync(destination(root, plan.receiptPath), `${JSON.stringify(recovery, null, 2)}\n`); } catch { /* caller still receives the recovery receipt */ }
    throw Object.assign(new Error(`Record migration failed; inspect recovery receipt and exact remaining paths: ${remaining.join(', ')}`, { cause: error }), { recovery });
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  try {
    const [mode, manifestPath, ...extra] = process.argv.slice(2);
    insist(['--plan', '--apply'].includes(mode) && manifestPath && !extra.length, 'Usage: node tools/document-record-migration.mjs --plan|--apply docs/migrations/document-reintegration/record-migrations/<name>.manifest.json');
    const result = mode === '--apply' ? applyRecordMigration(ROOT, manifestPath) : planRecordMigration(ROOT, manifestPath);
    console.log(JSON.stringify({ ...result, outputs: mode === '--plan' ? result.outputs?.map(output => ({ path: output.path, sha256: sha256(output.content) })) : result.outputs }, null, 2));
  } catch (error) {
    console.error(error.message);
    if (error.recovery) console.error(JSON.stringify(error.recovery));
    process.exitCode = 1;
  }
}
