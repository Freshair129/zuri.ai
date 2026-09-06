// T16 §7.10 integration test: real GenesisDatabase + real embed sidecar. Gated on
// RUN_STORE_TESTS=1 (otherwise the whole file test.skips with a clear message) and, even then,
// skips with a clear message if EMBED_URL/health is unreachable — this file starts nothing
// itself. Run explicitly: `npm run test:store` (or `RUN_STORE_TESTS=1 node --import tsx --test
// tests/integration/v4-store.test.ts`) with scripts/embed-sidecar.py already running.
//
// Wave-4 D: the latency and search assertions ingest tests/fixtures/v4/synthetic-50.json (50 models /
// 319 variants / 82 offers / 142 price lines) instead of the hand-written identity-mini fixture —
// a generated synthetic dataset of the same cardinality; not historical catalog evidence. The mini-fixture ingest stays
// in its own describe block purely to exercise decide()'s idempotency/skip semantics end-to-end
// against a real store (a smaller fixture ingests faster, and skip-vs-reingest logic doesn't
// depend on fixture size).
//
// Listed in package.json's "test" allowlist (the CI guard requires every test file there); in
// CI and plain `npm test` runs the whole file self-skips via the RUN_STORE_TESTS gate above.
// The separate "test:store" script targets this file for real-store runs.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

import { runIngest, type IngestDb, type IngestPaths } from '../../src/rag/v4/ingest.js';
import { searchV4, type SearchDeps, type GraphDb } from '../../src/rag/v4/search.js';
import { createEmbedClient } from '../../src/rag/v4/embed-client.js';
import { loadGenesisDatabase as resolveGenesisDatabase } from '../../src/rag/v4/genesis-binding.js';
import { loadCategoryGroupMap, loadTypeAliases, aliasIndex, CATEGORY_MAP_FILE, TYPE_ALIASES_FILE } from '../../src/rag/v4/config.js';
import type { BuildInputs } from '../../src/rag/v4/build-graph.js';
import type { FlowAccountRow, PriceLine } from '../../src/rag/v4/flowaccount.js';

const RUN_STORE_TESTS = process.env.RUN_STORE_TESTS === '1';
const EMBED_URL = process.env.EMBED_URL ?? 'http://127.0.0.1:8891';


const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const identityFixture = new URL('../fixtures/v4/identity-mini.json', import.meta.url);
const catalogFixture = new URL('../fixtures/v4/catalog-mini.json', import.meta.url);
const flowaccountRowsFixture = new URL('../fixtures/v4/flowaccount-rows-mini.json', import.meta.url);
const synthetic50Fixture = new URL('../fixtures/v4/synthetic-50.json', import.meta.url);
const qsNlPath = path.join(REPO_ROOT, 'tests', 'fixtures', 'v4', 'querysets', 'QS_NL_SYNTHETIC_v1.jsonl');

interface Synthetic50Fixture {
  identity: BuildInputs['identity'];
  catalog: BuildInputs['catalog'];
  flowaccount: { lines: PriceLine[]; review: unknown[]; counts: Record<string, number>; total: number };
}
interface QsNlLine { id: string; text: string }

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

/**
 * synthetic-50.json stores its FlowAccount data already parsed (`ParsedFlowAccount.lines`), not raw
 * xlsx rows — but `runIngest` (the real pipeline under test here) reads+parses an xlsx itself. This
 * reconstructs the 142 raw rows that `parseFlowAccountRows` would re-derive back into the exact
 * same `PriceLine`s: for a 'parsed' line, `productCode` is its own (already-uppercased)
 * `flowAccountCode`; for a 'name_coded' line, `productCode` is empty and `name` carries the same
 * `flowAccountName` string the fixture's `base`/`priceListGroup` were themselves derived from
 * (`codeFromName` is deterministic, so re-running it on the identical name string round-trips).
 * Safe for this fixture specifically: every one of its 142 lines is 'parsed' or 'name_coded'
 * (counts.unparsed/non_giftset/blank/inactive are all 0) and every `category` is 'Gift Set'.
 */
