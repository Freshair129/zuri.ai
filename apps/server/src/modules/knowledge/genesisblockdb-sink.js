// @req FR-024 — GenesisBlockDB sink: the real graph-backend adapter behind the P5 projection seam.
// @spec ADR-007 §P5 — GKS holds relations; live facts stay a Zuri query (assertNoLiveFacts guards the sink).
// @tested tests/integration/knowledge-genesis-sink.test.js

import { assertNoLiveFacts } from './live-facts'

/**
 * GenesisBlockDB graph sink — the concrete backend the sink.js SEAM describes.
 *
 * It satisfies the same GraphSink contract as createJsonSink(): writeGraph() only
 * ever calls addNode/addEdge, so this adapter is a drop-in replacement that lands the
 * projected graph in a real Rust-backed graph engine instead of an in-memory array.
 *
 * ── Which real client methods this maps onto ────────────────────────────────────────
 * The engine's canonical JavaScript client is the NAPI-RS `GenesisDatabase` class from
 * `G:\GenesisBlock_Dev\GenesisBlock` (`index.d.ts` / `index.js`, the prebuilt
 * `index.win32-x64-msvc.node` binding; npm pkg `@freshair129/gks-genesis-block-native-*`).
 * Its per-item write surface is:
 *
 *   addNode(args: NodeInput): Promise<NodeOutput>
 *     NodeInput = { id?, labels: string[], props?, embedding?, lang?,
 *                   validFrom?, causedBy?, ttl?, collection? }
 *   addEdge(args: EdgeInput): Promise<EdgeOutput>
 *     EdgeInput = { id?, from, to, rel, props?, validFrom?, supersede?, impact?, causedBy? }
 *
 * So the V2 projection shapes translate as:
 *   node {id,type,label,key} → client.addNode({ id, labels: [type], props: { label, key } })
 *   edge {from,to,rel,role?} → client.addEdge({ from, to, rel, props: role ? { role } : {} })
 *
 * This is the same intent the sink.js SEAM sketched (`upsertNode(id, type, {label,key})`
 * / `upsertEdge(from, to, rel, {role})`); the real engine exposes it as addNode/addEdge
 * taking a single object with `labels[]` (a node carries a set of labels; the projection
 * emits exactly one — its `type`) and a free-form `props` bag.
 *
 * The engine also ships batch equivalents — `bulkAddNodes(NodeInput[])` /
 * `bulkAddEdges(EdgeInput[])` — and node id upsert is deterministic (re-pushing the same
 * id is a no-op), while edges are append-with-server-id (re-pushing doubles them; the SoT
 * projection is meant to be pushed once into a clean graph — see the SmartGift design
 * note rag-design-genesisblockdb.md §5b). This adapter drives the per-item addNode/addEdge
 * because writeGraph() feeds one item at a time; an orchestrator wanting fewer round-trips
 * can buffer and call the bulk* methods instead, same NodeInput/EdgeInput shapes.
 *
 * ── Injected client contract ─────────────────────────────────────────────────────────
 * `client` is INJECTED, never constructed here: this module must not import from the
 * engine repo, spawn the Rust process, or open a real store. The client is any object
 * exposing `addNode(NodeInput)` and `addEdge(EdgeInput)` (each may be sync or return a
 * Promise) — the real `GenesisDatabase` instance in production, a recording mock in tests.
 *
 * The engine calls are async. writeGraph() is not awaited per-item (its GraphSink seam is
 * synchronous void), so this sink dispatches each write immediately and tracks the
 * in-flight promises; call `await sink.drain()` after writeGraph() to await durability and
 * surface any write error. toJSON() reports counts for eval/debug.
 *
 * @param {{ client: { addNode: Function, addEdge: Function } }} args
 * @returns {{
 *   addNode: (node: {id,type,label,key}) => void,
 *   addEdge: (edge: {from,to,rel,role?}) => void,
 *   drain: () => Promise<void>,
 *   toJSON: () => { backend: string, nodes: number, edges: number, pending: number, errors: number },
 * }}
 */
export function createGenesisBlockDBSink({ client } = {}) {
  if (!client || typeof client.addNode !== 'function' || typeof client.addEdge !== 'function') {
    throw new Error('createGenesisBlockDBSink requires an injected client with addNode() and addEdge()')
  }

  const pending = []
  const errors = []
  let nodeCount = 0
  let edgeCount = 0

  // A write may be sync (mock) or async (real engine). Track the promise so drain() can
  // await durability; attach a catch so a rejected write never becomes an unhandled
  // rejection — the error is recorded and re-surfaced through drain().
  const track = (result) => {
    if (result && typeof result.then === 'function') {
      pending.push(
        Promise.resolve(result).catch((err) => {
          errors.push(err)
          throw err
        }),
      )
    }
  }

  return {
    addNode(node) {
      // Defense in depth: the graph must never hold a live fact. assertNoLiveFacts runs
      // on the raw incoming node (id/type/label/key), so a smuggled price/credit/invoice/
      // etc. field throws here before any client call (ADR-007 §P5).
      assertNoLiveFacts(node)
      track(
        client.addNode({
          id: node.id,
          labels: [node.type],
          props: { label: node.label ?? null, key: node.key ?? null },
        }),
      )
      nodeCount += 1
    },

    addEdge(edge) {
      // MEMBER_OF carries `role`; every other relation has no edge props.
      const props = edge.role != null ? { role: edge.role } : {}
      track(
        client.addEdge({
          from: edge.from,
          to: edge.to,
          rel: edge.rel,
          props,
        }),
      )
      edgeCount += 1
    },

    // Await all in-flight engine writes. Rejects with the first write error (if any).
    async drain() {
      await Promise.all(pending)
    },

    // Summary of what was written — for eval/debug, not a full graph dump (the engine is
    // the store of record now; the JSON sink is where you go for the material).
    toJSON() {
      return {
        backend: 'GenesisBlockDB',
        nodes: nodeCount,
        edges: edgeCount,
        pending: pending.length,
        errors: errors.length,
      }
    },
  }
}
