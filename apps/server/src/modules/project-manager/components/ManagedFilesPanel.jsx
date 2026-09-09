'use client'

// @req FR-045 - Business and Project File Manager controls over one managed model.
// @req FR-173 - Files and Project Files admit Text/Markdown through the shared
// knowledge service and show durable job/publication state.
// @req FR-058 - hosts the grid/timeline/by-project/preview view switcher over the
// same managed asset list; the panel itself gains no new persistence or route.
// @spec SDD-023, SEC-007, ADR-016, SDD-031
// @tested tests/unit/fr045-api-ui-contract.test.js, tests/unit/fr058-file-manager-views-ui.test.js
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FileText, FolderOpen, Plus, RefreshCw, Search, Trash2, UploadCloud } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, Modal, SectionTitle, StatusPill } from '@/components/ui'
import { api, LoadingCard, useFetch } from './useApi'
import FileManagerViews from './FileManagerViews'

function bytes(size = 0) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read selected file'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

const KNOWLEDGE_MIMES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'application/markdown', 'application/x-markdown'])
const KNOWLEDGE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.mdown', '.mkdn', '.mkd'])

function knowledgeAsset(asset) {
  if (!asset || asset.state !== 'ACTIVE' || !['LOCAL_FILE', 'MANAGED_BLOB'].includes(asset.storageKind)) return false
  const mime = String(asset.mime || '').split(';', 1)[0].trim().toLowerCase()
  const name = String(asset.name || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot) : ''
  return KNOWLEDGE_MIMES.has(mime) || ((mime === 'text/*' || mime === 'application/octet-stream') && KNOWLEDGE_EXTENSIONS.has(extension))
}

// Knowledge list responses must never cross a Business/Project scope change.
// The shared useFetch hook predates this surface and deliberately has no
// cancellation/ignore-late guard, so keep the sequence local to the admission
// fetch instead of changing every existing caller.
function useScopedKnowledgeFetch(businessId, projectId) {
  const path = businessId
    ? `/api/knowledge/ingestions?businessId=${encodeURIComponent(businessId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`
    : null
  const scopeKey = `${businessId || ''}:${projectId || ''}`
  const sequence = useRef(0)
  const [state, setState] = useState({ scopeKey: null, data: null, loading: Boolean(path), error: null })
  const reload = useCallback(async () => {
    const requestSequence = ++sequence.current
    if (!path) {
      setState({ scopeKey, data: null, loading: false, error: null })
      return
    }
    setState((current) => ({
      scopeKey,
      data: current.scopeKey === scopeKey ? current.data : null,
      loading: true,
      error: null,
    }))
    try {
      const data = await api(path)
      if (requestSequence !== sequence.current) return
      setState({ scopeKey, data, loading: false, error: null })
    } catch (error) {
      if (requestSequence !== sequence.current) return
      setState({ scopeKey, data: null, loading: false, error: error.message })
    }
  }, [path, scopeKey])

  useEffect(() => {
    // Clear old scope data synchronously from the next effect before the new
    // request is allowed to publish. Cleanup invalidates an in-flight request.
    sequence.current += 1
    setState({ scopeKey, data: null, loading: Boolean(path), error: null })
    reload()
    return () => { sequence.current += 1 }
  }, [path, scopeKey, reload])

  if (state.scopeKey !== scopeKey) return { data: null, loading: Boolean(path), error: null, reload }
  return { data: state.data, loading: state.loading, error: state.error, reload }
}

function TextKnowledgeModal({ businessId, projectId, onSaved, onClose }) {
  const [sourceKey, setSourceKey] = useState('')
  const [version, setVersion] = useState('1')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  return (
    <Modal open onClose={onClose} title="Admit text or Markdown">
      <form onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        setSaving(true)
        try {
          const key = sourceKey.trim()
          const sourceVersion = version.trim()
          if (!key) throw new Error('Source key is required')
          if (!sourceVersion) throw new Error('Version is required')
          if (!content.trim()) throw new Error('Content is required')
          await api('/api/knowledge/ingestions', {
            method: 'POST',
            body: {
              businessId,
              projectId,
              idempotencyKey: `files:text:${key}:${sourceVersion}`,
              source: { kind: 'TEXT', sourceKey: key, version: sourceVersion, title: title.trim() || undefined, content },
            },
          })
          onSaved()
          onClose()
        } catch (err) { setError(err.message) } finally { setSaving(false) }
      }}>
        <Field label="Source key"><input className="input" value={sourceKey} onChange={(event) => setSourceKey(event.target.value)} required /></Field>
        <Field label="Version"><input className="input" value={version} onChange={(event) => setVersion(event.target.value)} required /></Field>
        <Field label="Title"><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Text or Markdown"><textarea className="input min-h-40" value={content} onChange={(event) => setContent(event.target.value)} required /></Field>
        {error && <p role="alert" className="mb-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Queueing…' : 'Queue admission'}</button></div>
      </form>
    </Modal>
  )
}

