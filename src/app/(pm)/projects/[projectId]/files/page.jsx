'use client'

// @req FR-037 — Project Files manages reference metadata rather than binary storage.
// @spec SDD-016, BR-002, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ExternalLink, FileText, Plus, Trash2 } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, Modal, PageHeader, SectionTitle } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

function byteLabel(size) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function AddFileModal({ open, onClose, projectId, workItems, onSaved }) {
  const [form, setForm] = useState({ name: '', mime: 'application/octet-stream', size: '0', url: '', blobRef: '', workItemId: '' })
  const [error, setError] = useState(null)
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  return (
    <Modal open={open} onClose={onClose} title="Add file reference">
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          setError(null)
          try {
            await api(`/api/projects/${projectId}/files`, {
              method: 'POST',
              body: {
                ...form,
                size: Number(form.size),
                url: form.url || null,
                blobRef: form.blobRef || null,
                workItemId: form.workItemId || null,
              },
            })
            onSaved()
            onClose()
          } catch (err) {
            setError(err.message)
          }
        }}
      >
        <Field label="Name"><input className="input" value={form.name} onChange={(event) => set('name', event.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <Field label="MIME type"><input className="input" value={form.mime} onChange={(event) => set('mime', event.target.value)} required /></Field>
          <Field label="Size (bytes)"><input className="input" type="number" min="0" value={form.size} onChange={(event) => set('size', event.target.value)} required /></Field>
        </div>
        <Field label="URL reference"><input className="input" value={form.url} onChange={(event) => set('url', event.target.value)} placeholder="https://… or local path" /></Field>
        <Field label="Blob reference"><input className="input" value={form.blobRef} onChange={(event) => set('blobRef', event.target.value)} placeholder="storage key or local blob reference" /></Field>
        <Field label="Linked work item (optional)">
          <select className="input" value={form.workItemId} onChange={(event) => set('workItemId', event.target.value)}>
            <option value="">Project-level file</option>
            {workItems.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
          </select>
        </Field>
        {error && <p className="mb-2 text-[11px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save reference</button>
        </div>
      </form>
    </Modal>
  )
}

export default function ProjectFilesPage() {
  const { projectId } = useParams()
  const [open, setOpen] = useState(false)
  const project = useFetch(`/api/projects/${projectId}`)
  const files = useFetch(`/api/projects/${projectId}/files`)
  const workItems = useMemo(
    () => (project.data?.workstreams || []).flatMap((workstream) => workstream.items || []),
    [project.data],
  )

  if (project.loading || files.loading) return <LoadingCard />
  if (project.error) return <ErrorState detail={project.error} retry={project.reload} />
  if (files.error) return <ErrorState detail={files.error} retry={files.reload} />

  return (
    <div>
      <PageHeader
        eyebrow={project.data?.code || 'Project'}
        title="Files"
        subtitle="Document and attachment references only. This MVP does not upload or store binary content."
        actions={<button type="button" className="btn btn-primary flex items-center gap-1" onClick={() => setOpen(true)}><Plus size={14} aria-hidden /> Add reference</button>}
      />
      {(files.data || []).length === 0 ? (
        <EmptyState title="No file references" hint="Add a document URL or blob reference, optionally linked to a work item." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {files.data.map((file) => (
            <Card key={file.id}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden><FileText size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{file.name}</p>
                  <p className="text-[10px] text-muted">{file.code} · {file.mime} · {byteLabel(file.size)}</p>
                  {file.workItem && <p className="mt-1 text-[10px] text-muted">Linked to {file.workItem.code} · {file.workItem.title}</p>}
                </div>
                <button
                  type="button"
                  className="btn px-2 py-1"
                  aria-label={`Delete ${file.name}`}
                  onClick={async () => {
                    if (window.confirm(`Delete file reference ${file.name}?`)) {
                      await api(`/api/projects/${projectId}/files/${file.id}`, { method: 'DELETE' })
                      files.reload()
                    }
                  }}
                ><Trash2 size={14} aria-hidden /></button>
              </div>
              <div className="mt-3 flex gap-2">
                {safeExternalUrl(file.url) && <a href={safeExternalUrl(file.url)} className="btn px-2 py-1 text-[11px]" target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden /> Open reference</a>}
                {file.blobRef && <span className="pill pill-planned">Blob ref: {file.blobRef}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {open && <AddFileModal open={open} onClose={() => setOpen(false)} projectId={projectId} workItems={workItems} onSaved={files.reload} />}
    </div>
  )
}
