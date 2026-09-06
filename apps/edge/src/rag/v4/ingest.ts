import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { buildGraphV4, embeddableNodes, type BuildInputs } from './build-graph.js';
import { buildUnpricedWorklist, parseFlowAccountRows, readFlowAccountXlsx, type PricePdfRef } from './flowaccount.js';
import type { CategoryGroupMap, TypeAliases } from './config.js';
import type { IdentityReview, Catalog2026Item } from './identity-types.js';
import { COLLECTION, EMBED_MODEL, EMBED_MODEL_REVISION, VECTOR_DIM } from './schema.js';
import type { EmbedClient } from './embed-client.js';

export interface IngestDb {
  createCollection(name: string, model: string, dim: number, metric: string): Promise<void>;
  listCollections(): Array<{ name: string; dim: number; metric: string; count: number }>;
  bulkAddNodes(n: Array<{ id: string; labels: string[]; props: any }>): Promise<void>;
  bulkAddEdges(e: Array<{ id: string; from: string; to: string; rel: string; props?: any }>): Promise<void>;
  addVector(nodeId: string, collection: string, embedding: number[]): Promise<void>;
  flushIndex(): Promise<void>;
  saveState(): Promise<void>;
}

export interface IngestPaths {
  dataRoot: string;
  identity: string;
  catalog: string;
  flowaccount: string;
  categoryMap: string;
  aliases: string;
  storeRoot: string; /* …/genesis_smartgift_store_v4 */
  /** Optional prebuilt index base -> where the price exists in the ใบราคา PDFs. Informational
   * only (joined into review/unpriced-offers.jsonl) — deliberately NOT part of the manifest
   * input hashes, so adding/refreshing it never forces a reingest. */
  pdfIndex?: string;
}

export interface IngestManifest {
  runId: string;
  createdAt: string;
  /** Bumped whenever the graph schema (node/edge shape) changes in a way that requires a full
   * reingest even though the raw input files are byte-identical — e.g. Wave-4 A.1's denormalized
   * priceTiers/priceSource/offerCodes props. See `decide()`. */
  schemaVersion: string;
  inputs: Record<'identity' | 'flowaccount' | 'catalog' | 'categoryMap' | 'aliases', { path: string; sha256: string }>;
  stats: Record<string, number>;
  vectors: number;
  collection: 'e5_v4';
  model: string;
  revision: string;
  flowaccountExportDate: '2026-06-21';
}

/** Current graph schema version (Wave-4 A.3). `decide()` forces a reingest whenever the previous
 * manifest's schemaVersion differs from this — including when it is absent entirely (a manifest
 * written before this field existed). */
export const SCHEMA_VERSION = 'v4.3'; // v4.3: CODE_RX/NAME_RX recover TFA-2/DY05601-shaped bases and
// a "Model:"+price-gated untagged Gift Set path — same flowaccount.xlsx, different lines parsed

export type IngestDecision = 'skip' | 'reingest';

const INPUT_KEYS: Array<keyof IngestManifest['inputs']> = ['identity', 'flowaccount', 'catalog', 'categoryMap', 'aliases'];

