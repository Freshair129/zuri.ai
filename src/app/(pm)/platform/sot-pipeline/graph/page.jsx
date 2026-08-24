'use client'

// @req FR-101 — the pipeline as read-only nodes and edges: hand-rolled SVG,
// topological layers left-to-right, status carried by fill, pending-decision
// badges linking into the FR-100 inbox. No client-side graph library.
// @spec FR-101
// @tested tests/unit/sot-pipeline-graph.test.js
import { useMemo } from 'react'
import Link from 'next/link'

import { Card, ErrorState, PageHeader, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

const NODE_W = 172
const NODE_H = 58
const COL_GAP = 64
const ROW_GAP = 26

const FILL = {
  planned: '#e2e8f0',
  running: '#bfdbfe',
  blocked: '#fde68a',
  done: '#bbf7d0',
  context: '#f1f5f9',
}
const STROKE = {
  planned: '#94a3b8',
  running: '#3b82f6',
  blocked: '#d97706',
  done: '#16a34a',
  context: '#cbd5e1',
}

function layout(nodes) {
  const byDepth = new Map()
  for (const node of nodes) {
    if (!byDepth.has(node.depth)) byDepth.set(node.depth, [])
    byDepth.get(node.depth).push(node)
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  const positions = new Map()
  let maxRows = 1
  depths.forEach((depth, column) => {
    const rows = byDepth.get(depth)
    maxRows = Math.max(maxRows, rows.length)
    rows.forEach((node, row) => {
      positions.set(node.id, {
        x: column * (NODE_W + COL_GAP),
        y: row * (NODE_H + ROW_GAP),
      })
    })
  })
  return {
    positions,
    width: depths.length * (NODE_W + COL_GAP) - COL_GAP + 2,
    height: maxRows * (NODE_H + ROW_GAP) - ROW_GAP + 2,
  }
}

export default function SotPipelineGraphPage() {
  const { businessId } = useScope()
  const { data, error, loading } = useFetch(
    businessId ? `/api/platform/sot/plan?businessId=${businessId}` : null,
    [businessId]
  )
  const graph = data?.graph
  const view = useMemo(() => (graph ? layout(graph.nodes) : null), [graph])

  if (!businessId) return <ErrorState message="เลือก Business ก่อนเพื่อดูกราฟ pipeline" />
  if (loading) return <LoadingCard />
  if (error) return <ErrorState message={error} />
  if (!graph || !view) return null

  return (
    <div>
      <PageHeader
        title="SoT Pipeline — มุมมองกราฟ"
        subtitle="node/edge สถานะสดจากหลักฐาน run + คิวอนุมัติ"
        actions={<Link href="/platform/sot-pipeline">กลับไปหน้าแผน</Link>}
      />
      <div style={{ display: 'flex', gap: '.6rem', margin: '0 0 .6rem', flexWrap: 'wrap' }}>
        <span><StatusPill status="PLANNED" /> รอเริ่ม</span>
        <span><StatusPill status="IN_PROGRESS" /> กำลังทำ</span>
        <span><StatusPill status="BLOCKED" /> ติดรออนุมัติ/แก้</span>
        <span><StatusPill status="DONE" /> เสร็จ</span>
      </div>
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <svg
            width={view.width}
            height={view.height}
            viewBox={`0 0 ${view.width} ${view.height}`}
            role="img"
            aria-label="SoT pipeline graph"
          >
            <defs>
              <marker id="sot-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
              </marker>
            </defs>
            {graph.edges.map((edge) => {
              const from = view.positions.get(edge.source)
              const to = view.positions.get(edge.target)
              if (!from || !to) return null
              return (
                <line
                  key={edge.id}
                  x1={from.x + NODE_W}
                  y1={from.y + NODE_H / 2}
                  x2={to.x}
                  y2={to.y + NODE_H / 2}
                  stroke="#94a3b8"
                  strokeWidth="1.2"
                  markerEnd="url(#sot-arrow)"
                />
              )
            })}
            {graph.nodes.map((node) => {
              const pos = view.positions.get(node.id)
              const status = node.status in FILL ? node.status : 'context'
              return (
                <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx="8"
                    fill={FILL[status]}
                    stroke={STROKE[status]}
                    strokeWidth={node.type === 'human-gate' ? 2.4 : 1.4}
                    strokeDasharray={node.status === 'context' ? '4 3' : 'none'}
                  />
                  <text x="10" y="22" fontSize="11.5" fontWeight="600" fill="#1e293b">
                    {node.title.length > 26 ? `${node.title.slice(0, 25)}…` : node.title}
                  </text>
                  <text x="10" y="40" fontSize="10" fill="#475569">
                    {node.status === 'context' ? node.type : node.status}
                    {node.pendingDecisions > 0 ? ` · รออนุมัติ ${node.pendingDecisions}` : ''}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </Card>
      {graph.nodes.some((n) => n.pendingDecisions > 0) ? (
        <p style={{ marginTop: '.6rem' }}>
          <Link href="/platform/sot-pipeline/inbox">→ เปิดกล่องรออนุมัติ</Link>
        </p>
      ) : null}
    </div>
  )
}
