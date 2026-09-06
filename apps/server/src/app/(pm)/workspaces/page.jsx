'use client'

// @req FR-001 — Workspace scope-hierarchy CRUD: list Spaces with their human
// codes, create/edit/archive via WorkspaceModal.
// @tested tests/e2e/smoke.spec.js
import { useState } from 'react'
import Link from 'next/link'
import { Plus, Archive } from 'lucide-react'
import { PageHeader, Card, StatusPill, EmptyState, Modal, Field } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from '@/modules/project-manager/components/useApi'

function WorkspaceModal({ open, onClose, scope, workspace, onSaved }) {
  const [form, setForm] = useState({
    name: workspace?.name || '',
    scopeType: workspace?.scopeType || 'BUSINESS',
    portfolioId: workspace?.portfolioId || scope.portfolios[0]?.id || '',
    businessId: workspace?.businessId || scope.businesses[0]?.id || '',
  })
  const [error, setError] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Modal open={open} onClose={onClose} title={workspace ? `Edit ${workspace.code}` : 'New space'}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          try {
            if (workspace) {
              await api(`/api/workspaces/${workspace.id}`, { method: 'PATCH', body: { name: form.name } })
            } else {
              await api('/api/scope', {
                method: 'POST',
                body: {
                  entity: 'workspace',
                  data: {
                    name: form.name,
                    scopeType: form.scopeType,
                    portfolioId: form.scopeType === 'PORTFOLIO' ? form.portfolioId : undefined,
                    businessId: form.scopeType === 'BUSINESS' ? form.businessId : undefined,
                  },
                },
              })
            }
            onSaved?.()
            onClose()
          } catch (err) {
            setError(err.message)
          }
        }}
      >
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        {!workspace && (
          <>
            <Field label="Scope type" hint="A Space belongs to an explicit scope — portfolio-wide or one business">
              <select className="input" value={form.scopeType} onChange={(e) => set('scopeType', e.target.value)}>
                <option value="BUSINESS">BUSINESS</option>
                <option value="PORTFOLIO">PORTFOLIO</option>
              </select>
            </Field>
            {form.scopeType === 'BUSINESS' ? (
              <Field label="Business">
                <select className="input" value={form.businessId} onChange={(e) => set('businessId', e.target.value)} required>
                  {scope.businesses.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} · {b.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Portfolio">
                <select className="input" value={form.portfolioId} onChange={(e) => set('portfolioId', e.target.value)} required>
                  {scope.portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
        {error && <p className="mb-2 text-[11px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function WorkspacesPage() {
  const scope = useScope()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)

  // FR-020 — scope is described in business words; tenant never surfaces here.
  const label = (ws) => {
    if (ws.scopeType === 'PORTFOLIO') return 'งานระดับเครือ · ทุกธุรกิจ'
    const b = scope.businesses.find((x) => x.id === ws.businessId)
    return `ธุรกิจ · ${b?.name || b?.code || '?'}`
  }

  return (
    <div>
      <PageHeader
        eyebrow="Scope"
        title="Spaces"
        subtitle="Working contexts inside your business. Group-level Spaces are shared by every business in the group."
        actions={
          <button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setModal(true)}>
            <Plus size={12} aria-hidden /> New space
          </button>
        }
      />
      {scope.scopedWorkspaces.length === 0 ? (
        <EmptyState title="No spaces" hint="Run npm run db:seed for the demo dataset, or create a Space." />
      ) : (
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          {scope.scopedWorkspaces.map((ws) => (
            <Card key={ws.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] text-muted">{ws.code} · {label(ws)}</p>
                  <Link href={`/workspaces/${ws.id}`} className="text-sm font-bold hover:text-brand-dark">{ws.name}</Link>
                </div>
                <StatusPill status={ws.status} />
              </div>
              <p className="mt-1.5 text-[10px] text-muted">
                {scope.projects.filter((p) => p.workspaceId === ws.id).length} project(s)
              </p>
              <div className="mt-3 flex gap-1.5">
                <Link className="btn px-2 py-1 text-[10px]" href={`/workspaces/${ws.id}`}>Open</Link>
                <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => { setEditing(ws); setModal(true) }}>Edit</button>
                <button
                  type="button"
                  className="btn px-2 py-1 text-[10px]"
                  aria-label={`Archive ${ws.code}`}
                  onClick={async () => {
                    if (window.confirm(`Archive workspace ${ws.code}?`)) {
                      await api(`/api/workspaces/${ws.id}`, { method: 'DELETE' })
                      scope.refresh()
                    }
                  }}
                >
                  <Archive size={11} aria-hidden />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal && (
        <WorkspaceModal
          open={modal}
          onClose={() => { setModal(false); setEditing(null) }}
          scope={scope}
          workspace={editing}
          onSaved={scope.refresh}
        />
      )}
    </div>
  )
}
