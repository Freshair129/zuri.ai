'use client'

// @req FR-008 — repository records (create/edit via RepoModal: provider,
// fullName, url, defaultBranch, externalRepoId) and their many-to-many
// project links.
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { PageHeader, Card, StatusPill, EmptyState, ErrorState, Modal, Field } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'

// @req FR-073 — a Repository is created under the viewer's active Business.
// businessId is never a form field: it comes from the trusted shell context
// (scope.shell.activeBusinessId, the same source files/page.jsx and
// overview/page.jsx use), never from something a caller could type. Letting the
// client name its own scope is exactly what BR-001 and the ownsBusiness gate
// on the server exist to prevent.
function RepoModal({ open, onClose, repo, businessId, businessLabel, onSaved }) {
  const [form, setForm] = useState({
    provider: repo?.provider || 'github',
    fullName: repo?.fullName || '',
    url: repo?.url || '',
    defaultBranch: repo?.defaultBranch || 'main',
    externalRepoId: repo?.externalRepoId || '',
  })
  const [error, setError] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  // Editing an existing Repository never needs businessId (PATCH keeps the
  // existing owner); only a new Repository requires one, and BusinessShellGuard
  // guarantees a READY route already has an active Business selected. This
  // check is a defensive last resort, not the real guard.
  const missingBusiness = !repo && !businessId
  return (
    <Modal open={open} onClose={onClose} title={repo ? `Edit ${repo.code}` : 'Register repository'}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          if (missingBusiness) {
            setError('No active business selected — choose a business before registering a repository.')
            return
          }
          try {
            const [ownerName, repoName] = form.fullName.split('/')
            const body = {
              provider: form.provider,
              fullName: form.fullName || null,
              ownerName: ownerName || null,
              repoName: repoName || null,
              url: form.url || null,
              defaultBranch: form.defaultBranch || null,
              externalRepoId: form.externalRepoId || null,
            }
            if (repo) await api(`/api/repositories/${repo.id}`, { method: 'PATCH', body })
            else await api('/api/repositories', { method: 'POST', body: { ...body, businessId } })
            onSaved?.()
            onClose()
          } catch (err) {
            setError(err.message)
          }
        }}
      >
        {!repo && (
          <p className="mb-2 text-[10px] text-muted">
            Business: <span className="font-bold">{businessLabel || '—'}</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="Provider">
            <select className="input" value={form.provider} onChange={(e) => set('provider', e.target.value)}>
              {['github', 'gitlab', 'bitbucket', 'azure', 'local'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Full name" hint="owner/name">
            <input className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="org/repo" />
          </Field>
          <Field label="URL"><input className="input" value={form.url} onChange={(e) => set('url', e.target.value)} /></Field>
          <Field label="Default branch"><input className="input" value={form.defaultBranch} onChange={(e) => set('defaultBranch', e.target.value)} /></Field>
        </div>
        <Field label="External repo ID" hint="External identifier only — never used as an internal key">
          <input className="input" value={form.externalRepoId} onChange={(e) => set('externalRepoId', e.target.value)} />
        </Field>
        {error && <p className="mb-2 text-[11px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={missingBusiness}>Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function RepositoriesPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  const businessLabel = scope.shell.activeBusiness ? `${scope.shell.activeBusiness.code} · ${scope.shell.activeBusiness.name}` : null
  const { data, loading, error, reload } = useFetch('/api/repositories')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)

  // @req FR-073, BR-001 — the API returns every Repository the viewer may see,
  // which spans every Business they see, not just the active one (there is no
  // businessId filter to ask the server for less). BusinessShellGuard
  // guarantees businessId is set whenever this page is mounted, so narrowing
  // here keeps the page itself inside the same Business boundary the rest of
  // the shell holds — a viewer who sees more than one Business no longer finds
  // another Business's repositories mixed into this list.
  const scopedRepos = (data || []).filter((r) => r.businessId === businessId)

  return (
    <div>
      <PageHeader
        eyebrow="Repositories"
        title="Repository Records"
        subtitle="Local metadata only — provider, name, URL, default branch. No GitHub API access in MVP."
        actions={
          <button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setModal(true)}>
            <Plus size={12} aria-hidden /> Register repository
          </button>
        }
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && scopedRepos.length === 0 && (
        <EmptyState title="No repositories registered" hint="Register repository metadata, then link it to projects with a role." />
      )}
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        {scopedRepos.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[9px] text-muted">{r.code} · {r.provider}{r.defaultBranch ? ` · ${r.defaultBranch}` : ''}</p>
                <p className="truncate text-sm font-bold">{r.fullName || r.repoName || r.code}</p>
                {r.url && <p className="mt-1 break-all text-[10px] text-muted">{r.url}</p>}
              </div>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(r.projects || []).map((link) => (
                <span key={link.id} className="pill pill-planned" title={link.role}>
                  {link.project?.code} · {link.role}
                </span>
              ))}
              {(r.projects || []).length === 0 && <span className="text-[10px] text-muted">not linked to any project</span>}
            </div>
            <div className="mt-3">
              <button type="button" className="btn px-2 py-1 text-[10px]" onClick={() => { setEditing(r); setModal(true) }}>Edit</button>
            </div>
          </Card>
        ))}
      </div>
      {modal && (
        <RepoModal
          open={modal}
          onClose={() => { setModal(false); setEditing(null) }}
          repo={editing}
          businessId={businessId}
          businessLabel={businessLabel}
          onSaved={reload}
        />
      )}
    </div>
  )
}
