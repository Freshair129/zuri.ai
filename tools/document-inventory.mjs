#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PINNED_REVISIONS = Object.freeze({
  ZAI: 'a34ceaf79c112e02b1bcfdbf0a84122d835b002e',
  ZNEXT: '8f3fa178f05567ae2c3863896d5a99cf6fd96d49',
});

const SCHEMA_VERSION = 1;
const MANIFEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../registry/document-reintegration');
const MANIFEST_FILES = Object.freeze({
  documents: 'documents.json',
  tooling: 'tooling.json',
  identities: 'identities.json',
  mappings: 'mappings.json',
  intake: 'intake.json',
});
const DISPOSITIONS_FILE = 'dispositions.json';
const DELTA_BASELINE_REVISION = '9e5b104e7763975ab994171a1941c246cf172a7a';
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc', '.txt']);
const TEXT_EXTENSIONS = new Set([
  ...DOCUMENT_EXTENSIONS,
  '.csv', '.json', '.toml', '.yaml', '.yml', '.html', '.htm', '.xml', '.sql', '.mmd',
]);
const ID_TOKEN = '(?:ZV2-CR|MI-RQ|[A-Z]{2,6}(?:-[A-Z]{2,6}){0,2})-\\d+(?:-\\d+)*(?:-P\\d+)?';
const VALID_ID = new RegExp(`^(?:${ID_TOKEN}|DOM-[A-Z][A-Z0-9]*)$`);
const CROSSWALK_DISPOSITIONS = new Set(['migrated', 'split', 'merged', 'retired', 'dropped']);
const TEXT_DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc', '.txt']);

