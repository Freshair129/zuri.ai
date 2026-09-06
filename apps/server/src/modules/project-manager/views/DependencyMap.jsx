'use client'

// @req FR-040 — Project-local Dependency Map renders contained dependency edges.
// @spec SDD-019, ADR-012 — the graph is read-only and stays under Project > Work.
// @tested tests/unit/dependency-map-view.test.js
import { useMemo } from 'react'
import { ArrowRight, CircleDot, Network } from 'lucide-react'
import { EmptyState, StatusPill } from '@/components/ui'
import s from './dependency-map.module.css'

const NODE_WIDTH = 188
const NODE_HEIGHT = 88
const COLUMN_GAP = 52
const ROW_GAP = 58

function graphLayout(nodes) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  const rows = Math.max(1, Math.ceil(nodes.length / columns))
  const positions = new Map()

  nodes.forEach((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    positions.set(node.id, {
      x: column * (NODE_WIDTH + COLUMN_GAP),
      y: row * (NODE_HEIGHT + ROW_GAP),
    })
  })

  return {
    positions,
    width: Math.max(NODE_WIDTH, columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP),
    height: Math.max(NODE_HEIGHT, rows * NODE_HEIGHT + (rows - 1) * ROW_GAP),
  }
}

function nodeTitle(node) {
  return node.code ? `${node.code} · ${node.title}` : node.title
}

export default function DependencyMap({ graph }) {
  const nodes = graph?.nodes || []
  const edges = graph?.edges || []
  const layout = useMemo(() => graphLayout(nodes), [nodes])

  if (nodes.length === 0) {
    return (
      <EmptyState
        title="No project dependencies"
        hint="Add a dependency between work items, workstreams, milestones, gates, or containers to see the map."
      />
    )
  }

  return (
    <div className={s.wrapper}>
      <section className={s.graphPanel} aria-label="Dependency Map graph">
        <div className={s.graphViewport}>
          <div className={s.graph} style={{ width: layout.width, height: layout.height }}>
            <svg
              className={s.edges}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={`${edges.length} dependency ${edges.length === 1 ? 'edge' : 'edges'}`}
            >
              <defs>
                <marker id="dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--action-primary)" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const source = layout.positions.get(edge.source)
                const target = layout.positions.get(edge.target)
                if (!source || !target) return null
                return (
                  <line
                    key={edge.id}
                    x1={source.x + NODE_WIDTH / 2}
                    y1={source.y + NODE_HEIGHT / 2}
                    x2={target.x + NODE_WIDTH / 2}
                    y2={target.y + NODE_HEIGHT / 2}
                    className={s.edge}
                    markerEnd="url(#dependency-arrow)"
                  />
                )
              })}
            </svg>
            <div className={s.nodes}>
              {nodes.map((node) => {
                const position = layout.positions.get(node.id)
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={s.node}
                    style={{ left: position.x, top: position.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
                    aria-label={`${node.type.replace(/_/g, ' ')}: ${nodeTitle(node)}`}
                  >
                    <span className={s.nodeIcon} aria-hidden><CircleDot size={15} /></span>
                    <span className={s.nodeBody}>
                      <span className={s.nodeType}>{node.type.replace(/_/g, ' ')}</span>
                      <span className={s.nodeTitle}>{nodeTitle(node)}</span>
                      {node.status && <StatusPill status={node.status} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={s.edgeList} aria-label="Dependency edge list">
        <div className="mb-3 flex items-center gap-2">
          <Network size={16} aria-hidden />
          <h2 className="text-sm font-bold">Dependency edges</h2>
        </div>
        {edges.length === 0 ? (
          <p className="text-xs text-muted">The project has nodes but no dependency edges yet.</p>
        ) : (
          <ol className="space-y-2">
            {edges.map((edge) => {
              const source = nodes.find((node) => node.id === edge.source)
              const target = nodes.find((node) => node.id === edge.target)
              return (
                <li key={edge.id} className={s.edgeRow}>
                  <span className="min-w-0 truncate font-semibold">{source ? nodeTitle(source) : edge.source}</span>
                  <span className="pill pill-gate shrink-0">{edge.label}</span>
                  <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 truncate font-semibold">{target ? nodeTitle(target) : edge.target}</span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
