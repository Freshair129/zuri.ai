// @req FR-213 — where each node and edge of the Data Pipeline Map is drawn.
//   Pure: the same projection always lays out the same way, so a render test can
//   assert positions and the page never shifts between two loads.
// @spec ADR-085 D6
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js

export const COLUMNS = ['SOURCE', 'ENTRY', 'PROCESS', 'STORE', 'RECIPIENT']
export const COLUMN_LABELS = {
  SOURCE: 'ต้นทาง',
  ENTRY: 'จุดรับเข้า',
  PROCESS: 'รวม / แปลง',
  STORE: 'ที่เก็บ',
  RECIPIENT: 'ผู้รับ',
}

export const GEOMETRY = {
  nodeWidth: 184,
  nodeHeight: 42,
  columnGap: 60,
  rowGap: 14,
  padX: 24,
  padTop: 44,
  padBottom: 24,
}

/**
 * Order the nodes inside each column so edges cross less: a few sweeps of the
 * barycenter heuristic over both neighbours, ties broken by registry order so
 * the result is deterministic.
 */
function orderColumns(nodes, edges) {
  const columns = COLUMNS.map((kind) => nodes.filter((n) => n.kind === kind).map((n) => n.id))
  const neighbours = new Map(nodes.map((n) => [n.id, []]))
  for (const edge of edges) {
    neighbours.get(edge.from)?.push(edge.to)
    neighbours.get(edge.to)?.push(edge.from)
  }
  const registryIndex = new Map(nodes.map((n, i) => [n.id, i]))
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const rank = new Map()
    columns.forEach((ids) => ids.forEach((id, i) => rank.set(id, ids.length > 1 ? i / (ids.length - 1) : 0.5)))
    for (const ids of columns) {
      const score = new Map(ids.map((id) => {
        const near = neighbours.get(id).filter((other) => rank.has(other))
        const value = near.length ? near.reduce((s, other) => s + rank.get(other), 0) / near.length : rank.get(id)
        return [id, value]
      }))
      ids.sort((a, b) => (score.get(a) - score.get(b)) || (registryIndex.get(a) - registryIndex.get(b)))
    }
  }
  return columns
}

export function layoutPipelineMap(map) {
  const { nodeWidth, nodeHeight, columnGap, rowGap, padX, padTop, padBottom } = GEOMETRY
  const columns = orderColumns(map.nodes, map.edges)
  const tallest = Math.max(1, ...columns.map((ids) => ids.length))
  const height = padTop + tallest * (nodeHeight + rowGap) - rowGap + padBottom
  const width = padX * 2 + COLUMNS.length * nodeWidth + (COLUMNS.length - 1) * columnGap

  const positions = new Map()
  columns.forEach((ids, col) => {
    const columnHeight = ids.length * (nodeHeight + rowGap) - rowGap
    const offset = padTop + Math.max(0, (tallest * (nodeHeight + rowGap) - rowGap - columnHeight) / 2)
    ids.forEach((id, row) => {
      positions.set(id, { x: padX + col * (nodeWidth + columnGap), y: offset + row * (nodeHeight + rowGap), col, row })
    })
  })

  const columnHeaders = COLUMNS.map((kind, col) => ({
    kind,
    label: COLUMN_LABELS[kind],
    x: padX + col * (nodeWidth + columnGap) + nodeWidth / 2,
    y: 24,
    count: columns[col].length,
  }))

  const edges = map.edges.map((edge) => {
    const a = positions.get(edge.from)
    const b = positions.get(edge.to)
    const ay = a.y + nodeHeight / 2
    const by = b.y + nodeHeight / 2
    let d
    let labelX
    let labelY
    if (b.col > a.col) {
      // Forward: right side of the source to the left side of the target.
      const x1 = a.x + nodeWidth
      const x2 = b.x
      const bend = Math.max(36, (x2 - x1) / 2)
      d = `M${x1},${ay} C${x1 + bend},${ay} ${x2 - bend},${by} ${x2},${by}`
      labelX = (x1 + x2) / 2
      labelY = (ay + by) / 2
    } else if (b.col < a.col) {
      // Backward (a read into an earlier column): left side out, right side in, arcing below.
      const x1 = a.x
      const x2 = b.x + nodeWidth
      const drop = 28 + Math.abs(a.col - b.col) * 10
      d = `M${x1},${ay} C${x1 - 48},${ay + drop} ${x2 + 48},${by + drop} ${x2},${by}`
      labelX = (x1 + x2) / 2
      labelY = (ay + by) / 2 + drop * 0.75
    } else {
      // Same column: an arc on the right-hand side.
      const x = a.x + nodeWidth
      const reach = 40 + Math.min(60, Math.abs(by - ay) / 6)
      d = `M${x},${ay} C${x + reach},${ay} ${x + reach},${by} ${x},${by}`
      labelX = x + reach * 0.75
      labelY = (ay + by) / 2
    }
    return { ...edge, d, labelX, labelY }
  })

  return { width, height, positions, edges, columnHeaders }
}
