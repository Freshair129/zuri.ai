import type { AnswerRag, PriceEvidenceV4 } from '../genesis-rag.js';
import type { SearchEvidenceV4 } from '../../answer/format-cards.js';
import { createMspStdioTransport, MspTransportError, type MspToolCall } from './msp-stdio.js';
import { createRecordStore, type GenesisRag17Record, type RecordOperation, type RecordStore } from './record-store.js';
import {
  GENESISRAG17_SCHEMA_VERSION, loadGenesisRag17Settings,
  type GenesisRag17Scope, type GenesisRag17Settings,
} from './settings.js';
import type { PublishedGenerationRef, PublishedPassage } from './types.js';

// @req FR-189 — edge answers SmartGift catalog queries from the published GenesisRAG17 generation
//   through MSP (`primary`), or keeps answering from v4 while comparing against it (`shadow`); v4
//   stays the fallback only until the configured sunset instant, and every fallback is recorded.
// @spec ADR-075 D7, ADR-075 D8 Phase 4, ADR-075 owner question 3, ADR-042 D4 (one query contract),
//   ADR-043 D2.1 (Tier 1 never talks to the substrate), ADR-061 (the RAG capability stays local)
// @tested tests/unit/genesisrag17-edge.test.ts
//
// This file adds a *reader*. v4 remains the only thing that writes its store, and nothing here
// writes GenesisBlockDB: the published generation is reached only by `msp_pipeline_query`, which MSP
// relays to the worker's loopback `/query` and never to GKS.

export class GenesisRag17ResponseError extends Error {
  readonly code = 'GENESISRAG17_INVALID_RESPONSE';
  constructor() {
    super('GENESISRAG17_INVALID_RESPONSE');
    this.name = 'GenesisRag17ResponseError';
  }
}

class UnsupportedOperationError extends Error {
  readonly code = 'UNSUPPORTED_OPERATION';
  constructor() { super('UNSUPPORTED_OPERATION'); }
}

export interface PublishedQueryResult extends PublishedGenerationRef {
  passages: PublishedPassage[];
}

export interface PublishedGenerationClient {
  query(text: string, topK: number): Promise<PublishedQueryResult>;
}

const CITATION_KEYS = ['sourceId', 'rawArtifactId', 'parsedArtifactId', 'chunkId', 'contentHash'] as const;
const SCOPE_KEYS = ['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility'] as const;

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const idLike = (value: unknown): boolean => nonEmpty(value) || (typeof value === 'number' && Number.isFinite(value));

/**
 * The response is checked here even though MSP already checked it: this is the edge's own boundary,
 * and a passage without its five citation ids is not an answer edge may give (ADR-075 D7).
 */
export function parsePublishedQueryResult(value: unknown, scope: GenesisRag17Scope, topK: number): PublishedQueryResult {
  const result = value as Record<string, any> | null;
  if (!result || result.schemaVersion !== GENESISRAG17_SCHEMA_VERSION) throw new GenesisRag17ResponseError();
  if (!result.scope || SCOPE_KEYS.some((key) => result.scope[key] !== scope[key])) throw new GenesisRag17ResponseError();
  if (!nonEmpty(result.snapshotId) || !idLike(result.generation) || !Array.isArray(result.results) || result.results.length > topK) {
    throw new GenesisRag17ResponseError();
  }
  const generation = String(result.generation);
  const passages = result.results.map((row: Record<string, any>) => {
    if (!row || !nonEmpty(row.id) || !Number.isFinite(row.score) || typeof row.text !== 'string' || !row.citation) {
      throw new GenesisRag17ResponseError();
    }
    // One query binds one generation: a hit from any other snapshot is a malformed response.
    if ((row.snapshotId !== undefined && row.snapshotId !== result.snapshotId) ||
        (row.generation !== undefined && String(row.generation) !== generation)) {
      throw new GenesisRag17ResponseError();
    }
    if (CITATION_KEYS.some((key) => !nonEmpty(row.citation[key]))) throw new GenesisRag17ResponseError();
    return {
      id: row.id, score: row.score, text: row.text,
      citation: Object.fromEntries(CITATION_KEYS.map((key) => [key, row.citation[key]])) as PublishedPassage['citation'],
    };
  });
  return { schemaVersion: GENESISRAG17_SCHEMA_VERSION, snapshotId: result.snapshotId, generation, passages };
}

export function createPublishedGenerationClient(options: {
  call: MspToolCall; credential: string; scope: GenesisRag17Scope;
}): PublishedGenerationClient {
  return {
    async query(text, topK) {
      const result = await options.call('msp_pipeline_query', {
        schemaVersion: GENESISRAG17_SCHEMA_VERSION,
        scope: options.scope,
        credential: options.credential,
        query: text.slice(0, 16000),
        topK,
      });
      return parsePublishedQueryResult(result, options.scope, topK);
    },
  };
}