function gitBuffer(repo, args, input) {
  return execFileSync('git', ['-C', repo, ...args], {
    input,
    encoding: null,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitText(repo, args) {
  return gitBuffer(repo, args).toString('utf8').trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceStatusClass(value) {
  if (value == null) return 'missing';
  const literal = value.toLowerCase();
  return ['approved', 'draft', 'proposed', 'retired', 'superseded'].includes(literal)
    ? `literal:${literal}`
    : 'other-literal';
}

function safeRepoPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value)
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

function assertRevision(repo, revision, namespace) {
  const resolved = gitText(repo, ['rev-parse', '--verify', `${revision}^{commit}`]);
  if (resolved !== revision) {
    throw new Error(`${namespace} revision must resolve exactly to ${revision}`);
  }
}

function readTree(repo, revision) {
  const output = gitBuffer(repo, ['ls-tree', '-r', '-z', '--full-tree', revision]).toString('utf8');
  const entries = new Map();
  for (const record of output.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (type === 'blob') entries.set(filePath, { mode, blob: oid, path: filePath });
  }
  return entries;
}

function readBlobs(repo, entries) {
  const ids = [...new Set([...entries.values()].map((entry) => entry.blob))].sort();
  if (ids.length === 0) return new Map();
  const output = gitBuffer(repo, ['cat-file', '--batch'], Buffer.from(`${ids.join('\n')}\n`, 'utf8'));
  const blobs = new Map();
  let offset = 0;
  while (offset < output.length) {
    const endHeader = output.indexOf(0x0a, offset);
    if (endHeader < 0) throw new Error('Invalid git cat-file --batch header');
    const [oid, type, sizeText] = output.subarray(offset, endHeader).toString('ascii').split(' ');
    const size = Number(sizeText);
    if (type !== 'blob' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Expected blob object, received ${oid} ${type} ${sizeText}`);
    }
    const bodyStart = endHeader + 1;
    const bodyEnd = bodyStart + size;
    if (bodyEnd >= output.length || output[bodyEnd] !== 0x0a) {
      throw new Error(`Invalid git cat-file --batch body for ${oid}`);
    }
    blobs.set(oid, output.subarray(bodyStart, bodyEnd));
    offset = bodyEnd + 1;
  }
  return blobs;
}

function loadSnapshot(repo, namespace, revision) {
  if (!repo) throw new Error(`Missing repository path for ${namespace}`);
  assertRevision(repo, revision, namespace);
  return { repo, namespace, revision, tree: readTree(repo, revision), blobs: new Map() };
}

function ensureBlobs(snapshot, paths) {
  const entries = new Map();
  for (const filePath of paths) {
    const entry = snapshot.tree.get(filePath);
    if (!entry) throw new Error(`${snapshot.namespace} source path is missing at pinned revision: ${filePath}`);
    entries.set(filePath, entry);
  }
  const missing = new Map([...entries.values()].filter((entry) => !snapshot.blobs.has(entry.blob)).map((entry) => [entry.path, entry]));
  if (missing.size) {
    const loaded = readBlobs(snapshot.repo, missing);
    for (const [oid, bytes] of loaded) snapshot.blobs.set(oid, bytes);
  }
  return entries;
}

function hasDocsSegment(filePath) {
  return filePath.split('/').includes('docs');
}

function isDocumentFile(filePath) {
  return hasDocsSegment(filePath) || DOCUMENT_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function sourceDisposition(namespace) {
  return namespace === 'ZAI' ? 'current-source' : 'incoming-review';
}

function frontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!item) continue;
    fields[item[1]] = item[2].replace(/^(?:"([^"]*)"|'([^']*)')$/, (_all, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  }
  return fields;
}

function fileKind(filePath) {
  const base = path.posix.basename(filePath);
  if (/^\.(?:doc-graph|preflight-report)\.json$/.test(base)) return 'generated-projection';
  const extension = path.posix.extname(filePath).toLowerCase();
  if (hasDocsSegment(filePath) && !TEXT_DOCUMENT_EXTENSIONS.has(extension)) return 'documentation-asset';
  if (/^docs\/changes\//.test(filePath)) return 'historical-change-record';
  if (/^docs\/change-requests\/(?:.*\/)?CR-\d+/i.test(filePath)) return 'proposal-intake';
  return 'document';
}

function fileRecord(snapshot, filePath) {
  const entry = snapshot.tree.get(filePath);
  const bytes = snapshot.blobs.get(entry.blob);
  const text = TEXT_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()) ? bytes.toString('utf8') : '';
  const meta = text ? frontMatter(text) : {};
  return {
    namespace: snapshot.namespace,
    revision: snapshot.revision,
    path: filePath,
    blob: entry.blob,
    sha256: sha256(bytes),
    extension: path.posix.extname(filePath).toLowerCase() || null,
    artifactKind: fileKind(filePath),
    sourceStatus: meta.status ?? null,
    disposition: sourceDisposition(snapshot.namespace),
    reviewStatus: 'not-reviewed',
  };
}

function isZaiToolingPath(filePath) {
  if (['AGENTS.md', 'CLAUDE.md', '.claude/AGENTS.md', 'docs/.id-ledger.json'].includes(filePath)) return true;
  if (filePath.startsWith('apps/edge/docs/registry/')) return true;
  if (['apps/edge/docs/.doc-graph.json', 'apps/edge/docs/.preflight-report.json'].includes(filePath)) return true;
  if (filePath.startsWith('.github/workflows/')) return true;
  if (['package.json', 'apps/server/package.json', 'scripts/build-llms-full.mjs', 'scripts/untracked-docs.mjs'].includes(filePath)) return true;
  const leaf = path.posix.basename(filePath).toLowerCase();
  const toolName = /(?:doc-(?:graph|preflight|links|identities)|id-(?:anchors|ledger|stability)|domain[-_]state|data[-_]pipeline|monorepo|edge[-_](?:graph|namespace)|roadmap|table[-_]integrity|governance[-_]source[-_]verifier|tests[-_]for|validate[-_]docs|generate[-_]views|change[-_]test[-_]selector|untracked[-_]docs)/i;
  if (!toolName.test(leaf)) return false;
  return /^(?:apps\/server\/(?:scripts|tests|src)\/|scripts\/|tests\/)/.test(filePath);
}

function isToolingPath(namespace, filePath) {
  if (namespace === 'ZNEXT') return filePath.startsWith('registry/') || filePath.startsWith('tools/') || ['AGENTS.md', 'CLAUDE.md'].includes(filePath);
  return isZaiToolingPath(filePath);
}

function idFamily(id) {
  if (id.startsWith('ZV2-CR-')) return 'ZV2-CR';
  if (id.startsWith('MI-RQ-')) return 'MI-RQ';
  const compoundFamily = id.match(/^([A-Z]{2,6}-[A-Z]{2,6})-\d/);
  if (compoundFamily) return compoundFamily[1];
  return id.split('-')[0];
}

function addDeclaration(candidateMap, id, locator) {
  if (!VALID_ID.test(id)) return;
  let record = candidateMap.get(id);
  if (!record) {
    record = { id, locators: new Map() };
    candidateMap.set(id, record);
  }
  const locatorKey = `${locator.path}\0${locator.declarationKind}`;
  if (!record.locators.has(locatorKey)) record.locators.set(locatorKey, locator);
}

function isParseableText(filePath) {
  return TEXT_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function declarationStatus(sectionText) {
  const match = sectionText.match(/^\s*\*\*Status:\*\*\s*([^\r\n]+)|^\s*Status:\s*([^\r\n]+)/m);
  return match ? (match[1] ?? match[2]).trim() : null;
}

function collectZnextDeclarations(snapshot, candidatePaths) {
  const candidateMap = new Map();
  for (const filePath of [...candidatePaths].sort()) {
    if (!isParseableText(filePath)) continue;
    const entry = snapshot.tree.get(filePath);
    const bytes = snapshot.blobs.get(entry.blob);
    const text = bytes.toString('utf8');
    const meta = frontMatter(text);
    const makeLocator = (declarationKind, sourceStatus = null) => ({
      path: filePath,
      blob: entry.blob,
      sha256: sha256(bytes),
      declarationKind,
      sourceStatus,
    });

    if (meta.id && VALID_ID.test(meta.id)) addDeclaration(candidateMap, meta.id, makeLocator('frontmatter-id', meta.status ?? null));

    const base = path.posix.basename(filePath);
    const fileId = base.match(new RegExp(`^(${ID_TOKEN})(?=[.-])`))?.[1];
    if (fileId) addDeclaration(candidateMap, fileId, makeLocator('filename-id', meta.status ?? null));

    if (filePath.startsWith('docs/features/') && /\/feature\.md$/i.test(filePath)) {
      const featureFolder = filePath.split('/').at(-2) ?? '';
      const folderId = featureFolder.match(/^(FEAT-\d+(?:-P\d+)?)(?:-|$)/)?.[1];
      if (folderId) addDeclaration(candidateMap, folderId, makeLocator('feature-folder-id', meta.status ?? null));
    }

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const heading = line.match(new RegExp(`^#{1,6}\\s+(${ID_TOKEN})(?=\\s|$|[—–:])`));
      if (heading) {
        const level = line.match(/^#+/)[0].length;
        let sectionEnd = lines.length;
        for (let next = index + 1; next < lines.length; next += 1) {
          const nextHeading = lines[next].match(/^(#+)\s/);
          if (nextHeading && nextHeading[1].length <= level) {
            sectionEnd = next;
            break;
          }
        }
        const status = declarationStatus(lines.slice(index + 1, sectionEnd).join('\n'));
        addDeclaration(candidateMap, heading[1], makeLocator('heading-id', status));
      }

      const acceptance = line.match(new RegExp(`^\\s*(?:[-*]\\s+)?(AC-\\d+(?:-\\d+){1,3})(?=\\s+[—–:-]|\\s*$)`));
      if (acceptance) addDeclaration(candidateMap, acceptance[1], makeLocator('acceptance-criterion-id'));
    }

    if (/^docs\/features\/[^/]+\/design\.md$/i.test(filePath)) {
      for (const match of text.matchAll(/\b(CMP-\d+)\b/g)) {
        addDeclaration(candidateMap, match[1], makeLocator('component-design-id'));
      }
    }

    if (filePath === 'registry/domains.yaml') {
      for (const match of text.matchAll(/^\s*-\s*code:\s*['"]?([A-Z][A-Z0-9]*)['"]?\s*$/gm)) {
        addDeclaration(candidateMap, `DOM-${match[1]}`, makeLocator('domain-registry-code'));
      }
    }
  }

  const identities = [];
  for (const record of candidateMap.values()) {
    const locators = [...record.locators.values()].sort((a, b) => a.path.localeCompare(b.path) || a.declarationKind.localeCompare(b.declarationKind));
    const primary = locators[0];
    identities.push({
      namespace: 'ZNEXT',
      id: record.id,
      family: idFamily(record.id),
      revision: snapshot.revision,
      path: primary.path,
      blob: primary.blob,
      sha256: primary.sha256,
      declarationKind: primary.declarationKind,
      declarations: locators,
      sourceStatus: primary.sourceStatus,
      disposition: 'incoming-review',
      reviewStatus: 'not-reviewed',
    });
  }
  return identities.sort(compareIdentity);
}

function compareIdentity(a, b) {
  return a.namespace.localeCompare(b.namespace) || a.id.localeCompare(b.id) || a.revision.localeCompare(b.revision);
}

function makeZaiIdentities(snapshot, ledgerPath) {
  const ledger = JSON.parse(snapshot.blobs.get(snapshot.tree.get(ledgerPath).blob).toString('utf8'));
  if (!ledger.ids || !Array.isArray(ledger.roster)) throw new Error('Invalid pinned zuri-ai ID ledger');
  const ledgerEntry = snapshot.tree.get(ledgerPath);
  const declarations = new Map();
  const ids = new Set([...ledger.roster, ...Object.keys(ledger.ids)]);
  for (const id of ids) {
    if (!VALID_ID.test(id)) throw new Error(`Invalid source identity in ZAI ledger: ${id}`);
    const source = ledger.ids[id];
    const sourcePath = source?.source && snapshot.tree.has(source.source) ? source.source : ledgerPath;
    const entry = snapshot.tree.get(sourcePath) ?? ledgerEntry;
    const bytes = snapshot.blobs.get(entry.blob);
    declarations.set(id, {
      namespace: 'ZAI',
      id,
      family: source?.family ?? idFamily(id),
      revision: snapshot.revision,
      path: sourcePath,
      blob: entry.blob,
      sha256: sha256(bytes),
      declarationKind: source?.source ? 'id-ledger-source' : 'id-ledger-roster',
      declarations: [{ path: sourcePath, blob: entry.blob, sha256: sha256(bytes), declarationKind: source?.source ? 'id-ledger-source' : 'id-ledger-roster', sourceStatus: source?.status ?? null }],
      sourceStatus: source?.status ?? 'roster-only',
      disposition: 'current-source',
      reviewStatus: 'not-reviewed',
    });
  }
  return [...declarations.values()].sort(compareIdentity);
}

function makeEdgeIdentities(snapshot, graphPath) {
  const graphEntry = snapshot.tree.get(graphPath);
  if (!graphEntry) return [];
  const graph = JSON.parse(snapshot.blobs.get(graphEntry.blob).toString('utf8'));
  const identities = new Map();
  for (const node of graph.nodes ?? []) {
    if (node.type !== 'requirement' || typeof node.label !== 'string' || !VALID_ID.test(node.label)) continue;
    const rawPath = typeof node.path === 'string' ? node.path.split('#')[0] : '';
    const filePath = rawPath && !rawPath.startsWith('/') ? `apps/edge/${rawPath}` : graphPath;
    const entry = snapshot.tree.get(filePath) ?? graphEntry;
    const bytes = snapshot.blobs.get(entry.blob);
    const declaration = {
      path: filePath,
      blob: entry.blob,
      sha256: sha256(bytes),
      declarationKind: 'edge-document-graph',
      sourceStatus: node.status ?? null,
    };
    const existing = identities.get(node.label);
    if (existing) {
      if (existing.path !== filePath) existing.declarations.push(declaration);
      continue;
    }
    identities.set(node.label, {
      namespace: 'edge',
      id: node.label,
      family: idFamily(node.label),
      revision: snapshot.revision,
      path: filePath,
      blob: entry.blob,
      sha256: sha256(bytes),
      declarationKind: 'edge-document-graph',
      declarations: [declaration],
      sourceStatus: node.status ?? null,
      disposition: 'current-source',
      reviewStatus: 'not-reviewed',
    });
  }
  return [...identities.values()].sort(compareIdentity);
}

function parseCsv(text, sourcePath) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      field = '';
      if (record.some((value) => value.trim() !== '')) records.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`Unclosed quoted CSV field in ${sourcePath}`);
  if (field.length || record.length) {
    record.push(field);
    if (record.some((value) => value.trim() !== '')) records.push(record);
  }
  if (records.length < 1) throw new Error(`Empty crosswalk CSV: ${sourcePath}`);
  const headers = records[0].map((header) => header.trim());
  for (const required of ['legacy_id', 'new_id', 'disposition']) {
    if (!headers.includes(required)) throw new Error(`Missing ${required} column in ${sourcePath}`);
  }
  return records.slice(1).map((values, index) => {
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? '']));
    const legacyId = row.legacy_id.trim();
    const targetId = row.new_id.trim() || null;
    const disposition = row.disposition.trim();
    if (!VALID_ID.test(legacyId)) throw new Error(`Invalid legacy_id at ${sourcePath} data row ${index + 1}`);
    if (targetId && !VALID_ID.test(targetId)) throw new Error(`Invalid new_id at ${sourcePath} data row ${index + 1}`);
    if (!CROSSWALK_DISPOSITIONS.has(disposition)) throw new Error(`Invalid disposition at ${sourcePath} data row ${index + 1}`);
    return { legacyId, targetId, disposition, row: index + 1 };
  });
}

function aggregateDisposition(rows) {
  if (rows.length === 0) return 'unmapped';
  const values = [...new Set(rows.map((row) => row.disposition))];
  return values.length === 1 ? values[0] : 'mixed';
}

function buildMappings(zai, znext, zaiIdentities, crosswalkPaths) {
  const zaiById = new Map(zaiIdentities.filter((identity) => identity.namespace === 'ZAI').map((identity) => [identity.id, identity]));
  const rowsBySource = new Map();
  let dataRows = 0;
  let blankTargets = 0;
  for (const filePath of crosswalkPaths.sort()) {
    const entry = znext.tree.get(filePath);
    const bytes = znext.blobs.get(entry.blob);
    const rows = parseCsv(bytes.toString('utf8'), filePath);
    dataRows += rows.length;
    for (const row of rows) {
      if (!zaiById.has(row.legacyId)) throw new Error(`Crosswalk source is not declared in the ZAI ledger: ${row.legacyId}`);
      if (row.targetId) {
        const key = `${znext.revision}\0${row.targetId}`;
        if (!znext.targetIdentityKeys.has(key)) throw new Error(`Crosswalk target lacks a ZNEXT declaration: ${row.targetId}`);
      } else {
        blankTargets += 1;
      }
      if (!rowsBySource.has(row.legacyId)) rowsBySource.set(row.legacyId, []);
      rowsBySource.get(row.legacyId).push({
        ...row,
        path: filePath,
        revision: znext.revision,
        blob: entry.blob,
        sha256: sha256(bytes),
      });
    }
  }

  const mappings = [];
  for (const [id, identity] of zaiById) {
    const rows = rowsBySource.get(id) ?? [];
    const targetIds = [...new Set(rows.map((row) => row.targetId).filter(Boolean))].sort();
    const provenance = rows.map((row) => ({
      path: row.path,
      revision: row.revision,
      blob: row.blob,
      sha256: row.sha256,
      row: row.row,
      targetId: row.targetId,
      sourceDisposition: row.disposition,
    }));
    mappings.push({
      source: { namespace: 'ZAI', id },
      sourceRevision: zai.revision,
      sourceLocator: { path: identity.path, blob: identity.blob, sha256: identity.sha256 },
      targetRevision: znext.revision,
      targets: targetIds.map((targetId) => ({ namespace: 'ZNEXT', id: targetId })),
      sourceDisposition: aggregateDisposition(rows),
      reviewStatus: 'not-reviewed',
      provenance,
    });
  }
  mappings.sort((a, b) => a.source.namespace.localeCompare(b.source.namespace) || a.source.id.localeCompare(b.source.id));
  return {
    mappings,
    crosswalkDataRows: dataRows,
    blankTargetRows: blankTargets,
    distinctCrosswalkSources: rowsBySource.size,
    unmappedSourceIds: [...zaiById.keys()].filter((id) => !rowsBySource.has(id)).length,
    multiTargetSources: mappings.filter((mapping) => mapping.targets.length > 1).length,
    splitSources: mappings.filter((mapping) => mapping.sourceDisposition === 'split').length,
    mixedDispositionSources: mappings.filter((mapping) => mapping.sourceDisposition === 'mixed').length,
  };
}

function makeIntake(snapshot, documentFiles) {
  const intake = [];
  for (const file of documentFiles) {
    if (file.namespace !== 'ZAI' || !/^docs\/change-requests\/(?:.*\/)?CR-\d+[^/]*$/i.test(file.path)) continue;
    const token = path.posix.basename(file.path).match(/^(CR-\d+)/i)?.[1] ?? null;
    intake.push({
      namespace: 'ZAI',
      sourceRevision: snapshot.revision,
      path: file.path,
      blob: file.blob,
      sha256: file.sha256,
      filenameToken: token,
      identity: null,
      disposition: 'proposal-intake',
      reviewStatus: 'not-reviewed',
    });
  }
  return intake.sort((a, b) => a.path.localeCompare(b.path));
}

function manifestEnvelope(kind, sources, arrayName, entries, summary = {}) {
  return { schemaVersion: SCHEMA_VERSION, sources, summary, [arrayName]: entries };
}

export function buildManifests({ zaiRepo, znextRepo, zaiRevision = PINNED_REVISIONS.ZAI, znextRevision = PINNED_REVISIONS.ZNEXT, enforcePins = true }) {
  if (enforcePins && zaiRevision !== PINNED_REVISIONS.ZAI) throw new Error(`ZAI revision must be pinned to ${PINNED_REVISIONS.ZAI}`);
  if (enforcePins && znextRevision !== PINNED_REVISIONS.ZNEXT) throw new Error(`ZNEXT revision must be pinned to ${PINNED_REVISIONS.ZNEXT}`);
  const zai = loadSnapshot(zaiRepo, 'ZAI', zaiRevision);
  const znext = loadSnapshot(znextRepo, 'ZNEXT', znextRevision);

  const zaiDocPaths = [...zai.tree.keys()].filter(isDocumentFile).sort();
  const znextDocPaths = [...znext.tree.keys()].filter(isDocumentFile).sort();
  const zaiToolingPaths = [...zai.tree.keys()].filter((filePath) => isToolingPath('ZAI', filePath)).sort();
  const znextToolingPaths = [...znext.tree.keys()].filter((filePath) => isToolingPath('ZNEXT', filePath)).sort();
  const ledgerPath = 'docs/.id-ledger.json';
  const edgeGraphPath = 'apps/edge/docs/.doc-graph.json';
  const crosswalkPaths = [...znext.tree.keys()].filter((filePath) => /^registry\/crosswalk\/[^/]+\.csv$/.test(filePath)).sort();

  const zaiPaths = new Set([...zaiDocPaths, ...zaiToolingPaths, ledgerPath, edgeGraphPath].filter((filePath) => zai.tree.has(filePath)));
  const znextPaths = new Set([...znextDocPaths, ...znextToolingPaths, ...crosswalkPaths].filter((filePath) => znext.tree.has(filePath)));
  ensureBlobs(zai, zaiPaths);
  ensureBlobs(znext, znextPaths);

  const documents = [
    ...zaiDocPaths.map((filePath) => fileRecord(zai, filePath)),
    ...znextDocPaths.map((filePath) => fileRecord(znext, filePath)),
  ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.path.localeCompare(b.path));
  const tooling = [
    ...zaiToolingPaths.map((filePath) => ({ ...fileRecord(zai, filePath), toolingKind: isZaiToolingPath(filePath) ? 'zai-governance-tooling' : 'tool' })),
    ...znextToolingPaths.map((filePath) => ({ ...fileRecord(znext, filePath), toolingKind: filePath.startsWith('registry/') ? 'source-registry' : filePath.startsWith('tools/') ? 'documentation-tool' : 'contributor-instructions' })),
  ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.path.localeCompare(b.path));

  const zaiIdentities = makeZaiIdentities(zai, ledgerPath);
  const znextDeclarationPaths = new Set([...znextDocPaths, ...znextToolingPaths]);
  const znextIdentities = collectZnextDeclarations(znext, znextDeclarationPaths);
  const edgeIdentities = makeEdgeIdentities(zai, edgeGraphPath);
  const identities = [...zaiIdentities, ...znextIdentities, ...edgeIdentities].sort(compareIdentity);
  znext.targetIdentityKeys = new Set(znextIdentities.map((identity) => `${identity.revision}\0${identity.id}`));

  const crosswalk = buildMappings(zai, znext, zaiIdentities, crosswalkPaths);
  const intake = makeIntake(zai, documents);
  const sources = [
    { namespace: 'ZAI', revision: zai.revision },
    { namespace: 'ZNEXT', revision: znext.revision },
  ];
  const docsUnderZai = zaiDocPaths.filter(hasDocsSegment).length;
  const docsUnderZnext = znextDocPaths.filter(hasDocsSegment).length;

  return {
    documents: manifestEnvelope('documents', sources, 'files', documents, {
      totalFiles: documents.length,
      zaiFiles: zaiDocPaths.length,
      znextFiles: znextDocPaths.length,
      zaiFilesUnderDocs: docsUnderZai,
      znextFilesUnderDocs: docsUnderZnext,
    }),
    tooling: manifestEnvelope('tooling', sources, 'tooling', tooling, {
      totalFiles: tooling.length,
      zaiFiles: zaiToolingPaths.length,
      znextFiles: znextToolingPaths.length,
    }),
    identities: manifestEnvelope('identities', sources, 'identities', identities, {
      totalIdentities: identities.length,
      zaiLedgerIdentities: zaiIdentities.length,
      znextDeclaredIdentities: znextIdentities.length,
      edgeNamespaceIdentities: edgeIdentities.length,
    }),
    mappings: manifestEnvelope('mappings', sources, 'mappings', crosswalk.mappings, {
      totalSources: crosswalk.mappings.length,
      crosswalkFiles: crosswalkPaths.length,
      crosswalkDataRows: crosswalk.crosswalkDataRows,
      distinctCrosswalkSources: crosswalk.distinctCrosswalkSources,
      unmappedSourceIds: crosswalk.unmappedSourceIds,
      blankTargetRows: crosswalk.blankTargetRows,
      multiTargetSources: crosswalk.multiTargetSources,
      splitSources: crosswalk.splitSources,
      mixedDispositionSources: crosswalk.mixedDispositionSources,
    }),
    intake: manifestEnvelope('intake', sources, 'intake', intake, {
      bareCrProposalFiles: intake.length,
    }),
  };
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function comparePathRecord(a, b) {
  return a.namespace.localeCompare(b.namespace) || a.path.localeCompare(b.path);
}

function assertSafeSourceRecord(record, context) {
  if (!safeRepoPath(record.path)) throw new Error(`${context} has an unsafe repository path`);
  if (!/^[0-9a-f]{40,64}$/i.test(record.blob ?? '')) throw new Error(`${context} has an invalid Git blob ID`);
  if (!/^[0-9a-f]{64}$/i.test(record.sha256 ?? '')) throw new Error(`${context} has an invalid SHA-256`);
}

export function validateManifests(manifests, { enforcePins = true } = {}) {
  let expectedPins;
  for (const [name, arrayName] of Object.entries({ documents: 'files', tooling: 'tooling', identities: 'identities', mappings: 'mappings', intake: 'intake' })) {
    const manifest = manifests[name];
    if (!manifest || manifest.schemaVersion !== SCHEMA_VERSION || !Array.isArray(manifest[arrayName])) {
      throw new Error(`Invalid ${name} manifest envelope`);
    }
    if (!Array.isArray(manifest.sources) || manifest.sources.length !== 2) throw new Error(`Invalid source pins in ${name} manifest`);
    const pins = Object.fromEntries(manifest.sources.map((source) => [source.namespace, source.revision]));
    if (!pins.ZAI || !pins.ZNEXT) throw new Error(`Invalid source pins in ${name} manifest`);
    if (enforcePins && (pins.ZAI !== PINNED_REVISIONS.ZAI || pins.ZNEXT !== PINNED_REVISIONS.ZNEXT)) throw new Error(`Unexpected source pins in ${name} manifest`);
    if (expectedPins && (pins.ZAI !== expectedPins.ZAI || pins.ZNEXT !== expectedPins.ZNEXT)) throw new Error('Source pins differ across manifests');
    expectedPins = pins;
  }

  const documents = manifests.documents.files;
  const tooling = manifests.tooling.tooling;
  const identities = manifests.identities.identities;
  const mappings = manifests.mappings.mappings;
  const intake = manifests.intake.intake;
  const sortCheck = (entries, compare, name) => {
    const sorted = [...entries].sort(compare);
    if (JSON.stringify(entries) !== JSON.stringify(sorted)) throw new Error(`${name} entries are not deterministically ordered`);
  };
  sortCheck(documents, comparePathRecord, 'Document');
  sortCheck(tooling, comparePathRecord, 'Tooling');
  sortCheck(identities, compareIdentity, 'Identity');
  sortCheck(mappings, (a, b) => a.source.namespace.localeCompare(b.source.namespace) || a.source.id.localeCompare(b.source.id), 'Mapping');
  sortCheck(intake, (a, b) => a.path.localeCompare(b.path), 'Intake');

  for (const entries of [documents, tooling]) {
    const fileKeys = new Set();
    for (const file of entries) {
    assertSafeSourceRecord(file, 'File entry');
    if (!['ZAI', 'ZNEXT'].includes(file.namespace)) throw new Error(`Invalid file namespace ${file.namespace}`);
    const key = `${file.namespace}\0${file.revision}\0${file.path}`;
    if (fileKeys.has(key)) throw new Error(`Duplicate file entry ${file.namespace}:${file.path}`);
    fileKeys.add(key);
    if (file.reviewStatus !== 'not-reviewed') throw new Error(`Unexpected file review status for ${file.path}`);
    }
  }

  const identityKeys = new Set();
  const identitiesByNamespace = new Map();
  for (const identity of identities) {
    assertSafeSourceRecord(identity, `Identity ${identity.namespace}:${identity.id}`);
    if (!['ZAI', 'ZNEXT', 'edge'].includes(identity.namespace) || !VALID_ID.test(identity.id)) throw new Error(`Invalid qualified identity ${identity.namespace}:${identity.id}`);
    if (!Array.isArray(identity.declarations) || identity.declarations.length === 0) throw new Error(`Identity lacks declaration provenance ${identity.namespace}:${identity.id}`);
    for (const locator of identity.declarations) assertSafeSourceRecord(locator, `Declaration ${identity.namespace}:${identity.id}`);
    const key = `${identity.namespace}\0${identity.id}\0${identity.revision}`;
    if (identityKeys.has(key)) throw new Error(`Duplicate qualified identity ${identity.namespace}:${identity.id}@${identity.revision}`);
    identityKeys.add(key);
    const expectedIdentityRevision = identity.namespace === 'edge' ? expectedPins.ZAI : expectedPins[identity.namespace];
    if (identity.revision !== expectedIdentityRevision) throw new Error(`Identity revision mismatch for ${identity.namespace}:${identity.id}`);
    if (!identitiesByNamespace.has(identity.namespace)) identitiesByNamespace.set(identity.namespace, new Map());
    identitiesByNamespace.get(identity.namespace).set(identity.id, identity);
    if (identity.reviewStatus !== 'not-reviewed') throw new Error(`Unexpected identity review status for ${identity.namespace}:${identity.id}`);
  }

  const zaiIdentities = identitiesByNamespace.get('ZAI') ?? new Map();
  const znextIdentities = identitiesByNamespace.get('ZNEXT') ?? new Map();
  const mappingKeys = new Set();
  let provenanceCount = 0;
  for (const mapping of mappings) {
    if (!mapping.source || mapping.source.namespace !== 'ZAI' || !zaiIdentities.has(mapping.source.id)) throw new Error(`Mapping source is not a ZAI identity: ${mapping.source?.id}`);
    if (mapping.sourceRevision !== expectedPins.ZAI || mapping.targetRevision !== expectedPins.ZNEXT) throw new Error(`Mapping revision pin mismatch for ${mapping.source.id}`);
    const sourceIdentity = zaiIdentities.get(mapping.source.id);
    if (mapping.sourceLocator.path !== sourceIdentity.path || mapping.sourceLocator.blob !== sourceIdentity.blob || mapping.sourceLocator.sha256 !== sourceIdentity.sha256) {
      throw new Error(`Mapping source locator mismatch for ${mapping.source.id}`);
    }
    const key = `${mapping.source.namespace}\0${mapping.source.id}`;
    if (mappingKeys.has(key)) throw new Error(`Duplicate mapping source ${mapping.source.namespace}:${mapping.source.id}`);
    mappingKeys.add(key);
    if (!Array.isArray(mapping.targets) || !Array.isArray(mapping.provenance)) throw new Error(`Invalid mapping arrays for ${mapping.source.id}`);
    if (mapping.reviewStatus !== 'not-reviewed') throw new Error(`Unreviewed mapping was promoted: ${mapping.source.id}`);
    const targetIds = [];
    for (const target of mapping.targets) {
      if (target.namespace !== 'ZNEXT' || !znextIdentities.has(target.id)) throw new Error(`Mapping target is undeclared: ${target.namespace}:${target.id}`);
      targetIds.push(target.id);
    }
    if (new Set(targetIds).size !== targetIds.length) throw new Error(`Duplicate target in mapping ${mapping.source.id}`);
    const provenanceTargets = [];
    for (const row of mapping.provenance) {
      assertSafeSourceRecord(row, `Crosswalk provenance for ${mapping.source.id}`);
      if (row.revision !== expectedPins.ZNEXT || !CROSSWALK_DISPOSITIONS.has(row.sourceDisposition)) throw new Error(`Invalid crosswalk provenance for ${mapping.source.id}`);
      if (row.targetId !== null) {
        if (!znextIdentities.has(row.targetId)) throw new Error(`Provenance target is undeclared: ${row.targetId}`);
        provenanceTargets.push(row.targetId);
      }
      if (!Number.isInteger(row.row) || row.row < 1) throw new Error(`Invalid crosswalk row ordinal for ${mapping.source.id}`);
      provenanceCount += 1;
    }
    if (JSON.stringify([...new Set(provenanceTargets)].sort()) !== JSON.stringify([...targetIds].sort())) {
      throw new Error(`Mapping target cardinality differs from preserved crosswalk rows for ${mapping.source.id}`);
    }
    if (mapping.sourceDisposition !== aggregateDisposition(mapping.provenance.map((row) => ({ disposition: row.sourceDisposition })))) {
      throw new Error(`Mapping disposition differs from preserved crosswalk rows for ${mapping.source.id}`);
    }
  }
  if (mappingKeys.size !== zaiIdentities.size) throw new Error('Mapping source coverage does not equal the pinned ZAI ledger');
  if (manifests.mappings.summary.crosswalkDataRows !== provenanceCount) throw new Error('Crosswalk row count differs from provenance[]');
  if (manifests.mappings.summary.totalSources !== mappings.length) throw new Error('Mapping count summary mismatch');
  if (manifests.mappings.summary.distinctCrosswalkSources + manifests.mappings.summary.unmappedSourceIds !== mappings.length) throw new Error('Crosswalk source accounting mismatch');
  if (manifests.identities.summary.zaiLedgerIdentities !== zaiIdentities.size) throw new Error('ZAI ledger identity count mismatch');
  if (manifests.documents.summary.totalFiles !== documents.length) throw new Error('Document file count summary mismatch');
  if (manifests.tooling.summary.totalFiles !== tooling.length) throw new Error('Tooling file count summary mismatch');

  for (const request of intake) {
    assertSafeSourceRecord(request, 'Intake entry');
    if (request.namespace !== 'ZAI' || request.identity !== null || request.disposition !== 'proposal-intake' || request.reviewStatus !== 'not-reviewed') {
      throw new Error(`Bare CR intake must remain a proposal without identity: ${request.path}`);
    }
    if (!/^docs\/change-requests\/(?:.*\/)?CR-\d+[^/]*$/i.test(request.path)) throw new Error(`Non-CR path in intake manifest: ${request.path}`);
  }
  if (manifests.intake.summary.bareCrProposalFiles !== intake.length) throw new Error('Intake file count summary mismatch');
  return {
    documents: documents.length,
    tooling: tooling.length,
    zaiIdentities: zaiIdentities.size,
    znextIdentities: znextIdentities.size,
    edgeIdentities: identitiesByNamespace.get('edge')?.size ?? 0,
    mappings: mappings.length,
    crosswalkRows: provenanceCount,
    intake: intake.length,
  };
}

function coverageMemberKey(record, includeId) {
  return [record.namespace, record.revision, ...(includeId ? [record.id] : []), record.path, record.blob, record.sha256].join('\0');
}

function coverageSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function validateDispositions(manifests, overlay) {
  if (!overlay || overlay.schemaVersion !== 1) throw new Error('Invalid dispositions overlay envelope');
  if (overlay.sources?.ZAI !== PINNED_REVISIONS.ZAI || overlay.sources?.ZNEXT !== PINNED_REVISIONS.ZNEXT) {
    throw new Error('Unexpected source pins in dispositions overlay');
  }
  if (overlay.baseline?.namespace !== 'ZAI' || overlay.baseline.revision !== DELTA_BASELINE_REVISION) {
    throw new Error('Unexpected development-delta baseline pin');
  }
  const policy = overlay.incomingPolicy;
  if (policy?.disposition !== 'provenance-only' || policy.semanticReview !== 'not-performed' || !policy.reason?.trim()) {
    throw new Error('Incoming policy must remain provenance-only and not semantically reviewed');
  }

  const expected = new Map();
  const addCoverage = (manifestName, records, selectorField, includeId = false) => {
    const groups = new Map();
    for (const record of records.filter((entry) => entry.namespace === 'ZNEXT')) {
      const discriminator = record[selectorField];
      const statusClass = sourceStatusClass(record.sourceStatus);
      const key = `${manifestName}\0${discriminator}\0${statusClass}`;
      if (!groups.has(key)) groups.set(key, { discriminator, statusClass, members: [] });
      groups.get(key).members.push(coverageMemberKey(record, includeId));
    }
    for (const [key, group] of groups) {
      expected.set(key, {
        manifest: manifestName,
        selector: { namespace: 'ZNEXT', [selectorField]: group.discriminator, statusClass: group.statusClass },
        count: group.members.length,
        membersSha256: sha256(Buffer.from(group.members.sort().join('\n'), 'utf8')),
      });
    }
  };
  addCoverage('documents.files', manifests.documents.files, 'artifactKind');
  addCoverage('tooling.tooling', manifests.tooling.tooling, 'toolingKind');
  addCoverage('identities.identities', manifests.identities.identities, 'family', true);

  if (!Array.isArray(policy.coverage)) throw new Error('Incoming policy lacks coverage groups');
  const seen = new Set();
  for (const group of policy.coverage) {
    const selector = group.selector;
    const discriminatorField = group.manifest === 'documents.files' ? 'artifactKind'
      : group.manifest === 'tooling.tooling' ? 'toolingKind'
        : group.manifest === 'identities.identities' ? 'family' : null;
    if (!discriminatorField || selector?.namespace !== 'ZNEXT' || typeof selector[discriminatorField] !== 'string' || typeof selector.statusClass !== 'string') {
      throw new Error(`Invalid disposition coverage selector: ${group.key}`);
    }
    const key = `${group.manifest}\0${selector[discriminatorField]}\0${selector.statusClass}`;
    if (seen.has(key)) throw new Error(`Duplicate disposition coverage selector: ${group.key}`);
    seen.add(key);
    const expectedGroup = expected.get(key);
    if (!expectedGroup) throw new Error(`Disposition coverage selector has no source records: ${group.key}`);
    const discriminator = selector[discriminatorField];
    const expectedKey = `${group.manifest}:${discriminator}:${selector.statusClass}`;
    const coverageKind = group.manifest === 'documents.files' ? 'document' : group.manifest === 'tooling.tooling' ? 'tooling' : 'identity';
    const expectedReasonCode = `${coverageKind}-${coverageSlug(discriminator)}-${coverageSlug(selector.statusClass)}`;
    if (group.key !== expectedKey || group.reasonCode !== expectedReasonCode) throw new Error(`Disposition reason does not match its family/status selector: ${group.key}`);
    if (group.count !== expectedGroup.count || group.membersSha256 !== expectedGroup.membersSha256) {
      throw new Error(`Disposition coverage differs from source inventory: ${group.key}`);
    }
    if (group.disposition !== 'provenance-only' || group.semanticReview !== 'not-performed') {
      throw new Error(`Incoming source was promoted beyond provenance-only: ${group.key}`);
    }
    if (!group.reasonCode?.trim() || !group.reason?.trim()) throw new Error(`Disposition coverage lacks a reason: ${group.key}`);
  }
  if (seen.size !== expected.size) throw new Error(`Disposition coverage is incomplete: expected ${expected.size} groups, found ${seen.size}`);

  const delta = overlay.developmentDelta;
  const reviews = delta?.reviews;
  if (!Array.isArray(reviews) || delta.summary?.total !== 23 || reviews.length !== 23) {
    throw new Error('Development-delta review must contain all 23 pinned document paths');
  }
  const paths = new Set();
  const sourceDocs = new Map(manifests.documents.files.filter((entry) => entry.namespace === 'ZAI').map((entry) => [entry.path, entry]));
  const sortedReviews = [...reviews].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(reviews) !== JSON.stringify(sortedReviews)) throw new Error('Development-delta reviews are not deterministically ordered');
  let modified = 0;
  let added = 0;
  for (const review of reviews) {
    if (!safeRepoPath(review.path) || paths.has(review.path)) throw new Error(`Invalid or duplicate development-delta path: ${review.path}`);
    paths.add(review.path);
    if (!['modified', 'added'].includes(review.changeType)) throw new Error(`Invalid development-delta change type: ${review.path}`);
    if (!['supplemented', 'historical-only', 'blocked'].includes(review.disposition) || review.authorityTreatment !== 'retain-current-ZAI-source') {
      throw new Error(`Invalid development-delta disposition: ${review.path}`);
    }
    if (review.current?.revision !== PINNED_REVISIONS.ZAI || review.baseline?.revision !== (review.changeType === 'added' ? undefined : DELTA_BASELINE_REVISION)) {
      throw new Error(`Development-delta revision mismatch: ${review.path}`);
    }
    const source = sourceDocs.get(review.path);
    if (!source || source.blob !== review.current.blob || source.sha256 !== review.current.sha256) {
      throw new Error(`Development-delta current locator mismatch: ${review.path}`);
    }
    if (review.changeType === 'added') added += 1;
    else modified += 1;
    if (review.sourceAnchor?.path !== review.path || !Number.isInteger(review.sourceAnchor.line) || review.sourceAnchor.line < 1 || !review.sourceAnchor.needle?.trim()) {
      throw new Error(`Development-delta source anchor is missing: ${review.path}`);
    }
    if (!review.summary?.trim() || !Array.isArray(review.evidence) || !review.evidence.length || !Array.isArray(review.limitations)) {
      throw new Error(`Development-delta review lacks evidence or limits: ${review.path}`);
    }
    for (const evidence of review.evidence) {
      if (!['code', 'test', 'config'].includes(evidence.kind) || !safeRepoPath(evidence.path) || !evidence.note?.trim()) {
        throw new Error(`Invalid development-delta evidence reference: ${review.path}`);
      }
    }
  }
  if (modified !== 20 || added !== 3 || delta.summary.modified !== modified || delta.summary.added !== added || delta.summary.deleted !== 0) {
    throw new Error('Development-delta change counts differ from pinned comparison');
  }
  return { coverageGroups: seen.size, incomingFiles: policy.coverage.filter((entry) => entry.manifest === 'documents.files').reduce((sum, entry) => sum + entry.count, 0), incomingTooling: policy.coverage.filter((entry) => entry.manifest === 'tooling.tooling').reduce((sum, entry) => sum + entry.count, 0), incomingIdentities: policy.coverage.filter((entry) => entry.manifest === 'identities.identities').reduce((sum, entry) => sum + entry.count, 0), deltaReviews: reviews.length };
}

function readManifestFiles(directory) {
  const result = {};
  for (const [key, fileName] of Object.entries(MANIFEST_FILES)) {
    result[key] = JSON.parse(readFileSync(path.join(directory, fileName), 'utf8'));
  }
  return result;
}

function readDispositions(directory) {
  return JSON.parse(readFileSync(path.join(directory, DISPOSITIONS_FILE), 'utf8'));
}

function writeManifestFiles(directory, manifests) {
  for (const [key, fileName] of Object.entries(MANIFEST_FILES)) {
    writeFileSync(path.join(directory, fileName), jsonText(manifests[key]), 'utf8');
  }
}

function validateSourceReferences(manifests, zaiRepo, znextRepo) {
  const snapshots = {
    ZAI: loadSnapshot(zaiRepo, 'ZAI', PINNED_REVISIONS.ZAI),
    ZNEXT: loadSnapshot(znextRepo, 'ZNEXT', PINNED_REVISIONS.ZNEXT),
  };
  const filePaths = { ZAI: new Set(), ZNEXT: new Set() };
  for (const entry of [...manifests.documents.files, ...manifests.tooling.tooling]) filePaths[entry.namespace].add(entry.path);
  for (const identity of manifests.identities.identities) {
    filePaths[identity.namespace === 'edge' ? 'ZAI' : identity.namespace].add(identity.path);
    for (const locator of identity.declarations) filePaths[identity.namespace === 'edge' ? 'ZAI' : identity.namespace].add(locator.path);
  }
  for (const mapping of manifests.mappings.mappings) {
    filePaths.ZAI.add(mapping.sourceLocator.path);
    for (const row of mapping.provenance) filePaths.ZNEXT.add(row.path);
  }
  for (const entry of manifests.intake.intake) filePaths.ZAI.add(entry.path);

  for (const namespace of ['ZAI', 'ZNEXT']) {
    const snapshot = snapshots[namespace];
    ensureBlobs(snapshot, filePaths[namespace]);
    for (const [key, fileName] of Object.entries(MANIFEST_FILES)) {
      const records = key === 'documents' ? manifests.documents.files
        : key === 'tooling' ? manifests.tooling.tooling
          : key === 'identities' ? manifests.identities.identities.filter((identity) => (identity.namespace === 'edge' ? 'ZAI' : identity.namespace) === namespace).flatMap((identity) => [identity, ...identity.declarations])
            : key === 'mappings' ? manifests.mappings.mappings.flatMap((mapping) => namespace === 'ZAI' ? [mapping.sourceLocator] : mapping.provenance)
              : manifests.intake.intake;
      for (const record of records) {
        const recordNamespace = record.namespace === 'edge' ? 'ZAI' : record.namespace;
        if (recordNamespace !== namespace) continue;
        const source = snapshot.tree.get(record.path);
        if (!source || source.blob !== record.blob || sha256(snapshot.blobs.get(source.blob)) !== record.sha256) {
          throw new Error(`Pinned source mismatch in ${fileName}: ${namespace}:${record.path}`);
        }
        if (record.revision && record.revision !== snapshot.revision) throw new Error(`Pinned source revision mismatch: ${namespace}:${record.path}`);
      }
    }
  }
  return true;
}

function validateDeltaSourceReferences(overlay, zaiRepo) {
  const current = loadSnapshot(zaiRepo, 'ZAI', PINNED_REVISIONS.ZAI);
  const baseline = loadSnapshot(zaiRepo, 'ZAI baseline', DELTA_BASELINE_REVISION);
  const sourceDiff = gitBuffer(zaiRepo, ['diff', '--name-status', DELTA_BASELINE_REVISION, PINNED_REVISIONS.ZAI, '--', 'docs']).toString('utf8').trim();
  const diffRows = sourceDiff ? sourceDiff.split(/\r?\n/).map((line) => {
    const [status, filePath] = line.split('\t');
    return { path: filePath, changeType: status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted' };
  }).sort((a, b) => a.path.localeCompare(b.path)) : [];
  const reviewedRows = overlay.developmentDelta.reviews.map(({ path: filePath, changeType }) => ({ path: filePath, changeType })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(diffRows) !== JSON.stringify(reviewedRows)) throw new Error('Development-delta review paths differ from the pinned ZAI documentation diff');
  for (const review of overlay.developmentDelta.reviews) {
    const currentEntry = current.tree.get(review.path);
    if (!currentEntry || currentEntry.blob !== review.current.blob) throw new Error(`Pinned delta source mismatch: ZAI:${review.path}`);
    ensureBlobs(current, [review.path]);
    const currentBytes = current.blobs.get(currentEntry.blob);
    if (sha256(currentBytes) !== review.current.sha256) throw new Error(`Pinned delta SHA-256 mismatch: ZAI:${review.path}`);
    const currentText = currentBytes.toString('utf8');
    const anchorIndex = currentText.toLowerCase().indexOf(review.sourceAnchor.needle.toLowerCase());
    if (anchorIndex < 0) throw new Error(`Development-delta source anchor is missing: ZAI:${review.path}`);
    const anchorLine = currentText.slice(0, anchorIndex).split(/\r?\n/).length;
    if (anchorLine !== review.sourceAnchor.line) throw new Error(`Development-delta source anchor moved: ZAI:${review.path}`);
    const baselineEntry = baseline.tree.get(review.path);
    if (review.baseline) {
      if (!baselineEntry || baselineEntry.blob !== review.baseline.blob) throw new Error(`Pinned delta baseline mismatch: ZAI:${review.path}`);
      ensureBlobs(baseline, [review.path]);
      if (sha256(baseline.blobs.get(baselineEntry.blob)) !== review.baseline.sha256) throw new Error(`Pinned delta baseline SHA-256 mismatch: ZAI:${review.path}`);
    } else if (baselineEntry) {
      throw new Error(`Added development-delta path already exists at baseline: ZAI:${review.path}`);
    }
    for (const evidence of review.evidence) {
      const found = current.tree.has(evidence.path) || [...current.tree.keys()].some((filePath) => filePath.startsWith(`${evidence.path.replace(/\/$/, '')}/`));
      if (!found) throw new Error(`Development-delta evidence path is missing: ZAI:${evidence.path}`);
    }
  }
  return true;
}

function printHelp() {
  process.stdout.write([
    'Usage:',
    '  node tools/document-inventory.mjs --generate --zai-repo <path> --znext-repo <path>',
    '  node tools/document-inventory.mjs --verify-sources --zai-repo <path> --znext-repo <path>',
    '  node tools/document-inventory.mjs --check',
  ].join('\n') + '\n');
}

function parseCli(argv) {
  const options = { mode: null, zaiRepo: null, znextRepo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--generate' || arg === '--verify-sources' || arg === '--check') {
      if (options.mode) throw new Error('Choose exactly one operation');
      options.mode = arg.slice(2);
    } else if (arg === '--zai-repo') {
      options.zaiRepo = argv[++i];
    } else if (arg === '--znext-repo') {
      options.znextRepo = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      options.mode = 'help';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.mode === 'help' || !options.mode) return printHelp();
  if (options.mode === 'check') {
    const manifests = readManifestFiles(MANIFEST_DIR);
    const counts = validateManifests(manifests);
    const dispositions = validateDispositions(manifests, readDispositions(MANIFEST_DIR));
    process.stdout.write(`Inventory check passed: ${JSON.stringify({ ...counts, dispositions })}\n`);
    return;
  }
  if (!options.zaiRepo || !options.znextRepo) throw new Error(`${options.mode} requires --zai-repo and --znext-repo`);
  const manifests = buildManifests({ zaiRepo: path.resolve(options.zaiRepo), znextRepo: path.resolve(options.znextRepo) });
  const counts = validateManifests(manifests);
  if (options.mode === 'generate') {
    writeManifestFiles(MANIFEST_DIR, manifests);
    process.stdout.write(`Inventory generated: ${JSON.stringify(counts)}\n`);
    return;
  }
  if (options.mode === 'verify-sources') {
    const committedManifests = readManifestFiles(MANIFEST_DIR);
    const overlay = readDispositions(MANIFEST_DIR);
    validateDispositions(committedManifests, overlay);
    validateSourceReferences(committedManifests, options.zaiRepo, options.znextRepo);
    validateDeltaSourceReferences(overlay, options.zaiRepo);
    for (const [key, fileName] of Object.entries(MANIFEST_FILES)) {
      if (jsonText(manifests[key]) !== readFileSync(path.join(MANIFEST_DIR, fileName), 'utf8')) {
        throw new Error(`Committed ${fileName} does not reproduce from pinned Git objects`);
      }
    }
    process.stdout.write(`Pinned source verification passed: ${JSON.stringify(counts)}\n`);
  }
}

const calledDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (calledDirectly) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`document-inventory: ${error.message}\n`);
    process.exitCode = 1;
  }
}
