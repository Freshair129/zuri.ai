import path from 'node:path';

import { startPricingServer, DEFAULT_PRICING_PORT } from '../src/pricing/http-server.js';
import { loadCostCatalog } from '../src/pricing/cost-catalog.js';

/**
 * Run the pricing engine as a local service.
 *
 * Bind stays on loopback: the payload can carry factory costs, so reaching it from another machine
 * is `tailscale serve`'s job, not an open bind.
 *
 *   ZURI_PRICING_CATALOG_ROOT   where the cost catalog JSONs live (default: state/catalog)
 *   ZURI_PRICING_OWNER_KEY      the one key that buys the owner view; unset means nobody gets it
 *   ZURI_PRICING_PORT           default 8899
 */
const catalogRoot = process.env.ZURI_PRICING_CATALOG_ROOT
  ?? path.join(process.cwd(), 'state', 'catalog');
const ownerKey = process.env.ZURI_PRICING_OWNER_KEY?.trim() || null;
const port = Number(process.env.ZURI_PRICING_PORT || DEFAULT_PRICING_PORT);

async function main(): Promise<void> {
  const catalog = loadCostCatalog(catalogRoot);
  if (catalog.manifest.products === 0) {
    // Silence here would look exactly like "that code does not exist" on every quote — which is
    // how the estimate path sat dead in a worktree with no state/ for weeks.
    console.error(
      `[pricing] no cost catalog at ${catalogRoot}. Every quote will answer "not in the catalog". ` +
        `Point ZURI_PRICING_CATALOG_ROOT at the catalog, or copy the JSON books there.`
    );
  }

  const server = await startPricingServer({
    catalogRoot,
    ownerKey,
    port,
    publicDir: process.env.ZURI_PRICING_PUBLIC_DIR ?? path.join(process.cwd(), 'public'),
    log: (line) => console.log(`[pricing] ${line}`),
  });

  console.log(
    `[pricing] calculator at http://127.0.0.1:${server.port}/ · ` +
      `${catalog.manifest.products} products (${catalog.manifest.quotable} quotable) · ` +
      `catalog ${catalog.manifest.sha256.slice(0, 12)} · ` +
      `owner view ${ownerKey ? 'enabled' : 'DISABLED (no ZURI_PRICING_OWNER_KEY)'}`
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('[pricing] failed to start:', err);
  process.exit(1);
});