export interface GenesisRag17Runtime {
  settings: GenesisRag17Settings;
  client: PublishedGenerationClient;
  store: RecordStore;
  now: () => Date;
  /** Waits for every in-flight shadow comparison. Answers never wait on this; tests and shutdown do. */
  flush(): Promise<void>;
  track(work: Promise<unknown>): void;
}

/**
 * `null` when the mode is `off` — and in that case nothing else is read, created or spawned.
 * Otherwise every prerequisite is checked now, so a misconfigured mode refuses to start.
 */
export function createGenesisRag17Runtime(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { call?: MspToolCall; store?: RecordStore; now?: () => Date; exists?: (p: string) => boolean } = {},
): GenesisRag17Runtime | null {
  const settings = loadGenesisRag17Settings(env, { exists: overrides.exists });
  if (!settings) return null;
  const call = overrides.call ?? createMspStdioTransport(settings.msp, env);
  const pending = new Set<Promise<unknown>>();
  return {
    settings,
    client: createPublishedGenerationClient({ call, credential: settings.credential, scope: settings.scope }),
    store: overrides.store ?? createRecordStore({
      root: settings.recordRoot, retentionDays: settings.retentionDays, maxRecordsPerDay: settings.maxRecordsPerDay,
    }),
    now: overrides.now ?? (() => new Date()),
    track(work) {
      const settled = work.then(() => undefined, () => undefined);
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
    },
    async flush() { await Promise.all([...pending]); },
  };
}

/** A bounded code, never a message: MSP's error text is not something a record may carry. */
export function errorCode(error: unknown): string {
  if (error instanceof MspTransportError) return error.code;
  if (error instanceof GenesisRag17ResponseError || error instanceof UnsupportedOperationError) return error.code;
  return 'UNKNOWN';
}

/** A catalog record's key, when the passage is one (FR-187 chunks are canonical JSON records). */
function recordKey(passage: PublishedPassage): string | null {
  try {
    const parsed = JSON.parse(passage.text);
    const key = parsed?.externalId ?? parsed?.code;
    return typeof key === 'string' && key ? key : null;
  } catch { return null; }
}

function passageNames(passage: PublishedPassage, code: string): boolean {
  if (recordKey(passage) === code) return true;
  return code.length >= 3 && passage.text.includes(code);
}

export interface SearchComparison {
  v4Count: number;
  publishedCount: number;
  overlapCount: number;
  top1Match: boolean;
  v4Empty: boolean;
  publishedEmpty: boolean;
  v4Unavailable: boolean;
  mismatch: boolean;
}

/**
 * Overlap is counted on v4's product codes: a v4 match "overlaps" when some published passage is
 * that record (its JSON key) or names its code. A mismatch is the disagreement a customer would
 * notice — one side found products and the other found none, or both found some and share not one.
 * The counts are recorded too, so a stricter reading can be taken from the same evidence later.
 */
export function compareSearch(v4: SearchEvidenceV4, published: PublishedQueryResult, topK: number): SearchComparison {
  const codes = v4.unavailable ? [] : (v4.matches ?? []).slice(0, topK)
    .map((match) => match.code ?? match.id).filter((code): code is string => Boolean(code));
  const passages = published.passages.slice(0, topK);
  const overlapCount = codes.filter((code) => passages.some((passage) => passageNames(passage, code))).length;
  const v4Empty = codes.length === 0;
  const publishedEmpty = passages.length === 0;
  return {
    v4Count: codes.length,
    publishedCount: passages.length,
    overlapCount,
    top1Match: Boolean(codes[0] && passages[0] && passageNames(passages[0], codes[0])),
    v4Empty,
    publishedEmpty,
    v4Unavailable: Boolean(v4.unavailable),
    mismatch: v4Empty !== publishedEmpty || (!v4Empty && !publishedEmpty && overlapCount === 0),
  };
}

const clampTopK = (value: number | undefined, fallback: number) =>
  Math.min(100, Math.max(1, Number.isSafeInteger(value) ? value as number : fallback));

function unavailableSearch(query: string, reason: string): SearchEvidenceV4 {
  return { query, parsed: null, matchCount: 0, matches: [], nearest: [], unavailable: true, reason, priceSource: 'commercial_sku' };
}

function unavailablePrice(code: string, reason: string): PriceEvidenceV4 {
  return { found: false, code, priceLadder: [], selectedPrice: null, exportDate: null, priceSource: 'none', unavailable: true, reason };
}

function publishedSearchEvidence(query: string, result: PublishedQueryResult): SearchEvidenceV4 {
  return {
    query,
    parsed: null,
    matchCount: result.passages.length,
    matches: [],
    nearest: [],
    priceSource: 'commercial_sku',
    published: { schemaVersion: result.schemaVersion, snapshotId: result.snapshotId, generation: result.generation },
    passages: result.passages,
  };
}

