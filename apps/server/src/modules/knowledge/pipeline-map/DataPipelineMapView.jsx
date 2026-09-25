'use client'

// @req FR-213 — Data Pipeline Map: Dark Slate Canvas, Compact KPIs, Static Stage Columns,
//   Pan & Zoom, Motion Flow Edges, and 3D WebGL Matrix Mode.
// @req FR-215 — Live pipeline health on the map: per-edge run and job counts for the active Business
//   from the FR-071 ledger and transport job tables; unbacked edges show no number rather than zero.
// @spec ADR-085 D3, D5, D6; NFR-008 (status never travels by colour alone)
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js

import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Workflow,
  Database,
  Layers,
  Sparkles,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Box,
  LayoutGrid,
  List,
  CheckCircle2,
  Cpu,
  Server,
  Activity,
  ArrowRight,
} from 'lucide-react'
import { PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { GEOMETRY, layoutPipelineMap, COLUMNS, COLUMN_LABELS } from './pipeline-map-layout'
import DataPipelineMap3D from './DataPipelineMap3D'
import { usePipelineHealth } from './use-pipeline-health'
import styles from './data-pipeline-map.module.css'

function useSafeScope() {
  try {
    return useScope()
  } catch {
    return null
  }
}

export const STATUS_LABEL = {
  PRODUCTION: 'production',
  CODE_TESTS: 'code + tests',
  PARTIAL: 'บางส่วน',
  DECLARED: 'ประกาศไว้',
  BLOCKED: 'ถูก block',
}

export const SURFACE_LABEL = {
  UI: 'UI',
  ENDPOINT: 'endpoint',
  MCP: 'MCP',
  WORKER: 'worker',
  NONE: 'ไม่มี surface',
}

const KIND_LABEL = {
  SOURCE: 'ต้นทาง',
  ENTRY: 'จุดรับเข้า',
  PROCESS: 'รวม / แปลง',
  STORE: 'ที่เก็บ',
  RECIPIENT: 'ผู้รับ',
}

const isInternal = (node) => node.kind !== 'SOURCE' && node.kind !== 'RECIPIENT'
const truncate = (text, max) => (text && text.length > max ? `${text.slice(0, max - 1)}…` : text || '')

export const SCM_DOMAINS = new Set(['inventory', 'procurement', 'commerce', 'warehouse'])
export const CRM_DOMAINS = new Set(['customer', 'market'])

export const matchDomain = (nodeDomain, filterDomain) => {
  if (!filterDomain) return true
  if (filterDomain === 'group:scm') return SCM_DOMAINS.has(nodeDomain)
  if (filterDomain === 'group:crm') return CRM_DOMAINS.has(nodeDomain)
  return nodeDomain === filterDomain
}

function StatusChip({ status }) {
  if (!status) return null
  return (
    <span className={styles.status} data-status={status}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function NodeDetail({ node, map, onSelectChain }) {
  const chains = map.chains.filter((chain) => chain.nodeIds.includes(node.id))
  return (
    <div className={styles.detailBody} data-testid={`pipeline-detail-${node.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.kind}>{KIND_LABEL[node.kind]}</span>
        <h3 className={styles.detailTitle}>{node.label}</h3>
        <code className={styles.mono}>{node.id}</code>
      </div>
      {node.detail && <p className={styles.detailText}>{node.detail}</p>}
      {isInternal(node) ? (
        <dl className={styles.facts}>
          <dt>สถานะ</dt>
          <dd>
            <StatusChip status={node.buildStatus} />
          </dd>
          <dt>ระดับ surface</dt>
          <dd>{SURFACE_LABEL[node.surfaceLevel] || '—'}</dd>
          <dt>โดเมน</dt>
          <dd>{node.domain ?? '—'}</dd>
          <dt>FEAT</dt>
          <dd>{node.features.length ? node.features.join(', ') : '—'}</dd>
        </dl>
      ) : (
        <p className={styles.detailText}>
          ระบบภายนอก — สถานะอยู่ที่ node ของ zuri-ai ที่เชื่อมกับมัน
        </p>
      )}
      {node.requirements.length > 0 && (
        <div>
          <h4 className={styles.subhead}>Requirements</h4>
          <ul className={styles.plainList}>
            {node.requirements.map((r) => (
              <li key={r.id}>
                <code className={styles.mono}>{r.id}</code>{' '}
                <span className={styles.muted}>{r.status}</span> {r.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {node.surfaces.length > 0 && (
        <div>
          <h4 className={styles.subhead}>Surfaces</h4>
          <ul className={styles.plainList}>
            {node.surfaces.map((s) => (
              <li key={`${s.type}-${s.ref}`}>
                <span className={styles.surfaceType}>{s.type}</span>{' '}
                <code className={styles.mono}>{s.ref}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {node.decisions.length > 0 && (
        <p className={styles.detailText}>Decisions: {node.decisions.join(', ')}</p>
      )}
      {node.blocked && <p className={styles.blocked}>Blocked: {node.blocked}</p>}
      {node.evidence && (
        <p className={styles.evidence}>
          <strong>หลักฐาน production:</strong> {node.evidence}
        </p>
      )}
      {chains.length > 0 && (
        <div>
          <h4 className={styles.subhead}>อยู่ใน chain</h4>
          <div className={styles.chipRow}>
            {chains.map((chain) => (
              <button
                key={chain.id}
                type="button"
                className={styles.chainChip}
                onClick={() => onSelectChain(chain.id)}
              >
                {chain.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EdgeDetail({ edge, nodeById, health }) {
  return (
    <div className={styles.detailBody} data-testid={`pipeline-detail-${edge.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.kind}>edge (ท่อส่งข้อมูล)</span>
        <h3 className={styles.detailTitle}>{edge.label}</h3>
        <code className={styles.mono}>{edge.id}</code>
      </div>
      <dl className={styles.facts}>
        <dt>จาก (ต้นทาง)</dt>
        <dd>{nodeById.get(edge.from)?.label}</dd>
        <dt>ถึง (ปลายทาง)</dt>
        <dd>{nodeById.get(edge.to)?.label}</dd>
        <dt>สถานะ</dt>
        <dd>
          <StatusChip status={edge.status} />
        </dd>
        <dt>เชื่อมต่อแล้ว</dt>
        <dd>{edge.wired ? 'ใช่' : 'ยังไม่ต่อ (เส้นประ)'}</dd>
      </dl>

      {/* FR-215 Live Pipeline Health & Monitor Surface */}
      {health ? health.available === false ? (
        <div className={styles.healthSection} data-testid="edge-health-unavailable">
          <h4 className={styles.healthTitle}>
            <Activity className="w-3.5 h-3.5 text-amber-500" />
            สถานะสดยังไม่พร้อมใช้งาน ({health.table})
          </h4>
          <p className={styles.mutedText}>
            อ่านข้อมูลจาก read port ของโดเมนเจ้าของไม่ได้ จึงไม่แสดงตัวเลขแทนข้อมูลที่ยังยืนยันไม่ได้
          </p>
          {health.monitorUrl && (
            <Link
              href={health.monitorUrl}
              className={styles.monitorButton}
              data-testid="edge-monitor-link"
            >
              เปิดหน้าจอตรวจสอบ <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.healthSection} data-testid="edge-health-detail">
          <h4 className={styles.healthTitle}>
            <Activity className="w-3.5 h-3.5 text-amber-500" />
            สถานะและกิจกรรมสด ({health.table})
          </h4>
          <dl className={styles.facts}>
            <dt>จำนวนงาน</dt>
            <dd>
              <strong>{health.total}</strong> รายการ
            </dd>
            <dt>สถานะย่อย</dt>
            <dd className={styles.statusChipsWrap}>
              {Object.keys(health.countsByStatus).length > 0 ? (
                Object.entries(health.countsByStatus).map(([st, count]) => (
                  <span
                    key={st}
                    className={styles.statusMiniTag}
                    data-status={st}
                  >
                    {st}: {count}
                  </span>
                ))
              ) : (
                <span className={styles.muted}>ไม่มีประวัติงาน</span>
              )}
            </dd>
            <dt>ข้อผิดพลาด</dt>
            <dd className={health.failedCount > 0 ? styles.failText : ''}>
              {health.failedCount > 0
                ? `⚠️ ${health.failedCount} รายการที่ล้มเหลว`
                : 'ไม่มีข้อผิดพลาด (ปกติ)'}
            </dd>
            <dt>ทำงานล่าสุด</dt>
            <dd>
              {health.lastRunAt
                ? new Date(health.lastRunAt).toLocaleString('th-TH')
                : '—'}
            </dd>
          </dl>
          {health.monitorUrl && (
            <Link
              href={health.monitorUrl}
              className={styles.monitorButton}
              data-testid="edge-monitor-link"
            >
              เปิดหน้าจอตรวจสอบ <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.unbackedNotice} data-testid="edge-unbacked-notice">
          <p className={styles.mutedText}>
            ไม่มีตารางบันทึกการทำงานผูกกับท่อนี้ (Unbacked Edge — ไม่มีการนับตัวเลข)
          </p>
        </div>
      )}
    </div>
  )
}

function ChainDetail({ chain, edgeById, nodeById, onSelectEdge }) {
  return (
    <div className={styles.detailBody} data-testid={`pipeline-detail-${chain.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.kind}>chain</span>
        <h3 className={styles.detailTitle}>
          {chain.id} · {chain.name}
        </h3>
      </div>
      {chain.summary && <p className={styles.detailText}>{chain.summary}</p>}
      <dl className={styles.facts}>
        <dt>สถานะ</dt>
        <dd>
          <StatusChip status={chain.status} />
        </dd>
        <dt>โดเมน</dt>
        <dd>{chain.domains.join(', ') || '—'}</dd>
        <dt>FEAT</dt>
        <dd>{chain.features.join(', ') || '—'}</dd>
      </dl>
      <h4 className={styles.subhead}>เส้นทางหลัก (Path)</h4>
      <ol className={styles.hops}>
        {chain.path.map((edgeId) => {
          const edge = edgeById.get(edgeId)
          if (!edge) return null
          return (
            <li key={edgeId}>
              <button
                type="button"
                className={styles.hop}
                onClick={() => onSelectEdge(edgeId)}
              >
                <span>
                  {nodeById.get(edge.from)?.label} → {nodeById.get(edge.to)?.label}
                </span>
                <span className={styles.muted}>{edge.label}</span>
                <StatusChip status={edge.status} />
              </button>
            </li>
          )
        })}
      </ol>
      {chain.branches.length > 0 && (
        <>
          <h4 className={styles.subhead}>ข้อมูลที่รวมเข้า / แตกออก (Branches)</h4>
          <ul className={styles.hops}>
            {chain.branches.map((edgeId) => {
              const edge = edgeById.get(edgeId)
              if (!edge) return null
              return (
                <li key={edgeId}>
                  <button
                    type="button"
                    className={styles.hop}
                    onClick={() => onSelectEdge(edgeId)}
                  >
                    <span>
                      {nodeById.get(edge.from)?.label} → {nodeById.get(edge.to)?.label}
                    </span>
                    <span className={styles.muted}>{edge.label}</span>
                    <StatusChip status={edge.status} />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default function DataPipelineMapView({
  map,
  initialChainId = null,
  initialBusinessId = null,
  initialHealth = null,
}) {
  const scope = useSafeScope()
  const activeBusinessId = initialBusinessId || scope?.shell?.activeBusinessId || scope?.currentBusiness?.id || null
  const [showHealthOverlay, setShowHealthOverlay] = useState(true)
  const { health: fetchedHealth, loading: healthLoading, error: healthError } = usePipelineHealth(showHealthOverlay ? activeBusinessId : null)
  const healthData = initialHealth || fetchedHealth
  const healthUnavailable = Boolean(healthError) || healthData?.summary?.healthAvailable === false

  const layout = useMemo(() => layoutPipelineMap(map), [map])
  const nodeById = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const edgeById = useMemo(() => new Map(map.edges.map((e) => [e.id, e])), [map])
  const chainById = useMemo(() => new Map(map.chains.map((c) => [c.id, c])), [map])
  const domains = useMemo(
    () => [...new Set(map.nodes.map((n) => n.domain).filter(Boolean))].sort(),
    [map]
  )

  const [viewMode, setViewMode] = useState('flow2d') // 'flow2d' | 'webgl3d' | 'list'
  const [chainId, setChainId] = useState(
    initialChainId && chainById.has(initialChainId) ? initialChainId : ''
  )
  const [domain, setDomain] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(
    initialChainId && chainById.has(initialChainId) ? { type: 'chain', id: initialChainId } : null
  )

  // 2D Pan & Zoom state
  const [pan, setPan] = useState({ x: 20, y: 15 })
  const [zoom, setZoom] = useState(0.82)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const canvasRef = useRef(null)

  const chain = chainId ? chainById.get(chainId) : null
  const chainEdges = useMemo(
    () => new Set(chain ? [...chain.path, ...chain.branches] : []),
    [chain]
  )
  const pathEdges = useMemo(() => new Set(chain ? chain.path : []), [chain])

  const nodeMatches = (node) => {
    if (chain && !chain.nodeIds.includes(node.id)) return false
    if (domain) {
      if (isInternal(node)) {
        if (!matchDomain(node.domain, domain)) return false
      } else if (
        !map.edges.some(
          (e) =>
            (e.from === node.id && matchDomain(nodeById.get(e.to)?.domain, domain)) ||
            (e.to === node.id && matchDomain(nodeById.get(e.from)?.domain, domain))
        )
      ) {
        return false
      }
    }
    if (status && isInternal(node) && node.buildStatus !== status) return false
    if (
      status &&
      !isInternal(node) &&
      !map.edges.some((e) => (e.from === node.id || e.to === node.id) && e.status === status)
    ) {
      return false
    }
    return true
  }

  const edgeMatches = (edge) => {
    if (chain && !chainEdges.has(edge.id)) return false
    if (domain) {
      const fromDomain = nodeById.get(edge.from)?.domain
      const toDomain = nodeById.get(edge.to)?.domain
      if (!matchDomain(fromDomain, domain) && !matchDomain(toDomain, domain)) {
        return false
      }
    }
    if (status && edge.status !== status) return false
    return true
  }

  const filtering = Boolean(chain || domain || status)

  const selectChain = (id) => {
    setChainId(id)
    setSelected(id ? { type: 'chain', id } : null)
  }
  const selectNode = (id) => setSelected({ type: 'node', id })
  const handleNodeKeyDown = (event, id) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectNode(id)
  }
  const selectEdge = (id) => setSelected({ type: 'edge', id })

  // Pan handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0) return // Left click only
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    }
  }

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      setPan({
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      })
    },
    [isDragging]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Native wheel handler on canvas: prevent page scrolling, support pinch/wheel zoom and Shift-pan
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const onWheel = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) {
        // Shift + Wheel = horizontal pan
        setPan((prev) => ({ ...prev, x: prev.x - e.deltaY }))
      } else if (Math.abs(e.deltaX) > 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Trackpad horizontal swipe
        setPan((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
      } else {
        // Wheel zoom
        const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08
        setZoom((prevZoom) => Math.max(0.35, Math.min(2.5, prevZoom * zoomFactor)))
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewMode])

  const handleZoomBtn = (factor) => {
    setZoom((prevZoom) => Math.max(0.35, Math.min(2.5, prevZoom * factor)))
  }

  const handleResetView = () => {
    setPan({ x: 20, y: 15 })
    setZoom(0.82)
  }

  const s = map.summary
  const internalCount = Object.values(s.internalByStatus).reduce((a, b) => a + b, 0)

  let detail = (
    <p className={styles.detailText}>
      เลือก chain, node หรือ edge เพื่อดูโดเมน FEAT requirement surface และหลักฐาน
    </p>
  )
  if (selected?.type === 'node' && nodeById.has(selected.id)) {
    detail = (
      <NodeDetail
        node={nodeById.get(selected.id)}
        map={map}
        onSelectChain={selectChain}
      />
    )
  }
  if (selected?.type === 'edge' && edgeById.has(selected.id)) {
    detail = (
      <EdgeDetail
        edge={edgeById.get(selected.id)}
        nodeById={nodeById}
        health={healthData?.edges?.[selected.id]}
      />
    )
  }
  if (selected?.type === 'chain' && chainById.has(selected.id)) {
    detail = (
      <ChainDetail
        chain={chainById.get(selected.id)}
        edgeById={edgeById}
        nodeById={nodeById}
        onSelectEdge={selectEdge}
      />
    )
  }

  return (
    <div className={styles.page} data-testid="data-pipeline-map">
      <div className={styles.headerWrap}>
        <PageHeader
          eyebrow="KNOWLEDGE (GKS) · DATA PIPELINE MAP"
          title="แผนที่ Data Pipeline"
          subtitle="ภาพรวมการไหลของข้อมูลจากต้นทาง เข้าสู่แต่ละ Vault และส่งต่อให้ผู้รับ — Static topological stages พร้อม Motion flow"
        />
      </div>

      {/* ====================================================================
          Compact Mini-KPIs Strip (Reduced Height)
          ==================================================================== */}
      <section className={styles.kpisCompact} aria-label="สรุปแผนที่">
        <div className={styles.kpiMiniChip}>
          <Workflow className="w-3.5 h-3.5 text-[#E8820C]" />
          <span className={styles.kpiMiniLabel}>Chains:</span>
          <span className={styles.kpiMiniValue}>{s.chains}</span>
          <span className={styles.kpiMiniMeta}>
            (prod {s.chainsByStatus.PRODUCTION} · tests {s.chainsByStatus.CODE_TESTS} · decl {s.chainsByStatus.DECLARED})
          </span>
        </div>

        <div className={styles.kpiMiniChip}>
          <ArrowRight className="w-3.5 h-3.5 text-sky-500" />
          <span className={styles.kpiMiniLabel}>Flow:</span>
          <span className={styles.kpiMiniValue}>
            {s.byKind.SOURCE} ต้นทาง → {s.byKind.RECIPIENT} ผู้รับ
          </span>
        </div>

        <div className={styles.kpiMiniChip}>
          <Database className="w-3.5 h-3.5 text-emerald-600" />
          <span className={styles.kpiMiniLabel}>Stages:</span>
          <span className={styles.kpiMiniValue}>
            {s.byKind.ENTRY} รับเข้า · {s.byKind.PROCESS} แปลง · {s.byKind.STORE} ที่เก็บ
          </span>
        </div>

        <div className={styles.kpiMiniChip}>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className={styles.kpiMiniLabel}>Live Nodes:</span>
          <span className={styles.kpiMiniValue}>
            {s.internalByStatus.PRODUCTION} / {internalCount}
          </span>
          <span className={styles.kpiMiniMeta}>
            ({Math.round((s.internalByStatus.PRODUCTION / internalCount) * 100)}% prod)
          </span>
        </div>

        <div className={styles.kpiMiniChip}>
          <Cpu className="w-3.5 h-3.5 text-violet-500" />
          <span className={styles.kpiMiniLabel}>Surfaces:</span>
          <span className={styles.kpiMiniValue}>
            {s.internalBySurface.UI} UI · {s.internalBySurface.ENDPOINT} API · {s.internalBySurface.WORKER} Wkr
          </span>
        </div>
      </section>

      {/* ====================================================================
          Toolbar: View Switcher (2D Flow vs 3D WebGL vs List) & Filters
          ==================================================================== */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.tabs} role="tablist" aria-label="มุมมอง">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'flow2d'}
              className={styles.tab}
              onClick={() => setViewMode('flow2d')}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> ภาพ Flow (2D Dark)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'webgl3d'}
              className={styles.tab}
              onClick={() => setViewMode('webgl3d')}
            >
              <Box className="w-3.5 h-3.5" /> 3D WebGL Matrix
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              className={styles.tab}
              onClick={() => setViewMode('list')}
            >
              <List className="w-3.5 h-3.5" /> ตารางรายการ
            </button>
          </div>

          <label className={styles.filter}>
            <span>Chain:</span>
            <select
              value={chainId}
              onChange={(e) => selectChain(e.target.value)}
              aria-label="เลือก chain"
            >
              <option value="">ทุก chain ({map.chains.length})</option>
              {map.chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.filter}>
            <span>โดเมน:</span>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              aria-label="กรองตามโดเมน"
            >
              <option value="">ทุกโดเมน ({domains.length})</option>
              <optgroup label="ERP Domain Groups">
                <option value="group:scm">📦 SCM (Inventory · Procurement · Commerce)</option>
                <option value="group:crm">👥 CRM (Customer · Market Intelligence)</option>
              </optgroup>
              <optgroup label="Individual Domains">
                {domains.map((d) => {
                  let label = d
                  if (SCM_DOMAINS.has(d)) label = `${d} (SCM)`
                  else if (CRM_DOMAINS.has(d)) label = `${d} (CRM)`
                  return (
                    <option key={d} value={d}>
                      {label}
                    </option>
                  )
                })}
              </optgroup>
            </select>
          </label>

          <label className={styles.filter}>
            <span>สถานะ:</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="กรองตามสถานะ"
            >
              <option value="">ทุกสถานะ</option>
              {Object.keys(STATUS_LABEL).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>

          {filtering && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setChainId('')
                setDomain('')
                setStatus('')
                setSelected(null)
              }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        {/* Legend status indicators & Live Health Toggle */}
        <div className={styles.legend}>
          <button
            type="button"
            className={`${styles.healthToggle} ${showHealthOverlay ? styles.healthToggleActive : ''}`}
            onClick={() => setShowHealthOverlay((v) => !v)}
            title="แสดงสถานะและการทำงานสดบนท่อส่งข้อมูล (FR-215)"
            data-testid="pipeline-health-toggle"
          >
            <Activity className={`w-3.5 h-3.5 ${healthUnavailable ? 'text-amber-500' : healthData?.summary?.hasFailures ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`} />
            <span>
              {healthLoading
                ? 'กำลังโหลด...'
                : healthUnavailable
                ? 'Live Health (ยังไม่พร้อมใช้งาน)'
                : healthData
                ? `Live Health (${healthData.summary.totalTracked}${healthData.summary.totalFailures > 0 ? ` · ⚠️ ${healthData.summary.totalFailures} fail` : ''})`
                : 'Live Health'}
            </span>
          </button>
          <StatusChip status="PRODUCTION" />
          <StatusChip status="CODE_TESTS" />
          <StatusChip status="PARTIAL" />
          <StatusChip status="DECLARED" />
          <StatusChip status="BLOCKED" />
          <span className="text-[10.5px] text-slate-500">เส้นประ = ยังไม่ต่อ</span>
          <span className="text-[10.5px] text-slate-500">กรอบประ = ระบบภายนอก</span>
        </div>
      </div>

      {/* ====================================================================
          Main Canvas & Inspector Body
          ==================================================================== */}
      <div className={styles.body}>
        <div className={styles.main}>
          {viewMode === 'flow2d' ? (
            <>
              {/* Solid Dark Slate Canvas with Pan & Zoom */}
              <div className={styles.canvasFrame}>
                <div
                  ref={canvasRef}
                  className={`${styles.canvasViewport} ${isDragging ? styles.isDragging : ''}`}
                  onMouseDown={handleMouseDown}
                >
                  <svg
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className={styles.svgRoot}
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    }}
                    role="img"
                    aria-label="Data pipeline map"
                  >
                    <defs>
                      <marker
                        id="pipeline-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#38BDF8" />
                      </marker>
                      <marker
                        id="pipeline-arrow-amber"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#F59E0B" />
                      </marker>
                      <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="glow" />
                        <feComposite in="SourceGraphic" in2="glow" operator="over" />
                      </filter>
                    </defs>

                    {/* Column Stage Headers */}
                    <g className={styles.columnHeaderGroup}>
                      {layout.columnHeaders.map((col) => (
                        <g key={col.kind} transform={`translate(${col.x - 70}, ${col.y - 18})`}>
                          <rect
                            width={140}
                            height={28}
                            rx={6}
                            className={styles.columnHeaderRect}
                          />
                          <text
                            x={70}
                            y={18}
                            textAnchor="middle"
                            className={styles.columnHeaderText}
                          >
                            {col.label}{' '}
                            <tspan className={styles.columnHeaderBadge}>({col.count})</tspan>
                          </text>
                        </g>
                      ))}
                    </g>

                    {/* Edges with Base Line + Animated Motion Flow Line */}
                    <g>
                      {layout.edges.map((edge) => {
                        const active = edgeMatches(edge)
                        const onPath = pathEdges.has(edge.id)
                        const inChain = chainEdges.has(edge.id)
                        const isSelected = selected?.type === 'edge' && selected.id === edge.id
                        const isBackward = edge.d && edge.d.includes('C') && edge.labelY > layout.positions.get(edge.from)?.y
                        const edgeHealth = healthData?.edges?.[edge.id]
                        const hasFailures = edgeHealth?.available !== false && edgeHealth?.failedCount > 0

                        return (
                          <g
                            key={edge.id}
                            className={styles.edge}
                            data-status={edge.status}
                            data-dim={filtering && !active ? 'true' : 'false'}
                            data-path={onPath ? 'true' : 'false'}
                            data-selected={isSelected ? 'true' : 'false'}
                            data-has-failures={hasFailures ? 'true' : 'false'}
                            onClick={() => selectEdge(edge.id)}
                          >
                            {/* Hit Area */}
                            <path d={edge.d} className={styles.edgeHit}>
                              <title>{`${nodeById.get(edge.from)?.label} → ${nodeById.get(edge.to)?.label}: ${edge.label} (${STATUS_LABEL[edge.status]})${edgeHealth ? edgeHealth.available === false ? ` · ${edgeHealth.table}: unavailable` : ` · ${edgeHealth.table}: ${edgeHealth.total} runs (${edgeHealth.failedCount} fail)` : ''}`}</title>
                            </path>

                            {/* Base Trace Line */}
                            <path
                              d={edge.d}
                              className={styles.edgeBase}
                              data-wired={edge.wired ? 'true' : 'false'}
                            />

                            {/* Animated Motion Edge Flow Line */}
                            {(!filtering || active) && (
                              <path
                                d={edge.d}
                                className={styles.edgeFlow}
                                data-backward={isBackward ? 'true' : 'false'}
                                markerEnd={
                                  isSelected || onPath
                                    ? 'url(#pipeline-arrow-amber)'
                                    : 'url(#pipeline-arrow)'
                                }
                              />
                            )}

                            {/* Traveling Pulse Packet for Selected / Active Path */}
                            {(isSelected || onPath) && (
                              <circle r="3.5" fill="#E8820C" filter="url(#glow-amber)">
                                <animateMotion
                                  path={edge.d}
                                  dur="1.4s"
                                  repeatCount="indefinite"
                                />
                              </circle>
                            )}

                            {/* Live Health Badge (FR-215 / ADR-085 D5) */}
                            {showHealthOverlay && edgeHealth && (() => {
                              const unavailable = edgeHealth.available === false
                              const hasFail = edgeHealth.failedCount > 0
                              return (
                                <g
                                  transform={`translate(${edge.labelX}, ${edge.labelY})`}
                                  className={styles.healthBadge}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    selectEdge(edge.id)
                                  }}
                                  data-testid={`edge-health-${edge.id}`}
                                >
                                  <title>{unavailable ? `${edgeHealth.table}: unavailable` : `${edgeHealth.table}: ${edgeHealth.total} งาน (${edgeHealth.failedCount} fail)`}</title>
                                  {unavailable ? (
                                    <>
                                      <rect x={-16} y={-8} width={32} height={16} rx={8} className={styles.badgeIdleBg} />
                                      <text x={0} y={3.5} textAnchor="middle" className={styles.badgeIdleText}>
                                        N/A
                                      </text>
                                    </>
                                  ) : hasFail ? (
                                    <>
                                      <rect x={-18} y={-8} width={36} height={16} rx={8} className={styles.badgeFailBg} />
                                      <text x={0} y={3.5} textAnchor="middle" className={styles.badgeFailText}>
                                        {edgeHealth.failedCount} fail
                                      </text>
                                    </>
                                  ) : edgeHealth.total > 0 ? (
                                    <>
                                      <rect x={-14} y={-8} width={28} height={16} rx={8} className={styles.badgeOkBg} />
                                      <text x={0} y={3.5} textAnchor="middle" className={styles.badgeOkText}>
                                        {edgeHealth.total}
                                      </text>
                                    </>
                                  ) : (
                                    <>
                                      <rect x={-12} y={-8} width={24} height={16} rx={8} className={styles.badgeIdleBg} />
                                      <text x={0} y={3.5} textAnchor="middle" className={styles.badgeIdleText}>
                                        0
                                      </text>
                                    </>
                                  )}
                                </g>
                              )
                            })()}

                            {/* Edge Label on hover / selection */}
                            {(isSelected || (onPath && active)) && (
                              <text
                                x={edge.labelX}
                                y={edge.labelY - (showHealthOverlay && edgeHealth ? 12 : 4)}
                                textAnchor="middle"
                                className={styles.edgeLabel}
                              >
                                {truncate(edge.label, 32)}
                              </text>
                            )}
                          </g>
                        )
                      })}
                    </g>

                    {/* Static Stage Column Nodes */}
                    <g>
                      {map.nodes.map((node) => {
                        const pos = layout.positions.get(node.id)
                        if (!pos) return null
                        const active = nodeMatches(node)
                        const isSelected = selected?.type === 'node' && selected.id === node.id
                        const internal = isInternal(node)
                        const second = internal
                          ? `${STATUS_LABEL[node.buildStatus]} · ${SURFACE_LABEL[node.surfaceLevel]}`
                          : 'ภายนอก'

                        return (
                          <g
                            key={node.id}
                            transform={`translate(${pos.x},${pos.y})`}
                            className={styles.node}
                            data-kind={node.kind}
                            data-status={internal ? node.buildStatus : 'EXTERNAL'}
                            data-dim={filtering && !active ? 'true' : 'false'}
                            data-selected={isSelected ? 'true' : 'false'}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            aria-label={`${KIND_LABEL[node.kind]}: ${node.label}`}
                            data-testid={`pipeline-node-${node.id}`}
                            onClick={() => selectNode(node.id)}
                            onKeyDown={(event) => handleNodeKeyDown(event, node.id)}
                          >
                            <title>{node.label}</title>
                            {/* Card Background */}
                            <rect
                              width={GEOMETRY.nodeWidth}
                              height={GEOMETRY.nodeHeight}
                              rx={6}
                              className={styles.nodeBox}
                            />
                            {/* Status Stripe */}
                            <rect
                              width={4.5}
                              height={GEOMETRY.nodeHeight}
                              rx={2}
                              className={styles.nodeStripe}
                            />
                            {/* Title */}
                            <text x={12} y={17} className={styles.nodeLabel}>
                              {truncate(node.label, 25)}
                            </text>
                            {/* Subtitle / Meta */}
                            <text x={12} y={32} className={styles.nodeMeta}>
                              {truncate(second, 30)}
                            </text>
                          </g>
                        )
                      })}
                    </g>
                  </svg>
                </div>

                {/* HUD Pan / Zoom Controls */}
                <div className={styles.hudControls}>
                  <button
                    type="button"
                    onClick={() => handleZoomBtn(1.15)}
                    className={styles.hudButton}
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleZoomBtn(0.85)}
                    className={styles.hudButton}
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className={styles.hudBadge}>{Math.round(zoom * 100)}%</span>
                  <button
                    type="button"
                    onClick={handleResetView}
                    className={styles.hudResetButton}
                    title="Reset to 100%"
                  >
                    <RotateCcw className="w-3 h-3 inline mr-1" /> รีเซ็ต
                  </button>
                </div>
              </div>

              {/* Chain Pills Selector */}
              <ul className={styles.chainList} aria-label="Chains">
                {map.chains.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={styles.chainButton}
                      aria-pressed={chainId === c.id}
                      onClick={() => selectChain(chainId === c.id ? '' : c.id)}
                      data-testid={`pipeline-chain-${c.id}`}
                    >
                      <code className={styles.mono}>{c.id}</code>
                      <span className={styles.chainName}>{c.name}</span>
                      <StatusChip status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : viewMode === 'webgl3d' ? (
            /* 3D WebGL Matrix View */
            <DataPipelineMap3D
              map={map}
              selectedId={selected?.id}
              onSelectNode={selectNode}
            />
          ) : (
            /* List Table View */
            <div className={styles.lists} data-testid="data-pipeline-map-list">
              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Chains ({map.chains.length})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Chain</th>
                      <th scope="col">ชื่อ</th>
                      <th scope="col">สถานะ</th>
                      <th scope="col">โดเมน</th>
                      <th scope="col">FEAT</th>
                      <th scope="col" className={styles.num}>
                        Hops
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {map.chains
                      .filter(
                        (c) =>
                          (!chain || c.id === chain.id) &&
                          (!domain || c.domains.some((d) => matchDomain(d, domain))) &&
                          (!status || c.status === status)
                      )
                      .map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => {
                                setViewMode('flow2d')
                                selectChain(c.id)
                              }}
                            >
                              {c.id}
                            </button>
                          </td>
                          <td>{c.name}</td>
                          <td>
                            <StatusChip status={c.status} />
                          </td>
                          <td>{c.domains.join(', ')}</td>
                          <td>{c.features.join(', ')}</td>
                          <td className={styles.num}>{c.path.length}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Nodes ({map.nodes.length})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Node</th>
                      <th scope="col">ชนิด</th>
                      <th scope="col">โดเมน</th>
                      <th scope="col">FEAT</th>
                      <th scope="col">สถานะ</th>
                      <th scope="col">Surface</th>
                      <th scope="col">Endpoint / UI / MCP / worker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {map.nodes.filter(nodeMatches).map((n) => (
                      <tr key={n.id}>
                        <td>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => selectNode(n.id)}
                          >
                            {n.label}
                          </button>
                          <div className={styles.mono}>{n.id}</div>
                        </td>
                        <td>{KIND_LABEL[n.kind]}</td>
                        <td>{n.domain ?? '—'}</td>
                        <td>{n.features.join(', ') || '—'}</td>
                        <td>
                          {isInternal(n) ? <StatusChip status={n.buildStatus} /> : 'ภายนอก'}
                        </td>
                        <td>{isInternal(n) ? SURFACE_LABEL[n.surfaceLevel] : '—'}</td>
                        <td className={styles.refs}>
                          {n.surfaces.map((x) => `${x.type} ${x.ref}`).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Edges ({map.edges.length})</caption>
                  <thead>
                    <tr>
                      <th scope="col">จาก</th>
                      <th scope="col">ถึง</th>
                      <th scope="col">ข้อมูล</th>
                      <th scope="col">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {map.edges.filter(edgeMatches).map((e) => (
                      <tr key={e.id}>
                        <td>{nodeById.get(e.from)?.label}</td>
                        <td>{nodeById.get(e.to)?.label}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.linkButton}
                            onClick={() => selectEdge(e.id)}
                          >
                            {e.label}
                          </button>
                          {!e.wired && <span className={styles.muted}> (ยังไม่ต่อ)</span>}
                        </td>
                        <td>
                          <StatusChip status={e.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Inspector Detail Drawer */}
        <aside className={styles.detail} aria-label="รายละเอียด" aria-live="polite">
          {detail}
        </aside>
      </div>

      <p className={styles.footnote}>
        สถานะมีสองแกน: สถานะการสร้าง (ประกาศไว้ → บางส่วน → code + tests → production พร้อมหลักฐาน) และระดับ surface (worker → MCP → endpoint → UI).
        edge ได้สถานะอ่อนสุดของ node ภายในที่เชื่อม และ chain ได้สถานะอ่อนสุดของทุก edge.
      </p>
    </div>
  )
}
