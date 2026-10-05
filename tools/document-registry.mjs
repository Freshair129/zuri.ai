import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { anchor, sameAnchor } from '../apps/server/scripts/id-anchors.mjs';
import { reservedBranchIds } from '../apps/server/scripts/id-stability.mjs';
import { authoredProvenanceKeys, parseCanonicalIndex, parseCanonicalRecord, splitRow, validateCanonicalEntry, validateAuthoredProvenance } from '../apps/server/scripts/document-registry-format.mjs';

const SOURCE_REVISION = 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = 'registry/document-registry/index.json';
const TEMPLATE_PATHS = ['registry/document-registry/PRD-SDD-v1.0.template.md', 'registry/document-registry/FEATURES.template.md'];
const EXPORT_PATHS = ['docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'];
const FAMILIES = new Set(['FEAT', 'FR', 'NFR', 'BR', 'SEC', 'SDD']);
const ROW_ID = /^\|\s*(FEAT|FR|NFR|BR|SEC|SDD)-\d{3,}\s*\|/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function verifyApprovedMigrationDocument(projectRoot, migrationDocument) {
  const file = join(projectRoot, migrationDocument);
  if (!existsSync(file)) throw new Error(`Missing approved migration document ${migrationDocument}`);
  const text = readFileSync(file, 'utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter || !/^status:\s*["']?approved["']?\s*$/m.test(frontmatter[1])) {
    throw new Error(`${migrationDocument} must have status: approved in frontmatter`);
  }
  const body = text.slice(frontmatter[0].length);
  if (!/^##\s+(?:การอนุมัติ|Approval)\s*$/im.test(body)) {
    throw new Error(`${migrationDocument} must contain an explicit approval section`);
  }
}

function verifyMigrationBaseRevision(projectRoot, revision) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', revision, 'HEAD'], {
      cwd: projectRoot, windowsHide: true, stdio: 'ignore',
    });
  } catch {
    throw new Error(`migration_base_revision ${revision} must be an ancestor of HEAD`);
  }
}

function gitBlobText(value) {
  return value.replace(/\r\n/g, '\n');
}

