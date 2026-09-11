import { fetchJson, RagUnavailableError } from './v4/http-client.js';
import type { PriceTier, SelectedPrice, SearchResponseV4 } from './v4/search.js';
import type { SearchEvidenceV4 } from '../answer/format-cards.js';

// @req RAG-FR-004 — retrieval is read-only: this door has no write path and no store handle at all.
// @req RAG-FR-005 — evidence carries provenance — source, version and query path travel with every result.
// @req RAG-NFR-002 — the same provenance guarantee stated as a non-functional one; an unavailable answer says so rather than substituting an unprovenanced one.
// @req RAG-SEC-001 — no arbitrary query surface: the service is asked typed questions, and neither executeHql nor hybridSearch is reachable from here.

/**
 * The LINE agent's only door into the catalog graph.
 *
 * This class talks to `zuri-rag-service` over HTTP and nothing else — no native GenesisBlock
 * binding, no store path, no `hybridSearch`/`executeHql` in this file. The service alone owns the
 * store; the agent asks it questions and gets a typed answer back, or an explicit
 * `{unavailable:true}` when it cannot. There is no silent fallback to a substring search here: a
 * caller that gets `unavailable` has to say so, not quietly answer from something else.
 */

export interface GenesisRagOptions {
  /** Base URL of `zuri-rag-service`. Defaults to `GENESIS_RAG_API_URL` or `http://localhost:8888`. */
  apiUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PriceEvidenceV4 {
  found: boolean;
  code: string;
  priceLadder: PriceTier[];
  selectedPrice: SelectedPrice | null;
  exportDate: string | null;
  priceSource: 'commercial_sku' | 'estimate_rmb' | 'none';
  unavailable?: true;
  reason?: string;
}

interface RagPriceResponse {
  found: boolean;
  code: string;
  priceLadder: PriceTier[];
  selectedPrice: SelectedPrice | null;
  exportDate: string | null;
}

const DEFAULT_API_URL = 'http://localhost:8888';
const DEFAULT_TIMEOUT_MS = 3000;

function toSearchEvidence(query: string, data: SearchResponseV4): SearchEvidenceV4 {
  return {
    query: data.query,
    parsed: data.parsed,
    matchCount: data.results.length,
    matches: data.results,
    nearest: data.nearest,
    priceSource: 'commercial_sku',
  };
}

function unavailableSearchEvidence(query: string, reason: string): SearchEvidenceV4 {
  return {
    query,
    parsed: null,
    matchCount: 0,
    matches: [],
    nearest: [],
    unavailable: true,
    reason,
    priceSource: 'commercial_sku',
  };
}

function reasonOf(err: unknown): string {
  return err instanceof RagUnavailableError ? err.reason : err instanceof Error ? err.message : String(err);
}

export class GenesisLocalRag {
  private readonly apiUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: GenesisRagOptions = {}) {
    this.apiUrl = (opts.apiUrl || process.env.GENESIS_RAG_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl;
  }

  async searchProducts(query: string, limit = 5): Promise<SearchEvidenceV4> {
    try {
      const data = await fetchJson<SearchResponseV4>(`${this.apiUrl}/api/rag/search`, {
        method: 'POST',
        body: { query, limit },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
      });
      return toSearchEvidence(query, data);
    } catch (err) {
      return unavailableSearchEvidence(query, reasonOf(err));
    }
  }

  /**
   * Search with an explicit quantity/budget instead of a fabricated query string.
   *
   * `find_within_budget` has no product name to search for — only a headcount and a budget — so
   * it must not invent query text to get an answer out of the search endpoint. This calls the same
   * route with `query: ''` and lets the service apply `qty`/`budgetPerUnit` as overrides on top of
   * whatever the (empty) query parses to.
   */
  async searchWithConstraints(params: {
    query: string;
    qty?: number | null;
    budgetPerUnit?: number | null;
    limit?: number;
  }): Promise<SearchEvidenceV4> {
    try {
      const data = await fetchJson<SearchResponseV4>(`${this.apiUrl}/api/rag/search`, {
        method: 'POST',
        body: {
          query: params.query,
          limit: params.limit,
          // A constraint-only call (no product name to search for) always browses the whole
          // catalog rather than the top-k nearest neighbours of an empty/blank embedding.
          browseAll: true,
          ...(params.qty !== undefined && params.qty !== null ? { qty: params.qty } : {}),
          ...(params.budgetPerUnit !== undefined && params.budgetPerUnit !== null
            ? { budgetPerUnit: params.budgetPerUnit }
            : {}),
        },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
      });
      return toSearchEvidence(params.query, data);
    } catch (err) {
      return unavailableSearchEvidence(params.query, reasonOf(err));
    }
  }

  async priceForCode(code: string, qty: number | null): Promise<PriceEvidenceV4> {
    try {
      const data = await fetchJson<RagPriceResponse>(`${this.apiUrl}/api/rag/price`, {
        method: 'POST',
        body: { code, qty },
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
      });
      return {
        found: data.found,
        code: data.code,
        priceLadder: data.priceLadder,
        selectedPrice: data.selectedPrice,
        exportDate: data.exportDate,
        priceSource: data.found ? 'commercial_sku' : 'none',
      };
    } catch (err) {
      return {
        found: false,
        code,
        priceLadder: [],
        selectedPrice: null,
        exportDate: null,
        priceSource: 'none',
        unavailable: true,
        reason: reasonOf(err),
      };
    }
  }

  async health(): Promise<{ ok: boolean; dbReady?: boolean; embedReady?: boolean; runId?: string | null; staleRun?: boolean }> {
    try {
      const body = await fetchJson<{ ok?: boolean; dbReady?: boolean; embedReady?: boolean; runId?: string | null; staleRun?: boolean }>(
        `${this.apiUrl}/health`,
        {
          timeoutMs: this.timeoutMs,
          fetchImpl: this.fetchImpl,
        },
      );
      return {
        ok: body.ok === true,
        dbReady: body.dbReady,
        embedReady: body.embedReady,
        runId: body.runId,
        staleRun: body.staleRun,
      };
    } catch {
      return { ok: false };
    }
  }
}

/**
 * What the answer path needs from its RAG door. `GenesisLocalRag` is one; FR-189's published-generation
 * reader (`rag/genesisrag17/published-rag.ts`) is the other, and only when its mode is not `off`.
 */
export type AnswerRag = Pick<GenesisLocalRag, 'searchProducts' | 'searchWithConstraints' | 'priceForCode' | 'health'>;
