import { createHash } from 'node:crypto';

const FAMILIES = new Set(['FEAT', 'FR', 'NFR', 'BR', 'SEC', 'SDD']);
const FAMILY_ID = /^(FEAT|FR|NFR|BR|SEC|SDD)-\d{3,}$/;
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const REGISTRY_PATHS = new Set([
  'docs/PRD-SDD-v1.0.md',
  'docs/FEATURES.md',
]);

function fail(message) {
  throw new Error(`Invalid document registry: ${message}`);
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string`);
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function stripRowEnding(row) {
  if (row.endsWith('\r\n')) return row.slice(0, -2);
  if (row.endsWith('\n')) return row.slice(0, -1);
  return row;
}

/** Split one Markdown table row while retaining its outer empty cells. */
export function splitRow(row) {
  if (typeof row !== 'string') fail('row must be a string');
  // Keep exact parity with apps/server/scripts/id-anchors.mjs:213. In
  // particular, escaped pipes are unescaped and backticks have no special role.
  return stripRowEnding(row).split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('record frontmatter is missing or malformed');
  const fields = Object.create(null);
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const field = line.match(/^([a-z][a-z0-9_]*):\s*(.*?)\s*$/);
    if (!field) fail(`unsupported frontmatter line: ${line}`);
    if (Object.hasOwn(fields, field[1])) fail(`duplicate frontmatter field: ${field[1]}`);
    fields[field[1]] = field[2];
  }
  return { fields, body: text.slice(match[0].length) };
}

function parseIntegerArray(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`${name} must be a JSON integer array`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    fail(`${name} must be a JSON integer array`);
  }
  return parsed;
}

/** Parse one canonical Markdown record without reading from the filesystem. */
export function parseCanonicalRecord(text) {
  if (typeof text !== 'string') fail('record must be a string');
  const { fields, body } = parseFrontmatter(text);
  const id = requiredText(fields.id, 'id');
  const family = requiredText(fields.family, 'family');
  const namespace = requiredText(fields.namespace, 'namespace');
  const recordVersion = Number(fields.version);
  if (![1, 2].includes(recordVersion)) fail('version must be 1 or 2');
  const status = requiredText(fields.status, 'status');
  if (namespace !== 'ZAI') fail(`active record namespace must be ZAI: ${namespace}`);
  if (!FAMILY_ID.test(id) || !FAMILIES.has(family) || !id.startsWith(`${family}-`)) {
    fail(`id ${id} does not match supported family ${family}`);
  }
  if (recordVersion === 2) return parseAuthoredRecord(fields, body, { id, namespace, family, recordVersion, status });
  if (status !== 'source-preserved') fail(`status must be source-preserved in format version 1: ${status}`);
  const sourceRevision = requiredText(fields.source_revision, 'source_revision');
  if (!SHA1.test(sourceRevision)) fail('source_revision must be a full Git SHA-1');
  const sourcePath = requiredText(fields.source_path, 'source_path');
  if (!REGISTRY_PATHS.has(sourcePath)) fail(`unsupported source_path: ${sourcePath}`);
  if ((family === 'FEAT') !== (sourcePath === 'docs/FEATURES.md')) {
    fail(`${family} source_path does not match its legacy registry`);
  }
  const sourceRowSha256 = requiredText(fields.source_row_sha256, 'source_row_sha256');
  if (!SHA256.test(sourceRowSha256)) fail('source_row_sha256 must be a SHA-256 hex digest');
  const sourceRowEol = fields.source_row_eol;
  if (sourceRowEol !== 'CRLF' && sourceRowEol !== 'LF') fail('source_row_eol must be CRLF or LF');
  const statementCell = Number(fields.statement_cell);
  nonNegativeInteger(statementCell, 'statement_cell');
  const requirementCells = parseIntegerArray(fields.requirement_cells ?? '[]', 'requirement_cells');
  const featureId = fields.feature_id || undefined;
  if (featureId && (family !== 'FR' || !/^FEAT-\d{3,}$/.test(featureId))) {
    fail('feature_id is only valid for an FR with an explicit FEAT membership');
  }

  const rowMatch = body.match(/<!-- canonical-row:start -->\r?\n```text\r?\n([\s\S]*?)```\r?\n<!-- canonical-row:end -->/g);
  if (!rowMatch || rowMatch.length !== 1) fail('record must contain exactly one canonical row fence');
  const block = body.match(/<!-- canonical-row:start -->\r?\n```text\r?\n([\s\S]*?)```\r?\n<!-- canonical-row:end -->/);
  if (!block) fail('canonical row fence is malformed');
  const storedRow = stripRowEnding(block[1]);
  if (storedRow.includes('\n') || storedRow.includes('\r')) fail('canonical row must occupy exactly one line');
  const row = `${storedRow}${sourceRowEol === 'CRLF' ? '\r\n' : '\n'}`;
  const actualRowSha256 = createHash('sha256').update(Buffer.from(row, 'utf8')).digest('hex');
  if (actualRowSha256 !== sourceRowSha256.toLowerCase()) fail(`${id} source row hash does not match its payload`);

  const cells = splitRow(row);
  if (cells.length < 4 || cells[1] !== id) fail(`${id} does not match the first cell of its row`);
  if (statementCell >= cells.length) fail(`${id} statement_cell is outside the row`);
  for (const cellIndex of requirementCells) {
    if (cellIndex >= cells.length) fail(`${id} requirement cell is outside the row`);
  }
  let requirementKeys = [];
  if (family === 'FEAT') {
    if (requirementCells.length !== 1 || requirementCells[0] !== 3) fail(`${id} must declare the FEAT FR-list cell explicitly`);
    const listed = cells[requirementCells[0]];
    requirementKeys = listed === '' || listed === '—' ? [] : listed.split(/\s*,\s*/);
    if (requirementKeys.some((key) => !/^FR-\d{3,}$/.test(key))) fail(`${id} has an invalid FR membership list`);
    if (new Set(requirementKeys).size !== requirementKeys.length) fail(`${id} has duplicate FR membership`);
  } else if (requirementCells.length > 0) {
    fail(`${id} cannot declare FEAT membership cells`);
  }
  const subjectAnchor = fields.subject_anchor || undefined;

  return {
    id,
    namespace,
    family,
    recordVersion,
    status,
    row,
    cells,
    statement: cells[statementCell],
    requirementKeys,
    sourceRevision,
    sourcePath,
    sourceRowEol,
    sourceRowSha256: actualRowSha256,
    statementCell,
    requirementCells,
    ...(subjectAnchor ? { subjectAnchor } : {}),
    ...(featureId ? { featureId } : {}),
  };
}

function validRegistryPath(value) {
  if (typeof value !== 'string' || value === '' || /[\\:\u0000-\u001f\u007f]/.test(value) || value.startsWith('/')) return false;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  return value.startsWith('docs/features/') || value.startsWith('docs/requirements/');
}

/** Parse and validate the versioned canonical index without filesystem access. */
export function parseCanonicalIndex(text) {
  if (typeof text !== 'string') fail('index must be a string');
  let index;
  try {
    index = JSON.parse(text);
  } catch {
    fail('index must be valid JSON');
  }
  if (!index || typeof index !== 'object' || Array.isArray(index)) fail('index must be a JSON object');
  if (![1, 2].includes(index.version)) fail(`unsupported index version: ${index.version}`);
  const sourceRevision = requiredText(index.sourceRevision, 'sourceRevision');
  if (!SHA1.test(sourceRevision)) fail('sourceRevision must be a full Git SHA-1');
  if (!Array.isArray(index.records)) fail('records must be an array');

  const keys = new Set();
  const paths = new Set();
  const records = index.records.map((record, offset) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`records[${offset}] must be an object`);
    const id = requiredText(record.id, `records[${offset}].id`);
    const namespace = requiredText(record.namespace, `records[${offset}].namespace`);
    const family = requiredText(record.family, `records[${offset}].family`);
    const path = requiredText(record.path, `records[${offset}].path`);
    if (namespace !== 'ZAI') fail(`records[${offset}] namespace must be ZAI`);
    if (!FAMILY_ID.test(id) || !FAMILIES.has(family) || !id.startsWith(`${family}-`)) fail(`records[${offset}] has invalid id/family`);
    if (![1, 2].includes(record.recordVersion) || (index.version === 1 && record.recordVersion !== 1)) fail(`records[${offset}].recordVersion is unsupported`);
    if (record.recordVersion === 1) {
      if (record.status !== 'source-preserved') fail(`records[${offset}].status must be source-preserved`);
    } else validateAuthoredFields(record);
    if (!validRegistryPath(path)) fail(`records[${offset}] has unsafe path`);
    const key = `${namespace}:${id}`;
    if (keys.has(key)) fail(`duplicate id: ${key}`);
    if (paths.has(path)) fail(`duplicate path: ${path}`);
    keys.add(key);
    paths.add(path);
    if (record.sourceRowSha256 !== undefined && (typeof record.sourceRowSha256 !== 'string' || !SHA256.test(record.sourceRowSha256))) {
      fail(`records[${offset}].sourceRowSha256 must be a SHA-256 hex digest`);
    }
    if (record.recordSha256 !== undefined && (typeof record.recordSha256 !== 'string' || !SHA256.test(record.recordSha256))) {
      fail(`records[${offset}].recordSha256 must be a SHA-256 hex digest`);
    }
    if (record.statementCell !== undefined) nonNegativeInteger(record.statementCell, `records[${offset}].statementCell`);
    if (record.exportOrder !== undefined) nonNegativeInteger(record.exportOrder, `records[${offset}].exportOrder`);
    if (record.requirementCells !== undefined && (!Array.isArray(record.requirementCells) || record.requirementCells.some((item) => !Number.isSafeInteger(item) || item < 0))) {
      fail(`records[${offset}].requirementCells must be an integer array`);
    }
    return { ...record, id, namespace, family, path };
  });

  return { version: index.version, sourceRevision, records };
}

const AUTHORED_FIELDS = {
  authored_base_revision: 'authoredBaseRevision', approval_revision: 'approvalRevision',
  approval_path: 'approvalPath', approval_version: 'approvalVersion', approval_sha256: 'approvalSha256',
  migration_id: 'migrationId', manifest_path: 'manifestPath', manifest_sha256: 'manifestSha256',
  row_sha256: 'rowSha256', statement_sha256: 'statementSha256', subject_anchor: 'subjectAnchor',
};

export const authoredProvenanceKeys = Object.freeze(Object.values(AUTHORED_FIELDS));

function validProvenancePath(value) {
  return typeof value === 'string' && /^docs\/(?:change-requests|migrations)\//.test(value)
    && !/[\\:\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

function validateAuthoredFields(record) {
  if (!['FR', 'SDD'].includes(record.family) || record.status !== 'active' || record.provenance !== 'authored') fail('authored records require FR/SDD, active lifecycle and authored provenance');
  if (record.sourcePath !== undefined || record.sourceRowSha256 !== undefined || record.sourceRevision !== undefined) fail('authored records cannot claim imported provenance');
  for (const key of authoredProvenanceKeys) requiredText(record[key], key);
  for (const key of ['authoredBaseRevision', 'approvalRevision']) if (!SHA1.test(record[key])) fail(`${key} must be a Git SHA-1`);
  for (const key of ['approvalSha256', 'manifestSha256', 'rowSha256', 'statementSha256']) if (!SHA256.test(record[key])) fail(`${key} must be a SHA-256`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(record.approvalVersion)) fail('approvalVersion must be semantic');
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(record.migrationId)) fail('invalid migration identity');
  if (!validProvenancePath(record.approvalPath) || !validProvenancePath(record.manifestPath)) fail('unsafe authored provenance path');
  if (record.manifestPath !== `docs/migrations/document-reintegration/record-migrations/${record.migrationId}.manifest.json`) fail('authored manifest path does not match migration identity');
  if (record.featureId !== undefined || JSON.stringify(record.requirementCells ?? []) !== '[]') fail('authored membership changes are unsupported');
}

function parseAuthoredRecord(fields, body, identity) {
  const allowed = new Set(['id', 'namespace', 'family', 'version', 'status', 'superseded_by', 'provenance', ...Object.keys(AUTHORED_FIELDS)]);
  for (const key of Object.keys(fields)) if (!allowed.has(key)) fail(`unsupported authored field: ${key}`);
  if (fields.superseded_by !== 'null') fail('active authored record must have superseded_by: null');
  const record = { ...identity, provenance: fields.provenance, requirementCells: [] };
  for (const [field, key] of Object.entries(AUTHORED_FIELDS)) record[key] = fields[field];
  validateAuthoredFields(record);
  const fences = [...body.matchAll(/<!-- canonical-row:start -->\r?\n```text\r?\n([^\r\n]*)\r?\n```\r?\n<!-- canonical-row:end -->/g)];
  if (fences.length !== 1 || (body.match(/<!-- canonical-row:start -->/g) ?? []).length !== 1) fail('authored record needs exactly one canonical row');
  const row = `${fences[0][1]}\n`;
  if (digest(row) !== record.rowSha256) fail('authored row hash does not match payload');
  const cells = splitRow(row);
  if (cells.length !== 5 || cells[0] !== '' || cells[4] !== '' || cells[1] !== record.id || cells[3] !== 'planned' || !cells[2]) fail('invalid authored identity/statement/lifecycle cells');
  if (digest(cells[2]) !== record.statementSha256) fail('authored statement hash does not match payload');
  return { ...record, row, cells, statement: cells[2], statementCell: 2, requirementKeys: [] };
}

const digest = value => createHash('sha256').update(value).digest('hex');

export function validateApprovalSource(text, version, sha256) {
  const fields = parseFrontmatter(text).fields;
  if (digest(text) !== sha256 || fields.status !== 'approved'
    || fields.version?.replace(/^["']|["']$/g, '') !== version) fail('authored approval provenance mismatch');
}

/** One identity/provenance comparison used by filesystem and snapshot readers. */
export function validateCanonicalEntry(record, entry, index) {
  const keys = ['id', 'namespace', 'family', 'recordVersion', 'status', 'statementCell', 'featureId'];
  if (record.recordVersion === 1) {
    keys.push('sourcePath', 'sourceRowSha256');
    if (record.sourceRevision !== index.sourceRevision) fail(`${record.id} source revision differs from index`);
  } else keys.push('provenance', ...authoredProvenanceKeys);
  for (const key of keys) if (record[key] !== entry[key]) fail(`${record.id} index ${key} does not match its canonical record`);
  if (JSON.stringify(record.requirementCells) !== JSON.stringify(entry.requirementCells ?? [])) fail(`${record.id} requirementCells differ`);
}

/** Authored provenance is backed by the exact source manifest and approved note. */
export function validateAuthoredProvenance(record, readSource) {
  if (record.recordVersion !== 2) return;
  const read = file => {
    const bytes = readSource(file);
    if (bytes === undefined || bytes === null) fail(`missing authored provenance: ${file}`);
    return bytes.toString().replace(/\r\n/g, '\n');
  };
  // An immutable copy proves the approved revision without freezing the live note.
  const approval = read(record.manifestPath.replace(/\.manifest\.json$/, '.approval.md'));
  validateApprovalSource(approval, record.approvalVersion, record.approvalSha256);
  const manifestText = read(record.manifestPath);
  if (digest(manifestText) !== record.manifestSha256) fail('authored manifest digest mismatch');
  const manifest = JSON.parse(manifestText);
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
  if (!keys(manifest, ['version', 'migrationId', 'base', 'approval', 'records'])
    || !keys(manifest.base, ['commit', 'indexSha256', 'ledgerSha256'])
    || !keys(manifest.approval, ['path', 'revision', 'version', 'sha256'])
    || !SHA256.test(manifest.base.indexSha256) || !SHA256.test(manifest.base.ledgerSha256)
    || !Array.isArray(manifest.records) || manifest.records.length < 1 || manifest.records.length > 4
    || manifest.records.some(item => !keys(item, ['id', 'family', 'statement', 'statementSha256', 'subjectAnchor']))
    || new Set(manifest.records.map(item => item.id)).size !== manifest.records.length) fail('invalid authored manifest schema');
  if (manifest.version !== 1 || manifest.migrationId !== record.migrationId || manifest.base?.commit !== record.authoredBaseRevision
    || manifest.approval?.revision !== record.approvalRevision || manifest.approval?.path !== record.approvalPath
    || manifest.approval?.version !== record.approvalVersion || manifest.approval?.sha256 !== record.approvalSha256) fail('authored manifest provenance mismatch');
  const items = manifest.records?.filter(item => item.id === record.id) ?? [];
  if (items.length !== 1 || items[0].family !== record.family || items[0].statement !== record.statement
    || items[0].statementSha256 !== record.statementSha256 || items[0].subjectAnchor !== record.subjectAnchor) fail('authored manifest subject mismatch');
  return manifest;
}
