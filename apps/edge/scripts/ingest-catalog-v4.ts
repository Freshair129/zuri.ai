// Stage 2 of the v4 catalog pipeline: build the graph from the staged inputs, embed every
// ProductModel/CatalogOffer passage, and write a new GenesisBlock store run + CURRENT pointer.
//
// Paths come from src/rag/v4/paths.ts and the engine from src/rag/v4/genesis-binding.ts, so this
// script no longer hardcodes one machine's D:/ and G:/ drives. Run `npm run catalog:source-v4`
// first to generate the inputs.
import fs from 'node:fs';
import path from 'node:path';

import { runIngest, type IngestDb, type IngestPaths } from '../src/rag/v4/ingest.js';
import { createEmbedClient } from '../src/rag/v4/embed-client.js';
import { resolvePipelinePaths } from '../src/rag/v4/paths.js';
import { loadGenesisDatabase } from '../src/rag/v4/genesis-binding.js';

const resolved = resolvePipelinePaths();

const paths: IngestPaths = {
  dataRoot: resolved.dataRoot,
  identity: resolved.identity,
  catalog: resolved.catalog,
  flowaccount: resolved.flowaccount,
  categoryMap: resolved.categoryMap,
  aliases: resolved.aliases,
  storeRoot: resolved.storeRoot,
  // Optional (informational, never forces a reingest): where each base's price exists in the
  // ใบราคา PDFs, built by scripts/build-price-pdf-index.py. Joined into review/unpriced-offers.jsonl.
  pdfIndex: resolved.pdfIndex,
};

const RAG_PORT = process.env.RAG_PORT ?? '8888';

function openDb(dir: string): IngestDb {
  const GenesisDatabase = loadGenesisDatabase();
  fs.mkdirSync(dir, { recursive: true });
  return GenesisDatabase.open({ path: dir, vectorDim: 384, retention: 'frontier_only' }) as IngestDb;
}

/** Fails fast with an actionable message rather than letting readFileSync throw a bare ENOENT. */
function requireInputs(): void {
  const missing = (
    [
      ['identity-review.json', paths.identity],
      ['catalog-2026.json', paths.catalog],
      ['flowaccount xlsx', paths.flowaccount],
    ] as const
  ).filter(([, p]) => !fs.existsSync(p));
  if (!missing.length) return;
  console.error(
    `[ingest-catalog-v4] missing generated inputs:\n` +
      missing.map(([label, p]) => `  - ${label}: ${p}`).join('\n') +
      `\n  Run: npm run catalog:source-v4`,
  );
  process.exit(2);
}

async function serviceHealth(): Promise<{ storePath?: string; staleRun?: boolean } | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    try {
      const resp = await fetch(`http://localhost:${RAG_PORT}/health`, { signal: ctl.signal });
      if (!resp.ok) return null;
      return (await resp.json()) as { storePath?: string; staleRun?: boolean };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  requireInputs();

  // Ingest is an offline batch job (not the LINE agent's 3 s request budget) and embeds
  // every ProductModel/CatalogOffer passage in one call, which can take minutes on CPU.
  const embedUrl = process.env.EMBED_URL ?? 'http://127.0.0.1:8891';
  const embed = createEmbedClient(embedUrl, { timeoutMs: 900000 });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const result = await runIngest(paths, {
    openDb,
    embed,
    now: () => new Date(),
    runId,
    serviceHealth,
  });

  if (result.exitCode === 2) {
    console.error(
      `[ingest-catalog-v4] embedding failed (exit 2). Is the embed sidecar up at ${embedUrl}?\n` +
        `  Start it with: npm run embed:serve`,
    );
    process.exit(2);
    return;
  }
  if (result.exitCode !== 0) {
    console.error(`[ingest-catalog-v4] failed with exit code ${result.exitCode} (decision=${result.decision})`);
    process.exit(result.exitCode);
    return;
  }

  if (result.decision === 'skip') {
    console.log('[ingest-catalog-v4] inputs unchanged; skipped ingest.');
  } else {
    console.log(`[ingest-catalog-v4] ingested run ${result.manifest?.runId ?? runId} -> ${result.runDir}`);
    console.log(`[ingest-catalog-v4] stats: ${JSON.stringify(result.manifest?.stats)}`);
    console.log(`[ingest-catalog-v4] vectors: ${result.manifest?.vectors}`);
    console.log(`[ingest-catalog-v4] CURRENT -> ${path.join(paths.storeRoot, 'CURRENT')}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[ingest-catalog-v4] unexpected error:', err);
  process.exit(3);
});
