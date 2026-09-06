import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { runIngest, decide, SCHEMA_VERSION, type IngestDb, type IngestManifest, type IngestPaths } from '../../src/rag/v4/ingest.js';
import { embeddableNodes, buildGraphV4 } from '../../src/rag/v4/build-graph.js';
import { parseFlowAccountRows, type FlowAccountRow } from '../../src/rag/v4/flowaccount.js';
import { loadCategoryGroupMap, loadTypeAliases, CATEGORY_MAP_FILE, TYPE_ALIASES_FILE } from '../../src/rag/v4/config.js';
import type { EmbedClient } from '../../src/rag/v4/embed-client.js';

const identityFixture = new URL('../fixtures/v4/identity-mini.json', import.meta.url);
const catalogFixture = new URL('../fixtures/v4/catalog-mini.json', import.meta.url);
const flowaccountRowsFixture = new URL('../fixtures/v4/flowaccount-rows-mini.json', import.meta.url);

const HEADER = ['BarCode', 'ProductCode', 'Name', 'Unit', 'Category', 'Description', 'UnitPrice', 'UnitPriceWithVat', 'BuyPrice', 'BuyPriceWithVat'];

async function writeFlowAccountXlsx(destPath: string, rows: FlowAccountRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('products');
  ws.getRow(1).values = ['ignored'];
  ws.getRow(2).values = ['ignored'];
  ws.getRow(3).values = HEADER;
  rows.forEach((r, i) => {
    ws.getRow(4 + i).values = ['', r.productCode, r.name, r.unit ?? '', r.category ?? '', '', r.unitPrice, r.unitPriceWithVat, r.buyPrice, r.buyPrice];
  });
  await wb.xlsx.writeFile(destPath);
}

// Extra rows appended to the fixture in writeInputs(): one inactive (review bucket only) and
// one fully unpriced gift set (exercises review/unpriced-offers.jsonl). Shared with
// makeExpectedRunN so the expected vector count matches what runIngest actually ingests.
const EXTRA_ROWS: FlowAccountRow[] = [
  { rowIndex: 99, productCode: 'ZZZ99', name: 'สินค้าทดสอบ ไม่ใช้งาน', unit: 'ชุด', category: 'Gift Set', unitPrice: 0, unitPriceWithVat: 0, buyPrice: 0 },
  { rowIndex: 100, productCode: 'ZZX01(P-01)-100', name: 'ชุดทดสอบไม่มีราคา ZZX01(P-01)', unit: 'ชุด', category: 'Gift Set', unitPrice: 0, unitPriceWithVat: 0, buyPrice: 0 },
];

function makeExpectedRunN(dataRoot: string): { N: number } {
  const identity = JSON.parse(fs.readFileSync(identityFixture, 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(catalogFixture, 'utf8'));
  const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(flowaccountRowsFixture, 'utf8'));
  const flowaccount = parseFlowAccountRows([...rows, ...EXTRA_ROWS]);
  const categoryMap = loadCategoryGroupMap();
  const aliases = loadTypeAliases();
  const batch = buildGraphV4({
    identity,
    catalog,
    flowaccount,
    categoryMap,
    aliases,
    refs: {
      identity: { file: 'identity-review.json', sha256: 'x', rowKey: '' },
      catalog: { file: 'catalog-2026.json', sha256: 'x', rowKey: '' },
      flowaccount: { file: 'flowaccount.xlsx', sha256: 'x', rowKey: '' },
    },
  });
  return { N: embeddableNodes(batch).length };
}

class FakeDb implements IngestDb {
  calls = { createCollection: [] as unknown[], bulkAddNodes: 0, bulkAddEdges: 0, addVector: 0, flushIndex: 0, saveState: 0 };
  private collectionCount = 0;
  constructor(private opts?: { verifyCountOverride?: number }) {}
  async createCollection(name: string, model: string, dim: number, metric: string): Promise<void> {
    this.calls.createCollection.push([name, model, dim, metric]);
  }
  listCollections() {
    const count = this.opts?.verifyCountOverride ?? this.collectionCount;
    return [{ name: 'e5_v4', dim: 384, metric: 'cosine', count }];
  }
  async bulkAddNodes(): Promise<void> {
    this.calls.bulkAddNodes++;
  }
  async bulkAddEdges(): Promise<void> {
    this.calls.bulkAddEdges++;
  }
  async addVector(): Promise<void> {
    this.calls.addVector++;
    this.collectionCount++;
  }
  async flushIndex(): Promise<void> {
    this.calls.flushIndex++;
  }
  async saveState(): Promise<void> {
    this.calls.saveState++;
  }
}

