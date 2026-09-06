// Stage 3 of the v4 catalog pipeline: the HTTP face of the store.
//
// The design puts one process in front of the GenesisBlock store — everything else (the LINE
// agent, the MCP pricing server, the eval harness) reaches the catalog over this socket rather
// than opening the store itself, because the engine takes a writer lock per directory and a
// second opener would fail or, worse, serve a stale run.
//
// That process used to live in a separate `zuri-rag-service` checkout that is not part of this
// repo, which left ingest with nothing to serve its output. This is that service, in-repo and
// reading the same CURRENT pointer ingest writes.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { searchV4, priceV4, type GraphDb, type SearchDeps } from './search.js';
import { createEmbedClient } from './embed-client.js';
import { aliasIndex, loadCategoryGroupMap, loadTypeAliases } from './config.js';
import { loadGenesisDatabase } from './genesis-binding.js';
import { resolvePipelinePaths } from './paths.js';
import { VECTOR_DIM } from './schema.js';
import { buildGraphSnapshot, DEFAULT_NODE_LIMIT } from './graph-snapshot.js';

export const DEFAULT_RAG_PORT = 8888;

export interface RagHealth {
  ok: boolean;
  dbReady: boolean;
  embedReady: boolean;
  storePath: string | null;
  runId: string | null;
  /** True when CURRENT names a newer run than the one this process has open. */
  staleRun: boolean;
  currentRunId: string | null;
}

export interface RagServer {
  port: number;
  close: () => Promise<void>;
  health: () => Promise<RagHealth>;
}

export interface RagServerOptions {
  port?: number;
  /** Loopback by default; exposing the catalog beyond this machine is a tunnel's job. */
  host?: string;
  storeRoot?: string;
  embedUrl?: string;
  log?: (line: string) => void;
}

/** Reads the run id the store root's CURRENT pointer names, or null. */
export function readCurrentRunId(storeRoot: string): string | null {
  const pointer = process.env.RAG_STORE_POINTER?.trim() || path.join(storeRoot, 'CURRENT');
  if (!fs.existsSync(pointer)) return null;
  const runId = fs.readFileSync(pointer, 'utf8').trim();
  return runId || null;
}

/**
 * Builds the SearchDeps the query path needs: the opened store, an embed client, and the three
 * lookup maps derived from the git-versioned config.
 */
export function buildSearchDeps(db: GraphDb, embedUrl: string): SearchDeps {
  const aliases = loadTypeAliases();
  const categoryMap = loadCategoryGroupMap();
  return {
    db,
    embed: createEmbedClient(embedUrl, { timeoutMs: 5000 }),
    aliases: aliasIndex(aliases),
    typeNames: new Map(aliases.types.map((t) => [t.typeId, t.name_th])),
    typeGroups: new Map(Object.entries(categoryMap.typeToGroup)),
  };
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage, limitBytes = 64 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export async function startRagServer(opts: RagServerOptions = {}): Promise<RagServer> {
  const paths = resolvePipelinePaths();
  const storeRoot = opts.storeRoot ?? paths.storeRoot;
  const embedUrl = opts.embedUrl ?? process.env.EMBED_URL ?? 'http://127.0.0.1:8891';
  const log = opts.log ?? ((line: string) => console.log(line));

  const openedRunId = readCurrentRunId(storeRoot);
  if (!openedRunId) {
    throw new Error(
      `RAG_STORE_EMPTY: no CURRENT pointer under ${storeRoot}. Run \`npm run catalog:ingest-v4\` first.`,
    );
  }
  const storePath = path.join(storeRoot, openedRunId);
  if (!fs.existsSync(storePath)) {
    throw new Error(`RAG_STORE_MISSING: CURRENT names ${openedRunId} but ${storePath} does not exist.`);
  }

  const GenesisDatabase = loadGenesisDatabase();
  // readOnly: this process only serves. Ingest writes new run dirs beside this one and swings
  // CURRENT, so the serving store is never the one being written.
  const db = GenesisDatabase.open({
    path: storePath,
    vectorDim: VECTOR_DIM,
    retention: 'frontier_only',
    readOnly: true,
  }) as GraphDb;

  const deps = buildSearchDeps(db, embedUrl);

  const health = async (): Promise<RagHealth> => {
    const currentRunId = readCurrentRunId(storeRoot);
    const embedHealth = await deps.embed.health();
    return {
      ok: embedHealth.ok,
      dbReady: true,
      embedReady: embedHealth.ok,
      storePath,
      runId: openedRunId,
      currentRunId,
      staleRun: !!currentRunId && currentRunId !== openedRunId,
    };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void (async () => {
      try {
        if (req.method === 'GET' && url.pathname === '/health') {
          const h = await health();
          send(res, h.ok ? 200 : 503, h);
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/graph') {
          // Read-only projection of the store for the Live Graph Viewer. GET so the viewer can
          // fetch it with no body, and so it is trivially cURL-able when diagnosing an empty graph.
          const raw = Number(url.searchParams.get('limit'));
          const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 5000) : DEFAULT_NODE_LIMIT;
          send(res, 200, await buildGraphSnapshot(db, { limit }));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/rag/search') {
          const body = await readJsonBody(req);
          const query = typeof body.query === 'string' ? body.query.trim() : '';
          if (!query) {
            send(res, 400, { success: false, error: 'query required' });
            return;
          }
          const overrides = { qty: num(body.qty), budgetPerUnit: num(body.budgetPerUnit) };
          const result = await searchV4(deps, query, {
            limit: num(body.limit),
            k: num(body.k),
            overrides,
            browseAll: body.browseAll === true,
            labelFilter: Array.isArray(body.labelFilter) ? body.labelFilter : undefined,
          });
          send(res, 200, result);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/rag/price') {
          const body = await readJsonBody(req);
          const code = typeof body.code === 'string' ? body.code.trim() : '';
          if (!code) {
            send(res, 400, { success: false, error: 'code required' });
            return;
          }
          send(res, 200, await priceV4(deps, code, num(body.qty) ?? null));
          return;
        }
        send(res, 404, { success: false, error: 'not found' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[rag-serve] ${req.method} ${url.pathname} failed: ${message}`);
        send(res, 500, { success: false, error: message });
      }
    })();
  });

  const port = opts.port ?? Number(process.env.RAG_PORT ?? DEFAULT_RAG_PORT);
  const host = opts.host ?? process.env.RAG_HOST ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = (server.address() as AddressInfo).port;
  log(`[rag-serve] listening on http://${host}:${actualPort} — store ${storePath}`);

  return {
    port: actualPort,
    health,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