function lineParts(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function sourceEol(row) {
  return row.endsWith('\r\n') ? 'CRLF' : 'LF';
}

function sourceRowWithoutEol(row) {
  return row.replace(/\r?\n$/, '');
}

function rowId(row) {
  const match = row.match(ROW_ID);
  return match ? match[0].match(/(FEAT|FR|NFR|BR|SEC|SDD)-\d{3,}/)[0] : undefined;
}

function ledgerAnchor(ledger, id, sourcePath) {
  const record = ledger.ids?.[id];
  if (!record || record.source !== sourcePath || record.family !== id.split('-')[0]) {
    throw new Error(`${id} is absent from the pinned ID ledger or its family/source differs`);
  }
  return record.history?.at(-1)?.anchor;
}

function extractRows(projectRoot) {
  const pinned = (file) => execFileSync('git', ['--no-replace-objects', 'cat-file', 'blob', `${SOURCE_REVISION}:${file}`],
    { cwd: projectRoot, windowsHide: true, encoding: null, maxBuffer: 16 * 1024 * 1024 });
  const ledger = JSON.parse(pinned('docs/.id-ledger.json').toString('utf8'));
  const collected = [];
  const sourceFiles = ['docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'];
  const seen = new Set();
  for (const sourcePath of sourceFiles) {
    const sourceBytes = pinned(sourcePath);
    if (!readFileSync(join(projectRoot, sourcePath)).equals(sourceBytes)) {
      throw new Error(`${sourcePath} differs from the pinned migration source; --adopt cannot relabel new content as historical provenance`);
    }
    const content = sourceBytes.toString('utf8');
    const rows = lineParts(content).filter((line) => ROW_ID.test(line));
    for (const [exportOrder, row] of rows.entries()) {
      const id = rowId(row);
      if (!id || !FAMILIES.has(id.split('-')[0])) throw new Error(`Unclassified registry row: ${row}`);
      if (seen.has(id)) throw new Error(`Duplicate declaration in legacy registries: ${id}`);
      seen.add(id);
      const cells = splitRow(row);
      if (cells[1] !== id || cells.length < 4) throw new Error(`${id} has an invalid table row`);
      const family = id.split('-')[0];
      const expectedSource = family === 'FEAT' ? 'docs/FEATURES.md' : 'docs/PRD-SDD-v1.0.md';
      if (sourcePath !== expectedSource) throw new Error(`${id} is declared in unexpected source ${sourcePath}`);
      collected.push({
        id,
        namespace: 'ZAI',
        family,
        status: 'source-preserved',
        path: '',
        sourcePath,
        sourceRevision: SOURCE_REVISION,
        row,
        sourceRowEol: sourceEol(row),
        sourceRowSha256: sha256(Buffer.from(row, 'utf8')),
        statementCell: 2,
        requirementCells: family === 'FEAT' ? [3] : [],
        requirementKeys: family === 'FEAT' ? parseFeatureList(cells[3], id) : [],
        exportDocument: sourcePath,
        exportOrder,
        subjectAnchor: ledgerAnchor(ledger, id, sourcePath),
      });
    }
  }
  const byId = new Map(collected.map((record) => [record.id, record]));
  for (const feature of collected.filter((record) => record.family === 'FEAT')) {
    for (const requirementId of feature.requirementKeys) {
      const requirement = byId.get(requirementId);
      if (!requirement || requirement.family !== 'FR') throw new Error(`${feature.id} references missing ${requirementId}`);
      if (requirement.featureId) throw new Error(`${requirementId} is listed by more than one feature`);
      requirement.featureId = feature.id;
    }
  }
  for (const record of collected) {
    if (record.family === 'FEAT') record.path = `docs/features/${record.id}/feature.md`;
    else if (record.family === 'FR' && record.featureId) record.path = `docs/features/${record.featureId}/requirements/${record.id}.md`;
    else record.path = `docs/requirements/${record.id}.md`;
  }
  return { collected, sourceFiles };
}

function parseFeatureList(value, featureId) {
  const keys = value === '' || value === '—' ? [] : value.split(/\s*,\s*/);
  if (keys.some((key) => !/^FR-\d{3,}$/.test(key))) throw new Error(`${featureId} has malformed FR membership`);
  if (new Set(keys).size !== keys.length) throw new Error(`${featureId} repeats an FR membership`);
  return keys;
}

function canonicalMarkdown(record) {
  const fields = [
    '---',
    `id: ${record.id}`,
    `namespace: ${record.namespace}`,
    `family: ${record.family}`,
    'version: 1',
    'status: source-preserved',
    `source_revision: ${record.sourceRevision}`,
    `source_path: ${record.sourcePath}`,
    `source_row_eol: ${record.sourceRowEol}`,
    `source_row_sha256: ${record.sourceRowSha256}`,
    `statement_cell: ${record.statementCell}`,
    `requirement_cells: ${JSON.stringify(record.requirementCells)}`,
  ];
  if (record.featureId) fields.push(`feature_id: ${record.featureId}`);
  if (record.subjectAnchor) fields.push(`subject_anchor: ${record.subjectAnchor}`);
  fields.push('---', '', `# ZAI:${record.id}`, '', '<!-- canonical-row:start -->', '```text', sourceRowWithoutEol(record.row), '```', '<!-- canonical-row:end -->', '');
  return fields.join('\n');
}

function buildTemplate(sourceText, sourcePath, records) {
  const byId = new Map(records.filter((record) => record.sourcePath === sourcePath).map((record) => [record.id, record]));
  return lineParts(sourceText).map((line) => {
    const id = rowId(line);
    if (!id) return line;
    const record = byId.get(id);
    if (!record) throw new Error(`No canonical record for ${id}`);
    return `{{CANONICAL_ROW:${id}}}`;
  }).join('');
}

function loadRecords(projectRoot, index, { verifyIndexHash = true } = {}) {
  const ledgerPath = join(projectRoot, 'docs/.id-ledger.json');
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
  const reservations = reservedBranchIds(ledger);
  if ([...reservations].some(id => !(ledger.reserved_ids || []).includes(id))) throw new Error('Historical reservation inventory was removed');
  const records = index.records.map((entry) => {
    if (reservations.has(entry.id)) throw new Error(`${entry.id} reuses a historical branch reservation`);
    const file = join(projectRoot, entry.path);
    if (!existsSync(file)) throw new Error(`Missing canonical record ${entry.path}`);
    const text = readFileSync(file, 'utf8');
    const record = parseCanonicalRecord(text);
    const recordDigest = sha256(Buffer.from(gitBlobText(text), 'utf8'));
    validateCanonicalEntry(record, entry, index);
    validateAuthoredProvenance(record, file => readFileSync(join(projectRoot, file)));
    if (verifyIndexHash && entry.recordSha256 !== recordDigest) throw new Error(`${entry.id} canonical record hash does not match index`);
    if (record.status === 'reviewed-migration') verifyApprovedMigrationDocument(projectRoot, record.migrationDocument);
    return { ...entry, ...record, registrySourceRevision: index.sourceRevision, recordSha256: recordDigest };
  });
  const byId = new Map(records.map(record => [record.id, record]));
  const memberships = new Map();
  for (const feature of records.filter(record => record.family === 'FEAT')) {
    for (const id of feature.requirementKeys) {
      if (byId.get(id)?.family !== 'FR' || memberships.has(id)) throw new Error(`${feature.id} has invalid or duplicate membership for ${id}`);
      memberships.set(id, feature.id);
    }
  }
  for (const record of records.filter(record => record.family === 'FR')) {
    if (record.featureId !== memberships.get(record.id)) throw new Error(`${record.id} feature membership differs from its explicit FEAT row`);
  }
  return records;
}

function buildIndex(projectRoot, records, templateOverrides = new Map()) {
  return buildCanonicalIndex(records, projectRoot, templateOverrides);
}

export function buildCanonicalIndex(records, projectRoot = ROOT, templateOverrides = new Map()) {
  const exportOrders = new Map();
  for (let i = 0; i < TEMPLATE_PATHS.length; i += 1) {
    const templatePath = TEMPLATE_PATHS[i];
    const template = templateOverrides.get(templatePath) ?? readFileSync(join(projectRoot, templatePath), 'utf8');
    const placeholders = [...template.matchAll(/\{\{CANONICAL_ROW:([^}]+)\}\}/g)].map((match) => match[1]);
    placeholders.forEach((id, exportOrder) => exportOrders.set(id, exportOrder));
  }
  for (const record of records) {
    if (record.recordVersion !== 2 && !exportOrders.has(record.id)) throw new Error(`${record.id} has no canonical projection slot`);
  }
  for (const document of EXPORT_PATHS) {
    let next = records.filter(record => record.recordVersion !== 2 && record.exportDocument === document).length;
    for (const record of records.filter(record => record.recordVersion === 2 && record.exportDocument === document)
      .sort((a, b) => a.exportOrder - b.exportOrder || a.id.localeCompare(b.id))) exportOrders.set(record.id, next++);
  }
  const entries = records.map((record) => ({
    id: record.id,
    namespace: record.namespace,
    family: record.family,
    recordVersion: record.recordVersion ?? 1,
    status: record.status ?? 'source-preserved',
    path: record.path,
    ...(record.recordVersion === 2
      ? { provenance: 'authored', ...Object.fromEntries(authoredProvenanceKeys.map(key => [key, record[key]])) }
      : { sourcePath: record.sourcePath, sourceRowSha256: record.sourceRowSha256 }),
    recordSha256: record.recordSha256,
    statementCell: record.statementCell,
    requirementCells: record.requirementCells,
    ...(record.featureId ? { featureId: record.featureId } : {}),
    exportDocument: record.exportDocument,
    exportOrder: exportOrders.get(record.id),
    ...(record.migrationBaseRevision ? { migrationBaseRevision: record.migrationBaseRevision } : {}),
    ...(record.migrationDocument ? { migrationDocument: record.migrationDocument } : {}),
  }));
  return { version: records.some(record => record.recordVersion === 2) ? 2 : 1, sourceRevision: SOURCE_REVISION, records: entries };
}

