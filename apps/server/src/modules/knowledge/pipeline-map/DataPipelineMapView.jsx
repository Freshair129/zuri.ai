'use client'

// @req FR-213 — the Data Pipeline Map: a layered node-edge drawing of where data
//   enters zuri-ai, where it is combined and who receives it, with chain, domain
//   and status filters, a detail panel and a list view that shows the same rows.
// @spec ADR-085 D3, D6; NFR-008 (status never travels by colour alone)
// @tested tests/unit/knowledge-data-pipeline-map-ui.test.js, tests/e2e/fr213-data-pipeline-map.spec.js
//
// Read-only. Every status on this page is the generator's word (FR-212); this
// component only draws it, filters it and explains it.

import { useMemo, useState } from 'react'
import { Kpi, PageHeader } from '@/components/ui'
import { GEOMETRY, layoutPipelineMap } from './pipeline-map-layout'
import styles from './data-pipeline-map.module.css'

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
const KIND_LABEL = { SOURCE: 'ต้นทาง', ENTRY: 'จุดรับเข้า', PROCESS: 'รวม / แปลง', STORE: 'ที่เก็บ', RECIPIENT: 'ผู้รับ' }
const isInternal = (node) => node.kind !== 'SOURCE' && node.kind !== 'RECIPIENT'
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function StatusChip({ status }) {
  if (!status) return null
  return <span className={styles.status} data-status={status}>{STATUS_LABEL[status] ?? status}</span>
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
          <dt>สถานะ</dt><dd><StatusChip status={node.buildStatus} /></dd>
          <dt>ระดับ surface</dt><dd>{SURFACE_LABEL[node.surfaceLevel]}</dd>
          <dt>โดเมน</dt><dd>{node.domain ?? (node.system === 'edge' ? 'Edge Device' : '—')}</dd>
          <dt>FEAT</dt><dd>{node.features.length ? node.features.join(', ') : '—'}</dd>
        </dl>
      ) : (
        <p className={styles.detailText}>{node.system === 'edge' ? 'Zuri Edge Device' : 'ระบบภายนอก'} — สถานะอยู่ที่ node ของ zuri-ai ที่เชื่อมกับมัน</p>
      )}
      {node.requirements.length > 0 && (
        <div>
          <h4 className={styles.subhead}>Requirements</h4>
          <ul className={styles.plainList}>
            {node.requirements.map((r) => (
              <li key={r.id}><code className={styles.mono}>{r.id}</code> <span className={styles.muted}>{r.status}</span> {r.title}</li>
            ))}
          </ul>
        </div>
      )}
      {node.surfaces.length > 0 && (
        <div>
          <h4 className={styles.subhead}>Surfaces</h4>
          <ul className={styles.plainList}>
            {node.surfaces.map((s) => (
              <li key={`${s.type}-${s.ref}`}><span className={styles.surfaceType}>{s.type}</span> <code className={styles.mono}>{s.ref}</code></li>
            ))}
          </ul>
        </div>
      )}
      {node.decisions.length > 0 && <p className={styles.detailText}>Decisions: {node.decisions.join(', ')}</p>}
      {node.blocked && <p className={styles.blocked}>Blocked: {node.blocked}</p>}
      {node.evidence && <p className={styles.evidence}><strong>หลักฐาน production:</strong> {node.evidence}</p>}
      {chains.length > 0 && (
        <div>
          <h4 className={styles.subhead}>อยู่ใน chain</h4>
          <div className={styles.chipRow}>
            {chains.map((chain) => (
              <button key={chain.id} type="button" className={styles.chainChip} onClick={() => onSelectChain(chain.id)}>{chain.id}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EdgeDetail({ edge, nodeById }) {
  return (
    <div className={styles.detailBody} data-testid={`pipeline-detail-${edge.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.kind}>edge</span>
        <h3 className={styles.detailTitle}>{edge.label}</h3>
        <code className={styles.mono}>{edge.id}</code>
      </div>
      <dl className={styles.facts}>
        <dt>จาก</dt><dd>{nodeById.get(edge.from)?.label}</dd>
        <dt>ถึง</dt><dd>{nodeById.get(edge.to)?.label}</dd>
        <dt>สถานะ</dt><dd><StatusChip status={edge.status} /></dd>
        <dt>ต่อแล้ว</dt><dd>{edge.wired ? 'ใช่' : 'ยังไม่ต่อ'}</dd>
      </dl>
    </div>
  )
}

function ChainDetail({ chain, edgeById, nodeById, onSelectEdge }) {
  return (
    <div className={styles.detailBody} data-testid={`pipeline-detail-${chain.id}`}>
      <div className={styles.detailHead}>
        <span className={styles.kind}>chain</span>
        <h3 className={styles.detailTitle}>{chain.id} · {chain.name}</h3>
      </div>
      {chain.summary && <p className={styles.detailText}>{chain.summary}</p>}
      <dl className={styles.facts}>
        <dt>สถานะ</dt><dd><StatusChip status={chain.status} /></dd>
        <dt>โดเมน</dt><dd>{chain.domains.join(', ') || '—'}</dd>
        <dt>FEAT</dt><dd>{chain.features.join(', ') || '—'}</dd>
      </dl>
      <h4 className={styles.subhead}>เส้นทาง</h4>
      <ol className={styles.hops}>
        {chain.path.map((edgeId) => {
          const edge = edgeById.get(edgeId)
          return (
            <li key={edgeId}>
              <button type="button" className={styles.hop} onClick={() => onSelectEdge(edgeId)}>
                <span>{nodeById.get(edge.from)?.label} → {nodeById.get(edge.to)?.label}</span>
                <span className={styles.muted}>{edge.label}</span>
                <StatusChip status={edge.status} />
              </button>
            </li>
          )
        })}
      </ol>
      {chain.branches.length > 0 && (
        <>
          <h4 className={styles.subhead}>ข้อมูลที่รวมเข้า / แตกออก</h4>
          <ul className={styles.hops}>
            {chain.branches.map((edgeId) => {
              const edge = edgeById.get(edgeId)
              return (
                <li key={edgeId}>
                  <button type="button" className={styles.hop} onClick={() => onSelectEdge(edgeId)}>
                    <span>{nodeById.get(edge.from)?.label} → {nodeById.get(edge.to)?.label}</span>
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

export default function DataPipelineMapView({ map, initialChainId = null }) {
  const layout = useMemo(() => layoutPipelineMap(map), [map])
  const nodeById = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const edgeById = useMemo(() => new Map(map.edges.map((e) => [e.id, e])), [map])
  const chainById = useMemo(() => new Map(map.chains.map((c) => [c.id, c])), [map])
  const domains = useMemo(() => [...new Set(map.nodes.map((n) => n.domain).filter(Boolean))].sort(), [map])

  const [view, setView] = useState('graph')
  const [chainId, setChainId] = useState(initialChainId && chainById.has(initialChainId) ? initialChainId : '')
  const [domain, setDomain] = useState('')
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(initialChainId && chainById.has(initialChainId) ? { type: 'chain', id: initialChainId } : null)

  const chain = chainId ? chainById.get(chainId) : null
  const chainEdges = useMemo(() => new Set(chain ? [...chain.path, ...chain.branches] : []), [chain])
  const pathEdges = useMemo(() => new Set(chain ? chain.path : []), [chain])

  const nodeMatches = (node) => {
    if (chain && !chain.nodeIds.includes(node.id)) return false
    if (domain) {
      if (isInternal(node)) { if (node.domain !== domain) return false }
      else if (!map.edges.some((e) => (e.from === node.id && nodeById.get(e.to)?.domain === domain) || (e.to === node.id && nodeById.get(e.from)?.domain === domain))) return false
    }
    if (status && isInternal(node) && node.buildStatus !== status) return false
    if (status && !isInternal(node) && !map.edges.some((e) => (e.from === node.id || e.to === node.id) && e.status === status)) return false
    return true
  }
  const edgeMatches = (edge) => {
    if (chain && !chainEdges.has(edge.id)) return false
    if (domain && nodeById.get(edge.from)?.domain !== domain && nodeById.get(edge.to)?.domain !== domain) return false
    if (status && edge.status !== status) return false
    return true
  }
  const filtering = Boolean(chain || domain || status)

  const selectChain = (id) => {
    setChainId(id)
    setSelected(id ? { type: 'chain', id } : null)
  }
  const selectNode = (id) => setSelected({ type: 'node', id })
  const selectEdge = (id) => setSelected({ type: 'edge', id })
  const onKey = (event, fn) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      fn()
    }
  }

  const s = map.summary
  const internalCount = Object.values(s.internalByStatus).reduce((a, b) => a + b, 0)

  let detail = <p className={styles.detailText}>เลือก chain, node หรือ edge เพื่อดูโดเมน FEAT requirement surface และหลักฐาน</p>
  if (selected?.type === 'node' && nodeById.has(selected.id)) detail = <NodeDetail node={nodeById.get(selected.id)} map={map} onSelectChain={selectChain} />
  if (selected?.type === 'edge' && edgeById.has(selected.id)) detail = <EdgeDetail edge={edgeById.get(selected.id)} nodeById={nodeById} />
  if (selected?.type === 'chain' && chainById.has(selected.id)) detail = <ChainDetail chain={chainById.get(selected.id)} edgeById={edgeById} nodeById={nodeById} onSelectEdge={selectEdge} />

  return (
    <div className={styles.page} data-testid="data-pipeline-map">
      <PageHeader
        eyebrow="KNOWLEDGE (GKS) · DATA PIPELINE MAP"
        title="แผนที่ data pipeline"
        subtitle="ข้อมูลเข้ามาจากไหน ถูกรวมที่ไหน และส่งให้ใคร — generate จาก docs/DATA-PIPELINE-MAP.md ทุกครั้งที่รัน govern ไม่ใช่การวัดสด"
      />

      <section className={styles.kpis} aria-label="สรุปแผนที่">
        <Kpi label="Chains" value={s.chains} meta={`production ${s.chainsByStatus.PRODUCTION} · code+tests ${s.chainsByStatus.CODE_TESTS} · ประกาศไว้ ${s.chainsByStatus.DECLARED}`} />
        <Kpi label="ต้นทาง → ผู้รับ" value={`${s.byKind.SOURCE} → ${s.byKind.RECIPIENT}`} meta="ระบบและคนภายนอก" />
        <Kpi label="จุดรับเข้า" value={s.byKind.ENTRY} meta={`รวม / แปลง ${s.byKind.PROCESS} · ที่เก็บ ${s.byKind.STORE}`} />
        <Kpi label="Node ภายในที่ขึ้น production" value={`${s.internalByStatus.PRODUCTION} / ${internalCount}`} meta={`code+tests ${s.internalByStatus.CODE_TESTS} · บางส่วน ${s.internalByStatus.PARTIAL} · ประกาศ ${s.internalByStatus.DECLARED} · block ${s.internalByStatus.BLOCKED}`} tone="good" />
        <Kpi label="มีหน้าจอ / endpoint" value={`${s.internalBySurface.UI} / ${s.internalBySurface.ENDPOINT}`} meta={`MCP ${s.internalBySurface.MCP} · worker ${s.internalBySurface.WORKER} · ไม่มี ${s.internalBySurface.NONE}`} />
      </section>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="มุมมอง">
          <button type="button" role="tab" aria-selected={view === 'graph'} className={styles.tab} onClick={() => setView('graph')}>ภาพ node-edge</button>
          <button type="button" role="tab" aria-selected={view === 'list'} className={styles.tab} onClick={() => setView('list')}>รายการ</button>
        </div>
        <label className={styles.filter}>
          <span>Chain</span>
          <select value={chainId} onChange={(e) => selectChain(e.target.value)} aria-label="เลือก chain">
            <option value="">ทุก chain</option>
            {map.chains.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}
          </select>
        </label>
        <label className={styles.filter}>
          <span>โดเมน</span>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="กรองตามโดเมน">
            <option value="">ทุกโดเมน</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className={styles.filter}>
          <span>สถานะ</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="กรองตามสถานะ">
            <option value="">ทุกสถานะ</option>
            {map.vocabulary.buildStatuses.slice().reverse().map((v) => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
          </select>
        </label>
        {filtering && <button type="button" className={styles.clear} onClick={() => { selectChain(''); setDomain(''); setStatus('') }}>ล้างตัวกรอง</button>}
      </div>

      <div className={styles.body}>
        <div className={styles.main}>
          {view === 'graph' ? (
            <>
              <div className={styles.legend} aria-label="คำอธิบายสี">
                {map.vocabulary.buildStatuses.slice().reverse().map((v) => <StatusChip key={v} status={v} />)}
                <span className={styles.muted}>เส้นประ = ยังไม่ต่อ · กรอบเทา = ระบบภายนอก</span>
              </div>
              <div className={styles.canvas}>
                <svg
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                  role="group"
                  aria-label={`แผนที่ data pipeline: ${s.nodes} node, ${s.edges} edge, ${s.chains} chain`}
                  className={styles.svg}
                >
                  <defs>
                    <marker id="pipeline-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" className={styles.arrowHead} />
                    </marker>
                  </defs>
                  {layout.columnHeaders.map((h) => (
                    <text key={h.kind} x={h.x} y={h.y} textAnchor="middle" className={styles.columnHeader}>{h.label} ({h.count})</text>
                  ))}
                  <g>
                    {layout.edges.map((edge) => {
                      const active = edgeMatches(edge)
                      const onPath = pathEdges.has(edge.id)
                      const isSelected = selected?.type === 'edge' && selected.id === edge.id
                      return (
                        <g key={edge.id} className={styles.edge} data-status={edge.status} data-dim={filtering && !active ? 'true' : 'false'} data-path={onPath ? 'true' : 'false'} data-selected={isSelected ? 'true' : 'false'}>
                          <path d={edge.d} className={styles.edgeHit} onClick={() => selectEdge(edge.id)}>
                            <title>{`${nodeById.get(edge.from)?.label} → ${nodeById.get(edge.to)?.label}: ${edge.label} (${STATUS_LABEL[edge.status]})`}</title>
                          </path>
                          <path d={edge.d} className={styles.edgeLine} data-wired={edge.wired ? 'true' : 'false'} markerEnd="url(#pipeline-arrow)" />
                          {(isSelected || (onPath && active)) && (
                            <text x={edge.labelX} y={edge.labelY - 4} textAnchor="middle" className={styles.edgeLabel}>{truncate(edge.label, 34)}</text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                  <g>
                    {map.nodes.map((node) => {
                      const pos = layout.positions.get(node.id)
                      const active = nodeMatches(node)
                      const isSelected = selected?.type === 'node' && selected.id === node.id
                      const internal = isInternal(node)
                      const second = internal
                        ? `${STATUS_LABEL[node.buildStatus]} · ${SURFACE_LABEL[node.surfaceLevel]}`
                        : (node.system === 'edge' ? 'Edge Device' : 'ภายนอก')
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
                          aria-label={`${KIND_LABEL[node.kind]}: ${node.label}${internal ? `, ${STATUS_LABEL[node.buildStatus]}, ${SURFACE_LABEL[node.surfaceLevel]}, โดเมน ${node.domain ?? 'edge'}` : ''}`}
                          data-testid={`pipeline-node-${node.id}`}
                          onClick={() => selectNode(node.id)}
                          onKeyDown={(event) => onKey(event, () => selectNode(node.id))}
                        >
                          <title>{node.label}</title>
                          <rect width={GEOMETRY.nodeWidth} height={GEOMETRY.nodeHeight} rx={7} className={styles.nodeBox} />
                          <rect width={5} height={GEOMETRY.nodeHeight} rx={2} className={styles.nodeStripe} />
                          <text x={13} y={17} className={styles.nodeLabel}>{truncate(node.label, 26)}</text>
                          <text x={13} y={33} className={styles.nodeMeta}>{truncate(second, 30)}</text>
                        </g>
                      )
                    })}
                  </g>
                </svg>
              </div>
              <ul className={styles.chainList} aria-label="Chains">
                {map.chains.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={styles.chainButton} aria-pressed={chainId === c.id} onClick={() => selectChain(chainId === c.id ? '' : c.id)} data-testid={`pipeline-chain-${c.id}`}>
                      <code className={styles.mono}>{c.id}</code>
                      <span className={styles.chainName}>{c.name}</span>
                      <StatusChip status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className={styles.lists} data-testid="data-pipeline-map-list">
              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Chains</caption>
                  <thead><tr><th scope="col">Chain</th><th scope="col">ชื่อ</th><th scope="col">สถานะ</th><th scope="col">โดเมน</th><th scope="col">FEAT</th><th scope="col" className={styles.num}>Hops</th></tr></thead>
                  <tbody>
                    {map.chains.filter((c) => (!chain || c.id === chain.id) && (!domain || c.domains.includes(domain)) && (!status || c.status === status)).map((c) => (
                      <tr key={c.id}>
                        <td><button type="button" className={styles.linkButton} onClick={() => { setView('graph'); selectChain(c.id) }}>{c.id}</button></td>
                        <td>{c.name}</td><td><StatusChip status={c.status} /></td><td>{c.domains.join(', ')}</td><td>{c.features.join(', ')}</td><td className={styles.num}>{c.path.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Nodes</caption>
                  <thead><tr><th scope="col">Node</th><th scope="col">ชนิด</th><th scope="col">โดเมน</th><th scope="col">FEAT</th><th scope="col">สถานะ</th><th scope="col">Surface</th><th scope="col">Endpoint / UI / MCP / worker</th></tr></thead>
                  <tbody>
                    {map.nodes.filter(nodeMatches).map((n) => (
                      <tr key={n.id}>
                        <td><button type="button" className={styles.linkButton} onClick={() => selectNode(n.id)}>{n.label}</button><div className={styles.mono}>{n.id}</div></td>
                        <td>{KIND_LABEL[n.kind]}</td>
                        <td>{n.domain ?? '—'}</td>
                        <td>{n.features.join(', ') || '—'}</td>
                        <td>{isInternal(n) ? <StatusChip status={n.buildStatus} /> : 'ภายนอก'}</td>
                        <td>{isInternal(n) ? SURFACE_LABEL[n.surfaceLevel] : '—'}</td>
                        <td className={styles.refs}>{n.surfaces.map((x) => `${x.type} ${x.ref}`).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.tableFrame}>
                <table className={styles.table}>
                  <caption className={styles.caption}>Edges</caption>
                  <thead><tr><th scope="col">จาก</th><th scope="col">ถึง</th><th scope="col">ข้อมูล</th><th scope="col">สถานะ</th></tr></thead>
                  <tbody>
                    {map.edges.filter(edgeMatches).map((e) => (
                      <tr key={e.id}>
                        <td>{nodeById.get(e.from)?.label}</td><td>{nodeById.get(e.to)?.label}</td>
                        <td><button type="button" className={styles.linkButton} onClick={() => selectEdge(e.id)}>{e.label}</button>{!e.wired && <span className={styles.muted}> (ยังไม่ต่อ)</span>}</td>
                        <td><StatusChip status={e.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <aside className={styles.detail} aria-label="รายละเอียด" aria-live="polite">
          {detail}
        </aside>
      </div>

      <p className={styles.footnote}>
        สถานะมีสองแกน: สถานะการสร้าง (ประกาศไว้ → บางส่วน → code + tests → production พร้อมหลักฐาน) และระดับ surface (worker → MCP → endpoint → UI).
        edge ได้สถานะอ่อนสุดของ node ภายในที่เชื่อม และ chain ได้สถานะอ่อนสุดของทุก edge. surface ใหม่ที่ไม่มีใครเพิ่มเข้า registry จะไม่ปรากฏที่นี่.
      </p>
    </div>
  )
}
