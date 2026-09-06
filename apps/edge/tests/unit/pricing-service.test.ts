import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { loadCostCatalog, catalogManifestFor } from '../../src/pricing/cost-catalog.js';
import { createPricingRouter, roleForKey } from '../../src/pricing/service.js';
import { startPricingServer } from '../../src/pricing/http-server.js';
import { buildPriceQuote } from '../../src/pricing/index.js';
import { scopeQuote } from '../../src/identity/scope.js';

// @tested SDD-015 — the read-only pricing MCP door and its role gate.

/**
 * A catalog root written per-suite so the tests never depend on the machine's real cost data
 * (which is gitignored and carries factory prices for the whole range).
 */
const BOOK = {
  label: 'test-giftset',
  products: [
    { code: 'TJS23-2', name: 'Turbo Handheld Fan + Umbrella', rmb: 32.0, upc: 20, dims: [47.5, 45.5, 51.0], kg: null, e: true, img: 'TJS23-2.webp' },
    { code: 'TPP00-2', name: 'A5 notebook with pen', rmb: 14.5, upc: 40, dims: [50, 40, 40], kg: 12, e: false },
    { code: 'NOCOST0', name: 'Row with no readable cost', rmb: null, upc: null, dims: null, kg: null, e: false },
  ],
};

let catalogRoot: string;
const OWNER_KEY = 'test-owner-key-abc';
const NOW = () => new Date('2026-08-24T00:00:00.000Z');

function writeCatalog(root: string) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'giftset.json'), JSON.stringify(BOOK));
}

before(() => {
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-svc-'));
  writeCatalog(catalogRoot);
});

after(() => {
  fs.rmSync(catalogRoot, { recursive: true, force: true });
});

function router(over: { ownerKey?: string | null } = {}) {
  return createPricingRouter({
    catalog: loadCostCatalog(catalogRoot),
    ownerKey: over.ownerKey === undefined ? OWNER_KEY : over.ownerKey,
    now: NOW,
  });
}

describe('cost catalog manifest', () => {
  it('loads products and reports a sha256 over the catalog files, plus quotable counts', () => {
    const catalog = loadCostCatalog(catalogRoot);
    assert.equal(catalog.products.length, 3);
    const manifest = catalogManifestFor(catalog);
    assert.equal(manifest.products, 3);
    assert.equal(manifest.quotable, 2, 'the row with no cost/carton is not quotable');
    assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(manifest.books, ['test-giftset']);
  });

  it('the sha256 changes when a cost changes — a silently edited catalog is detectable', () => {
    const first = catalogManifestFor(loadCostCatalog(catalogRoot)).sha256;
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-svc-2-'));
    try {
      const edited = JSON.parse(JSON.stringify(BOOK));
      edited.products[0].rmb = 33.0;
      fs.mkdirSync(other, { recursive: true });
      fs.writeFileSync(path.join(other, 'giftset.json'), JSON.stringify(edited));
      assert.notEqual(catalogManifestFor(loadCostCatalog(other)).sha256, first);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('an empty root loads as an empty catalog rather than throwing — the service can say so', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-svc-empty-'));
    try {
      const manifest = catalogManifestFor(loadCostCatalog(empty));
      assert.equal(manifest.products, 0);
      assert.equal(manifest.quotable, 0);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('pricing service — role gate', () => {
  it('the configured owner key resolves to owner; anything else is sales', () => {
    assert.equal(roleForKey(OWNER_KEY, OWNER_KEY), 'owner');
    assert.equal(roleForKey('wrong', OWNER_KEY), 'sales');
    assert.equal(roleForKey(undefined, OWNER_KEY), 'sales');
    assert.equal(roleForKey('', OWNER_KEY), 'sales');
  });

  it('fails closed: with no owner key configured, even a matching-looking key stays sales', () => {
    assert.equal(roleForKey('', null), 'sales');
    assert.equal(roleForKey('anything', null), 'sales');
    assert.equal(roleForKey('anything', ''), 'sales');
  });

  it('a sales quote carries prices but no cost, margin or basis anywhere in the payload', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 100 }, 'sales');
    assert.equal(res.status, 200);
    const body = res.body as any;
    assert.ok(body.quote.breaks.length > 0);
    assert.ok(body.quote.breaks[0].unitPriceThb > 0);
    assert.equal(body.quote.cost, undefined);
    // Scan every key at every depth: a cost field must not reappear through some nested object
    // added later. Field *names* are checked, not substrings — `priceSource: 'estimate_rmb'` is a
    // label, not a cost.
    const COST_KEYS = new Set([
      'landedUnitCostThb', 'orderGrossProfitThb', 'grossMarginPct', 'basis', 'markupFactor',
      'factoryCostThb', 'freightPerUnitThb', 'logoPerUnitThb', 'inlandChinaCostThb', 'rmb', 'upc',
    ]);
    const walk = (node: unknown, trail: string): void => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${trail}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          assert.ok(!COST_KEYS.has(key), `sales payload must not contain ${trail}.${key}`);
          walk(value, `${trail}.${key}`);
        }
      }
    };
    walk(body, 'body');
  });

  it('an owner quote carries the cost breakdown and margins', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 100 }, 'owner');
    assert.equal(res.status, 200);
    const body = res.body as any;
    assert.ok(body.quote.cost.factoryCostThb > 0);
    assert.ok(body.quote.breaks[0].landedUnitCostThb > 0);
    assert.equal(typeof body.quote.breaks[0].grossMarginPct, 'number');
  });
});