const renderExports = (...args) => renderCanonicalExports(...args);

export function renderCanonicalExports(projectRoot, index, records, templateOverrides = new Map()) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return TEMPLATE_PATHS.map((templatePath, i) => {
    const template = templateOverrides.get(templatePath) ?? readFileSync(join(projectRoot, templatePath), 'utf8');
    const placeholders = [...template.matchAll(/\{\{CANONICAL_ROW:([^}]+)\}\}/g)].map((match) => match[1]);
    const expected = index.records.filter((record) => record.exportDocument === EXPORT_PATHS[i] && record.recordVersion !== 2)
      .sort((a, b) => a.exportOrder - b.exportOrder).map((record) => record.id);
    if (new Set(placeholders).size !== placeholders.length || placeholders.length !== expected.length ||
        placeholders.some((id, offset) => id !== expected[offset])) {
      throw new Error(`${templatePath} placeholders do not match canonical records`);
    }
    let output = template.replace(/\{\{CANONICAL_ROW:([^}]+)\}\}/g, (_match, id) => {
      const record = byId.get(id);
      if (!record) throw new Error(`${templatePath} has unknown placeholder ${id}`);
      return record.row;
    });
    const authored = index.records.filter(record => record.exportDocument === EXPORT_PATHS[i] && record.recordVersion === 2)
      .sort((a, b) => a.exportOrder - b.exportOrder).map(entry => byId.get(entry.id));
    if (authored.length) output += `\n\n## Authored records\n\n| ID | Statement | Status |\n|---|---|---|\n${authored.map(record => record.row).join('')}`;
    return { path: EXPORT_PATHS[i], output };
  });
}