function KnowledgeJobs({ data, onReload, onMessage }) {
  const items = data?.items || []
  const pending = items.some((item) => ['QUEUED', 'RUNNING'].includes(item.status))
  useEffect(() => {
    if (!pending) return undefined
    const timer = window.setInterval(() => { onReload() }, 3000)
    return () => window.clearInterval(timer)
  }, [pending, onReload])
  if (!items.length) return null
  const withdraw = async (item) => {
    if (!item.source?.id || item.source.revoked) return
    try {
      await api(`/api/knowledge/sources/${encodeURIComponent(item.source.id)}`, {
        method: 'DELETE',
        body: { expectedVersion: item.source.version },
      })
      onReload()
    } catch (error) { onMessage(error.message) }
  }
  const statusDetail = (item) => {
    if (item.status === 'QUEUED') return 'Waiting to process'
    if (item.status === 'RUNNING') return 'Processing'
    if (item.status === 'PUBLISHED') return 'Published'
    if (item.status === 'FAILED') return 'Processing failed'
    if (item.status === 'SUPERSEDED') return 'Superseded by a newer version'
    if (item.status === 'WITHDRAWN') return 'Withdrawn'
    return 'Status updated'
  }
  return <Card className="mb-4" data-testid="knowledge-admissions">
    <div className="mb-2 flex items-center justify-between gap-2"><SectionTitle>Knowledge admissions</SectionTitle><button className="btn px-2" type="button" onClick={onReload} aria-label="Refresh knowledge admissions"><RefreshCw size={13} /></button></div>
    <div className="space-y-2">
      {items.map((item) => <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2 last:border-b-0 last:pb-0" data-testid={`knowledge-status-${item.id}`} key={item.id}>
        <StatusPill status={item.status} />
        <span className="min-w-0 flex-1 truncate text-xs">{item.source?.title || item.sourceVersion}</span>
        <span className="text-[10px] text-muted">rev {item.revision} · {statusDetail(item)}</span>
        {item.source?.id && !item.source.revoked && <button className="btn px-2 text-[10px]" data-testid={`knowledge-withdraw-${item.source.id}`} type="button" onClick={() => withdraw(item)}>Withdraw</button>}
      </div>)}
    </div>
  </Card>
}

function KnowledgeQuery({ businessId, projectId, onMessage }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      const result = await api('/api/knowledge/queries', { method: 'POST', body: { businessId, projectId, query: query.trim(), topK: 10 } })
      setResults(result)
    } catch (error) { onMessage(error.message) } finally { setBusy(false) }
  }
  return <Card className="mb-4">
    <SectionTitle>Search admitted knowledge</SectionTitle>
    <form className="mt-2 flex flex-wrap gap-2" onSubmit={submit} data-testid="knowledge-query-form">
      <input className="input min-w-[16rem] flex-1" data-testid="knowledge-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about these files" aria-label="Knowledge query" />
      <button className="btn btn-primary flex items-center gap-1" data-testid="knowledge-query-submit" type="submit" disabled={busy}><Search size={13} /> {busy ? 'Searching…' : 'Search'}</button>
    </form>
    {results && <div className="mt-3 space-y-2" aria-live="polite">
      <p className="text-[10px] text-muted">Corpus generation {results.corpusGeneration ?? '—'}</p>
      {results.results?.length ? results.results.map((result) => <div className="rounded border border-[var(--border)] p-2 text-xs" key={result.citationId || result.id}>
        <p>{result.text}</p>
        {result.citationId && <a className="mt-1 inline-block text-[10px] text-[var(--brand-dark)]" href={`/api/knowledge/citations/${encodeURIComponent(result.citationId)}`} target="_blank" rel="noreferrer">Open citation</a>}
      </div>) : <p className="text-xs text-muted">No admitted knowledge matched.</p>}
    </div>}
  </Card>
}