describe('pricing service — routes', () => {
  it('GET /health reports catalog identity without ever exposing the owner key', async () => {
    const res = await router().handle('GET', '/health', null, 'sales');
    assert.equal(res.status, 200);
    const body = res.body as any;
    assert.equal(body.ok, true);
    assert.equal(body.catalog.products, 3);
    assert.equal(body.catalog.quotable, 2);
    assert.equal(body.ownerKeyConfigured, true);
    assert.ok(!JSON.stringify(body).includes(OWNER_KEY));
  });

  it('GET /api/pricing/catalog hides cost from sales and shows it to owner', async () => {
    const sales = await router().handle('GET', '/api/pricing/catalog?q=notebook', null, 'sales');
    const salesItems = (sales.body as any).items;
    assert.equal(salesItems.length, 1);
    assert.equal(salesItems[0].code, 'TPP00-2');
    assert.equal(salesItems[0].rmb, undefined);
    assert.equal(salesItems[0].quotable, true);

    const owner = await router().handle('GET', '/api/pricing/catalog?q=notebook', null, 'owner');
    assert.equal((owner.body as any).items[0].rmb, 14.5);
  });

  it('an unknown sku is 404 with the code named, not a 500', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'NOPE1', quantity: 10 }, 'owner');
    assert.equal(res.status, 404);
    assert.match((res.body as any).error, /NOPE1/);
  });

  it('a catalog row missing cost or carton is 422 and says which piece is missing', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'NOCOST0', quantity: 10 }, 'owner');
    assert.equal(res.status, 422);
    assert.ok((res.body as any).missing.length > 0);
  });

  it('a malformed body is 400 with the offending field, never a stack trace', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: -5 }, 'owner');
    assert.equal(res.status, 400);
    assert.ok(!JSON.stringify(res.body).includes('at Object'));
  });

  it('an unknown route is 404', async () => {
    const res = await router().handle('GET', '/api/pricing/nope', null, 'owner');
    assert.equal(res.status, 404);
  });

  it('ad-hoc quoting is owner-only: sales gets 403, owner gets a quote for a sku not in the catalog', async () => {
    const body = {
      sku: 'ADHOC-1',
      factoryCostRmb: 40,
      carton: { unitsPerCarton: 20, cartonCbm: 0.11, cartonWeightKg: 14 },
    };
    const denied = await router().handle('POST', '/api/pricing/quote/adhoc', body, 'sales');
    assert.equal(denied.status, 403);

    const allowed = await router().handle('POST', '/api/pricing/quote/adhoc', body, 'owner');
    assert.equal(allowed.status, 200);
    assert.equal((allowed.body as any).quote.sku, 'ADHOC-1');
    assert.ok((allowed.body as any).quote.cost.factoryCostThb > 0);
  });
});