/**
 * The answer path's RAG door for the configured mode. `off` returns the v4 instance itself — not a
 * wrapper around it — so today's behaviour is unchanged by construction, not by test alone.
 */
export function wrapAnswerRag(v4: AnswerRag, runtime: GenesisRag17Runtime | null): AnswerRag {
  if (!runtime) return v4;
  return runtime.settings.mode === 'shadow' ? shadowRag(v4, runtime) : primaryRag(v4, runtime);
}

function record(runtime: GenesisRag17Runtime, entry: GenesisRag17Record): void {
  runtime.store.append(entry);
}

function shadowRag(v4: AnswerRag, runtime: GenesisRag17Runtime): AnswerRag {
  const { settings, client, now } = runtime;

  const shadow = (operation: RecordOperation, query: string, topK: number, answer: SearchEvidenceV4, v4LatencyMs: number) => {
    if (!query.trim()) return; // budget-only searches have no text a published generation could be asked
    try {
      const started = Date.now();
      runtime.track((async () => {
        try {
          const published = await client.query(query, topK);
          record(runtime, {
            kind: 'shadow', at: now().toISOString(), operation, outcome: 'compared',
            snapshotId: published.snapshotId, generation: published.generation,
            ...compareSearch(answer, published, topK),
            v4LatencyMs, publishedLatencyMs: Date.now() - started,
          });
        } catch (error) {
          record(runtime, {
            kind: 'shadow', at: now().toISOString(), operation, outcome: 'error',
            errorCode: errorCode(error), publishedLatencyMs: Date.now() - started,
          });
        }
      })());
    } catch { /* a shadow that cannot even start is still not the customer's problem */ }
  };

  return {
    async searchProducts(query, limit = 5) {
      const started = Date.now();
      const answer = await v4.searchProducts(query, limit);
      shadow('search', query, clampTopK(limit, settings.topK), answer, Date.now() - started);
      return answer;
    },
    async searchWithConstraints(params) {
      const started = Date.now();
      const answer = await v4.searchWithConstraints(params);
      shadow('search_constraints', params.query, clampTopK(params.limit, settings.topK), answer, Date.now() - started);
      return answer;
    },
    priceForCode: (code, qty) => v4.priceForCode(code, qty),
    health: () => v4.health(),
  };
}

function primaryRag(v4: AnswerRag, runtime: GenesisRag17Runtime): AnswerRag {
  const { settings, client, now } = runtime;
  const fallbackUntil = settings.fallbackUntil as Date;

  async function fallbackOr<T>(operation: RecordOperation, error: unknown, useV4: () => Promise<T>, unavailable: (reason: string) => T): Promise<T> {
    const reason = errorCode(error);
    const at = now();
    // Strictly before the configured instant. At or after it there is no v4 answer at all.
    if (at.getTime() < fallbackUntil.getTime()) {
      record(runtime, { kind: 'fallback', at: at.toISOString(), operation, reason, fallbackUntil: fallbackUntil.toISOString() });
      return useV4();
    }
    record(runtime, { kind: 'primary_unavailable', at: at.toISOString(), operation, reason, fallbackUntil: fallbackUntil.toISOString() });
    return unavailable(`genesisrag17_unavailable:${reason}`);
  }

  return {
    async searchProducts(query, limit = 5) {
      if (!query.trim()) {
        return fallbackOr('search', new UnsupportedOperationError(), () => v4.searchProducts(query, limit), (r) => unavailableSearch(query, r));
      }
      const started = Date.now();
      try {
        const result = await client.query(query, clampTopK(limit, settings.topK));
        record(runtime, {
          kind: 'primary', at: now().toISOString(), operation: 'search', snapshotId: result.snapshotId,
          generation: result.generation, resultCount: result.passages.length, latencyMs: Date.now() - started,
        });
        return publishedSearchEvidence(query, result);
      } catch (error) {
        return fallbackOr('search', error, () => v4.searchProducts(query, limit), (r) => unavailableSearch(query, r));
      }
    },
    // Budget filtering and price ladders are typed lookups. Under `ontology_v1` a published
    // generation holds opaque catalog text, so these have no published equivalent until FR-188's
    // `PRICED_AT` lands; they are recorded as fallbacks, and stop being answered at sunset.
    searchWithConstraints: (params) => fallbackOr('search_constraints', new UnsupportedOperationError(),
      () => v4.searchWithConstraints(params), (r) => unavailableSearch(params.query, r)),
    priceForCode: (code, qty) => fallbackOr('price', new UnsupportedOperationError(),
      () => v4.priceForCode(code, qty), (r) => unavailablePrice(code, r)),
    health: () => v4.health(),
  };
}