function AddManagedFile({ businessId, projectId, mounts, onSaved, onClose }) {
  const [kind, setKind] = useState(mounts.length ? 'LOCAL_FILE' : 'EXTERNAL_URL')
  const [file, setFile] = useState(null)
  const [externalUrl, setExternalUrl] = useState('')
  const [relativePath, setRelativePath] = useState('Documents/')
  const [mountId, setMountId] = useState(mounts[0]?.id || '')
  const [error, setError] = useState(null)
  return (
    <Modal open onClose={onClose} title="Add managed file">
      <form onSubmit={async (event) => {
        event.preventDefault()
        setError(null)
        try {
          const local = kind === 'LOCAL_FILE'
          if (local && !file) throw new Error('Choose a local file')
          const payload = local ? {
            businessId, projectId, storageKind: kind, mountId,
            relativePath: `${relativePath.replace(/[\\/]+$/, '')}/${file.name}`,
            contentBase64: await toBase64(file), name: file.name,
            mime: file.type || 'application/octet-stream', size: file.size,
          } : {
            businessId, projectId, storageKind: kind, externalUrl,
            name: new URL(externalUrl).pathname.split('/').pop() || 'External file',
            mime: 'application/octet-stream', size: 0,
          }
          await api('/api/files', { method: 'POST', body: payload })
          onSaved(); onClose()
        } catch (err) { setError(err.message) }
      }}>
        <Field label="Storage"><select className="input" value={kind} onChange={(event) => setKind(event.target.value)}><option value="EXTERNAL_URL">External URL</option><option value="LOCAL_FILE" disabled={!mounts.length}>Managed local file</option></select></Field>
        {kind === 'LOCAL_FILE' ? <>
          <Field label="Device mount"><select className="input" value={mountId} onChange={(event) => setMountId(event.target.value)}>{mounts.map((mount) => <option key={mount.id} value={mount.id}>{mount.deviceKey} · {mount.rootPath}</option>)}</select></Field>
          <Field label="Folder inside mount"><input className="input" value={relativePath} onChange={(event) => setRelativePath(event.target.value)} required /></Field>
          <Field label="File"><input className="input" type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></Field>
        </> : <Field label="HTTPS URL"><input className="input" type="url" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} required /></Field>}
        {error && <p role="alert" className="mb-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></div>
      </form>
    </Modal>
  )
}

