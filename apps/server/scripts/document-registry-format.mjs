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
  if (recordVersion !== 1) fail('version must be 1');
  const status = requiredText(fields.status, 'status');
  if (!['source-preserved', 'reviewed-migration'].includes(status)) fail(`unsupported record status: ${status}`);
  if (namespace !== 'ZAI') fail(`active record namespace must be ZAI: ${namespace}`);
  if (!FAMILY_ID.test(id) || !FAMILIES.has(family) || !id.startsWith(`${family}-`)) {
    fail(`id ${id} does not match supported family ${family}`);
  }
  let sourceRevision;
  let migrationBaseRevision;
  let migrationDocument;
  if (status === 'source-preserved') {
    sourceRevision = requiredText(fields.source_revision, 'source_revision');
    if (!SHA1.test(sourceRevision)) fail('source_revision must be a full Git SHA-1');
    if (fields.migration_base_revision || fields.migration_document) fail('source-preserved records cannot declare migration provenance');
  } else {
    if (fields.source_revision) fail('reviewed-migration records must not claim source_revision provenance');
    migrationBaseRevision = requiredText(fields.migration_base_revision, 'migration_base_revision');
    if (!SHA1.test(migrationBaseRevision)) fail('migration_base_revision must be a full Git SHA-1');
    migrationDocument = requiredText(fields.migration_document, 'migration_document');
    if (!/^docs\/change-requests\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.md$/.test(migrationDocument)) {
      fail('migration_document must be a safe path under docs/change-requests');
    }
    if (family !== 'FR' || fields.feature_id) fail('reviewed-migration records currently support standalone FR records only');
  }
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
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(migrationBaseRevision ? { migrationBaseRevision, migrationDocument } : {}),
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
  if (typeof value !== 'string' || value === '' || value.includes('\\') || value.startsWith('/')) return false;
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
  if (index.version !== 1) fail(`unsupported index version: ${index.version}`);
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
    if (record.recordVersion !== 1) fail(`records[${offset}].recordVersion must be 1`);
    if (!['source-preserved', 'reviewed-migration'].includes(record.status)) fail(`records[${offset}].status is unsupported`);
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
    if (record.status === 'reviewed-migration') {
      if (typeof record.migrationBaseRevision !== 'string' || !SHA1.test(record.migrationBaseRevision)) {
        fail(`records[${offset}].migrationBaseRevision must be a full Git SHA-1`);
      }
      if (typeof record.migrationDocument !== 'string' || !/^docs\/change-requests\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.md$/.test(record.migrationDocument)) {
        fail(`records[${offset}].migrationDocument must be a safe path under docs/change-requests`);
      }
    } else if (record.migrationBaseRevision !== undefined || record.migrationDocument !== undefined) {
      fail(`records[${offset}] source-preserved record cannot declare migration provenance`);
    }
    return { ...record, id, namespace, family, path };
  });

  return { version: 1, sourceRevision, records };
}
