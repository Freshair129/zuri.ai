// A `GraphDb` + `EmbedClient` pair built over the REAL `buildGraphV4` output (§9 Wave-2
// follow-up: "T16 must add one test that runs searchV4 over buildGraphV4(...)" — this replay test
// discharges that for T15's synthetic-50 fixture instead of the hand-written identity-mini.json).
//
// There is no embedding model available in a unit test, so the ranking here is not semantic: the
// embed client returns a deterministic hash vector (present only so `EmbedClient`'s contract is
// honoured — nothing reads it), and `hybridSearch` instead scores every embeddable node by
// character-bigram overlap between the query text and the node's real passage text (the same
// `modelPassage`/`offerPassage` strings `embeddableNodes` computes for ingest). Bigrams, not
// whitespace tokens, because Thai has no spaces between words — splitting on whitespace would
// leave most of a Thai query as one unsplittable chunk that can never partially match.
import { createHash } from 'node:crypto';
import type { EmbedClient } from '../../../src/rag/v4/embed-client.js';
import type { GraphDb } from '../../../src/rag/v4/search.js';
import { buildGraphV4, embeddableNodes } from '../../../src/rag/v4/build-graph.js';
import type { BuildInputs } from '../../../src/rag/v4/build-graph.js';
import type { GraphBatch, GraphNode } from '../../../src/rag/v4/schema.js';

export interface Synthetic50Fixture {
  identity: BuildInputs['identity'];
  flowaccount: BuildInputs['flowaccount'];
  catalog: BuildInputs['catalog'];
}

function bigrams(s: string): Set<string> {
  const norm = s
    .toLowerCase()
    .replace(/passage:\s*/g, '')
    .replace(/[|•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    const pair = norm.slice(i, i + 2);
    if (pair.trim().length === 2) out.add(pair);
  }
  // ASCII word tokens too, so an English term like "power bank" gets credit as a whole unit and
  // not just via its incidental 2-character overlaps with unrelated Thai bigrams.
  for (const w of norm.match(/[a-z0-9]+/g) ?? []) if (w.length >= 2) out.add(w);
  return out;
}

function overlapScore(queryGrams: Set<string>, passageGrams: Set<string>): number {
  if (queryGrams.size === 0) return 0;
  let hit = 0;
  for (const g of queryGrams) if (passageGrams.has(g)) hit++;
  return hit / queryGrams.size;
}

/** `hash-based vectors are fine` (plan, T15): a deterministic, content-derived float vector — not
 * meaningful for cosine similarity, but real enough that `EmbedClient.embed` never returns the
 * same array reference twice and every text produces a distinct vector. */
function hashVector(text: string, dim = 384): number[] {
  const out = new Array<number>(dim);
  let seed = createHash('sha256').update(text, 'utf8').digest();
  for (let i = 0; i < dim; i++) {
    if (i > 0 && i % 32 === 0) seed = createHash('sha256').update(seed).digest();
    out[i] = (seed[i % 32] / 255) * 2 - 1;
  }
  return out;
}

export interface SyntheticGraphDb extends GraphDb {
  batch: GraphBatch;
}

/**
 * Builds a `{ db, embed }` pair over the real `buildGraphV4` output of `synthetic-50.json`, plus the
 * committed `category-group-map.v1.json` / `product-type-aliases.v1.json` config every real ingest
 * uses. `embed.embed(['query: ...'], 'query')` records the raw query text in a closure the fake
 * `hybridSearch` reads back — `searchV4` always embeds before it searches, in that order, so this
 * mirrors "the engine saw this query's text" without smuggling anything through the vector itself.
 */
export function buildSyntheticGraphDb(
  fixture: Synthetic50Fixture,
  categoryMap: BuildInputs['categoryMap'],
  aliases: BuildInputs['aliases'],
): { db: SyntheticGraphDb; embed: EmbedClient; batch: GraphBatch } {
  const refs: BuildInputs['refs'] = {
    identity: { file: 'synthetic-identity.json', sha256: 'fixture-synthetic-50', rowKey: 'root' },
    catalog: { file: 'synthetic-catalog.json', sha256: 'fixture-synthetic-50', rowKey: 'root' },
    flowaccount: { file: 'synthetic-prices.xlsx', sha256: 'fixture-synthetic-50', rowKey: 'root' },
  };

  const batch = buildGraphV4({
    identity: fixture.identity,
    catalog: fixture.catalog,
    flowaccount: fixture.flowaccount,
    categoryMap,
    aliases,
    refs,
  });

  const nodesById = new Map<string, GraphNode>(batch.nodes.map((n) => [n.id, n]));
  const passages = embeddableNodes(batch);
  const gramsById = new Map<string, Set<string>>(passages.map((p) => [p.id, bigrams(p.text)]));

  let lastQueryText = '';
  const embed: EmbedClient = {
    async embed(texts, kind) {
      if (kind === 'query' && texts.length) {
        lastQueryText = texts[0].replace(/^query:\s*/, '');
      }
      return texts.map((t) => hashVector(t));
    },
    async health() {
      return { ok: true, model: 'fake-bigram-hash', revision: 'fixture' };
    },
  };

  const db: SyntheticGraphDb = {
    batch,
    async hybridSearch({ k }) {
      const queryGrams = bigrams(lastQueryText);
      const scored: Array<{ id: string; score: number }> = [];
      for (const [id, grams] of gramsById) {
        scored.push({ id, score: overlapScore(queryGrams, grams) });
      }
      // Deterministic full ranking (ties broken by node id) rather than dropping zero-score
      // nodes outright: a real vector index always returns its k nearest neighbours regardless of
      // an absolute-similarity floor, and `filterHits`/exclude-type filtering downstream is what
      // is actually under test here, not this fixture's notion of relevance.
      scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      return scored.slice(0, k).map(({ id, score }) => ({ node: nodesById.get(id)!, score }));
    },
    async neighbors(seed, a) {
      const direction = a.direction ?? 'out';
      const rels = a.rels ?? (a.rel ? [a.rel] : undefined);
      const out: Array<{ node: GraphNode; path: Array<{ rel: string; from: string; to: string; props: any }> }> = [];
      for (const e of batch.edges) {
        if (rels && !rels.includes(e.rel)) continue;
        const matchesOut = direction !== 'in' && e.from === seed;
        const matchesIn = direction !== 'out' && e.to === seed;
        if (!matchesOut && !matchesIn) continue;
        const otherId = matchesOut ? e.to : e.from;
        const node = nodesById.get(otherId);
        if (!node) continue;
        out.push({ node, path: [{ rel: e.rel, from: e.from, to: e.to, props: e.props ?? {} }] });
      }
      return out;
    },
  };

  return { db, embed, batch };
}