function sha256File(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function hashInputs(p: IngestPaths): IngestManifest['inputs'] {
  return {
    identity: { path: p.identity, sha256: sha256File(p.identity) },
    flowaccount: { path: p.flowaccount, sha256: sha256File(p.flowaccount) },
    catalog: { path: p.catalog, sha256: sha256File(p.catalog) },
    categoryMap: { path: p.categoryMap, sha256: sha256File(p.categoryMap) },
    aliases: { path: p.aliases, sha256: sha256File(p.aliases) },
  };
}

export function decide(prev: IngestManifest | null, inputs: IngestManifest['inputs']): IngestDecision {
  if (!prev) return 'reingest';
  if (prev.schemaVersion !== SCHEMA_VERSION) return 'reingest';
  for (const k of INPUT_KEYS) {
    if (prev.inputs[k]?.sha256 !== inputs[k]?.sha256) return 'reingest';
  }
  return 'skip';
}

function readCurrentManifest(storeRoot: string): IngestManifest | null {
  const currentPath = path.join(storeRoot, 'CURRENT');
  if (!fs.existsSync(currentPath)) return null;
  const runId = fs.readFileSync(currentPath, 'utf8').trim();
  if (!runId) return null;
  const manifestPath = path.join(storeRoot, runId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as IngestManifest;
  } catch {
    return null;
  }
}

export async function runIngest(
  p: IngestPaths,
  deps: {
    openDb: (dir: string) => IngestDb;
    embed: EmbedClient;
    now: () => Date;
    runId: string;
    serviceHealth?: () => Promise<{ storePath?: string; staleRun?: boolean } | null>;
  },
): Promise<{ decision: IngestDecision; runDir?: string; manifest?: IngestManifest; exitCode: 0 | 2 | 3 }> {
  // 1. read + hash the 5 inputs
  const inputs = hashInputs(p);

  // 2. decide (read CURRENT -> <run>/manifest.json)
  const prev = readCurrentManifest(p.storeRoot);
  const decision = decide(prev, inputs);
  if (decision === 'skip') {
    return { decision, exitCode: 0 };
  }

  // 3. buildGraphV4
  const identity: IdentityReview = JSON.parse(fs.readFileSync(p.identity, 'utf8'));
  const catalog: Catalog2026Item[] = JSON.parse(fs.readFileSync(p.catalog, 'utf8'));
  const categoryMap: CategoryGroupMap = JSON.parse(fs.readFileSync(p.categoryMap, 'utf8'));
  const aliases: TypeAliases = JSON.parse(fs.readFileSync(p.aliases, 'utf8'));
  const flowaccountRows = await readFlowAccountXlsx(p.flowaccount);
  const flowaccount = parseFlowAccountRows(flowaccountRows);

  const buildInputs: BuildInputs = {
    identity,
    catalog,
    flowaccount,
    categoryMap,
    aliases,
    refs: {
      identity: { file: path.basename(p.identity), sha256: inputs.identity.sha256, rowKey: '' },
      catalog: { file: path.basename(p.catalog), sha256: inputs.catalog.sha256, rowKey: '' },
      flowaccount: { file: path.basename(p.flowaccount), sha256: inputs.flowaccount.sha256, rowKey: '' },
    },
  };
  const batch = buildGraphV4(buildInputs);

  // 4. embeddableNodes
  const toEmbed = embeddableNodes(batch);

  // 5. embed ALL texts before any db call; sidecar failure => exitCode 2 before any db call
  let vectors: number[][];
  try {
    vectors = await deps.embed.embed(toEmbed.map((n) => n.text), 'passage');
  } catch {
    return { decision, exitCode: 2 };
  }
  if (vectors.length !== toEmbed.length) {
    return { decision, exitCode: 2 };
  }

  const runId = deps.runId;
  const runDir = path.join(p.storeRoot, runId);

  // 6. openDb(runDir) (lock error => 3)
  let db: IngestDb;
  try {
    db = deps.openDb(runDir);
  } catch {
    return { decision, exitCode: 3 };
  }

  await db.createCollection(COLLECTION, EMBED_MODEL, VECTOR_DIM, 'cosine');
  await db.bulkAddNodes(batch.nodes);
  await db.bulkAddEdges(batch.edges);
  for (let i = 0; i < toEmbed.length; i++) {
    await db.addVector(toEmbed[i].id, COLLECTION, vectors[i]);
  }
  await db.flushIndex();
  await db.saveState();

  // 7. verify listCollections() count === N and stats
  const collections = db.listCollections();
  const info = collections.find((c) => c.name === COLLECTION);
  if (!info || info.count !== toEmbed.length) {
    return { decision, exitCode: 3 };
  }

  const manifest: IngestManifest = {
    runId,
    createdAt: deps.now().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    inputs,
    stats: batch.stats,
    vectors: toEmbed.length,
    collection: COLLECTION,
    model: EMBED_MODEL,
    revision: EMBED_MODEL_REVISION,
    flowaccountExportDate: '2026-06-21',
  };

  // 8. write manifest.json then CURRENT only after verify passes
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(p.storeRoot, 'CURRENT'), runId);

  // 9. write review/flowaccount-buckets.jsonl
  const reviewDir = path.join(runDir, 'review');
  fs.mkdirSync(reviewDir, { recursive: true });
  const jsonl = flowaccount.review.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(path.join(reviewDir, 'flowaccount-buckets.jsonl'), jsonl.length ? `${jsonl}\n` : '');

  // 9b. write review/unpriced-offers.jsonl (RCA-PRICE-DATA-LOSS prevention #5): gift-set bases
  // whose every FlowAccount line has UnitPrice 0 — the sales worklist, joined against the
  // optional price-PDF index when present.
  let pdfIndex: Record<string, PricePdfRef[]> | undefined;
  if (p.pdfIndex && fs.existsSync(p.pdfIndex)) {
    try {
      pdfIndex = JSON.parse(fs.readFileSync(p.pdfIndex, 'utf8'));
    } catch {
      console.warn(`[ingest] ignoring unreadable price-PDF index at ${p.pdfIndex}`);
    }
  }
  const unpriced = buildUnpricedWorklist(flowaccount.lines, pdfIndex);
  const unpricedJsonl = unpriced.map((e) => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(reviewDir, 'unpriced-offers.jsonl'), unpricedJsonl.length ? `${unpricedJsonl}\n` : '');

  // 10. log service restart warning (best-effort, non-fatal). Two independent signals mean
  // "the running service will not serve this ingest until it is restarted": the service's own
  // /health already says its open store is behind CURRENT (staleRun), or its opened storePath
  // simply does not name this run yet. Either one alone is enough to warn — a store can be
  // staleRun while its storePath string still happens to contain runId as a substring (or vice
  // versa), so neither check subsumes the other.
  if (deps.serviceHealth) {
    try {
      const health = await deps.serviceHealth();
      if (health) {
        const staleRun = health.staleRun === true;
        const storeMismatch = !health.storePath?.includes(runId);
        if (staleRun || storeMismatch) {
          console.warn(
            `[ingest] rag-service must be restarted to pick up run ${runId} ` +
              `(staleRun=${staleRun}, storePath=${health.storePath ?? 'unknown'}).`,
          );
        }
      }
    } catch {
      // best-effort only; never fails the ingest
    }
  }

  return { decision, runDir, manifest, exitCode: 0 };
}
