// Bundled query sets are synthetic. Evaluate only against a matching synthetic ingest.
// Catalog graph v4 eval harness (plan T16, spec §8). Two modes:
//   --mode v4                HTTP against a running zuri-rag-service (GENESIS_RAG_API_URL,
//                             default http://localhost:8888 — the service's own default RAG_PORT)
//   --mode baseline-substring in-process src/catalog/store.ts searchByName over
//                             $ZURI_DATA_ROOT/source/catalog-2026.json (the pre-v4 substring
//                             search); has no notion of ProductModel/type/price-ladder, so it
//                             legitimately scores near-zero on every graph-aware metric — see
//                             `toEvalResultBaseline` below.
//
// Bare invocation (no flags) = `--mode v4` with the gate ON (Wave-4 C). `--baseline substring`
// (or `--baseline=substring`) is accepted as an alias of `--mode baseline-substring`.
// `--alpha <n>` sends that hybridSearch alpha on every request (recorded in manifest.json).
//
// Writes manifest.json / queries.jsonl / results.jsonl / metrics.jsonl / errors.jsonl /
// environment-manifest.json under $ZURI_DATA_ROOT/catalog_eval_v4/<runId>/ (schema modelled on
// data/catalog_vector_benchmark_round1_v1/metrics.jsonl). --no-gate disables the exit(1) on a
// failed target.
//
// --gen-offer-self generates $ZURI_DATA_ROOT/catalog_eval_v4/generated/QS_OFFER_SELF_v1.jsonl from
// data/catalog_vector_benchmark_round1_v1/vector-input-round1.json (cohort COHORT_R1_RESOLVED_375)
// and exits — it does not run an eval.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildGraphV4, type BuildInputs } from '../src/rag/v4/build-graph.js';
import { parseFlowAccountRows, readFlowAccountXlsx } from '../src/rag/v4/flowaccount.js';
import { loadCategoryGroupMap, loadTypeAliases, CATEGORY_MAP_FILE, TYPE_ALIASES_FILE } from '../src/rag/v4/config.js';
import type { IdentityReview, Catalog2026Item } from '../src/rag/v4/identity-types.js';
import { EMBED_MODEL, EMBED_MODEL_REVISION, offerNodeId } from '../src/rag/v4/schema.js';
import type { ResultV4 } from '../src/rag/v4/search.js';
import { searchByName, type Catalog, type CatalogProduct } from '../src/catalog/store.js';
import { resolvePipelinePaths } from '../src/rag/v4/paths.js';
import {
  hit,
  recallAtK,
  mrr,
  negConstraintPass,
  duplicateResultRate,
  percentile,
  priceCoverage,
  variantCoverage,
  traceCoverage,
  priceLinkCoverage,
  type EvalResult,
  type ExpectedTarget,
  type RankedQuery,
} from './lib/eval-metrics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

// --- CLI args ----------------------------------------------------------------------------
// Bare invocation (no flags at all) = `--mode v4` with the gate ON — see the module doc comment.
export interface Args { mode: 'v4' | 'baseline-substring'; gate: boolean; genOfferSelf: boolean; alpha: number | null }

export function parseArgs(argv: string[]): Args {
  const out: Args = { mode: 'v4', gate: true, genOfferSelf: false, alpha: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = argv[++i] as Args['mode'];
    else if (a.startsWith('--mode=')) out.mode = a.slice('--mode='.length) as Args['mode'];
    else if (a === '--baseline') { if (argv[++i] === 'substring') out.mode = 'baseline-substring'; }
    else if (a === '--baseline=substring') out.mode = 'baseline-substring';
    else if (a === '--no-gate') out.gate = false;
    else if (a === '--gen-offer-self') out.genOfferSelf = true;
    else if (a === '--alpha') out.alpha = Number(argv[++i]);
    else if (a.startsWith('--alpha=')) out.alpha = Number(a.slice('--alpha='.length));
  }
  return out;
}

