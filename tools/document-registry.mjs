import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseCanonicalIndex, parseCanonicalRecord, splitRow } from '../apps/server/scripts/document-registry-format.mjs';

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
  return index.records.map((entry) => {
    const file = join(projectRoot, entry.path);
    if (!existsSync(file)) throw new Error(`Missing canonical record ${entry.path}`);
    const text = readFileSync(file, 'utf8');
    const record = parseCanonicalRecord(text);
    const recordDigest = sha256(Buffer.from(gitBlobText(text), 'utf8'));
    for (const [indexKey, recordKey] of [
      ['id', 'id'], ['namespace', 'namespace'], ['family', 'family'], ['sourcePath', 'sourcePath'],
      ['sourceRowSha256', 'sourceRowSha256'], ['recordVersion', 'recordVersion'], ['status', 'status'],
      ['statementCell', 'statementCell'], ['featureId', 'featureId'],
    ]) {
      if (entry[indexKey] !== record[recordKey]) throw new Error(`${entry.id} index ${indexKey} does not match its canonical record`);
    }
    if (JSON.stringify(entry.requirementCells ?? []) !== JSON.stringify(record.requirementCells)) throw new Error(`${entry.id} requirementCells do not match its canonical record`);
    if (verifyIndexHash && entry.recordSha256 !== recordDigest) throw new Error(`${entry.id} canonical record hash does not match index`);
    if (record.sourceRevision !== index.sourceRevision) throw new Error(`${entry.id} source revision differs from index`);
    return { ...entry, ...record, recordSha256: recordDigest };
  });
}

function buildIndex(records) {
  const entries = records.map((record) => ({
    id: record.id,
    namespace: record.namespace,
    family: record.family,
    recordVersion: 1,
    status: 'source-preserved',
    path: record.path,
    sourcePath: record.sourcePath,
    sourceRowSha256: record.sourceRowSha256,
    recordSha256: record.recordSha256,
    statementCell: record.statementCell,
    requirementCells: record.requirementCells,
    ...(record.featureId ? { featureId: record.featureId } : {}),
    exportDocument: record.exportDocument,
    exportOrder: record.exportOrder,
  }));
  return { version: 1, sourceRevision: SOURCE_REVISION, records: entries };
}

function renderExports(projectRoot, index, records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return TEMPLATE_PATHS.map((templatePath, i) => {
    const template = readFileSync(join(projectRoot, templatePath), 'utf8');
    const placeholders = [...template.matchAll(/\{\{CANONICAL_ROW:([^}]+)\}\}/g)].map((match) => match[1]);
    const expected = index.records.filter((record) => record.exportDocument === EXPORT_PATHS[i]).map((record) => record.id);
    if (new Set(placeholders).size !== placeholders.length || placeholders.length !== expected.length || expected.some((id) => !placeholders.includes(id))) {
      throw new Error(`${templatePath} placeholders do not match canonical records`);
    }
    const output = template.replace(/\{\{CANONICAL_ROW:([^}]+)\}\}/g, (_match, id) => {
      const record = byId.get(id);
      if (!record) throw new Error(`${templatePath} has unknown placeholder ${id}`);
      return record.row;
    });
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
  const index = buildIndex(outputs);
  writeFile(projectRoot, INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  const exports = renderExports(projectRoot, index, outputs);
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
  const nextIndex = buildIndex(records);
  const nextIndexText = `${JSON.stringify(nextIndex, null, 2)}\n`;
  if (check && nextIndexText !== indexText) throw new Error(`${INDEX_PATH} is stale; run --write`);
  const exports = renderExports(projectRoot, nextIndex, records);
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

const args = process.argv.slice(2);
if (args.length > 0 && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    if (args.length !== 1 || !['--adopt', '--write', '--check'].includes(args[0])) throw new Error('Usage: node tools/document-registry.mjs --adopt|--write|--check');
    if (args[0] === '--adopt') {
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
