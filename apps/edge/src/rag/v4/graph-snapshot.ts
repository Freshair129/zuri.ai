// Builds a bounded node/edge snapshot of the catalog graph for the Live Graph Viewer.
//
// The viewer is a force-directed simulation, not a data export: it caps itself at a few hundred
// nodes and is unreadable well before that. The store holds ~3,150 nodes and ~11,017 edges, so this
// returns a *representative subgraph* — and which few hundred nodes you pick is the whole problem.
//
// Two earlier shapes did not work, and the reasons are why this looks the way it does:
//
//   1. Plain breadth-first from the taxonomy roots returns a pure tree (~1 edge per node). The
//      spine — group -> type -> model -> variant — genuinely has no cross-links. Every edge that
//      makes this a *graph* hangs off CatalogOffer, which a root-first walk reaches last.
//   2. Queueing offers into the same FIFO made it worse: they sit behind ~300 models, so the node
//      budget is gone before any of them is expanded.
//
// So the walk expands offers first, and gives every label a quota. The quotas are the load-bearing
// part: without them PhysicalSKU alone will eat the budget, because a gift set contains several and
// each is a leaf that contributes one edge and nothing else.
//
// The engine has no "list all nodes" call, and does not need one: `neighbors()` from the
// deterministic root ids (4 CategoryGroups, 32 ProductTypes, from the git-versioned config)
// reaches the whole graph.
import type { GraphDb } from './search.js';
import { catGroupId, typeNodeId, offerNodeId, SKU_PKG_GIFTBOX_STD } from './schema.js';
import { loadCategoryGroupMap, loadTypeAliases } from './config.js';

/** Node shape the viewer consumes (graph-viewer.html `initLiveGraph`). */
export interface ViewerNode {
  id: string;
  label: string;
  name: string;
  status: string;
  props: Record<string, unknown>;
}

export interface ViewerEdge {
  from: string;
  to: string;
  rel: string;
  props: Record<string, unknown>;
}

export interface GraphSnapshot {
  nodes: ViewerNode[];
  edges: ViewerEdge[];
  /** Node count per label, so the viewer's legend does not have to recompute it. */
  label_counts: Record<string, number>;
  /** True when a budget or quota stopped the walk before the graph was exhausted. */
  truncated: boolean;
}

/**
 * Default node budget. The viewer's own ceiling is 700, but that is the point where it stops
 * simulating, not the point where it stops being readable — at ~570 the canvas is a single clump
 * with captions written over each other. 300 lays out with visible structure, and `?limit=` is
 * there when you want the denser picture.
 */
export const DEFAULT_NODE_LIMIT = 300;

/** Neighbours fetched per expansion. */
const FANOUT = 60;
/** Offers pulled in per model — a spread of offers, not every offer one model appears in. */
const OFFERS_PER_MODEL = 2;

/**
 * Share of the node budget each label may take. Proportions, not counts, so `?limit=` scales the
 * whole picture instead of only its tail. CatalogOffer gets the largest share because offers are
 * what carry the cross-type edges; PhysicalSKU is capped hard for the opposite reason.
 */
const LABEL_SHARE: Record<string, number> = {
  CategoryGroup: 0.02,
  ProductType: 0.07,
  CatalogOffer: 0.28,
  ProductModel: 0.22,
  PhysicalVariant: 0.17,
  PhysicalSKU: 0.17,
  CommercialSKU: 0.06,
  AttributeValue: 0.04,
};
const DEFAULT_SHARE = 0.05;

/**
 * Universal nodes: connected to essentially every offer in the catalog. Every gift set can be
 * screen-printed, laser-engraved and shipped in the standard box, so these four sit at degree
 * ~= offerCount and contributed 37% of all edges in an unfiltered snapshot — enough to collapse a
 * force layout into a hairball around four nodes that say nothing. They are a constant, not a
 * relationship, so the viewer is better off without them. Nothing else filters by label: this is
 * about a handful of specific universal nodes, not about hiding a kind of thing.
 */
const UNIVERSAL_LABELS = new Set(['CustomizationOption']);
const UNIVERSAL_IDS = new Set([SKU_PKG_GIFTBOX_STD]);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * The caption drawn on the node. Every node needs one that reads as a *thing*, because the viewer
 * paints these on the canvas: falling through to the raw id turns a screenful into overlapping
 * `PHYSICAL_VARIANT_91F6E7CA…` strings and the graph becomes unreadable regardless of its layout.
 * Thai first — these are read by Thai-speaking staff.
 */
function displayName(id: string, label: string, props: Record<string, unknown>): string {
  switch (label) {
    case 'PhysicalSKU':
      // The generated, human-meaningful code (SKU-POWER-BANK-BLK-MC-5).
      return str(props.displayCode) ?? shortId(id);
    case 'AttributeValue':
      return str(props.value) ?? shortId(id);
    case 'PhysicalVariant': {
      // A variant has no name of its own; what distinguishes it is its attributes.
      const facets = ['colors', 'sizes', 'materials']
        .flatMap((k) => (Array.isArray(props[k]) ? (props[k] as unknown[]) : []))
        .filter((v): v is string => typeof v === 'string' && !!v.trim());
      if (!facets.length) return shortId(id);
      return facets.length > 2 ? `${facets.slice(0, 2).join(', ')} +${facets.length - 2}` : facets.join(', ');
    }
    case 'CommercialSKU': {
      const code = str(props.commercialSku) ?? str(props.offerCode);
      const tier = props.qtyTier;
      return code ? (typeof tier === 'number' ? `${code} @${tier}` : code) : shortId(id);
    }
    default:
      for (const key of ['name_th', 'displayName', 'name_en', 'englishName', 'code']) {
        const v = str(props[key]);
        if (v) return v;
      }
      return shortId(id);
  }
}

