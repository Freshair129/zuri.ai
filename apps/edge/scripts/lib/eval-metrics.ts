// Pure metric functions for the catalog-v4 eval harness (spec §8.3 / plan T16).
// Kept dependency-free (no fetch, no fs) so tests/unit/v4-eval-metrics.test.ts can exercise
// every metric with tiny hand-written fixtures. The one exception is `offerNodeId` below (a pure
// string-formatting helper, no I/O), needed by `priceLinkCoverage` (Wave-4 F) to map a FlowAccount
// base code to the CatalogOffer node id it must appear as.
import { offerNodeId } from '../../src/rag/v4/schema.js';

/** The subset of ResultV4 the metrics need — same shape for both `--mode v4` (mapped from the
 * real HTTP response) and `--mode baseline-substring` (mapped from a plain substring hit, which
 * legitimately has no `type`/`components` — see scripts/eval-catalog-v4.ts `toEvalResult`). */
export interface EvalResult {
  id: string;
  kind: 'model' | 'offer';
  type: { id: string } | null;
  components: Array<{ modelId: string; typeId: string | null }>;
}

export interface ExpectedTarget {
  kind: 'model' | 'type';
  /** One or more acceptable target ids. QS_NL_SYNTHETIC_v1 / QS_LINE_SYNTHETIC_v1 carry exactly one;
   * QS_OFFER_SYNTHETIC_v1 carries every resolved component productId for the offer (OR semantics —
   * a query is a hit if *any* expected id is retrieved, matching round1's own recall method). */
  ids: string[];
}

export interface MetricAgg {
  numerator: number;
  denominator: number;
  value: number;
  status: 'measured' | 'no_data';
}

function agg(numerator: number, denominator: number): MetricAgg {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : 0,
    status: denominator > 0 ? 'measured' : 'no_data',
  };
}

/** hit(): §8.3 — expected model → result.id == id, or an Offer whose components contain it;
 * expected type → result.type.id == id, or an Offer whose components carry that typeId. */
export function hit(result: EvalResult, expected: ExpectedTarget): boolean {
  if (expected.kind === 'model') {
    if (expected.ids.includes(result.id)) return true;
    if (result.kind === 'offer') return result.components.some((c) => expected.ids.includes(c.modelId));
    return false;
  }
  if (result.type && expected.ids.includes(result.type.id)) return true;
  if (result.kind === 'offer') {
    return result.components.some((c) => c.typeId !== null && expected.ids.includes(c.typeId));
  }
  return false;
}

export interface RankedQuery {
  /** Results in the order the search engine returned them (already sliced to the k being
   * evaluated by the caller, e.g. top-1 / top-5 / top-10). */
  ranked: EvalResult[];
  expected: ExpectedTarget;
}

/** RECALL_AT_K: hit() true anywhere in the top-K / total queries. */
export function recallAtK(queries: RankedQuery[], k: number): MetricAgg {
  let hits = 0;
  for (const q of queries) {
    if (q.ranked.slice(0, k).some((r) => hit(r, q.expected))) hits++;
  }
  return agg(hits, queries.length);
}

/** MRR: mean(1 / rank of the first hit); 0 when no hit — same OR semantics as recallAtK. */
export function mrr(queries: RankedQuery[]): MetricAgg {
  let sum = 0;
  for (const q of queries) {
    const idx = q.ranked.findIndex((r) => hit(r, q.expected));
    if (idx >= 0) sum += 1 / (idx + 1);
  }
  return agg(sum, queries.length);
}

function violatesExclusion(r: EvalResult, excludeTypes: string[]): boolean {
  if (r.type && excludeTypes.includes(r.type.id)) return true;
  if (r.kind === 'offer') return r.components.some((c) => c.typeId !== null && excludeTypes.includes(c.typeId));
  return false;
}

export interface NegQuery {
  excludeTypes: string[];
  results: EvalResult[];
  nearest: EvalResult[];
}

/** NEG_CONSTRAINT_PASS (non-vacuous): among queries with exclude != [], a pass needs
 * (results >= 1 OR nearest >= 1) AND no result/nearest in an excluded type. A query with both
 * `results` and `nearest` empty (the engine returned nothing to check) must NOT count as a pass —
 * that would make the metric vacuously perfect. Denominator is always every exclude!=[] query. */
export function negConstraintPass(queries: NegQuery[]): MetricAgg {
  const withExclude = queries.filter((q) => q.excludeTypes.length > 0);
  let pass = 0;
  for (const q of withExclude) {
    const pool = [...q.results, ...q.nearest];
    if (pool.length === 0) continue; // vacuous — does not count as a pass
    if (!pool.some((r) => violatesExclusion(r, q.excludeTypes))) pass++;
  }
  return agg(pass, withExclude.length);
}