function ManagedFilesPanelBody({ businessId, projectId = null, businessTools = false }) {
  const [adding, setAdding] = useState(false)
  const [textAdding, setTextAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [view, setView] = useState('grid')
  const query = projectId ? `/api/files?projectId=${encodeURIComponent(projectId)}` : `/api/business/files?businessId=${encodeURIComponent(businessId)}`
  const files = useFetch(businessId ? query : null, [businessId, projectId])
  const mounts = useFetch(businessId ? `/api/files/mounts?businessId=${encodeURIComponent(businessId)}` : null, [businessId])
  const knowledge = useScopedKnowledgeFetch(businessId, projectId)
  const activeMounts = useMemo(() => (mounts.data || []).filter((mount) => mount.status === 'ACTIVE'), [mounts.data])
  const assets = files.data?.assets || []
  const groups = files.data?.groups || []
  const knowledgeByAssetId = useMemo(() => {
    const latest = new Map()
    for (const item of knowledge.data?.items || []) {
      if (item.source?.fileAssetId && !latest.has(item.source.fileAssetId)) latest.set(item.source.fileAssetId, item)
    }
    return latest
  }, [knowledge.data])
  const reloadKnowledge = knowledge.reload
  if (files.loading || mounts.loading) return <LoadingCard />
  if (files.error) return <ErrorState detail={files.error} retry={files.reload} />
  const admitAsset = async (asset) => {
    try {
      await api('/api/knowledge/ingestions', {
        method: 'POST',
        body: {
          businessId,
          projectId,
          idempotencyKey: `files:file:${asset.id}:${asset.sha256 || asset.version}`,
          source: { kind: 'FILE', fileAssetId: asset.id },
        },
      })
      reloadKnowledge()
    } catch (error) { setMessage(error.message) }
  }
  const runBusinessTool = async (path, confirm = false) => {
    const mountId = activeMounts[0]?.id
    if (!mountId) return setMessage('Configure an active device mount first')
    try {
      const result = await api(path, { method: 'POST', body: { businessId, mountId, confirm } })
      setMessage(JSON.stringify(result)); files.reload()
    } catch (error) { setMessage(error.message) }
  }
  return <>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className="btn btn-primary flex items-center gap-1" type="button" onClick={() => setAdding(true)}><Plus size={14} /> Add file</button>
      <button className="btn flex items-center gap-1" data-testid="knowledge-admit-text" type="button" onClick={() => setTextAdding(true)}><UploadCloud size={14} /> Add text</button>
      {businessTools && <>
        <button className="btn flex items-center gap-1" type="button" onClick={() => runBusinessTool('/api/files/reconcile', false)}><RefreshCw size={14} /> Preview reconcile</button>
        <button className="btn" type="button" onClick={() => runBusinessTool('/api/files/reconcile', true)}>Confirm reconcile</button>
        <button className="btn" type="button" onClick={() => runBusinessTool('/api/files/cache/rebuild')}>Rebuild cache</button>
      </>}
    </div>
    {message && <pre className="card mb-4 overflow-auto text-[10px]">{message}</pre>}
    {!knowledge.loading && !knowledge.error && <KnowledgeJobs key={`${businessId}:${projectId || ''}`} data={knowledge.data} onReload={reloadKnowledge} onMessage={setMessage} />}
    <KnowledgeQuery key={`${businessId}:${projectId || ''}`} businessId={businessId} projectId={projectId} onMessage={setMessage} />
    {!assets.length ? <EmptyState title="No managed files" hint="Add a Business or Project file. Local content requires a configured device mount." /> : <FileManagerViews
      view={view}
      onViewChange={setView}
      assets={assets}
      groups={groups}
      renderAsset={(asset) => <Card key={asset.id}>
        <div className="flex items-start gap-3"><FileText size={20} className="text-[var(--brand-dark)]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{asset.name}</p><p className="text-[10px] text-muted">{asset.code} · {asset.storageKind} · {bytes(asset.size)} · {asset.state}</p>{asset.relativePath && <p className="truncate text-[10px] text-muted">{asset.relativePath}</p>}</div>
          <button className="btn px-2" type="button" aria-label={`Delete ${asset.name}`} onClick={async () => { if (window.confirm(`Delete metadata for ${asset.name}?`)) { await api(`/api/files/${asset.id}`, { method: 'DELETE' }); files.reload() } }}><Trash2 size={13} /></button></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {asset.externalUrl && <a className="btn text-[11px]" href={asset.externalUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
          {asset.storageKind === 'LOCAL_FILE' && asset.state === 'ACTIVE' && <a className="btn text-[11px]" href={`/api/files/${asset.id}/content`} target="_blank"><FileText size={13} /> View</a>}
          {asset.storageKind === 'LOCAL_FILE' && asset.localCapability?.available && <button className="btn text-[11px]" type="button" onClick={async () => { try { await api(`/api/files/${asset.id}/reveal`, { method: 'POST', headers: { 'x-zuri-local-intent': 'reveal' } }); setMessage('Opened in File Explorer') } catch (error) { setMessage(error.message) } }}><FolderOpen size={13} /> Reveal</button>}
          {asset.storageKind === 'LOCAL_FILE' && <button className="btn text-[11px]" type="button" onClick={async () => { const relativePath = window.prompt('Relative path inside the active mount', asset.relativePath || ''); if (!relativePath || !activeMounts[0]) return; try { await api(`/api/files/${asset.id}/relink`, { method: 'POST', body: { mountId: activeMounts[0].id, relativePath } }); files.reload() } catch (error) { setMessage(error.message) } }}>Relink</button>}
          {knowledgeAsset(asset) && <button className="btn text-[11px]" data-testid={`knowledge-admit-file-${asset.id}`} type="button" onClick={() => admitAsset(asset)} disabled={['QUEUED', 'RUNNING'].includes(knowledgeByAssetId.get(asset.id)?.status)}><UploadCloud size={13} /> {knowledgeByAssetId.get(asset.id) ? 'Re-admit version' : 'Admit knowledge'}</button>}
        </div>
      </Card>}
    />}
    {adding && <AddManagedFile businessId={businessId} projectId={projectId} mounts={activeMounts} onSaved={files.reload} onClose={() => setAdding(false)} />}
    {textAdding && <TextKnowledgeModal key={`${businessId}:${projectId || ''}`} businessId={businessId} projectId={projectId} onSaved={reloadKnowledge} onClose={() => setTextAdding(false)} />}
  </>
}

export function ManagedFilesPanel({ businessId, projectId = null, businessTools = false }) {
  const scopeKey = `${businessId || ''}:${projectId || ''}`
  return <ManagedFilesPanelBody
    key={scopeKey}
    businessId={businessId}
    projectId={projectId}
    businessTools={businessTools}
  />
}

export default ManagedFilesPanel