function fakeEmbedClient(opts?: { throws?: boolean; short?: boolean }): EmbedClient {
  return {
    async embed(texts: string[], _kind: 'query' | 'passage') {
      if (opts?.throws) throw new Error('sidecar down');
      const vecs = texts.map(() => new Array(384).fill(0.1));
      return opts?.short ? vecs.slice(0, -1) : vecs;
    },
    async health() {
      return { ok: true };
    },
  };
}

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v4-ingest-'));
}

async function writeInputs(dataRoot: string): Promise<IngestPaths> {
  const identityPath = path.join(dataRoot, 'identity-review.json');
  const catalogPath = path.join(dataRoot, 'catalog-2026.json');
  const flowPath = path.join(dataRoot, 'flowaccount-product-2026-06-21.xlsx');
  fs.copyFileSync(identityFixture, identityPath);
  fs.copyFileSync(catalogFixture, catalogPath);
  const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(flowaccountRowsFixture, 'utf8'));
  await writeFlowAccountXlsx(flowPath, [...rows, ...EXTRA_ROWS]);
  // Optional price-PDF index: maps the unpriced base to where its price already exists in the
  // ใบราคา PDFs, so the worklist can point sales at the right file/pages.
  const pdfIndexPath = path.join(dataRoot, 'price-pdf-index.json');
  fs.writeFileSync(pdfIndexPath, JSON.stringify({ ZZX01: [{ file: '01-ใบเสนอราคา.pdf', pages: [78] }] }));
  const storeRoot = path.join(dataRoot, 'genesis_smartgift_store_v4');
  return {
    dataRoot,
    identity: identityPath,
    catalog: catalogPath,
    flowaccount: flowPath,
    categoryMap: CATEGORY_MAP_FILE,
    aliases: TYPE_ALIASES_FILE,
    storeRoot,
    pdfIndex: pdfIndexPath,
  };
}

describe('v4 ingest — decide', () => {
  const inputs: IngestManifest['inputs'] = {
    identity: { path: 'a', sha256: 'h1' },
    flowaccount: { path: 'b', sha256: 'h2' },
    catalog: { path: 'c', sha256: 'h3' },
    categoryMap: { path: 'd', sha256: 'h4' },
    aliases: { path: 'e', sha256: 'h5' },
  };

  it('reingest when no previous manifest', () => {
    assert.equal(decide(null, inputs), 'reingest');
  });

  it('skip when all hashes match and schemaVersion is current', () => {
    const prev: IngestManifest = {
      runId: 'r1', createdAt: 'now', schemaVersion: SCHEMA_VERSION, inputs, stats: {}, vectors: 0, collection: 'e5_v4', model: 'm', revision: 'r', flowaccountExportDate: '2026-06-21',
    };
    assert.equal(decide(prev, inputs), 'skip');
  });

  it('reingest when a hash differs', () => {
    const prev: IngestManifest = {
      runId: 'r1', createdAt: 'now', schemaVersion: SCHEMA_VERSION, inputs: { ...inputs, aliases: { path: 'e', sha256: 'DIFFERENT' } }, stats: {}, vectors: 0, collection: 'e5_v4', model: 'm', revision: 'r', flowaccountExportDate: '2026-06-21',
    };
    assert.equal(decide(prev, inputs), 'reingest');
  });

  it('reingest when the previous manifest schemaVersion differs from the current SCHEMA_VERSION (Wave-4 A.3)', () => {
    const prev: IngestManifest = {
      runId: 'r1', createdAt: 'now', schemaVersion: 'v4.0', inputs, stats: {}, vectors: 0, collection: 'e5_v4', model: 'm', revision: 'r', flowaccountExportDate: '2026-06-21',
    };
    assert.equal(decide(prev, inputs), 'reingest');
  });

  it('reingest when the previous manifest has no schemaVersion at all (pre-Wave-4 manifest)', () => {
    const prev = {
      runId: 'r1', createdAt: 'now', inputs, stats: {}, vectors: 0, collection: 'e5_v4', model: 'm', revision: 'r', flowaccountExportDate: '2026-06-21',
    } as unknown as IngestManifest;
    assert.equal(decide(prev, inputs), 'reingest');
  });
});

