'use client'

// @req FR-040 — Project-local Dependency Map renders contained dependency edges.
// @spec SDD-019, ADR-012 — derived layout stays under Project > Work; intake reuses the C1 writer.
// @tested tests/unit/dependency-map-view.test.js
import { useEffect, useMemo, useRef, useState } from 'react'
import HandoffContractDialog from '../components/HandoffContractDialog'
import { edgePlan, projectPlan, pipelineMessage, pointerMoved, submitPipelinePlan, createGraphReader } from '../components/pipeline-edge-interactions'
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

// @req FR-083 — both gestures propose the same command and pending inline preview.
// @spec ADR-035, BR-017, SDD-046, NFR-008
// @tested tests/unit/pipeline-edge-interactions.test.js, tests/e2e/pipeline-edge-editing.spec.js
export default function DependencyMap({ graph: initialGraph }) {
  const [graph, setGraph] = useState(initialGraph)
  const [sourceKey, setSourceKey] = useState(''), [targetKey, setTargetKey] = useState('')
  const [attempt, setAttempt] = useState(null), [dialog, setDialog] = useState(false)
  const [phase, setPhase] = useState('idle'), [error, setError] = useState(null), [receipt, setReceipt] = useState(null)
  const ticket = useRef(0), trigger = useRef(null), drag = useRef(null), recovery = useRef(null)
  const suppressedClick = useRef(false)
  const graphReader = useRef(null)
  if (!graphReader.current) graphReader.current = createGraphReader(setGraph)
  useEffect(() => {
    graphReader.current.invalidate(); setGraph(initialGraph); ticket.current++
    return () => { ticket.current++; graphReader.current.invalidate() }
  }, [initialGraph])
  const busy = phase === 'pending' || phase === 'committing'
  const unresolved = phase === 'refused' && recovery.current?.expectedPreviewHash != null
  const restoreFocus = () => requestAnimationFrame(() => trigger.current?.focus())
  const cancel = () => { ticket.current++; setDialog(false); setAttempt(null); setError(null); setPhase('idle'); recovery.current = null; restoreFocus() }
  const propose = (source, target, origin) => {
    if (busy || unresolved) return
    ticket.current++; trigger.current = origin
    const from = graph.nodes.find(node => node.id === source), to = graph.nodes.find(node => node.id === target)
    if (!from || !to) return
    setAttempt({ source, target, sourceTitle: nodeTitle(from), targetTitle: nodeTitle(to) })
    setError(null); setDialog(true); setPhase('idle'); recovery.current = null
  }
  const refresh = () => graphReader.current.refresh(graph.projectId)
  const execute = async (plan, currentAttempt = attempt) => {
    const current = ++ticket.current
    graphReader.current.invalidate()
    setDialog(false); setError(null); setPhase('pending')
    recovery.current = plan
    try {
      const result = await submitPipelinePlan(plan, {
        isCurrent: () => ticket.current === current,
        onPreview: accepted => { recovery.current = accepted; setPhase('committing') },
      })
      if (!result || ticket.current !== current) return
      if (result.committed !== true) throw Object.assign(new Error('Commit refused'), { code: result.errors?.[0]?.code || 'REFUSED' })
      recovery.current = null; setReceipt(result); setAttempt(null)
      try { await refresh() } catch { setError('Saved. Reload the Project to see the latest graph.') }
      if (ticket.current === current) { setPhase('saved'); restoreFocus() }
    } catch (failure) {
      if (ticket.current !== current) return
      // A lost response retries the identical idempotent commit. A definitive
      // refusal must use a fresh preview after correction or explicit retry.
      const uncertain = recovery.current?.expectedPreviewHash != null && failure.definitive !== true
      if (!uncertain) recovery.current = null
      setAttempt(currentAttempt); setError(uncertain ? 'The save result is uncertain. Retry to recover the same handoff without creating another request.' : pipelineMessage(failure)); setPhase('refused'); restoreFocus()
    }
  }
  const declare = async draft => {
    const proposal = { ...attempt, ...draft }
    setAttempt(proposal); setDialog(false); setPhase('pending')
    const current = ++ticket.current
    try {
      let contract = draft.contract
      if (contract.acceptance.kind === 'GATE') {
        const response = await fetch(`/api/resolve?type=GATE&code=${encodeURIComponent(contract.acceptance.gateCode)}`)
        if (!response.ok) throw Object.assign(new Error('Gate unavailable'), { code: 'INVALID_CONTRACT' })
        const gate = await response.json()
        contract = { ...contract, acceptance: { kind: 'GATE', gateId: gate.id } }
      }
      if (ticket.current !== current) return
      const plan = edgePlan({ graph, ...proposal, contract })
      execute(plan, proposal)
    } catch (failure) { if (ticket.current === current) { setError(pipelineMessage(failure)); setPhase('refused') } }
  }
  const retry = () => recovery.current ? execute(recovery.current) : declare(attempt)
  const undo = () => execute(projectPlan(graph.projectId, [{ op: 'undo', originalAuditEventId: receipt.auditEventId, expectedAfterHash: receipt.deltaReceipt.afterHash }]), null)
  const pointerStart = (event, node) => {
    if (busy || event.button !== 0) return
    drag.current = { source: node.id, x: event.clientX, y: event.clientY, id: event.pointerId, origin: event.currentTarget, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = event => {
    if (!drag.current || event.pointerId !== drag.current.id) return
    drag.current.moved ||= pointerMoved(drag.current, { x: event.clientX, y: event.clientY })
  }
  const pointerEnd = event => {
    const gesture = drag.current; drag.current = null
    if (!gesture || event.pointerId !== gesture.id) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    suppressedClick.current = gesture.moved
    if (!gesture.moved) return
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-node-key]')?.dataset.nodeKey
    if (target) propose(gesture.source, target, gesture.origin)
  }

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
      <div className={s.connectionControls}>
        <label>Connection source<select aria-label="Connection source" className="input" value={sourceKey} onChange={e => setSourceKey(e.target.value)} disabled={busy || unresolved}><option value="">Select source</option>{nodes.map(node => <option key={node.id} value={node.id}>{nodeTitle(node)}</option>)}</select></label>
        <label>Connection target<select aria-label="Connection target" id="canvas-target" className="input" value={targetKey} onChange={e => setTargetKey(e.target.value)} disabled={busy || unresolved}><option value="">Select target</option>{nodes.map(node => <option key={node.id} value={node.id}>{nodeTitle(node)}</option>)}</select></label>
        <button className="btn btn-primary" type="button" disabled={!sourceKey || !targetKey || busy || unresolved} onClick={e => propose(sourceKey, targetKey, e.currentTarget)}>Connect to…</button>
      </div>
      <p className="text-xs text-muted">Drag a node’s connection handle to another node, or select source and target above. Every edge needs a handoff contract.</p>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-xs">
        {phase === 'pending' ? 'Pending preview — checking the proposed handoff.' : phase === 'committing' ? 'Pending handoff — saving the accepted preview.' : phase === 'saved' ? 'Handoff saved.' : ''}
      </div>
      {phase === 'pending' && <button type="button" className="btn" onClick={cancel}>Cancel preview</button>}
      {error && <div className={s.refusal}>
        <p role="alert">{attempt && `${attempt.sourceTitle} → ${attempt.targetTitle}: `}{error}</p>
        {phase === 'refused' && <div className="flex flex-wrap gap-2">
          {attempt && !recovery.current && <button type="button" className="btn" onClick={() => setDialog(true)}>Correct handoff</button>}
          {(attempt || recovery.current) && <button type="button" className="btn" onClick={retry}>Retry handoff</button>}
          {!recovery.current && <button type="button" className="btn" onClick={cancel}>Dismiss</button>}
        </div>}
        <button type="button" className="btn" onClick={() => refresh().then(applied => { if (applied && phase === 'saved') setError(null) }).catch(() => setError('Reload failed. Retry when connected.'))}>Reload Project</button>
      </div>}
      {receipt?.deltaReceipt?.undoable && <button type="button" className="btn" disabled={busy || unresolved} onClick={undo}>Undo last handoff</button>}
      {dialog && <HandoffContractDialog attempt={attempt} onCancel={cancel} onSubmit={declare} />}
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
              {[...edges, ...(attempt && !dialog ? [{ id: 'attempt', source: attempt.source, target: attempt.target, pending: true }] : [])].map((edge) => {
                const source = layout.positions.get(edge.source)
                const target = layout.positions.get(edge.target)
                if (!source || !target) return null
                return (
                  <g key={edge.id}><line
                    x1={source.x + NODE_WIDTH / 2}
                    y1={source.y + NODE_HEIGHT / 2}
                    x2={target.x + NODE_WIDTH / 2}
                    y2={target.y + NODE_HEIGHT / 2}
                    className={edge.pending ? s.pendingEdge : s.edge}
                    markerEnd="url(#dependency-arrow)"
                  />
                  <text x={(source.x + target.x) / 2 + NODE_WIDTH / 2} y={(source.y + target.y) / 2 + NODE_HEIGHT / 2 - 10} className={s.edgeLabel}>
                    {edge.pending ? phase === 'refused' ? error : 'Pending handoff' : edge.contractState === 'UNDECLARED' ? 'Undeclared' : edge.contractState === 'SATISFIED' ? '✓ Satisfied' : edge.contractState === 'DECLARED' ? 'Declared' : 'Invalid'}
                  </text></g>
                )
              })}
            </svg>
            <div className={s.nodes}>
              {nodes.map((node) => {
                const position = layout.positions.get(node.id)
                return (
                  <div key={node.id} data-node-key={node.id} className={s.nodeGroup} style={{ left: position.x, top: position.y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}>
                  <button
                    type="button"
                    className={s.node}
                    onClick={() => { setSourceKey(node.id); document.getElementById('canvas-target')?.focus() }}
                    aria-label={`${node.type.replace(/_/g, ' ')}: ${nodeTitle(node)}`}
                  >
                    <span className={s.nodeIcon} aria-hidden><CircleDot size={15} /></span>
                    <span className={s.nodeBody}>
                      <span className={s.nodeType}>{node.type.replace(/_/g, ' ')}</span>
                      <span className={s.nodeTitle}>{nodeTitle(node)}</span>
                      {node.status && <StatusPill status={node.status} />}
                    </span>
                  </button>
                  <button type="button" className={s.handle} aria-label={`Connect from ${node.code || node.title}`} disabled={busy || unresolved}
                    onPointerDown={e => pointerStart(e, node)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={() => { drag.current = null }}
                    onClick={() => { if (!suppressedClick.current) { setSourceKey(node.id); document.getElementById('canvas-target')?.focus() } suppressedClick.current = false }}><CircleDot size={16} aria-hidden /></button>
                  </div>
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
                <li key={edge.id} data-edge-id={edge.id} className={s.edgeRow}>
                  <span className="min-w-0 truncate font-semibold">{source ? nodeTitle(source) : edge.source}</span>
                  <span className="pill pill-gate shrink-0">{edge.label}</span>
                  <span>{edge.contractState === 'UNDECLARED' ? 'Contract undeclared' : edge.contractState === 'SATISFIED' ? '✓ Satisfied handoff' : edge.contractState === 'DECLARED' ? 'Declared handoff' : 'Invalid contract'}</span>
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