function toFlowAccountRows(lines: PriceLine[]): FlowAccountRow[] {
  return lines.map((l, i) => ({
    rowIndex: i + 1,
    productCode: l.bucket === 'parsed' ? (l.flowAccountCode ?? '') : '',
    name: l.flowAccountName,
    unit: 'ชุด',
    category: l.category,
    unitPrice: l.unitPrice,
    unitPriceWithVat: l.unitPriceWithVat,
    buyPrice: 0,
  }));
}

function readJsonl<T>(p: string): T[] {
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line) as T);
}

function loadGenesisDatabase(): any {
  // Resolution lives in src/rag/v4/genesis-binding.ts (npm package, then GENESIS_NATIVE_MODULE,
  // then the legacy absolute path) so this test exercises the same engine the pipeline does.
  return resolveGenesisDatabase();
}

async function embedHealthy(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    try {
      const res = await fetch(`${EMBED_URL}/health`, { signal: ctl.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

if (!RUN_STORE_TESTS) {
  describe('v4 store integration (skipped: RUN_STORE_TESTS!=1)', () => {
    it('skipped — set RUN_STORE_TESTS=1 with scripts/embed-sidecar.py running to run this suite', (t) => {
      t.skip('RUN_STORE_TESTS!=1 — this suite needs a real GenesisDatabase and a real embed sidecar');
    });
  });
} else {
  describe('v4 store integration — mini fixture (idempotency/skip case)', () => {
    let skipReason: string | null = null;
    let GenesisDatabase: any = null;
    let dataRoot: string;
    let paths: IngestPaths;

    before(async () => {
      if (!(await embedHealthy())) {
        skipReason = `EMBED_URL=${EMBED_URL}/health unreachable — start scripts/embed-sidecar.py first`;
        return;
      }
      try {
        GenesisDatabase = loadGenesisDatabase();
      } catch (err) {
        skipReason = `GenesisBlock native module unavailable: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }

      dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-store-it-mini-'));
      const identityPath = path.join(dataRoot, 'identity-review.json');
      const catalogPath = path.join(dataRoot, 'catalog-2026.json');
      const flowPath = path.join(dataRoot, 'flowaccount-product-2026-06-21.xlsx');
      fs.copyFileSync(identityFixture, identityPath);
      fs.copyFileSync(catalogFixture, catalogPath);
      const rows: FlowAccountRow[] = JSON.parse(fs.readFileSync(flowaccountRowsFixture, 'utf8'));
      await writeFlowAccountXlsx(flowPath, rows);
      paths = {
        dataRoot,
        identity: identityPath,
        catalog: catalogPath,
        flowaccount: flowPath,
        categoryMap: CATEGORY_MAP_FILE,
        aliases: TYPE_ALIASES_FILE,
        storeRoot: path.join(dataRoot, 'genesis_smartgift_store_v4'),
      };
    });

    after(() => {
      // Best-effort only: the native GenesisBlock binding has no close() (§5.10 / Wave-3 note),
      // so the store files under dataRoot may still be locked by this process when the suite
      // ends — Windows then refuses to delete them (EPERM) even though the test itself passed.
      // The OS reclaims %TEMP% on its own schedule; failing the whole run over an unlink race
      // in teardown would be a false negative, not a real defect.
      try {
        if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[v4-store.test] best-effort tmp cleanup failed (native store handle likely still locked): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    it('ingest mini fixture (identity-mini + catalog-mini + flowaccount-rows-mini) with the REAL GenesisDatabase and REAL embed client', async (t) => {
      if (skipReason) return t.skip(skipReason);

      const embed = createEmbedClient(EMBED_URL, { timeoutMs: 60000 });
      let dbHandle: GraphDb | null = null;

      function openDb(dir: string): IngestDb {
        fs.mkdirSync(dir, { recursive: true });
        dbHandle = GenesisDatabase.open({ path: dir, vectorDim: 384, retention: 'frontier_only' }) as GraphDb & IngestDb;
        return dbHandle as unknown as IngestDb;
      }

      const res = await runIngest(paths, { openDb, embed, now: () => new Date(), runId: 'RUN_IT_MINI_1' });
      assert.equal(res.exitCode, 0, `ingest failed: ${JSON.stringify(res)}`);
      assert.equal(res.decision, 'reingest');
      assert.ok(res.manifest);

      // models(3) + offers(3: OFFER_TSP07-2, OFFER_TBY01 from catalog + OFFER_TPH00-4 flowaccount_only)
      assert.equal(res.manifest!.stats.ProductModel, 3);
      assert.equal(res.manifest!.stats.CatalogOffer, 3);
      assert.equal(res.manifest!.vectors, 6);

      assert.ok(dbHandle, 'openDb must have been called and captured a handle');
      const collections = (dbHandle as any).listCollections() as Array<{ name: string; count: number }>;
      const e5 = collections.find((c) => c.name === 'e5_v4');
      assert.ok(e5, 'e5_v4 collection must exist');
      assert.equal(e5!.count, 6, 'e5_v4 vector count must equal models(3) + offers(3)');

      const currentPath = path.join(paths.storeRoot, 'CURRENT');
      assert.equal(fs.readFileSync(currentPath, 'utf8'), 'RUN_IT_MINI_1');
    });

    it('second run with identical inputs -> skip (no reingest, CURRENT unchanged)', async (t) => {
      if (skipReason) return t.skip(skipReason);
      const embed = createEmbedClient(EMBED_URL, { timeoutMs: 60000 });
      let openCalled = false;
      const res = await runIngest(paths, {
        openDb: (dir) => {
          openCalled = true;
          fs.mkdirSync(dir, { recursive: true });
          return GenesisDatabase.open({ path: dir, vectorDim: 384, retention: 'frontier_only' }) as IngestDb;
        },
        embed,
        now: () => new Date(),
        runId: 'RUN_IT_MINI_2',
      });
      assert.equal(res.decision, 'skip');
      assert.equal(res.exitCode, 0);
      assert.equal(openCalled, false, 'a skip decision must never open a second store handle on the same dir');
      assert.equal(fs.readFileSync(path.join(paths.storeRoot, 'CURRENT'), 'utf8'), 'RUN_IT_MINI_1');
    });
  });

  describe('v4 store integration — synthetic-50 fixture (latency + search, Wave-4 D)', () => {
    let skipReason: string | null = null;
    let GenesisDatabase: any = null;
    let dataRoot: string;
    let paths: IngestPaths;
    let dbHandle: GraphDb | null = null;
    let searchDeps: SearchDeps;

    before(async () => {
      if (!(await embedHealthy())) {
        skipReason = `EMBED_URL=${EMBED_URL}/health unreachable — start scripts/embed-sidecar.py first`;
        return;
      }
      try {
        GenesisDatabase = loadGenesisDatabase();
      } catch (err) {
        skipReason = `GenesisBlock native module unavailable: ${err instanceof Error ? err.message : String(err)}`;
        return;
      }

      const synthetic50 = JSON.parse(fs.readFileSync(synthetic50Fixture, 'utf8')) as Synthetic50Fixture;

      dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v4-store-it-synthetic50-'));
      const identityPath = path.join(dataRoot, 'identity-review.json');
      const catalogPath = path.join(dataRoot, 'catalog-2026.json');
      const flowPath = path.join(dataRoot, 'flowaccount-product-2026-06-21.xlsx');
      fs.writeFileSync(identityPath, JSON.stringify(synthetic50.identity));
      fs.writeFileSync(catalogPath, JSON.stringify(synthetic50.catalog));
      await writeFlowAccountXlsx(flowPath, toFlowAccountRows(synthetic50.flowaccount.lines));
      paths = {
        dataRoot,
        identity: identityPath,
        catalog: catalogPath,
        flowaccount: flowPath,
        categoryMap: CATEGORY_MAP_FILE,
        aliases: TYPE_ALIASES_FILE,
        storeRoot: path.join(dataRoot, 'genesis_smartgift_store_v4'),
      };
    });

    after(() => {
      // Best-effort only — see the mini-fixture describe block's `after` for why.
      try {
        if (dataRoot) fs.rmSync(dataRoot, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[v4-store.test] best-effort tmp cleanup failed (native store handle likely still locked): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    it('ingest synthetic-50 fixture with the REAL GenesisDatabase and REAL embed client: 50 models / 319 variants / 82 offers, e5_v4 count 132', async (t) => {
      if (skipReason) return t.skip(skipReason);

      const embed = createEmbedClient(EMBED_URL, { timeoutMs: 180000 });

      function openDb(dir: string): IngestDb {
        fs.mkdirSync(dir, { recursive: true });
        dbHandle = GenesisDatabase.open({ path: dir, vectorDim: 384, retention: 'frontier_only' }) as GraphDb & IngestDb;
        return dbHandle as unknown as IngestDb;
      }

      const res = await runIngest(paths, { openDb, embed, now: () => new Date(), runId: 'RUN_IT_SYNTHETIC50_1' });
      assert.equal(res.exitCode, 0, `ingest failed: ${JSON.stringify(res)}`);
      assert.equal(res.decision, 'reingest');
      assert.ok(res.manifest);

      assert.equal(res.manifest!.stats.ProductModel, 50);
      assert.equal(res.manifest!.stats.PhysicalVariant, 319);
      assert.equal(res.manifest!.stats.CatalogOffer, 82);
      // e5_v4 embeds ProductModel + CatalogOffer only (§5.6 / AC-A7) = 50 + 82 = 132.
      assert.equal(res.manifest!.vectors, 132);

      assert.ok(dbHandle, 'openDb must have been called and captured a handle');
      const collections = (dbHandle as any).listCollections() as Array<{ name: string; count: number }>;
      const e5 = collections.find((c) => c.name === 'e5_v4');
      assert.ok(e5, 'e5_v4 collection must exist');
      assert.equal(e5!.count, 132, 'e5_v4 vector count must equal models(50) + offers(82)');

      const currentPath = path.join(paths.storeRoot, 'CURRENT');
      assert.equal(fs.readFileSync(currentPath, 'utf8'), 'RUN_IT_SYNTHETIC50_1');

      const categoryMap = loadCategoryGroupMap();
      const typeAliases = loadTypeAliases();
      searchDeps = {
        db: dbHandle!,
        embed,
        aliases: aliasIndex(typeAliases),
        typeNames: new Map(typeAliases.types.map((t) => [t.typeId, t.name_th])),
        typeGroups: new Map(Object.entries(categoryMap.typeToGroup)),
      };
    });

    it('searchV4("พาวเวอร์แบงก์") returns a ProductModel with englishName matching /power bank/i in the top 5', async (t) => {
      if (skipReason) return t.skip(skipReason);
      const res = await searchV4(searchDeps, 'พาวเวอร์แบงก์', { limit: 5 });
      assert.equal(res.success, true);
      assert.ok(
        res.results.some((r) => r.kind === 'model' && r.englishName !== null && /power bank/i.test(r.englishName)),
        `expected a Power Bank ProductModel in top-5, got: ${JSON.stringify(res.results.map((r) => ({ kind: r.kind, id: r.id, englishName: r.englishName })))}`,
      );
    });

    it('20 NL queries from QS_NL_SYNTHETIC_v1.jsonl: p95 end-to-end latency <= 800ms (query time only, not ingest)', async (t) => {
      if (skipReason) return t.skip(skipReason);
      const lines = readJsonl<QsNlLine>(qsNlPath).slice(0, 20);
      assert.equal(lines.length, 20, 'expected at least 20 lines in QS_NL_SYNTHETIC_v1.jsonl');
      const latencies: number[] = [];
      for (const line of lines) {
        const t0 = performance.now();
        await searchV4(searchDeps, line.text, { limit: 5 });
        latencies.push(performance.now() - t0);
      }
      const sorted = [...latencies].sort((a, b) => a - b);
      const p95 = sorted[Math.min(Math.ceil(0.95 * sorted.length), sorted.length) - 1];
      const p50 = sorted[Math.min(Math.ceil(0.5 * sorted.length), sorted.length) - 1];
      console.log(`[v4-store.test] synthetic-50, 20 QS_NL_SYNTHETIC_v1 queries: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms min=${sorted[0].toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`);
      assert.ok(p95 <= 800, `p95=${p95.toFixed(1)}ms exceeds 800ms budget; all: ${sorted.map((v) => v.toFixed(1)).join(', ')}`);
    });
  });
}