describe('v4 ingest — runIngest', () => {
  let dataRoot: string;
  let N: number;

  let sharedInputs: IngestPaths;

  before(async () => {
    dataRoot = makeTmpRoot();
    N = makeExpectedRunN(dataRoot).N;
    // ExcelJS stamps a creation timestamp into the xlsx's core.xml, so regenerating the
    // file per-test would change its bytes/sha256 even with identical row content and
    // make the "second run" skip assertion flaky. Write the flowaccount workbook once
    // and reuse the same paths across the tests that expect identical input hashes.
    sharedInputs = await writeInputs(dataRoot);
  });

  after(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('first run: reingest, writes manifest with 5 sha256 keys, addVector count = models+offers, CURRENT written', async () => {
    const p = sharedInputs;
    const db = new FakeDb();
    const opened: string[] = [];
    const res = await runIngest(p, {
      openDb: (dir) => {
        opened.push(dir);
        return db;
      },
      embed: fakeEmbedClient(),
      now: () => new Date('2026-08-23T00:00:00.000Z'),
      runId: 'RUN1',
    });

    assert.equal(res.exitCode, 0);
    assert.equal(res.decision, 'reingest');
    assert.ok(res.manifest);
    assert.deepEqual(Object.keys(res.manifest!.inputs).sort(), ['aliases', 'catalog', 'categoryMap', 'flowaccount', 'identity'].sort());
    for (const k of Object.keys(res.manifest!.inputs) as Array<keyof IngestManifest['inputs']>) {
      assert.equal(typeof res.manifest!.inputs[k].sha256, 'string');
      assert.ok(res.manifest!.inputs[k].sha256.length > 0);
    }
    assert.equal(db.calls.addVector, N);
    assert.ok(N > 0);

    assert.equal(opened[0], path.join(p.storeRoot, 'RUN1'));
    assert.equal(db.calls.createCollection.length, 1);
    assert.deepEqual(db.calls.createCollection[0], ['e5_v4', 'intfloat/multilingual-e5-small', 384, 'cosine']);

    const currentPath = path.join(p.storeRoot, 'CURRENT');
    assert.equal(fs.readFileSync(currentPath, 'utf8'), 'RUN1');
    const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(p.storeRoot, 'RUN1', 'manifest.json'), 'utf8'));
    assert.equal(manifestOnDisk.runId, 'RUN1');
    assert.equal(manifestOnDisk.collection, 'e5_v4');
    assert.equal(manifestOnDisk.vectors, N);
    assert.equal(manifestOnDisk.schemaVersion, SCHEMA_VERSION);
    assert.equal(res.manifest!.schemaVersion, SCHEMA_VERSION);

    const reviewPath = path.join(p.storeRoot, 'RUN1', 'review', 'flowaccount-buckets.jsonl');
    assert.ok(fs.existsSync(reviewPath));
    const content = fs.readFileSync(reviewPath, 'utf8').trim();
    const parsedLines = (content ? content.split('\n') : []).map((line) => JSON.parse(line));
    assert.ok(parsedLines.length >= 1, 'expected at least the inactive row in the review bucket log');
    assert.ok(parsedLines.some((r: { bucket: string }) => r.bucket === 'inactive'));

    // RCA-PRICE-DATA-LOSS prevention #5: every ingest writes the unpriced-offer worklist,
    // joined against the optional price-PDF index.
    const unpricedPath = path.join(p.storeRoot, 'RUN1', 'review', 'unpriced-offers.jsonl');
    assert.ok(fs.existsSync(unpricedPath), 'expected review/unpriced-offers.jsonl');
    const unpriced = fs.readFileSync(unpricedPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const zzx = unpriced.find((e: { base: string }) => e.base === 'ZZX01');
    assert.ok(zzx, 'expected the fully-unpriced base ZZX01 in the worklist');
    assert.equal(zzx.name, 'ชุดทดสอบไม่มีราคา ZZX01(P-01)');
    assert.deepEqual(zzx.priceListRefs, [{ file: '01-ใบเสนอราคา.pdf', pages: [78] }]);
    // priced bases from the fixture must NOT appear
    assert.ok(!unpriced.some((e: { base: string }) => e.base === 'TBY01'));
  });

  it('second run with identical inputs: skip, zero bulkAddNodes/db calls', async () => {
    const p = sharedInputs;
    const db = new FakeDb();
    let openCalled = false;
    const res = await runIngest(p, {
      openDb: () => {
        openCalled = true;
        return db;
      },
      embed: fakeEmbedClient(),
      now: () => new Date(),
      runId: 'RUN2',
    });
    assert.equal(res.decision, 'skip');
    assert.equal(res.exitCode, 0);
    assert.equal(openCalled, false);
    assert.equal(db.calls.bulkAddNodes, 0);
  });

  it('modifying aliases input triggers reingest', async () => {
    const p = sharedInputs;
    const tmpAliases = path.join(dataRoot, 'aliases-modified.json');
    const aliases = JSON.parse(fs.readFileSync(TYPE_ALIASES_FILE, 'utf8'));
    aliases.__test_marker = Date.now();
    fs.writeFileSync(tmpAliases, JSON.stringify(aliases));
    const p2: IngestPaths = { ...p, aliases: tmpAliases };
    const db = new FakeDb();
    const res = await runIngest(p2, {
      openDb: () => db,
      embed: fakeEmbedClient(),
      now: () => new Date(),
      runId: 'RUN3',
    });
    assert.equal(res.decision, 'reingest');
    assert.equal(res.exitCode, 0);
  });

  it('a stale on-disk manifest.schemaVersion triggers reingest even though input hashes are unchanged (Wave-4 A.3)', async () => {
    const freshStoreRoot = path.join(dataRoot, 'store-schema-version');
    const p2: IngestPaths = { ...sharedInputs, storeRoot: freshStoreRoot };

    const db1 = new FakeDb();
    const first = await runIngest(p2, { openDb: () => db1, embed: fakeEmbedClient(), now: () => new Date(), runId: 'RUN_SV_1' });
    assert.equal(first.decision, 'reingest');
    assert.equal(first.exitCode, 0);

    // Same inputs, identical hashes — but the on-disk manifest predates Wave-4 A.3.
    const manifestPath = path.join(freshStoreRoot, 'RUN_SV_1', 'manifest.json');
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    onDisk.schemaVersion = 'v4.0';
    fs.writeFileSync(manifestPath, JSON.stringify(onDisk));

    const db2 = new FakeDb();
    let openCalled = false;
    const second = await runIngest(p2, {
      openDb: (dir) => {
        openCalled = true;
        return db2;
      },
      embed: fakeEmbedClient(),
      now: () => new Date(),
      runId: 'RUN_SV_2',
    });
    assert.equal(second.decision, 'reingest', 'must reingest despite identical input hashes because schemaVersion is stale');
    assert.equal(openCalled, true);
    assert.equal(fs.readFileSync(path.join(freshStoreRoot, 'CURRENT'), 'utf8'), 'RUN_SV_2');
  });

  it('embed failure => exitCode 2, bulkAddNodes not called, no CURRENT change', async () => {
    const p = sharedInputs;
    // force reingest by using a fresh storeRoot
    const freshStoreRoot = path.join(dataRoot, 'store-embed-fail');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const db = new FakeDb();
    let openCalled = false;
    const res = await runIngest(p2, {
      openDb: () => {
        openCalled = true;
        return db;
      },
      embed: fakeEmbedClient({ throws: true }),
      now: () => new Date(),
      runId: 'RUN_FAIL',
    });
    assert.equal(res.exitCode, 2);
    assert.equal(openCalled, false);
    assert.equal(db.calls.bulkAddNodes, 0);
    assert.equal(fs.existsSync(path.join(freshStoreRoot, 'CURRENT')), false);
  });

  it('verify failure (listCollections count mismatch) => exitCode 3, no CURRENT', async () => {
    const p = sharedInputs;
    const freshStoreRoot = path.join(dataRoot, 'store-verify-fail');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const db = new FakeDb({ verifyCountOverride: 1 });
    const res = await runIngest(p2, {
      openDb: () => db,
      embed: fakeEmbedClient(),
      now: () => new Date(),
      runId: 'RUN_VERIFY_FAIL',
    });
    assert.equal(res.exitCode, 3);
    assert.equal(fs.existsSync(path.join(freshStoreRoot, 'CURRENT')), false);
  });

  it('post-ingest: warns explicitly that the service must be restarted when health.staleRun is true (gate defect 6)', async () => {
    const p = sharedInputs;
    const freshStoreRoot = path.join(dataRoot, 'store-stale-warn');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const db = new FakeDb();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = ((msg?: unknown) => { warnings.push(String(msg)); }) as typeof console.warn;
    try {
      await runIngest(p2, {
        openDb: () => db,
        embed: fakeEmbedClient(),
        now: () => new Date(),
        runId: 'RUN_STALE',
        // storePath already names the new run, but staleRun is still true -> must still warn.
        serviceHealth: async () => ({ storePath: path.join(freshStoreRoot, 'RUN_STALE'), staleRun: true }),
      });
    } finally {
      console.warn = origWarn;
    }
    assert.ok(warnings.some((w) => /restart/i.test(w)), `expected a restart warning, got: ${warnings.join(' | ')}`);
  });

  it('post-ingest: warns when storePath does not name the new runId, even if staleRun is false/absent', async () => {
    const p = sharedInputs;
    const freshStoreRoot = path.join(dataRoot, 'store-mismatch-warn');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const db = new FakeDb();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = ((msg?: unknown) => { warnings.push(String(msg)); }) as typeof console.warn;
    try {
      await runIngest(p2, {
        openDb: () => db,
        embed: fakeEmbedClient(),
        now: () => new Date(),
        runId: 'RUN_MISMATCH',
        serviceHealth: async () => ({ storePath: path.join(freshStoreRoot, 'OLD_RUN'), staleRun: false }),
      });
    } finally {
      console.warn = origWarn;
    }
    assert.ok(warnings.some((w) => /restart/i.test(w)), `expected a restart warning, got: ${warnings.join(' | ')}`);
  });

  it('post-ingest: no warning when the service already points at the new run and is not stale', async () => {
    const p = sharedInputs;
    const freshStoreRoot = path.join(dataRoot, 'store-fresh-no-warn');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const db = new FakeDb();
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = ((msg?: unknown) => { warnings.push(String(msg)); }) as typeof console.warn;
    try {
      await runIngest(p2, {
        openDb: () => db,
        embed: fakeEmbedClient(),
        now: () => new Date(),
        runId: 'RUN_FRESH',
        serviceHealth: async () => ({ storePath: path.join(freshStoreRoot, 'RUN_FRESH'), staleRun: false }),
      });
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.length, 0, `expected no warning, got: ${warnings.join(' | ')}`);
  });

  it('openDb throwing "already open" => exitCode 3', async () => {
    const p = sharedInputs;
    const freshStoreRoot = path.join(dataRoot, 'store-lock-fail');
    const p2: IngestPaths = { ...p, storeRoot: freshStoreRoot };
    const res = await runIngest(p2, {
      openDb: () => {
        throw new Error('already open');
      },
      embed: fakeEmbedClient(),
      now: () => new Date(),
      runId: 'RUN_LOCK_FAIL',
    });
    assert.equal(res.exitCode, 3);
    assert.equal(fs.existsSync(path.join(freshStoreRoot, 'CURRENT')), false);
  });
});