// --- Query set line shapes (tests/fixtures/v4/querysets/*.jsonl) -------------------------
interface QsLine {
  id: string;
  text: string;
  expected: { kind: 'model' | 'type'; id: string };
  exclude: string[];
  qty: number | null;
  budget: number | null;
  group?: string;
  intent?: string;
}
interface QsOfferSelfLine {
  id: string;
  offerId: string;
  sourceCode: string;
  text: string;
  expected: { kind: 'model'; ids: string[] };
  restricted: true;
}

function readJsonl<T>(p: string): T[] {
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line) as T);
}
function writeJsonl(p: string, lines: unknown[]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n');
  fs.writeFileSync(p, body.length ? `${body}\n` : '');
}

// --- Legacy offer-self generator (separate from bundled synthetic fixtures) ----------------
// The round1 benchmark's own per-offer metric (see catalog_vector_benchmark_round1_v1/metrics.jsonl
// cohortId=COHORT_R1_RESOLVED_375, denominator=1005) restricts to offers whose *every* resolved
// component target productId belongs to a productMaster carrying that cohort membership — verified
// historically yielded 1,005 lines (spec §8.2); this is not the synthetic set's provenance.
//
// NOTE on a plan-text divergence: the T16 task text says "expected = resolvedTargetProductIds",
// but that exact field name only exists in catalog_vector_benchmark_round1_v1/benchmark-results.jsonl
// (an *output* of the round1 run) — the source file this generator actually reads,
// vector-input-round1.json, does not carry a field of that name. Reconstructing it takes two
// fields per catalogOffer entry: `resolvedComponentTargetProductIds` (component-linked "set"
// offers) falling back to `referenceTargetProductIds` when the former is empty (offers with no
// componentTargets at all — typically offerKind 'single'). Verified this fallback reproduces
// benchmark-results.jsonl's own resolvedTargetProductIds exactly on all 1,016 offers (0 mismatches)
// historically yielded 1,005 non-empty results, matching spec §8.2's original QS_OFFER_SELF_v1
// size and metrics.jsonl's COHORT_R1_RESOLVED_375 denominator.
interface Round1ProductMaster { productId: string; cohortMembership?: string[] }
interface Round1CatalogOffer {
  offerId: string;
  sourceCode: string;
  resolvedComponentTargetProductIds?: string[];
  referenceTargetProductIds?: string[];
  text: string;
}
interface Round1VectorInput { productMasters: Round1ProductMaster[]; catalogOffers: Round1CatalogOffer[] }

export function generateOfferSelfQuerySet(input: Round1VectorInput): QsOfferSelfLine[] {
  const resolvedIds = new Set(
    input.productMasters.filter((p) => (p.cohortMembership ?? []).includes('COHORT_R1_RESOLVED_375')).map((p) => p.productId),
  );
  const out: QsOfferSelfLine[] = [];
  for (const o of input.catalogOffers) {
    const componentIds = o.resolvedComponentTargetProductIds ?? [];
    const ids = componentIds.length > 0 ? componentIds : (o.referenceTargetProductIds ?? []);
    if (ids.length === 0) continue;
    if (!ids.every((id) => resolvedIds.has(id))) continue;
    out.push({
      id: `OS-${o.sourceCode}`,
      offerId: o.offerId,
      sourceCode: o.sourceCode,
      text: o.text,
      expected: { kind: 'model', ids },
      restricted: true,
    });
  }
  return out;
}

function runGenOfferSelf(dataRoot: string): void {
  const inputPath = path.join(dataRoot, 'catalog_vector_benchmark_round1_v1', 'vector-input-round1.json');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Round1VectorInput;
  const lines = generateOfferSelfQuerySet(input);
  const outPath = path.join(dataRoot, 'catalog_eval_v4', 'generated', 'QS_OFFER_SELF_v1.jsonl');
  writeJsonl(outPath, lines);
  console.log(`[eval-catalog-v4] wrote ${lines.length} lines -> ${outPath}`);
}

