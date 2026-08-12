'use client'

import { useState } from 'react'
import { Plus, Check, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui'
import { WORK_STATUSES, ITEM_SUBTYPES } from '@/lib/validation/enums'
import { api } from './useApi'

// Indest-style workpackage detail/editor. Persists via PATCH /api/work/[id] — core
// fields on the WorkItem, everything Indest-extra (description, cost, effort, result,
// to-dos) rides in the metrics JSON, so no schema change is needed.
const TABS = ['General', 'Cost & Effort', 'Result']
const STATUS_DOT = {
  PLANNED: '#9CA3AF', READY: '#3b82f6', IN_PROGRESS: '#2563eb', REVIEW: '#f59e0b',
  BLOCKED: '#C84B4B', DONE: '#238553', CANCELLED: '#C0C4CC',
}

function readMetrics(item) {
  if (item?.metrics && typeof item.metrics === 'object') return item.metrics
  if (typeof item?.metricDataJson === 'string') {
    try { return JSON.parse(item.metricDataJson) } catch { return {} }
  }
  return {}
}

export default function WorkpackageModal({ open, item, onClose, onSaved }) {
  const [tab, setTab] = useState('General')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(() => {
    const m = readMetrics(item)
    return {
      title: item?.title || '',
      status: item?.status || 'PLANNED',
      subtype: item?.subtype || 'TASK',
      weight: item?.weight ?? 1,
      numericValue: item?.numericValue ?? '',
      description: m.description || '',
      estCost: m.estCost ?? '',
      estEffort: m.estEffort ?? '',
      result: m.result || '',
      todos: Array.isArray(m.todos) ? m.todos : [],
    }
  })
  const [todoText, setTodoText] = useState('')
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const doneCount = form.todos.filter((t) => t.done).length
  const pct = form.todos.length ? Math.round((doneCount / form.todos.length) * 100) : 0

  const addTodo = () => {
    const text = todoText.trim()
    if (!text) return
    set('todos', [...form.todos, { text, done: false }])
    setTodoText('')
  }
  const toggleTodo = (i) => set('todos', form.todos.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t)))
  const removeTodo = (i) => set('todos', form.todos.filter((_, idx) => idx !== i))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/work/${item.id}`, {
        method: 'PATCH',
        body: {
          title: form.title,
          status: form.status,
          subtype: form.subtype,
          weight: Number(form.weight) || 1,
          numericValue: form.numericValue === '' ? null : Number(form.numericValue),
          metrics: {
            ...readMetrics(item),
            description: form.description,
            estCost: form.estCost === '' ? null : Number(form.estCost),
            estEffort: form.estEffort === '' ? null : Number(form.estEffort),
            result: form.result,
            todos: form.todos,
          },
        },
      })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open || !item) return null

  return (
    <Modal open={open} onClose={onClose} wide title={form.title || 'Workpackage'}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-[var(--surface-mid)] px-2.5 py-1 text-[10px] font-bold">
          <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT[form.status] }} />
          {form.status.replace(/_/g, ' ')}
        </span>
        <span className="text-[10px] text-muted">{item.workstream?.code}</span>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-5 max-md:grid-cols-1">
        {/* Left: tabbed form */}
        <div>
          <div className="mb-3 inline-flex rounded-lg bg-[var(--surface-mid)] p-1">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${tab === t ? 'bg-white text-[var(--text)] shadow-sm' : 'text-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'General' && (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Title</span>
                <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Description</span>
                <textarea className="input min-h-[72px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-muted">Status</span>
                  <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {WORK_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold text-muted">Type</span>
                  <select className="input" value={form.subtype} onChange={(e) => set('subtype', e.target.value)}>
                    {ITEM_SUBTYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          {tab === 'Cost & Effort' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Weight</span>
                <input className="input" type="number" step="0.1" value={form.weight} onChange={(e) => set('weight', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Value / metric</span>
                <input className="input" type="number" value={form.numericValue} onChange={(e) => set('numericValue', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Estimated Cost</span>
                <input className="input" type="number" value={form.estCost} onChange={(e) => set('estCost', e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold text-muted">Estimated Effort (h)</span>
                <input className="input" type="number" value={form.estEffort} onChange={(e) => set('estEffort', e.target.value)} />
              </label>
            </div>
          )}

          {tab === 'Result' && (
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold text-muted">Result / notes</span>
              <textarea className="input min-h-[140px]" value={form.result} onChange={(e) => set('result', e.target.value)} />
            </label>
          )}
        </div>

        {/* Right: To-Do's */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold">To Do&apos;s <span className="text-muted">{form.todos.length}</span></span>
            <span className="text-[10px] text-muted">{pct}%</span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-mid)]">
            <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mb-2 max-h-[200px] space-y-1 overflow-y-auto">
            {form.todos.map((t, i) => (
              <div key={i} className="group flex items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => toggleTodo(i)}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${t.done ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--border)]'}`}
                  aria-label={t.done ? 'Mark not done' : 'Mark done'}
                >
                  {t.done && <Check size={11} />}
                </button>
                <span className={`min-w-0 flex-1 truncate text-[11px] ${t.done ? 'text-muted line-through' : ''}`}>{t.text}</span>
                <button type="button" onClick={() => removeTodo(i)} className="text-muted opacity-0 transition group-hover:opacity-100" aria-label="Remove">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              className="input flex-1"
              placeholder="Add to do"
              value={todoText}
              onChange={(e) => setTodoText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTodo())}
            />
            <button type="button" className="btn flex items-center gap-1 px-2" onClick={addTodo} aria-label="Add to do">
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  )
}
