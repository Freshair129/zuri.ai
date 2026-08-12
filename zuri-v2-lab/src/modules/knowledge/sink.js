// @req FR-024 — a sink seam so the projected graph can target different backends
//   (an in-memory JSON store now; GenesisBlockDB / a Rust graph engine later).
// @spec ADR-007 §P5 — the projection produces relations for a knowledge store; the
//   store is pluggable behind addNode/addEdge so swapping backends never touches the
//   projector.
// @tested tests/integration/knowledge-project.test.js

/**
 * @typedef {Object} GraphSink
 * A write target for a projected knowledge graph. Any backend adapter implements the
 * same two mutators; writeGraph() only ever calls addNode/addEdge.
 * @property {(node: {id,type,label,key}) => void} addNode
 * @property {(edge: {from,to,rel,role?}) => void} addEdge
 */

/**
 * In-memory JSON sink — the default backend. Accumulates nodes/edges as it is fed and
 * can serialise them.
 * @returns {GraphSink & { nodes: any[], edges: any[], toJSON: () => {nodes:any[],edges:any[]} }}
 */
export function createJsonSink() {
  const nodes = []
  const edges = []
  return {
    nodes,
    edges,
    addNode(node) {
      nodes.push(node)
    },
    addEdge(edge) {
      edges.push(edge)
    },
    toJSON() {
      return { nodes, edges }
    },
  }
}

/**
 * Push a projected graph into a sink. Backend-agnostic: it drives the sink through its
 * addNode/addEdge seam only, so the same call works for the JSON sink today and a
 * GenesisBlockDBSink tomorrow.
 * @param {{ nodes: any[], edges: any[] }} graph — output of projectKnowledgeGraph
 * @param {GraphSink} sink
 * @returns {Promise<GraphSink>} the same sink, for chaining
 */
export async function writeGraph(graph, sink) {
  for (const node of graph.nodes) sink.addNode(node)
  for (const edge of graph.edges) sink.addEdge(edge)
  return sink
}

// GenesisBlockDBSink — future seam (NOT implemented here).
// A Rust-backed graph engine (GenesisBlockDB / GKS) will provide an adapter that
// satisfies the GraphSink interface:
//
//   function createGenesisBlockDBSink(client) {
//     return {
//       addNode(node) { client.upsertNode(node.id, node.type, { label: node.label, key: node.key }) },
//       addEdge(edge) { client.upsertEdge(edge.from, edge.to, edge.rel, edge.role ? { role: edge.role } : {}) },
//     }
//   }
//
// It is deliberately left unimplemented: this module owns only the projection + the
// contract, never the external/Rust adapter (ADR-007 §P5 — GKS is a separate system).