describe('pricing service — parity with the engine', () => {
  /**
   * The whole point of the service is that it is the *same* engine, not a second implementation:
   * every number it returns must equal a direct engine call on the same inputs. This is the test
   * the browser calculator's own copy of the formulas kept failing (two drift fixes in its git
   * history), which is why it becomes a client of this instead.
   */
  it('every break equals a direct buildPriceQuote on the same inputs, for both roles', async () => {
    const catalog = loadCostCatalog(catalogRoot);
    const product = catalog.byCode.get('TJS23-2')!;
    // Written out rather than taken from quoteInputForProduct, so this also pins the mapping the
    // agent has always used: 4-decimal carton CBM, goods class from the electrical flag, and
    // screening positions from the item code (TJS23-2 -> 2 pieces + box + bag = 4).
    const expected = buildPriceQuote({
      sku: product.code,
      factoryCostRmb: product.rmb!,
      exchangeRate: 5,
      carton: { unitsPerCarton: product.upc!, cartonCbm: 0.1102 },
      freight: { mode: 'auto', goodsClass: 'electronic_tisi', shipMonth: 8 },
      logo: { positions: 4 },
    });

    for (const role of ['owner', 'sales'] as const) {
      const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', exchangeRate: 5, freight: { shipMonth: 8 } }, role);
      assert.equal(res.status, 200);
      const got = (res.body as any).quote;
      const want = scopeQuote(expected, role);
      // The service adds `orderTotalThb` per break; every other field must be the engine's own.
      const stripped = got.breaks.map(({ orderTotalThb, ...rest }: any) => rest);
      assert.deepEqual(stripped, want.breaks, `${role} breaks must match the engine exactly`);
      for (const b of got.breaks) {
        assert.equal(b.orderTotalThb, Math.round(b.quantity * b.unitPriceThb * 100) / 100);
      }
    }
  });

  it('states the catalog sha256 and the freight rate provenance on every quote', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2' }, 'sales');
    const body = res.body as any;
    assert.match(body.catalog.sha256, /^[0-9a-f]{64}$/);
    assert.ok(body.provenance.freightRate.source.length > 0);
    assert.ok(body.provenance.freightRate.asOf.length > 0);
  });
});

