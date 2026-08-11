'use client'

import { useState } from 'react'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { Card, StatusPill, EmptyState, ErrorState, Modal, Field } from '@/components/ui'
import { DEPENDENCY_TYPES, DEPENDENCY_ENDPOINT_TYPES } from '@/lib/validation/enums'
import { useFetch, api, LoadingCard } from '../../components/useApi'

function NewDependencyModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({
    sourceType: 'GATE',
    sourceCode: '',
    targetType: 'WORKSTREAM',
    targetCode: '',
    dependencyType: 'BLOCKS',
  })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Resolve human codes to internal ids via the resolve endpoint.
      const resolve = async (type, code) => {
        const res = await api(`/api/resolve?type=${type}&code=${encodeURIComponent(code)}`)
        return res.id
      }
      const sourceId = await resolve(form.sourceType, form.sourceCode)
      const targetId = await resolve(form.targetType, form.targetCode)
      await api('/api/dependencies', {
        method: 'POST',
        body: {
          sourceType: form.sourceType,
          sourceId,
          targetType: form.targetType,
          targetId,
          dependencyType: form.dependencyType,
        },
      })
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New dependency">
      <form onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source type">
            <select className="input" value={form.sourceType} onChange={(e) => set('sourceType', e.target.value)}>
              {DEPENDENCY_ENDPOINT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Source code" hint="Human code, e.g. GATE-DATA-ID">
            <input className="input" value={form.sourceCode} onChange={(e) => set('sourceCode', e.target.value)} required />
          </Field>
          <Field label="Target type">
            <select className="input" value={form.targetType} onChange={(e) => set('targetType', e.target.value)}>
              {DEPENDENCY_ENDPOINT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <Field label="Target code">
            <input className="input" value={form.targetCode} onChange={(e) => set('targetCode', e.target.value)} required />
          </Field>
        </div>
        <Field label="Relation">
          <select className="input" value={form.dependencyType} onChange={(e) => set('dependencyType', e.target.value)}>
            {DEPENDENCY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        {error && <p className="mb-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function DependenciesView({ projectId }) {
  const [open, setOpen] = useState(false)
  const url = projectId ? `/api/dependencies?projectId=${projectId}` : '/api/dependencies'
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
            <button
              type="button"
              className="btn px-2 py-1"
              aria-label="Delete dependency"
              onClick={async () => {
                await api(`/api/dependencies/${d.id}`, { method: 'DELETE' })
                reload()
              }}
            >
              <Trash2 size={12} aria-hidden />
            </button>
          </Card>
        ))}
      </div>
      {open && <NewDependencyModal open={open} onClose={() => setOpen(false)} onSaved={reload} />}
    </div>
  )
}
