import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readCanonicalRegistry } from '../document-registry.mjs';
import { renderDocumentViews, writeDocumentViews } from '../generate-document-views.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const records = readCanonicalRegistry(ROOT);
const graph = JSON.parse(readFileSync(join(ROOT, 'docs/.doc-graph.json'), 'utf8'));

test('the default CLI invocation generates views without arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'zai-doc-view-cli-'));
  try {
    mkdirSync(join(root, 'tools'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'tools/generate-document-views.mjs'), readFileSync(join(ROOT, 'tools/generate-document-views.mjs')));
    writeFileSync(join(root, 'tools/document-registry.mjs'), `export const readCanonicalRegistry = () => ${JSON.stringify([{ id: 'FR-999', family: 'FR', recordVersion: 1, sourceRevision: 'a'.repeat(40) }])};\n`);
    writeFileSync(join(root, 'docs/.doc-graph.json'), JSON.stringify({ version: '2.0.0', nodes: [], edges: [] }));
    const result = spawnSync(process.execPath, [join(root, 'tools/generate-document-views.mjs')], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Generated 4 document views/);
    assert.ok(existsSync(join(root, 'docs/product/README.md')));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir())) && root.includes('zai-doc-view-cli-'));
    rmSync(root, { recursive: true, force: true });
  }
});

function generate(inputGraph = graph) {
  return renderDocumentViews({ root: ROOT, records, graph: inputGraph });
}

test('renders deterministic projections for canonical feature membership', () => {
  const outputs = generate();
  assert.equal(outputs.size, 96);
  assert.equal(outputs.get('docs/features/FEAT-001/design.md'), generate().get('docs/features/FEAT-001/design.md'));
  const migrated = records.find((record) => record.id === 'FR-278');
  assert.equal(migrated.status, 'reviewed-migration');
  assert.equal(migrated.registrySourceRevision, records.find((record) => record.status === 'source-preserved').sourceRevision);
  assert.match(migrated.migrationBaseRevision, /^[a-f0-9]{40}$/);
  assert.equal(migrated.migrationDocument, 'docs/change-requests/marketing/line-oa-sales-flow/RECORD-MIGRATION-AND-CRM-READ-PROPOSAL.md');

  const feature = records.find((record) => record.id === 'FEAT-001');
  const requirement = records.find((record) => record.id === 'FR-037');
  const design = outputs.get('docs/features/FEAT-001/design.md');
  assert.match(design, /^version: "1\.0\.0"$/m);
  assert.ok(design.includes(feature.statement));
  assert.ok(design.includes(requirement.statement));
  assert.ok(design.includes(requirement.cells.slice(1, -1).at(-1)));
  assert.match(design, /ZAI:FEAT-001 canonical record/);
  assert.match(design, /ZAI:FR-037 canonical record/);
  assert.match(design, /ADR-016-SQLITE-AUTHORITY-AND-MANAGED-LOCAL-FILE-WORKSPACE/);
  assert.match(design, /PRD-SDD-v1\.0\.md/);

  const plannedDesign = outputs.get('docs/features/FEAT-007/design.md');
  const plannedRequirement = records.find((record) => record.id === 'FR-082');
  assert.ok(plannedRequirement.cells.slice(1, -1).at(-1).includes('design only'));
  assert.ok(plannedDesign.includes(plannedRequirement.cells.slice(1, -1).at(-1)));

  const evidenceDesign = outputs.get('docs/features/FEAT-013/design.md');
  assert.match(evidenceDesign, /acceptance report/);
  assert.doesNotMatch(evidenceDesign, /\.brain\/reports/);
});

test('renders code and test graph bindings without asserting test results', () => {
  const verification = generate().get('docs/features/FEAT-001/verification.md');
  assert.match(verification, /Code paths — graph bindings/);
  assert.match(verification, /Test paths — graph bindings/);
  assert.match(verification, /tests\/unit\/project-file-service\.test\.js/);
  assert.match(verification, /src\/modules\/project-manager\/application\/project-file-service\.js/);
  assert.match(verification, /reports no test execution or pass result/);
  assert.match(verification, /not proof that a test ran, passed/);
});

test('all generated and hand-authored entrypoint links resolve in this checkout', () => {
  const outputs = generate();
  const authored = [
    'docs/README.md',
    'docs/migrations/document-reintegration/DIAGRAMS.md',
    'docs/migrations/document-reintegration/VIEW-CONTRACT.md',
  ].map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]);
  for (const [sourcePath, content] of [...outputs, ...authored]) {
    const prose = content.replace(/```[\s\S]*?```/g, '').replace(/(`+)[\s\S]*?\1/g, '');
    for (const [, href] of prose.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z]+:/i.test(href)) continue;
      const pathname = decodeURIComponent(href.split('#', 1)[0]);
      const target = resolve(ROOT, dirname(sourcePath), pathname);
      assert.ok(existsSync(target), `${sourcePath} links to missing ${href}`);
    }
  }
});

test('rebases source-relative statement links while preserving labels and external URLs', () => {
  const changedRecords = records.map((record) => record.id === 'FR-037'
    ? { ...record, statement: 'See [same source](#scope), [related](related/guide.md?mode=1#part), and [web](https://example.test/spec#part).' }
    : record);
  const design = renderDocumentViews({ root: ROOT, records: changedRecords, graph })
    .get('docs/features/FEAT-001/design.md');
  assert.ok(design.includes('[same source](../../PRD-SDD-v1.0.md#scope)'));
  assert.ok(design.includes('[related](../../related/guide.md?mode=1#part)'));
  assert.ok(design.includes('[web](https://example.test/spec#part)'));
});

test('rejects a graph whose feature membership differs from the canonical registry', () => {
  const changed = structuredClone(graph);
  changed.edges = changed.edges.filter((edge) => !(edge.from === 'feat:FEAT-001'
    && edge.to === 'req:FR-037'
    && edge.type === 'bundles'));
  assert.throws(() => generate(changed), /missing current bundles edge for FR-037/);
});

test('rejects stale code or test paths in current graph bindings', () => {
  const changed = structuredClone(graph);
  const edge = changed.edges.find((item) => item.to === 'req:FR-037' && item.type === 'verifies' && item.status === 'current');
  assert.ok(edge);
  const node = changed.nodes.find((item) => item.id === edge.from);
  assert.ok(node);
  node.path = 'tests/__missing_document_view_binding__.test.js';
  assert.throws(() => generate(changed), /Test binding graph path does not exist/);
});

test('writes deterministic files, verifies them read-only, and detects stale output', () => {
  const root = mkdtempSync(join(tmpdir(), 'zai-doc-views-'));
  try {
    const outputs = generate();
    assert.equal(writeDocumentViews(root, outputs), outputs.size);
    assert.equal(writeDocumentViews(root, outputs, true), outputs.size);
    const target = join(root, 'docs/features/FEAT-001/design.md');
    writeFileSync(target, `${readFileSync(target, 'utf8')}manual edit\n`);
    assert.throws(() => writeDocumentViews(root, outputs, true), /stale; run generator without --check/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