// --- Baseline (substring) search adapter --------------------------------------------------
// src/catalog/store.ts's CatalogProduct carries factory-cost fields (rmb/upc/dims/kg/e) that
// catalog-2026.json's flat Catalog2026Item[] doesn't have; searchByName only reads `.code`/`.name`,
// so the placeholder fields below are never read by it, only present to satisfy the real type.
function toCatalogProduct(item: Catalog2026Item): CatalogProduct {
  return { code: item.code, name: item.name, rmb: null, upc: null, dims: null, kg: null, e: false, img: item.image ?? undefined, book: 'catalog-2026' };
}

function loadBaselineCatalog(dataRoot: string): Catalog {
  const catalogPath = path.join(dataRoot, 'source', 'catalog-2026.json');
  const items = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Catalog2026Item[];
  const products = items.map(toCatalogProduct);
  const byCode = new Map(products.map((p) => [p.code.toUpperCase(), p]));
  return { products, byCode };
}

// --- Per-mode search runner -----------------------------------------------------------------
interface SearchOutcome { results: EvalResult[]; nearest: EvalResult[]; latencyMs: number; error: string | null }

function toEvalResult(r: ResultV4): EvalResult {
  return {
    id: r.id,
    kind: r.kind,
    type: r.type ? { id: r.type.id } : null,
    components: (r.components ?? []).map((c) => ({ modelId: c.modelId, typeId: c.typeId })),
  };
}

/** Deliberately drops type/component information: substring search has no ProductModel/type
 * concept at all, so every graph-aware hit() check against a baseline result is a genuine miss —
 * the "honest zeros" this mode is meant to produce, not a fabricated pass/fail. */
function toEvalResultBaseline(p: CatalogProduct): EvalResult {
  return { id: p.code, kind: 'offer', type: null, components: [] };
}

