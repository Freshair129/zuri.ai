'use client'

// @req FR-045 - Business and Project File Manager controls over one managed model.
// @req FR-058 - hosts the grid/timeline/by-project/preview view switcher over the
// same managed asset list; the panel itself gains no new persistence or route.
// @spec SDD-023, SEC-007, ADR-016, SDD-031
// @tested tests/unit/fr045-api-ui-contract.test.js, tests/unit/fr058-file-manager-views-ui.test.js
import { useMemo, useState } from 'react'
import { ExternalLink, FileText, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, Modal, SectionTitle } from '@/components/ui'
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

export default function ManagedFilesPanel({ businessId, projectId = null, businessTools = false }) {
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState(null)
  const [view, setView] = useState('grid')
  const query = projectId ? `/api/files?projectId=${encodeURIComponent(projectId)}` : `/api/business/files?businessId=${encodeURIComponent(businessId)}`
  const files = useFetch(businessId ? query : null, [businessId, projectId])
  const mounts = useFetch(businessId ? `/api/files/mounts?businessId=${encodeURIComponent(businessId)}` : null, [businessId])
  const activeMounts = useMemo(() => (mounts.data || []).filter((mount) => mount.status === 'ACTIVE'), [mounts.data])
  if (files.loading || mounts.loading) return <LoadingCard />
  if (files.error) return <ErrorState detail={files.error} retry={files.reload} />
  const assets = files.data?.assets || []
  const groups = files.data?.groups || []
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
      {businessTools && <>
        <button className="btn flex items-center gap-1" type="button" onClick={() => runBusinessTool('/api/files/reconcile', false)}><RefreshCw size={14} /> Preview reconcile</button>
        <button className="btn" type="button" onClick={() => runBusinessTool('/api/files/reconcile', true)}>Confirm reconcile</button>
        <button className="btn" type="button" onClick={() => runBusinessTool('/api/files/cache/rebuild')}>Rebuild cache</button>
      </>}
    </div>
    {message && <pre className="card mb-4 overflow-auto text-[10px]">{message}</pre>}
    {!assets.length ? <EmptyState title="No managed files" hint="Add a Business or Project file. Local content requires a configured device mount." /> : <FileManagerViews
      view={view}
      onViewChange={setView}
      assets={assets}
      groups={groups}
      renderAsset={(asset) => <Card key={asset.id}>
        <div className="flex items-start gap-3"><FileText size={20} className="text-[var(--brand-dark)]" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{asset.name}</p><p className="text-[10px] text-muted">{asset.code} · {asset.storageKind} · {bytes(asset.size)} · {asset.state}</p>{asset.relativePath && <p className="truncate text-[10px] text-muted">{asset.relativePath}</p>}</div>
          <button className="btn px-2" type="button" aria-label={`Delete ${asset.name}`} onClick={async () => { if (window.confirm(`Delete metadata for ${asset.name}?`)) { try { await api(`/api/files/${asset.id}`, { method: 'DELETE' }); files.reload() } catch (error) { setMessage(error.message) } } }}><Trash2 size={13} /></button></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {asset.externalUrl && <a className="btn text-[11px]" href={asset.externalUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
          {asset.storageKind === 'LOCAL_FILE' && asset.state === 'ACTIVE' && <a className="btn text-[11px]" href={`/api/files/${asset.id}/content`} target="_blank"><FileText size={13} /> View</a>}
          {asset.storageKind === 'LOCAL_FILE' && asset.localCapability?.available && <button className="btn text-[11px]" type="button" onClick={async () => { try { await api(`/api/files/${asset.id}/reveal`, { method: 'POST', headers: { 'x-zuri-local-intent': 'reveal' } }); setMessage('Opened in File Explorer') } catch (error) { setMessage(error.message) } }}><FolderOpen size={13} /> Reveal</button>}
          {asset.storageKind === 'LOCAL_FILE' && <button className="btn text-[11px]" type="button" onClick={async () => { const relativePath = window.prompt('Relative path inside the active mount', asset.relativePath || ''); if (!relativePath || !activeMounts[0]) return; try { await api(`/api/files/${asset.id}/relink`, { method: 'POST', body: { mountId: activeMounts[0].id, relativePath } }); files.reload() } catch (error) { setMessage(error.message) } }}>Relink</button>}
        </div>
      </Card>}
    />}
    {adding && <AddManagedFile businessId={businessId} projectId={projectId} mounts={activeMounts} onSaved={files.reload} onClose={() => setAdding(false)} />}
  </>
}