/** DUPLICATE_RESULT_RATE: queries whose `results` contain >=2 entries with the same id, / queries. */
export function duplicateResultRate(queries: Array<{ results: EvalResult[] }>): MetricAgg {
  let dup = 0;
  for (const q of queries) {
    const ids = q.results.map((r) => r.id);
    if (new Set(ids).size < ids.length) dup++;
  }
  return agg(dup, queries.length);
}

/** Nearest-rank percentile (p in [0,100]) over an array of latencies in ms. Empty input -> 0. */
export function percentile(valuesMs: number[], p: number): number {
  if (!valuesMs.length) return 0;
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[idx];
}

// --- Graph-level coverage metrics (independent of search mode — see plan T16 note: computed by
// rebuilding the GraphBatch from real inputs with buildGraphV4, not by querying a live store). ---

export interface GraphNodeLike { id: string; labels: string[]; props: Record<string, unknown> }
export interface GraphEdgeLike { id: string; from: string; to: string; rel: string; props?: Record<string, unknown> }
export interface GraphBatchLike { nodes: GraphNodeLike[]; edges: GraphEdgeLike[] }

/** PRICE_COVERAGE: CatalogOffer nodes with >=1 outgoing PRICED_AS edge to a CommercialSKU whose
 * `priceMissing === false`, over `distinctFlowAccountBases` (parsed+name_coded bases; caller
 * supplies this — it comes from ParsedFlowAccount, not the graph itself). */
export function priceCoverage(batch: GraphBatchLike, distinctFlowAccountBases: number): MetricAgg {
  const cskuById = new Map(batch.nodes.filter((n) => n.labels.includes('CommercialSKU')).map((n) => [n.id, n]));
  const pricedOfferIds = new Set<string>();
  for (const e of batch.edges) {
    if (e.rel !== 'PRICED_AS') continue;
    const csku = cskuById.get(e.to);
    if (csku && csku.props.priceMissing === false) pricedOfferIds.add(e.from);
  }
  return agg(pricedOfferIds.size, distinctFlowAccountBases);
}

/** VARIANT_COVERAGE: ProductModel nodes with >=1 HAS_VARIANT edge to a PhysicalVariant whose
 * `colors` is non-empty, over `productModelDenominator` (427 in the real catalog). */
export function variantCoverage(batch: GraphBatchLike, productModelDenominator: number): MetricAgg {
  const variantById = new Map(batch.nodes.filter((n) => n.labels.includes('PhysicalVariant')).map((n) => [n.id, n]));
  const withColor = new Set<string>();
  for (const e of batch.edges) {
    if (e.rel !== 'HAS_VARIANT') continue;
    const v = variantById.get(e.to);
    const colors = v?.props.colors;
    if (v && Array.isArray(colors) && colors.length > 0) withColor.add(e.from);
  }
  return agg(withColor.size, productModelDenominator);
}

/** TRACE_COVERAGE: nodes with a truthy `sourceRef` prop, over total nodes. */
export function traceCoverage(batch: GraphBatchLike): MetricAgg {
  const withRef = batch.nodes.filter((n) => Boolean(n.props?.sourceRef)).length;
  return agg(withRef, batch.nodes.length);
}

export interface PriceLinkLine { bucket: string; base: string; unitPrice: number }

/** PRICE_LINK_COVERAGE (Wave-4 F, gate): unlike PRICE_COVERAGE (denominated over ALL distinct
 * FlowAccount bases, priced or not — an informational data-completeness measure, target 1.00 is
 * unrealistic and no longer gated), this metric is strictly a graph-construction correctness
 * check: of the bases that DO have a priced FlowAccount line, did that price actually make it
 * into the graph as a PRICED_AS edge? numerator = distinct bases (parsed+name_coded) with >=1
 * line `unitPrice > 0` whose CatalogOffer node (`offerNodeId(base)`) has >=1 outgoing PRICED_AS
 * edge to a CommercialSKU with `priceMissing === false`; denominator = distinct bases
 * (parsed+name_coded) with >=1 line `unitPrice > 0`. */
export function priceLinkCoverage(batch: GraphBatchLike, lines: PriceLinkLine[]): MetricAgg {
  const pricedBases = new Set(
    lines.filter((l) => (l.bucket === 'parsed' || l.bucket === 'name_coded') && l.unitPrice > 0).map((l) => l.base),
  );
  const cskuById = new Map(batch.nodes.filter((n) => n.labels.includes('CommercialSKU')).map((n) => [n.id, n]));
  const linkedOfferIds = new Set<string>();
  for (const e of batch.edges) {
    if (e.rel !== 'PRICED_AS') continue;
    const csku = cskuById.get(e.to);
    if (csku && csku.props.priceMissing === false) linkedOfferIds.add(e.from);
  }
  let numerator = 0;
  for (const base of pricedBases) {
    if (linkedOfferIds.has(offerNodeId(base))) numerator++;
  }
  return agg(numerator, pricedBases.size);
}