async function v4Search(
  apiUrl: string,
  query: string,
  limit: number,
  opts: { labelFilter?: Array<'model' | 'offer'>; alpha?: number | null } = {},
): Promise<SearchOutcome> {
  const t0 = performance.now();
  try {
    const body: Record<string, unknown> = { query, limit };
    if (opts.labelFilter) body.labelFilter = opts.labelFilter;
    if (opts.alpha !== undefined && opts.alpha !== null) body.alpha = opts.alpha;
    const res = await fetch(`${apiUrl}/api/rag/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const latencyMs = performance.now() - t0;
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      return { results: [], nearest: [], latencyMs, error: `http_${res.status}:${body.detail ?? body.error ?? ''}` };
    }
    const data = (await res.json()) as { results: ResultV4[]; nearest: ResultV4[] };
    return { results: data.results.map(toEvalResult), nearest: data.nearest.map(toEvalResult), latencyMs, error: null };
  } catch (err) {
    return { results: [], nearest: [], latencyMs: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

function baselineSearch(catalog: Catalog, query: string, limit: number): SearchOutcome {
  const t0 = performance.now();
  try {
    const hits = searchByName(catalog, query, limit);
    return { results: hits.map(toEvalResultBaseline), nearest: [], latencyMs: performance.now() - t0, error: null };
  } catch (err) {
    return { results: [], nearest: [], latencyMs: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Graph-level coverage (computed once from real inputs, same for both modes — plan T16 chose
// "rebuild the GraphBatch from inputs with buildGraphV4" over reading a live store: it needs no
// running service/store, and PRICE/VARIANT/TRACE coverage are catalog data-quality properties,
// not properties of a particular search engine, so both modes must report the identical number) --
async function computeGraphCoverage(dataRoot: string): Promise<{
  priceCoverage: ReturnType<typeof priceCoverage>;
  priceLinkCoverage: ReturnType<typeof priceLinkCoverage>;
  variantCoverage: ReturnType<typeof variantCoverage>;
  traceCoverage: ReturnType<typeof traceCoverage>;
  reason: string | null;
}> {
  try {
    const identityPath = path.join(dataRoot, 'catalog_identity_review_user_logic_v1', 'identity-review.json');
    const catalogPath = path.join(dataRoot, 'source', 'catalog-2026.json');
    const flowPath = path.join(dataRoot, 'source', 'flowaccount-product-2026-06-21.xlsx');
    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8')) as IdentityReview;
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as Catalog2026Item[];
    const categoryMap = loadCategoryGroupMap();
    const aliases = loadTypeAliases();
    const rows = await readFlowAccountXlsx(flowPath);
    const flowaccount = parseFlowAccountRows(rows);
    const distinctBases = new Set(
      flowaccount.lines.filter((l) => l.bucket === 'parsed' || l.bucket === 'name_coded').map((l) => l.base),
    ).size;
    const buildInputs: BuildInputs = {
      identity,
      catalog,
      flowaccount,
      categoryMap,
      aliases,
      refs: {
        identity: { file: 'identity-review.json', sha256: sha256File(identityPath), rowKey: '' },
        catalog: { file: 'catalog-2026.json', sha256: sha256File(catalogPath), rowKey: '' },
        flowaccount: { file: 'flowaccount-product-2026-06-21.xlsx', sha256: sha256File(flowPath), rowKey: '' },
      },
    };
    const batch = buildGraphV4(buildInputs);
    return {
      priceCoverage: priceCoverage(batch, distinctBases),
      priceLinkCoverage: priceLinkCoverage(batch, flowaccount.lines),
      variantCoverage: variantCoverage(batch, batch.stats.ProductModel),
      traceCoverage: traceCoverage(batch),
      reason: null,
    };
  } catch (err) {
    const zero = { numerator: 0, denominator: 0, value: 0, status: 'no_data' as const };
    return { priceCoverage: zero, priceLinkCoverage: zero, variantCoverage: zero, traceCoverage: zero, reason: err instanceof Error ? err.message : String(err) };
  }
}

function sha256File(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// --- Metric line schema (modelled on catalog_vector_benchmark_round1_v1/metrics.jsonl) ----------
interface MetricLine {
  metricId: string;
  numerator: number;
  denominator: number;
  value: number;
  status: 'measured' | 'no_data';
  evidence: string[];
  unit: 'ratio' | 'ms';
  target: string | null;
  pass: boolean | null;
  reason: string | null;
  runId: string;
  querySetId: string | null;
}

function metricLine(
  metricId: string,
  agg: { numerator: number; denominator: number; value: number; status: 'measured' | 'no_data' },
  opts: { evidence: string[]; unit: 'ratio' | 'ms'; target: string | null; pass: boolean | null; querySetId: string | null; reason?: string | null },
  runId: string,
): MetricLine {
  return {
    metricId,
    numerator: agg.numerator,
    denominator: agg.denominator,
    value: agg.value,
    status: agg.status,
    evidence: opts.evidence,
    unit: opts.unit,
    target: opts.target,
    pass: opts.pass,
    reason: opts.reason ?? null,
    runId,
    querySetId: opts.querySetId,
  };
}

// --- Main ------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = resolvePipelinePaths().dataRoot;

  if (args.genOfferSelf) {
    runGenOfferSelf(dataRoot);
    return;
  }

  if (args.mode !== 'v4' && args.mode !== 'baseline-substring') {
    console.error('[eval-catalog-v4] --mode v4|baseline-substring is required (or --gen-offer-self).');
    process.exit(2);
    return;
  }

  const startedAt = new Date();
  const runId = args.mode === 'baseline-substring' ? 'BASELINE_SUBSTRING' : `V4_${startedAt.toISOString().replace(/[:.]/g, '-')}`;
  const outDir = path.join(dataRoot, 'catalog_eval_v4', runId);
  fs.mkdirSync(outDir, { recursive: true });

  const apiUrl = (process.env.GENESIS_RAG_API_URL ?? 'http://localhost:8888').replace(/\/$/, '');
  const baselineCatalog = args.mode === 'baseline-substring' ? loadBaselineCatalog(dataRoot) : null;

  async function run(query: string, limit: number, opts: { labelFilter?: Array<'model' | 'offer'> } = {}): Promise<SearchOutcome> {
    if (args.mode === 'v4') return v4Search(apiUrl, query, limit, { labelFilter: opts.labelFilter, alpha: args.alpha });
    return baselineSearch(baselineCatalog!, query, limit);
  }

  const qsDir = path.join(REPO_ROOT, 'tests', 'fixtures', 'v4', 'querysets');
  const nlLines = readJsonl<QsLine>(path.join(qsDir, 'QS_NL_SYNTHETIC_v1.jsonl')).map((l) => ({ ...l, querySetId: 'QS_NL_SYNTHETIC_v1' }));
  const lineLines = readJsonl<QsLine>(path.join(qsDir, 'QS_LINE_SYNTHETIC_v1.jsonl')).map((l) => ({ ...l, querySetId: 'QS_LINE_SYNTHETIC_v1' }));
  const offerSelfPath = path.join(qsDir, 'QS_OFFER_SYNTHETIC_v1.jsonl');
  const offerSelfLines = fs.existsSync(offerSelfPath) ? readJsonl<QsOfferSelfLine>(offerSelfPath) : [];

  const combined = [...nlLines, ...lineLines];

  const queriesOut: unknown[] = [];
  const resultsOut: unknown[] = [];
  const errorsOut: unknown[] = [];

  const rankedQueries: RankedQuery[] = [];
  const negQueries: Array<{ excludeTypes: string[]; results: EvalResult[]; nearest: EvalResult[] }> = [];
  const dupQueries: Array<{ results: EvalResult[] }> = [];
  const latencies: number[] = [];

  for (const line of combined) {
    const outcome = await run(line.text, 10);
    latencies.push(outcome.latencyMs);
    queriesOut.push({ id: line.id, querySetId: line.querySetId, text: line.text, expected: line.expected, exclude: line.exclude, qty: line.qty, budget: line.budget });
    resultsOut.push({
      id: line.id, querySetId: line.querySetId, mode: args.mode,
      resultsIds: outcome.results.map((r) => r.id), nearestIds: outcome.nearest.map((r) => r.id),
      latencyMs: outcome.latencyMs, error: outcome.error,
    });
    if (outcome.error) errorsOut.push({ id: line.id, querySetId: line.querySetId, query: line.text, error: outcome.error });

    const expected: ExpectedTarget = { kind: line.expected.kind, ids: [line.expected.id] };
    rankedQueries.push({ ranked: outcome.results, expected });
    negQueries.push({ excludeTypes: line.exclude, results: outcome.results, nearest: outcome.nearest });
    dupQueries.push({ results: outcome.results });
  }

  // --- OFFER_SELF_RECALL_AT_5_RESTRICTED (Wave-4 C): request labelFilter:['model'], limit 5
  // directly (the service does the k=max(baseK,400) broadening — spec §5.7/Wave-4 B), rather than
  // requesting a raw top-40 and filtering/slicing client-side. The query's own offer id is a
  // CatalogOffer id, which labelFilter:['model'] already excludes from `outcome.results`
  // entirely — the `r.id !== selfId` check below is now a defensive no-op, kept for clarity and
  // as a guard against a hypothetical id collision, not because it does real work anymore. ---
  const offerSelfRanked: RankedQuery[] = [];
  for (const line of offerSelfLines) {
    const outcome = await run(line.text, 5, { labelFilter: ['model'] });
    const selfId = offerNodeId(line.sourceCode);
    const restricted = outcome.results.filter((r) => r.id !== selfId);
    queriesOut.push({ id: line.id, querySetId: 'QS_OFFER_SYNTHETIC_v1', text: line.text, expected: line.expected, restricted: true });
    resultsOut.push({ id: line.id, querySetId: 'QS_OFFER_SYNTHETIC_v1', mode: args.mode, resultsIds: restricted.map((r) => r.id), nearestIds: [], latencyMs: outcome.latencyMs, error: outcome.error });
    if (outcome.error) errorsOut.push({ id: line.id, querySetId: 'QS_OFFER_SYNTHETIC_v1', query: line.text, error: outcome.error });
    offerSelfRanked.push({ ranked: restricted, expected: line.expected });
  }

  // --- Query-level metrics ---
  const r1 = recallAtK(rankedQueries, 1);
  const r5 = recallAtK(rankedQueries, 5);
  const r10 = recallAtK(rankedQueries, 10);
  const mrrAgg = mrr(rankedQueries);
  const negAgg = negConstraintPass(negQueries);
  const dupAgg = duplicateResultRate(dupQueries);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const offerSelfAgg = offerSelfLines.length ? recallAtK(offerSelfRanked, 5) : { numerator: 0, denominator: 0, value: 0, status: 'no_data' as const };

  // --- Graph-level metrics (same for both modes) ---
  const graph = await computeGraphCoverage(dataRoot);

  const evidenceFile = 'results.jsonl';
  const metrics: MetricLine[] = [
    metricLine('MET_V4_RECALL_AT_1', r1, { evidence: [evidenceFile], unit: 'ratio', target: null, pass: null, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_RECALL_AT_5', r5, { evidence: [evidenceFile], unit: 'ratio', target: '>=0.80', pass: r5.value >= 0.8, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_RECALL_AT_10', r10, { evidence: [evidenceFile], unit: 'ratio', target: null, pass: null, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_MRR', mrrAgg, { evidence: [evidenceFile], unit: 'ratio', target: '>=0.65', pass: mrrAgg.value >= 0.65, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_NEG_CONSTRAINT_PASS', negAgg, { evidence: [evidenceFile], unit: 'ratio', target: '==1.00', pass: negAgg.value >= 1, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    // Informational (spec updated): denominated over ALL distinct FlowAccount bases (118/216),
    // not just the ones a store's own PRICED_AS edges could possibly reach. No longer a gate —
    // MET_V4_PRICE_LINK_COVERAGE below is the graph-construction correctness gate instead.
    metricLine('MET_V4_PRICE_COVERAGE', graph.priceCoverage, { evidence: ['identity-review.json', 'source/flowaccount-product-2026-06-21.xlsx'], unit: 'ratio', target: '>=0.85', pass: null, querySetId: null, reason: graph.reason }, runId),
    metricLine('MET_V4_PRICE_LINK_COVERAGE', graph.priceLinkCoverage, { evidence: ['identity-review.json', 'source/flowaccount-product-2026-06-21.xlsx'], unit: 'ratio', target: '==1.00', pass: graph.priceLinkCoverage.value >= 1, querySetId: null, reason: graph.reason }, runId),
    metricLine('MET_V4_VARIANT_COVERAGE', graph.variantCoverage, { evidence: ['identity-review.json'], unit: 'ratio', target: '>=0.85', pass: graph.variantCoverage.value >= 0.85, querySetId: null, reason: graph.reason }, runId),
    metricLine('MET_V4_DUPLICATE_RESULT_RATE', dupAgg, { evidence: [evidenceFile], unit: 'ratio', target: '==0', pass: dupAgg.value === 0, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_LATENCY_P50_MS', { numerator: p50, denominator: 1, value: p50, status: 'measured' }, { evidence: [evidenceFile], unit: 'ms', target: null, pass: null, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_LATENCY_P95_MS', { numerator: p95, denominator: 1, value: p95, status: 'measured' }, { evidence: [evidenceFile], unit: 'ms', target: '<=800', pass: p95 <= 800, querySetId: 'QS_NL_SYNTHETIC_v1+QS_LINE_SYNTHETIC_v1' }, runId),
    metricLine('MET_V4_TRACE_COVERAGE', graph.traceCoverage, { evidence: ['identity-review.json'], unit: 'ratio', target: '>=1.00', pass: graph.traceCoverage.value >= 1, querySetId: null, reason: graph.reason }, runId),
    metricLine('MET_V4_OFFER_SELF_RECALL_AT_5_RESTRICTED', offerSelfAgg, { evidence: [evidenceFile], unit: 'ratio', target: '>=0.86', pass: offerSelfLines.length ? offerSelfAgg.value >= 0.86 : null, querySetId: 'QS_OFFER_SYNTHETIC_v1' }, runId),
  ];

  writeJsonl(path.join(outDir, 'queries.jsonl'), queriesOut);
  writeJsonl(path.join(outDir, 'results.jsonl'), resultsOut);
  writeJsonl(path.join(outDir, 'metrics.jsonl'), metrics);
  writeJsonl(path.join(outDir, 'errors.jsonl'), errorsOut);

  const finishedAt = new Date();
  const gateFailures = metrics.filter((m) => m.pass === false);
  const manifest = {
    runId,
    mode: args.mode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    ragApiUrl: args.mode === 'v4' ? apiUrl : null,
    alpha: args.alpha,
    baselineCatalogPath: args.mode === 'baseline-substring' ? path.join(dataRoot, 'source', 'catalog-2026.json') : null,
    querySets: {
      QS_NL_SYNTHETIC_v1: nlLines.length,
      QS_LINE_SYNTHETIC_v1: lineLines.length,
      QS_OFFER_SYNTHETIC_v1: offerSelfLines.length,
    },
    gateEnabled: args.gate,
    gateResult: !args.gate ? 'disabled' : gateFailures.length === 0 ? 'pass' : 'fail',
    gateFailures: gateFailures.map((m) => m.metricId),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  let gitBranch = null;
  let gitSha = null;
  let gitDirty = null;
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT }).toString().trim();
    gitSha = execSync('git rev-parse HEAD', { cwd: REPO_ROOT }).toString().trim();
    gitDirty = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim().length > 0;
  } catch {
    // best-effort only
  }
  // Best-effort: the store's schemaVersion, read from a plain GET /health (Wave-4 C) — the
  // service surfaces it (when a store is open) as manifest.schemaVersion of the run it opened.
  // Absent/unreachable service, or a service too old to report it -> null, never a hard failure.
  let storeSchemaVersion: string | null = null;
  if (args.mode === 'v4') {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      try {
        const healthRes = await fetch(`${apiUrl}/health`, { signal: ctl.signal });
        if (healthRes.ok) {
          const body = (await healthRes.json()) as { schemaVersion?: string | null };
          storeSchemaVersion = body.schemaVersion ?? null;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // best-effort only
    }
  }

  const environmentManifest = {
    runId,
    mode: args.mode,
    host: { os: os.platform(), osVersion: os.release(), arch: os.arch(), hostname: os.hostname() },
    cpu: { model: os.cpus()[0]?.model ?? null, logicalCores: os.cpus().length, ramTotalBytes: os.totalmem() },
    runtime: { node: process.version },
    repository: { repoId: 'zuri-edge-device', branch: gitBranch, commitSha: gitSha, gitDirty },
    model: args.mode === 'v4' ? { modelId: EMBED_MODEL, revision: EMBED_MODEL_REVISION } : null,
    ragApiUrl: args.mode === 'v4' ? apiUrl : null,
    schemaVersion: storeSchemaVersion,
  };
  fs.writeFileSync(path.join(outDir, 'environment-manifest.json'), JSON.stringify(environmentManifest, null, 2));

  // --- Print table ---
  console.log(`\n[eval-catalog-v4] mode=${args.mode} runId=${runId}`);
  console.log(`[eval-catalog-v4] output: ${outDir}`);
  const rows = metrics.map((m) => `${m.metricId.padEnd(42)} ${m.value.toFixed(4).padStart(8)}  target=${(m.target ?? '-').padEnd(9)} pass=${m.pass === null ? '-' : m.pass}`);
  console.log(rows.join('\n'));
  console.log(`[eval-catalog-v4] gate: ${manifest.gateResult}`);

  if (args.gate && gateFailures.length > 0) {
    process.exit(1);
  }
}

// Guard main() behind an entry-point check so `parseArgs`/`generateOfferSelfQuerySet` can be
// unit-imported (tests/unit/v4-eval-cli.test.ts) without running the CLI (fetches, process.exit).
const isMainModule = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    console.error('[eval-catalog-v4] unexpected error:', err);
    process.exit(3);
  });
}
