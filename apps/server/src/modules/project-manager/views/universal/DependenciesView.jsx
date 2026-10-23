'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { Card, StatusPill, EmptyState, ErrorState, Modal, Field } from '@/components/ui'
import { DEPENDENCY_TYPES, DEPENDENCY_ENDPOINT_TYPES } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, api, LoadingCard } from '../../components/useApi'

// @req FR-084 — a declared handoff is previewed and confirmed in the existing register.
// @spec ADR-035, BR-017, NFR-008
// @tested tests/unit/dependency-handoff-form.test.js, tests/e2e/dependency-handoff.spec.js
async function pipelineRequest(plan, { removeId } = {}) {
  const response = await fetch(removeId ? `/api/dependencies/${removeId}` : '/api/dependencies', {
    method: removeId ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }),
  })
  const result = await response.json()
  if (!response.ok || result.valid === false || result.committed === false) {
    const code = result.errors?.[0]?.code
    const messages = { STALE_PREVIEW: 'The preview is out of date. Preview again.', STALE_ENTITY: 'This dependency changed. Reload it before editing.', SCOPE_UNAVAILABLE: 'This work is unavailable in your current scope.', CYCLE: 'This dependency would create a cycle.', INVALID_CONTRACT: 'Check the acceptance Gate and its predecessor scope.', IDEMPOTENCY_CONFLICT: 'This request changed after confirmation. Preview again.' }
    throw new Error(messages[code] || result.error || result.errors?.[0]?.message || 'The handoff could not be saved.')
  }
  return result
}
export function NewDependencyModal({ open, onClose, onSaved, projectId, dependency = null, remove = false }) {
  const initial = null // The authorized GET exposes only state/hash, never persisted provenance.
  const [form, setForm] = useState({ sourceType: 'GATE', sourceCode: '', targetType: 'WORKSTREAM', targetCode: '', sourceProjectCode: '', targetProjectCode: '', dependencyType: 'BLOCKS', deliverable: initial?.deliverable || '', acceptance: initial?.acceptance.kind || 'MANUAL', satisfied: initial?.acceptance.satisfied === true, gateCode: '', gateId: initial?.acceptance.gateId || null })
  const [error, setError] = useState(null), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false), [preview, setPreview] = useState(null)
  const generation = useRef(0), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++ } }, [])
  const set = (key, value) => { generation.current++; setPreview(null); setError(null); setForm(old => ({ ...old, [key]: value, ...(key === 'gateCode' ? { gateId: null } : {}) })) }
  const close = () => { if (!confirming) { generation.current++; onClose() } }
  const resolve = async (type, code) => (await api(`/api/resolve?type=${type}&code=${encodeURIComponent(code)}`)).id
  const previewHandoff = async event => {
    event.preventDefault()
    const ticket = ++generation.current
    setBusy(true); setError(null)
    try {
      const projectIds = projectId ? [projectId] : [...new Set(await Promise.all([resolve('PROJECT', form.sourceProjectCode), resolve('PROJECT', form.targetProjectCode)]))].sort()
      let command
      if (remove) command = { op: 'dependency.remove', id: dependency.id, expectedDependencyHash: dependency.expectedDependencyHash }
      else {
        const acceptance = form.acceptance === 'MANUAL' ? { kind: 'MANUAL', satisfied: form.satisfied } : { kind: 'GATE', gateId: form.gateId || await resolve('GATE', form.gateCode) }
        const contract = { version: 1, deliverable: form.deliverable, acceptance }
        command = dependency ? { op: 'dependency.contract', id: dependency.id, expectedDependencyHash: dependency.expectedDependencyHash, contract } : { op: 'dependency.create', clientRef: 'edge', source: { type: form.sourceType, id: await resolve(form.sourceType, form.sourceCode) }, target: { type: form.targetType, id: await resolve(form.targetType, form.targetCode) }, dependencyType: form.dependencyType, contract }
      }
      const plan = { schemaVersion: '1.3', kind: 'DEPENDENCY_REGISTER', projectIds, trace: { correlationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }, expectedPreviewHash: null, commands: [command] }
      const result = await pipelineRequest(plan, { removeId: remove ? dependency.id : null })
      if (alive.current && generation.current === ticket) setPreview({ plan: { ...plan, expectedPreviewHash: result.previewHash }, result })
    } catch (failure) { if (alive.current && generation.current === ticket) setError(failure.message) }
    finally { if (alive.current) setBusy(false) }
  }
  const confirm = async () => {
    if (!preview || confirming) return
    setConfirming(true); setError(null)
    try {
      await pipelineRequest(preview.plan, { removeId: remove ? dependency.id : null })
      if (alive.current) { onSaved?.(); onClose() }
    } catch (failure) { if (alive.current) { setError(failure.message); setPreview(null) } }
    finally { if (alive.current) setConfirming(false) }
  }
  return (
    <Modal open={open} onClose={close} title={remove ? 'Remove dependency' : dependency ? 'Edit handoff contract' : 'New dependency'}>
      <form onSubmit={previewHandoff}>
        <fieldset disabled={confirming}>
          {!dependency && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Source type"><select aria-label="Source type" className="input" value={form.sourceType} onChange={e => set('sourceType', e.target.value)}>{DEPENDENCY_ENDPOINT_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></Field>
              <Field label="Source code"><input aria-label="Source code" className="input" value={form.sourceCode} onChange={e => set('sourceCode', e.target.value)} required /></Field>
              <Field label="Target type"><select aria-label="Target type" className="input" value={form.targetType} onChange={e => set('targetType', e.target.value)}>{DEPENDENCY_ENDPOINT_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></Field>
              <Field label="Target code"><input aria-label="Target code" className="input" value={form.targetCode} onChange={e => set('targetCode', e.target.value)} required /></Field>
            </div>
            <Field label="Relation"><select aria-label="Relation" className="input" value={form.dependencyType} onChange={e => set('dependencyType', e.target.value)}>{DEPENDENCY_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}</select></Field>
          </>}
          {!projectId && <div className="grid grid-cols-2 gap-3"><Field label="Source Project code"><input aria-label="Source Project code" className="input" value={form.sourceProjectCode} onChange={e => set('sourceProjectCode', e.target.value)} required disabled={confirming} /></Field><Field label="Target Project code"><input aria-label="Target Project code" className="input" value={form.targetProjectCode} onChange={e => set('targetProjectCode', e.target.value)} required disabled={confirming} /></Field></div>}
          {dependency && <p className="mb-3 text-xs">{dependency.source.code} → {dependency.target.code} · {dependency.dependencyType.replace(/_/g, ' ')}</p>}
          {remove ? <p className="mb-3 text-xs">Review removal of this obligation before confirming.</p> : <>
            <Field label="Deliverable"><textarea aria-label="Deliverable" className="input" value={form.deliverable} onChange={e => set('deliverable', e.target.value)} required maxLength={2000} /></Field>
            <Field label="Acceptance"><select aria-label="Acceptance" className="input" value={form.acceptance} onChange={e => set('acceptance', e.target.value)}><option value="MANUAL">Explicit manual decision</option><option value="GATE">Existing Gate</option></select></Field>
            {form.acceptance === 'MANUAL' ? <label className="mb-3 flex gap-2 text-xs"><input type="checkbox" checked={form.satisfied} onChange={e => set('satisfied', e.target.checked)} />Acceptance satisfied</label> : <Field label="Acceptance Gate code" hint={form.gateId ? 'Keep the current Gate, or enter another code.' : 'Must govern the predecessor in its Project or Workstream.'}><input aria-label="Acceptance Gate code" className="input" value={form.gateCode} onChange={e => set('gateCode', e.target.value)} required={!form.gateId} /></Field>}
          </>}
        </fieldset>
        {preview && <div role="status" className="mb-3 rounded-lg bg-[var(--brand-tint)] p-3 text-xs">Review ready. Confirm to {remove ? 'remove this dependency' : 'save this handoff'}.</div>}
        {error && <p role="alert" className="mb-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={confirming} onClick={close}>Cancel</button>
          {preview ? <button type="button" className="btn btn-primary" onClick={confirm} disabled={confirming}>{confirming ? 'Saving…' : remove ? 'Confirm removal' : 'Confirm handoff'}</button> : <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Previewing…' : remove ? 'Preview removal' : 'Preview handoff'}</button>}
        </div>
      </form>
    </Modal>
  )
}

export default function DependenciesView({ projectId }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  else if (businessId) params.set('businessId', businessId)
  const url = projectId || businessId ? `/api/dependencies?${params.toString()}` : null
  const { data, loading, error, reload } = useFetch(url)

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setOpen(true)}>
          <Plus size={12} aria-hidden /> New dependency
        </button>
      </div>
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (!data || data.length === 0) && (
        <EmptyState title="No dependencies" hint="Link projects, streams, milestones, gates, containers or items to model blocking relations." />
      )}
      <div className="space-y-2">
        {(data || []).map((d) => (
          <Card key={d.id} className="flex items-center gap-3 py-3 max-md:flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[9px] text-muted">{d.source.type.replace(/_/g, ' ')}</p>
              <p className="truncate text-xs font-bold">{d.source.code} · {d.source.title}</p>
              {d.source.status && <StatusPill status={d.source.status} />}
              <p className="mt-1 text-xs">{d.contractState === 'UNDECLARED' ? 'contract undeclared' : 'Declared handoff contract'}</p>
              <p className="text-[10px] text-muted">{d.contractState === 'UNDECLARED' ? 'Legacy · contract undeclared' : d.contractState}</p>
            </div>
            <div className="flex flex-col items-center px-1">
              <span className="pill pill-gate">{d.dependencyType.replace(/_/g, ' ')}</span>
              <ArrowRight size={14} className="mt-1 text-muted" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] text-muted">{d.target.type.replace(/_/g, ' ')}</p>
              <p className="truncate text-xs font-bold">{d.target.code} · {d.target.title}</p>
              {d.target.status && <StatusPill status={d.target.status} />}
            </div>
            <button type="button" className="btn px-2 py-1" onClick={() => setEditing({ dependency: d, remove: false })}>Edit contract</button>
            <button type="button" className="btn px-2 py-1" aria-label="Delete dependency" onClick={() => setEditing({ dependency: d, remove: true })}><Trash2 size={12} aria-hidden /></button>
          </Card>
        ))}
      </div>
      {editing && <NewDependencyModal open projectId={projectId} dependency={editing.dependency} remove={editing.remove} onClose={() => setEditing(null)} onSaved={reload} />}
      {open && <NewDependencyModal projectId={projectId} open={open} onClose={() => setOpen(false)} onSaved={reload} />}
    </div>
  )
}