/** Last resort: `PHYSICAL_VARIANT_C152AD50…` is noise on a canvas; `VARIANT C152AD50` is a handle. */
function shortId(id: string): string {
  const at = id.lastIndexOf('_');
  if (at <= 0 || at === id.length - 1) return id.slice(0, 18);
  return `${id.slice(0, at).replace(/^PHYSICAL_/, '').replace(/_/g, ' ')} ${id.slice(at + 1, at + 9)}`;
}

function toViewerNode(node: { id: string; labels: string[]; props: any }): ViewerNode {
  const props = (node.props ?? {}) as Record<string, unknown>;
  const status = typeof props.status === 'string' && props.status ? props.status : 'canonical';
  const label = node.labels?.[0] ?? 'Unknown';
  return {
    id: node.id,
    label,
    name: displayName(node.id, label, props),
    status,
    props,
  };
}

export async function buildGraphSnapshot(
  db: GraphDb,
  opts: { limit?: number } = {},
): Promise<GraphSnapshot> {
  const limit = Math.max(1, opts.limit ?? DEFAULT_NODE_LIMIT);
  const quota = (label: string): number =>
    Math.max(1, Math.round(limit * (LABEL_SHARE[label] ?? DEFAULT_SHARE)));

  const categoryMap = loadCategoryGroupMap();
  const aliases = loadTypeAliases();

  const nodes = new Map<string, ViewerNode>();
  const edges = new Map<string, ViewerEdge>();
  const perLabel = new Map<string, number>();
  const visited = new Set<string>();
  // Offers jump the queue: they are the only nodes that link different product types together, so
  // reaching them late is the same as not reaching them at all.
  const offerQueue: string[] = [];
  const queue: string[] = [
    ...categoryMap.groups.map((g) => catGroupId(g.id)),
    ...aliases.types.map((t) => typeNodeId(t.typeId)),
  ];
  let truncated = false;

  const admit = (node: { id: string; labels: string[]; props: any }): boolean => {
    if (nodes.has(node.id) || UNIVERSAL_IDS.has(node.id)) return false;
    const viewer = toViewerNode(node);
    if (UNIVERSAL_LABELS.has(viewer.label)) return false;
    const used = perLabel.get(viewer.label) ?? 0;
    if (nodes.size >= limit || used >= quota(viewer.label)) {
      truncated = true;
      return false;
    }
    nodes.set(node.id, viewer);
    perLabel.set(viewer.label, used + 1);
    return true;
  };

  const recordEdge = (e: { rel: string; from: string; to: string; props: any }): void => {
    if (!e?.from || !e?.to || !e?.rel) return;
    const key = `${e.from}|${e.rel}|${e.to}`;
    if (!edges.has(key)) edges.set(key, { from: e.from, to: e.to, rel: e.rel, props: e.props ?? {} });
  };

  const expand = async (seed: string): Promise<void> => {
    if (visited.has(seed)) return;
    visited.add(seed);
    let hits: Awaited<ReturnType<GraphDb['neighbors']>>;
    try {
      hits = await db.neighbors(seed, { direction: 'both', depth: 1, limit: FANOUT });
    } catch {
      // A config type with no products in this store is not an error; it contributes nothing.
      return;
    }
    for (const hit of hits) {
      if (hit.node?.id && admit(hit.node)) queue.push(hit.node.id);
      for (const e of hit.path ?? []) recordEdge(e);

      // ProductModel carries its offer codes as a prop, so the offers cost no extra query to find.
      const codes = hit.node?.props?.offerCodes;
      if (Array.isArray(codes)) {
        for (const code of codes.slice(0, OFFERS_PER_MODEL)) {
          if (typeof code === 'string') offerQueue.push(offerNodeId(code));
        }
      }
    }
  };

  while ((queue.length || offerQueue.length) && nodes.size < limit) {
    const seed = offerQueue.length ? offerQueue.shift()! : queue.shift()!;
    await expand(seed);
  }
  if (queue.length || offerQueue.length) truncated = true;

  // Second pass: expand what was collected but never visited, recording only edges whose *both*
  // endpoints are already in the set. This adds the cross-links without growing the node count —
  // an offer admitted late still gets its CONTAINS edges to SKUs the walk had already taken.
  for (const id of [...nodes.keys()]) {
    if (visited.has(id)) continue;
    visited.add(id);
    try {
      const hits = await db.neighbors(id, { direction: 'both', depth: 1, limit: FANOUT });
      for (const hit of hits) {
        for (const e of hit.path ?? []) {
          if (nodes.has(e.from) && nodes.has(e.to)) recordEdge(e);
        }
      }
    } catch {
      // as above
    }
  }

  // Edges whose endpoints the walk never materialised are dropped: the viewer discards them
  // anyway, and shipping them would misreport the edge count in the UI.
  const kept = [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to));

  // Drop nodes that ended up with no surviving edge. They are an artefact of quota-bounded
  // collection — admitted while their only neighbours were still unreached — and in a
  // force-directed view they are just dots drifting at the margin.
  const connected = new Set<string>();
  for (const e of kept) {
    connected.add(e.from);
    connected.add(e.to);
  }
  const finalNodes = [...nodes.values()].filter((n) => connected.has(n.id));

  const label_counts: Record<string, number> = {};
  for (const n of finalNodes) label_counts[n.label] = (label_counts[n.label] ?? 0) + 1;

  return { nodes: finalNodes, edges: kept, label_counts, truncated };
}