describe('pricing service — over a real socket', () => {
  let server: Awaited<ReturnType<typeof startPricingServer>>;
  let base: string;

  before(async () => {
    server = await startPricingServer({
      catalogRoot,
      ownerKey: OWNER_KEY,
      port: 0,
      host: '127.0.0.1',
      now: NOW,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  after(async () => {
    await server.close();
  });

  it('binds to loopback and serves health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it('the role header decides what a caller sees; without it the caller is sales', async () => {
    const anon = await fetch(`${base}/api/pricing/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'TJS23-2', quantity: 100 }),
    });
    const anonBody = await anon.json();
    assert.equal(anonBody.quote.cost, undefined);

    const owner = await fetch(`${base}/api/pricing/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zuri-pricing-key': OWNER_KEY },
      body: JSON.stringify({ sku: 'TJS23-2', quantity: 100 }),
    });
    const ownerBody = await owner.json();
    assert.ok(ownerBody.quote.cost.factoryCostThb > 0);
  });

  it('unparsable JSON is answered 400, not a crash', async () => {
    const res = await fetch(`${base}/api/pricing/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(res.status, 400);
  });
});

describe('pricing service — profiles, detail and lead time (what the calculator needs)', () => {
  it('the corporate profile prices off landed cost at its own breaks, differing from standard', async () => {
    const standard = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', shipMonth: 8 }, 'owner');
    const corporate = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', shipMonth: 8, profile: 'corporate' }, 'owner');
    assert.equal(corporate.status, 200);
    const stdBreaks = (standard.body as any).quote.breaks.map((b: any) => b.quantity);
    const corpBreaks = (corporate.body as any).quote.breaks.map((b: any) => b.quantity);
    assert.deepEqual(stdBreaks, [10, 20, 50, 100, 300, 500, 1000]);
    assert.deepEqual(corpBreaks, [100, 300, 500, 1000], 'corporate quotes only the volume breaks');
    assert.equal((corporate.body as any).profile, 'corporate');
  });

  it('an unknown profile is rejected rather than silently priced as standard', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', profile: 'vip' }, 'owner');
    assert.equal(res.status, 400);
  });

  it('owner gets the full engine detail the calculator renders; sales gets none of it', async () => {
    const owner = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', shipMonth: 8 }, 'owner');
    const detail = (owner.body as any).detail;
    assert.ok(detail.anchorLandedUnitCost.freight.cartons > 0);
    assert.equal(typeof detail.anchorLandedUnitCost.freight.weightFlipThresholdKg, 'number');
    assert.ok(['volume', 'weight'].includes(detail.anchorLandedUnitCost.freight.chargedBy));
    assert.equal(typeof detail.breaks[0].smallOrderFactor, 'number');
    assert.ok(['truck', 'sea'].includes(detail.breaks[0].freightMode));
    assert.ok(detail.policy.markupBands.length > 0);

    const sales = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', shipMonth: 8 }, 'sales');
    assert.equal((sales.body as any).detail, undefined);
  });

  it('lead time comes back for the asked quantity, and rush drops the sample stage', async () => {
    const normal = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 300, shipMonth: 8 }, 'sales');
    const lead = (normal.body as any).leadTime;
    assert.ok(lead.minDays > 0 && lead.maxDays >= lead.minDays);
    assert.ok(lead.stages.some((s: any) => s.key === 'sample'));

    const rush = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 300, shipMonth: 8, rush: true }, 'sales');
    const rushLead = (rush.body as any).leadTime;
    assert.ok(!rushLead.stages.some((s: any) => s.key === 'sample'));
    assert.ok(rushLead.maxDays < lead.maxDays);
  });
});

describe('pricing service — serving the calculator', () => {
  let server: Awaited<ReturnType<typeof startPricingServer>>;
  let base: string;
  let publicDir: string;

  before(async () => {
    publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-public-'));
    fs.writeFileSync(path.join(publicDir, 'pricing.html'), '<!doctype html><title>calc</title><body>ok');
    fs.mkdirSync(path.join(catalogRoot, 'img', 'giftset'), { recursive: true });
    fs.writeFileSync(path.join(catalogRoot, 'img', 'giftset', 'TJS23-2.webp'), Buffer.from([0x52, 0x49, 0x46, 0x46]));
    server = await startPricingServer({
      catalogRoot,
      ownerKey: OWNER_KEY,
      port: 0,
      host: '127.0.0.1',
      publicDir,
      now: NOW,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  after(async () => {
    await server.close();
    fs.rmSync(publicDir, { recursive: true, force: true });
  });

  it('serves the calculator at / so the page and the API share one origin', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(await res.text(), /calc/);
  });

  it('serves catalog thumbnails from the catalog root', async () => {
    const res = await fetch(`${base}/catalog/img/giftset/TJS23-2.webp`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /image\/webp/);
  });

  it('a missing thumbnail is 404, never a directory listing', async () => {
    assert.equal((await fetch(`${base}/catalog/img/giftset/nope.webp`)).status, 404);
  });

  it('refuses to walk out of its roots', async () => {
    for (const attempt of ['/../package.json', '/catalog/img/../../../package.json', '/%2e%2e/package.json']) {
      const res = await fetch(`${base}${attempt}`);
      assert.ok(res.status === 404 || res.status === 400, `${attempt} must not be served (got ${res.status})`);
      const body = await res.text();
      assert.ok(!body.includes('"dependencies"'), `${attempt} leaked a repo file`);
    }
  });

  it('the API still answers on the same origin', async () => {
    const res = await fetch(`${base}/api/pricing/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'TJS23-2', quantity: 100, shipMonth: 8 }),
    });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).quote.breaks.length > 0);
  });
});

describe('pricing service — a deadline decides the freight mode', () => {
  it('a generous deadline picks sea and says why; the quote is priced on that mode', async () => {
    const res = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 500, shipMonth: 8, deadlineDays: 60 }, 'owner');
    assert.equal(res.status, 200);
    const body = res.body as any;
    assert.equal(body.deadline.mode, 'sea');
    assert.match(body.deadline.reason, /เรือ/);
    assert.equal(body.leadTime.mode, 'sea');
    assert.equal((res.body as any).detail.breaks.find((b: any) => b.quantity === 500).freightMode, 'sea');
  });

  it('a tight deadline falls back to truck, and an impossible one says so with no mode', async () => {
    const tight = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 500, shipMonth: 8, deadlineDays: 25 }, 'owner');
    assert.equal((tight.body as any).deadline.mode, 'truck');

    const impossible = await router().handle('POST', '/api/pricing/quote', { sku: 'TJS23-2', quantity: 500, shipMonth: 8, deadlineDays: 3 }, 'owner');
    assert.equal((impossible.body as any).deadline.mode, null);
    assert.ok((impossible.body as any).deadline.reason.length > 0);
  });
});
