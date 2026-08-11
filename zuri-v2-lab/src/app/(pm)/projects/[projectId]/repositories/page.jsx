'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Unlink } from 'lucide-react'
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, Modal, Field } from '@/components/ui'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'

function LinkRepoModal({ open, onClose, projectId, repos, onSaved }) {
  const [form, setForm] = useState({ repoId: repos[0]?.id || '', role: 'PRIMARY', pathScope: '', branch: '' })
  const [error, setError] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  return (
    <Modal open={open} onClose={onClose} title="Link repository">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          try {
            await api('/api/repositories/link', {
              method: 'POST',
              body: { projectId, repoId: form.repoId, role: form.role, pathScope: form.pathScope || null, branch: form.branch || null },
            })
            onSaved?.()
            onClose()
          } catch (err) {
            setError(err.message)
          }
        }}
      >
        <Field label="Repository">
          <select className="input" value={form.repoId} onChange={(e) => set('repoId', e.target.value)} required>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.code} · {r.fullName || r.provider}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => set('role', e.target.value)}>
              {['PRIMARY', 'REFERENCE', 'INFRA', 'DOCS'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Path scope"><input className="input" value={form.pathScope} onChange={(e) => set('pathScope', e.target.value)} placeholder="src/" /></Field>
          <Field label="Branch"><input className="input" value={form.branch} onChange={(e) => set('branch', e.target.value)} placeholder="main" /></Field>
        </div>
        {error && <p className="mb-2 text-[11px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Link</button>
        </div>
      </form>
    </Modal>
  )
}

export default function ProjectRepositoriesPage() {
  const { projectId } = useParams()
  const [linkOpen, setLinkOpen] = useState(false)
  const project = useFetch(`/api/projects/${projectId}`)
  const repos = useFetch('/api/repositories')

  if (project.loading || repos.loading) return <LoadingCard />
  if (project.error) return <ErrorState detail={project.error} retry={project.reload} />

  const links = project.data?.repositories || []

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title="Linked repositories"
        subtitle="Many-to-many links. A project is never identified by its repository — repositories are local metadata."
        actions={
          <button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setLinkOpen(true)}>
            <Plus size={12} aria-hidden /> Link repository
          </button>
        }
      />
      {links.length === 0 ? (
        <EmptyState title="No repositories linked" hint="Register repositories under the Repos module, then link them here with a role." />
      ) : (
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          {links.map((link) => (
            <Card key={link.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] text-muted">{link.repo.code} · {link.repo.provider}</p>
                  <p className="text-sm font-bold">{link.repo.fullName || link.repo.repoName || link.repo.code}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="pill pill-gate">{link.role}</span>
                    {link.pathScope && <span className="pill pill-planned">{link.pathScope}</span>}
                    {link.branch && <span className="pill pill-planned">{link.branch}</span>}
                    <StatusPill status={link.repo.status} />
                  </div>
                  {link.repo.url && <p className="mt-1.5 break-all text-[10px] text-muted">{link.repo.url}</p>}
                </div>
                <button
                  type="button"
                  className="btn px-2 py-1"
                  aria-label="Unlink"
                  onClick={async () => {
                    await api(`/api/repositories/link/${link.id}`, { method: 'DELETE' })
                    project.reload()
                  }}
                >
                  <Unlink size={12} aria-hidden />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {linkOpen && (
        <LinkRepoModal open={linkOpen} onClose={() => setLinkOpen(false)} projectId={projectId} repos={repos.data || []} onSaved={project.reload} />
      )}
    </div>
  )
}