function writeFile(projectRoot, relativePath, content) {
  const destination = join(projectRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content, 'utf8');
}

function adopt(projectRoot) {
  const existingIndexPath = join(projectRoot, INDEX_PATH);
  if (existsSync(existingIndexPath)) {
    const existingIndex = parseCanonicalIndex(readFileSync(existingIndexPath, 'utf8'));
    if (existingIndex.sourceRevision !== SOURCE_REVISION) throw new Error('--adopt is only valid for the pinned initial migration');
  }
  const { collected } = extractRows(projectRoot);
  const outputs = [];
  for (const record of collected) {
    const markdown = canonicalMarkdown(record);
    const parsed = parseCanonicalRecord(markdown);
    if (parsed.id !== record.id || parsed.row !== record.row) throw new Error(`${record.id} failed canonical round-trip`);
    const existingRecord = join(projectRoot, record.path);
    if (existsSync(existingRecord) && readFileSync(existingRecord, 'utf8') !== markdown) throw new Error(`${record.path} already exists with different content`);
    writeFile(projectRoot, record.path, markdown);
    outputs.push({ ...record, recordSha256: sha256(Buffer.from(gitBlobText(markdown), 'utf8')) });
  }
  const sources = ['docs/PRD-SDD-v1.0.md', 'docs/FEATURES.md'];
  for (let i = 0; i < sources.length; i += 1) {
    const source = readFileSync(join(projectRoot, sources[i]), 'utf8');
    const template = buildTemplate(source, sources[i], collected);
    const existingTemplate = join(projectRoot, TEMPLATE_PATHS[i]);
    writeFile(projectRoot, TEMPLATE_PATHS[i], template);
  }
  const index = buildIndex(projectRoot, outputs);
  writeFile(projectRoot, INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  const exports = renderCanonicalExports(projectRoot, index, outputs);
  for (const output of exports) {
    const original = readFileSync(join(projectRoot, output.path), 'utf8');
    if (output.output !== original) throw new Error(`${output.path} is not byte-identical after canonical adoption`);
    writeFile(projectRoot, output.path, output.output);
  }
  return outputs.length;
}

export function writeCanonicalProjections(projectRoot = ROOT, { check = false } = {}) {
  const indexText = readFileSync(join(projectRoot, INDEX_PATH), 'utf8');
  const index = parseCanonicalIndex(indexText);
  const records = loadRecords(projectRoot, index, { verifyIndexHash: check });
  const nextIndex = buildIndex(projectRoot, records);
  const nextIndexText = `${JSON.stringify(nextIndex, null, 2)}\n`;
  if (check && nextIndexText !== indexText) throw new Error(`${INDEX_PATH} is stale; run --write`);
  const exports = renderCanonicalExports(projectRoot, nextIndex, records);
  for (const output of exports) {
    const existing = readFileSync(join(projectRoot, output.path), 'utf8');
    if (check && output.output !== existing) throw new Error(`${output.path} is stale; run --write`);
    if (!check) writeFile(projectRoot, output.path, output.output);
  }
  if (!check) writeFile(projectRoot, INDEX_PATH, nextIndexText);
  return records;
}

export function readCanonicalRegistry(projectRoot = ROOT) {
  const index = parseCanonicalIndex(readFileSync(join(projectRoot, INDEX_PATH), 'utf8'));
  return loadRecords(projectRoot, index);
}

export function registerReviewedRecord(projectRoot = ROOT, candidatePath) {
  const relativePath = String(candidatePath || '').replace(/\\/g, '/');
  if (!/^docs\/requirements\/FR-\d{3,}\.md$/.test(relativePath)) {
    throw new Error('Reviewed registration accepts standalone FR records at docs/requirements/FR-nnn.md only');
  }
  const index = parseCanonicalIndex(readFileSync(join(projectRoot, INDEX_PATH), 'utf8'));
  const records = loadRecords(projectRoot, index);
  const file = join(projectRoot, relativePath);
  if (!existsSync(file)) throw new Error(`Missing canonical record ${relativePath}`);
  const candidateText = readFileSync(file, 'utf8');
  const candidate = parseCanonicalRecord(candidateText);
  if (candidate.status !== 'reviewed-migration') throw new Error(`${candidate.id} must use status: reviewed-migration`);
  if (relativePath !== `docs/requirements/${candidate.id}.md`) throw new Error(`${candidate.id} canonical path does not match its ID`);
  if (candidate.sourcePath !== 'docs/PRD-SDD-v1.0.md' || candidate.featureId) {
    throw new Error(`${candidate.id} must target the PRD as a standalone functional requirement`);
  }
  if (records.some((record) => record.id === candidate.id || record.path === relativePath)) {
    throw new Error(`${candidate.id} or ${relativePath} is already registered`);
  }

  const ledger = JSON.parse(readFileSync(join(projectRoot, 'docs/.id-ledger.json'), 'utf8'));
  if (ledger.ids?.[candidate.id] || ledger.roster?.includes(candidate.id) || reservedBranchIds(ledger).has(candidate.id)) {
    throw new Error(`${candidate.id} is already pinned or previously used in the ID ledger`);
  }
  const candidateAnchor = anchor(candidate.statement);
  for (const [id, entry] of Object.entries(ledger.ids || {})) {
    if (entry.family !== candidate.family) continue;
    const pinnedAnchor = entry.history?.at(-1)?.anchor;
    if (sameAnchor(candidateAnchor, pinnedAnchor)) throw new Error(`${candidate.id} inherits the pinned subject of ${id}`);
  }
  verifyApprovedMigrationDocument(projectRoot, candidate.migrationDocument);
  verifyMigrationBaseRevision(projectRoot, candidate.migrationBaseRevision);

  const templatePath = TEMPLATE_PATHS[0];
  const template = readFileSync(join(projectRoot, templatePath), 'utf8');
  const matches = [...template.matchAll(/\{\{CANONICAL_ROW:FR-\d{3,}\}\}/g)];
  if (!matches.length) throw new Error(`${templatePath} has no functional-requirement projection slot`);
  const slot = `{{CANONICAL_ROW:${candidate.id}}}`;
  if (template.includes(slot)) throw new Error(`${candidate.id} already has a projection slot`);
  const last = matches.at(-1);
  const end = last.index + last[0].length;
  const nextTemplate = `${template.slice(0, end)}${slot}${template.slice(end)}`;
  const recordDigest = sha256(Buffer.from(gitBlobText(candidateText), 'utf8'));
  const addedRecord = {
    ...candidate,
    path: relativePath,
    recordSha256: recordDigest,
    exportDocument: candidate.sourcePath,
  };
  const nextRecords = [...records, addedRecord];
  const templateOverrides = new Map([[templatePath, nextTemplate]]);
  const nextIndex = buildIndex(projectRoot, nextRecords, templateOverrides);
  const indexText = `${JSON.stringify(nextIndex, null, 2)}\n`;
  const exports = renderExports(projectRoot, nextIndex, nextRecords, templateOverrides);

  writeFile(projectRoot, templatePath, nextTemplate);
  writeFile(projectRoot, INDEX_PATH, indexText);
  for (const output of exports) writeFile(projectRoot, output.path, output.output);
  return candidate.id;
}

const args = process.argv.slice(2);
if (args.length > 0 && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    if (args[0] === '--register-reviewed') {
      if (args.length !== 2) throw new Error('Usage: node tools/document-registry.mjs --register-reviewed <canonical-record-path>');
      console.log(`Registered reviewed record ZAI:${registerReviewedRecord(ROOT, args[1])}.`);
    } else if (args.length !== 1 || !['--adopt', '--write', '--check'].includes(args[0])) {
      throw new Error('Usage: node tools/document-registry.mjs --adopt|--write|--check|--register-reviewed <canonical-record-path>');
    } else if (args[0] === '--adopt') {
      console.log(`Adopted ${adopt(ROOT)} canonical records.`);
    } else {
      const records = writeCanonicalProjections(ROOT, { check: args[0] === '--check' });
      console.log(`${args[0] === '--check' ? 'Verified' : 'Wrote'} ${records.length} canonical records and compatibility projections.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
