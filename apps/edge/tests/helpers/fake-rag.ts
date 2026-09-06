import { GenesisLocalRag } from '../../src/rag/genesis-rag.js';
import type { ResultV4, SearchResponseV4 } from '../../src/rag/v4/search.js';

/**
 * A `GenesisLocalRag` wired to a scripted `fetch`, for tests that need `EvidenceOptions.rag`
 * without a real `zuri-rag-service` running.
 *
 * `GenesisLocalRag` has private fields, so a plain object literal cannot stand in for it under
 * TypeScript's structural typing — this constructs a real instance with a stubbed `fetchImpl`
 * instead, the same trick T6's http-client tests use.
 */

export type FakeSearchHandler = (body: Record<string, unknown>) => Partial<SearchResponseV4> & {
  results?: ResultV4[];
  nearest?: ResultV4[];
};

export type FakePriceHandler = (body: Record<string, unknown>) => {
  found: boolean;
  code: string;
  priceLadder: unknown[];
  selectedPrice: unknown;
  exportDate: string | null;
};

export interface FakeRagHandlers {
  search?: FakeSearchHandler;
  price?: FakePriceHandler;
  /** When set, every call to any route rejects/errors with a connection failure. */
  down?: boolean;
}

const EMPTY_TIMING = { embedMs: 0, searchMs: 0, expandMs: 0, k: 0 };

function defaultSearch(body: Record<string, unknown>): Partial<SearchResponseV4> {
  return {
    success: true,
    query: String(body.query ?? ''),
    parsed: {
      cleanText: String(body.query ?? ''),
      excludeTypes: [],
      qty: (body.qty as number | undefined) ?? null,
      budgetPerUnit: (body.budgetPerUnit as number | undefined) ?? null,
      budgetTotal: null,
      budgetUnmet: false,
    },
    results: [],
    nearest: [],
    timing: EMPTY_TIMING,
  };
}

function defaultPrice(body: Record<string, unknown>) {
  return { found: false, code: String(body.code ?? ''), priceLadder: [], selectedPrice: null, exportDate: null };
}

export function fetchStub(handlers: FakeRagHandlers = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    if (handlers.down) {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (u.endsWith('/api/rag/search')) {
      const data = (handlers.search ?? defaultSearch)(body);
      return new Response(JSON.stringify({ ...defaultSearch(body), ...data }), { status: 200 });
    }
    if (u.endsWith('/api/rag/price')) {
      const data = (handlers.price ?? defaultPrice)(body);
      return new Response(JSON.stringify(data), { status: 200 });
    }
    if (u.endsWith('/health')) {
      // Real shape per zuri-rag-service /health (gate defect 9): ok, dbReady, embedReady,
      // storePath, runId, currentRunId, staleRun.
      return new Response(
        JSON.stringify({
          ok: true,
          dbReady: true,
          embedReady: true,
          storePath: '/store/RUN_FAKE',
          runId: 'RUN_FAKE',
          currentRunId: 'RUN_FAKE',
          staleRun: false,
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as typeof fetch;
}

/** A `GenesisLocalRag` whose graph search/price always come back empty/not-found (never `unavailable`). */
export function emptyFakeRag(): GenesisLocalRag {
  return new GenesisLocalRag({ fetchImpl: fetchStub() });
}

export function fakeRag(handlers: FakeRagHandlers = {}): GenesisLocalRag {
  return new GenesisLocalRag({ fetchImpl: fetchStub(handlers) });
}

export function stubResult(over: Partial<ResultV4> & { id: string; code: string; name: string }): ResultV4 {
  return {
    kind: 'model',
    englishName: null,
    type: null,
    group: null,
    score: 1,
    status: 'auto',
    image: null,
    variants: [],
    priceLadder: [],
    selectedPrice: null,
    components: [],
    customizations: [],
    sourceRef: null,
    ...over,
  };
}
