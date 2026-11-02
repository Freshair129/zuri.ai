'use client'

// @req FR-013, FR-045 - portable backup UI exposes content inclusion and remount gaps.
// @req FR-293 — the PM Backup UI can continue an admitted TEST restore from its durable checkpoint.
// @spec BR-008, SDD-023, ADR-016 D10
// @tested tests/integration/backup.test.js, tests/integration/managed-blob-transfer.test.js, tests/unit/fr045-backup-contract.test.js

import { useEffect, useRef, useState } from 'react'
import { Download, Upload, RefreshCw, Search, Trash2 } from 'lucide-react'
import { PageHeader, Card, SectionTitle, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from '@/modules/project-manager/components/useApi'

async function transferResponse(response) {
  const value = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(value?.message || `Transfer request failed (${response.status})`)
    error.code = value?.code
    error.status = response.status
    throw error
  }
  return value
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function BackupPage() {
  const scope = useScope()
  const [snapshotText, setSnapshotText] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)
  const [includeBinaryContent, setIncludeBinaryContent] = useState(false)
  const [remountsText, setRemountsText] = useState('[]')
  const [transferRemountsText, setTransferRemountsText] = useState('[]')
  const [transferFile, setTransferFile] = useState(null)
  const [transferJob, setTransferJob] = useState(null)
  const downloadedPackages = useRef(new Set())
  const announcedRestores = useRef(new Set())

  const requestApi = async (...args) => {
    try { return await api(...args) }
    catch (err) { setError(err.message); throw err }
  }

  const writeHeaders = async () => ({ 'X-Zuri-API-Write-CSRF': (await requestApi('/api/auth/csrf')).token })

  useEffect(() => {
    let active = true
    requestApi('/api/backup/transfers').then(result => {
      const resumable = result.jobs?.find(job => ['COPYING', 'PREVIEWED', 'RESTORING', 'UNKNOWN',
        'METADATA_COMMITTED', 'NEEDS_ADMISSION'].includes(job.state)
        || (job.kind === 'EXPORT' && job.state === 'COMPLETE'))
      if (active && resumable) setTransferJob(current => current ?? resumable)
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const exportTransfer = async (expectedGeneration) => {
    const result = await requestApi('/api/backup/transfers/export', { method: 'POST',
      headers: await writeHeaders(), body: { format: 'compact-managed-blob-backup.v1',
        includeBinaryContent, expectedGeneration } })
    const job = result.job
    setTransferJob(job)
    setError('Export job accepted. The sealed package will download when the job reaches COMPLETE.')
  }

  const exportSnapshot = async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = await requestApi(`/api/backup/export?includeBinaryContent=${includeBinaryContent ? '1' : '0'}`)
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `zuri-ai-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)
    } catch (err) {
      if (err.code === 'MANAGED_BLOB_TRANSFER_REQUIRED' && err.expectedGeneration) {
        try { await exportTransfer(err.expectedGeneration) } catch (transferError) { setError(transferError.message) }
      } else if (err.code === 'MANAGED_BLOB_TRANSFER_REQUIRED') {
        setError('This snapshot requires the managed-blob transfer package, but the installation is not admitted for export.')
      } else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const parseSnapshot = () => {
    try {
      return JSON.parse(snapshotText)
    } catch {
      setError('Snapshot is not valid JSON')
      return null
    }
  }

  const parseRemounts = () => {
    try {
      const value = JSON.parse(remountsText)
      if (!Array.isArray(value)) throw new Error()
      return value
    } catch {
      setError('Remounts must be a JSON array')
      return null
    }
  }

  const runPreview = async () => {
    setError(null)
    setRestored(false)
    setPreview(null)
    const snapshot = parseSnapshot()
    const remounts = parseRemounts()
    if (!snapshot || !remounts) return
    setBusy(true)
    try {
      const result = await requestApi('/api/backup/import', { method: 'POST', body: { snapshot, remounts } })
      if (!result.valid) setError(result.errors.join('; '))
      else setPreview(result)
    } catch (err) {
      setError(err.code === 'MANAGED_BLOB_TRANSFER_REQUIRED'
        ? 'This package contains managed-blob recovery refs. Use the sealed TAR transfer workflow below.' : err.message)
    } finally {
      setBusy(false)
    }
  }

  const previewTransfer = async () => {
    setError(null)
    setTransferJob(null)
    if (!transferFile) { setError('Choose a managed-blob backup TAR package first.'); return }
    setBusy(true)
    try {
      const response = await fetch('/api/backup/transfers/preview', { method: 'POST',
        headers: { ...(await writeHeaders()), 'Content-Type': 'application/x-tar' }, body: transferFile })
      const value = await transferResponse(response)
      setTransferJob(value.job)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const confirmTransfer = async () => {
    const resuming = ['RESTORING', 'UNKNOWN', 'METADATA_COMMITTED'].includes(transferJob.state)
      && transferJob.resumeAvailable === true
    if (!resuming && (!transferJob?.confirmationBinding || transferJob.testAdmissionCheckEnabled !== true
      || transferJob.state !== 'PREVIEWED')) return
    const prompt = resuming
      ? 'Continue the already-claimed TEST restore from its durable checkpoint? Unresolved provider writes remain held for inspection.'
      : 'Replace all data in this installation with this transfer snapshot? The restored generation will remain NEEDS_ADMISSION.'
    if (!window.confirm(prompt)) return
    setBusy(true); setError(null)
    try {
      const remounts = resuming ? undefined : JSON.parse(transferRemountsText)
      if (!resuming && !Array.isArray(remounts)) throw new Error('Target remounts must be a JSON array.')
      const result = await requestApi(`/api/backup/transfers/${transferJob.jobId}/confirm`, { method: 'POST',
        headers: await writeHeaders(), body: { ...(resuming ? {} : { confirmationBinding: transferJob.confirmationBinding, remounts }),
          expectedJobVersion: transferJob.jobVersion } })
      setTransferJob(current => ({ ...current, ...result.job,
        confirmationBinding: current?.confirmationBinding,
        testAdmissionCheckEnabled: current?.testAdmissionCheckEnabled }))
      setError('Restore attempt accepted. Status will update as the durable job completes.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const refreshTransfer = async () => {
    if (!transferJob?.jobId) return
    setBusy(true)
    try {
      const result = await requestApi(`/api/backup/transfers/${transferJob.jobId}`)
      setTransferJob(current => ({ ...current, ...result.job }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const inspectTransfer = async () => {
    if (!transferJob?.jobId) return
    setBusy(true)
    try {
      const result = await requestApi(`/api/backup/transfers/${transferJob.jobId}/inspect`, { method: 'POST',
        headers: await writeHeaders(), body: {} })
      setTransferJob(current => ({ ...current, ...result.job }))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const abandonTransfer = async () => {
    if (!transferJob?.jobId || !window.confirm('Abandon this transfer job and release only its confirmed private package?')) return
    setBusy(true)
    try {
      const result = await requestApi(`/api/backup/transfers/${transferJob.jobId}/abandon`, { method: 'POST',
        headers: await writeHeaders(), body: { expectedJobVersion: transferJob.jobVersion } })
      setTransferJob(result.job)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!transferJob?.jobId || !['COPYING', 'RESTORING', 'METADATA_COMMITTED'].includes(transferJob.state)) return undefined
    const timer = setInterval(async () => {
      try {
        const result = await requestApi(`/api/backup/transfers/${transferJob.jobId}`)
        setTransferJob(current => ({ ...current, ...result.job }))
      } catch (err) { setError(err.message) }
    }, 2500)
    return () => clearInterval(timer)
  }, [transferJob?.jobId, transferJob?.state])

  useEffect(() => {
    if (transferJob?.kind !== 'EXPORT' || transferJob.state !== 'COMPLETE'
      || downloadedPackages.current.has(transferJob.jobId)) return undefined
    downloadedPackages.current.add(transferJob.jobId)
    let cancelled = false
    const download = async () => {
      try {
        const response = await fetch(`/api/backup/transfers/${transferJob.jobId}/package`)
        if (!response.ok) await transferResponse(response)
        const blob = await response.blob()
        if (!cancelled) downloadBlob(blob, `zuri-managed-blob-backup-${transferJob.jobId}.tar`)
      } catch (err) { if (!cancelled) setError(err.message) }
    }
    void download()
    return () => { cancelled = true }
  }, [transferJob?.jobId, transferJob?.kind, transferJob?.state])

  useEffect(() => {
    if (transferJob?.kind !== 'RESTORE' || transferJob.state !== 'NEEDS_ADMISSION'
      || announcedRestores.current.has(transferJob.jobId)) return
    announcedRestores.current.add(transferJob.jobId)
    setError('Restore completed on the admitted TEST target. This generation remains NEEDS_ADMISSION; ordinary recovery is still unavailable.')
    scope.refresh()
  }, [transferJob?.jobId, transferJob?.kind, transferJob?.state, scope])

  const confirmRestore = async () => {
    const snapshot = parseSnapshot()
    const remounts = parseRemounts()
    if (!snapshot || !remounts) return
    if (!window.confirm('Restore this snapshot? Current local data will be REPLACED.')) return
    setBusy(true)
    setError(null)
    try {
        const result = await requestApi('/api/backup/import', { method: 'POST', body: { snapshot, remounts, confirm: true } })
      if (result.restored) {
        setRestored(true)
        setPreview(null)
        scope.refresh()
      } else {
        setError((result.errors || ['Restore failed']).join('; '))
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Backup"
        title="Snapshot Export / Import"
        subtitle="Explicit offline backup. Import always previews counts and asks for confirmation — never a silent overwrite."
      />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card>
          <SectionTitle caption="Full-domain JSON snapshot: scope, projects, work data, repositories, audit metadata">Export</SectionTitle>
          <label className="mb-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={includeBinaryContent} onChange={(event) => setIncludeBinaryContent(event.target.checked)} /> Include available local file content explicitly</label>
          <button type="button" className="btn btn-primary flex items-center gap-1.5" onClick={exportSnapshot} disabled={busy}>
            <Download size={13} aria-hidden /> Download snapshot
          </button>
        </Card>
        <Card>
          <SectionTitle caption="Reserved managed-blob refs require the sealed package and explicit target review">Managed-blob transfer</SectionTitle>
          <p className="mb-3 text-[11px] text-muted">The package includes exact original bytes and snapshot bindings. Replace-all confirmation is limited to source-bound disposable TEST admission; this runtime keeps every other target closed.</p>
          <label className="mb-2 block text-[10px] font-bold">Transfer package (.tar)</label>
          <input className="input" type="file" accept=".tar,application/x-tar" onChange={event => setTransferFile(event.target.files?.[0] || null)} />
          <button type="button" className="btn mt-3 flex items-center gap-1.5" onClick={previewTransfer} disabled={busy || !transferFile}>
            <Upload size={13} aria-hidden /> Preview package
          </button>
          {transferJob && <div className="mt-3 rounded-lg border border-[var(--border)] p-3 text-[10px]">
            <p><strong>Job:</strong> {transferJob.jobId}</p>
            <p><strong>Kind / state:</strong> {transferJob.kind} / {transferJob.state}</p>
            <p><strong>Generation:</strong> {transferJob.generation}</p>
            {transferJob.counts?.snapshotRows && <p><strong>Snapshot rows:</strong> {Object.values(transferJob.counts.snapshotRows).reduce((sum, n) => sum + n, 0)}</p>}
            {transferJob.counts && <p><strong>Managed objects / original bytes:</strong> {transferJob.counts.transferEntries} / {transferJob.counts.originalBytes}</p>}
            {transferJob.counts?.localFileRestore?.mountRequiredBusinessIds?.length > 0
              && <p><strong>Target-local mounts required:</strong> {transferJob.counts.localFileRestore.mountRequiredBusinessIds.join(', ')}</p>}
            {transferJob.confirmationBinding && <p className="mt-2 text-muted">Confirmation status: {transferJob.testAdmissionCheckEnabled
              ? 'This preview is not authorization. The server will verify a current source-bound TEST admission at confirm.'
              : 'Server-side TEST admission verification is not configured on this runtime.'}</p>}
            {transferJob.kind === 'RESTORE' && transferJob.state === 'PREVIEWED' && !transferJob.confirmationBinding
              && <p className="mt-2 text-muted">This preview was opened in an earlier session. Abandon it and upload the package again to create a fresh confirmation binding.</p>}
            {transferJob.kind === 'RESTORE' && transferJob.state === 'PREVIEWED'
              && <label className="mt-3 block text-[10px] font-bold">Target-local remounts (businessId, deviceKey, absolute rootPath)
                <textarea className="input mt-1 h-20 font-mono text-[10px]" value={transferRemountsText}
                  onChange={event => setTransferRemountsText(event.target.value)} aria-label="Target-local remount JSON" />
              </label>}
            <div className="mt-2 flex flex-wrap gap-2">
              {((transferJob.state === 'PREVIEWED' && transferJob.confirmationBinding)
                || (transferJob.resumeAvailable === true && ['RESTORING', 'UNKNOWN', 'METADATA_COMMITTED'].includes(transferJob.state)))
                && <button type="button" className="btn btn-danger" onClick={confirmTransfer} disabled={busy
                  || (transferJob.state === 'PREVIEWED' && !transferJob.testAdmissionCheckEnabled)}>
                  {transferJob.state === 'PREVIEWED' ? 'Confirm TEST restore' : 'Resume TEST restore'}
                </button>}
              <button type="button" className="btn" onClick={refreshTransfer} disabled={busy}><RefreshCw size={12} aria-hidden /> Status</button>
              <button type="button" className="btn" onClick={inspectTransfer} disabled={busy}><Search size={12} aria-hidden /> Inspect</button>
              {['PREPARED', 'PREVIEWED', 'COMPLETE', 'FAILED'].includes(transferJob.state) && <button type="button" className="btn" onClick={abandonTransfer} disabled={busy}><Trash2 size={12} aria-hidden /> Abandon</button>}
            </div>
          </div>}
        </Card>
        <Card>
          <SectionTitle caption="Paste a snapshot JSON, preview, then confirm to restore">Import</SectionTitle>
          <textarea
            className="input h-40 font-mono text-[10px]"
            value={snapshotText}
            onChange={(e) => setSnapshotText(e.target.value)}
            placeholder='{ "schemaVersion": "1.0", "exportedAt": "...", "tables": { ... } }'
            aria-label="Snapshot JSON"
          />
          <label className="mt-3 block text-[10px] font-bold">Device remounts (portable snapshots never contain absolute paths)</label>
          <textarea className="input mt-1 h-24 font-mono text-[10px]" value={remountsText} onChange={(event) => setRemountsText(event.target.value)} aria-label="Device remount JSON" />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn flex items-center gap-1.5" onClick={runPreview} disabled={busy || !snapshotText.trim()}>
              <Upload size={13} aria-hidden /> Preview
            </button>
            <button type="button" className="btn btn-danger" onClick={confirmRestore} disabled={busy || !preview}>
              Confirm restore
            </button>
          </div>
          {error && (
            <p className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}
          {preview && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-bold">
                Snapshot from {preview.exportedAt ? new Date(preview.exportedAt).toLocaleString() : 'unknown time'}
                {preview.wouldReplace && (
                  <span className="ml-2" style={{ color: 'var(--warning)' }}>— will replace existing data</span>
                )}
              </p>
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-left text-muted"><th>Table</th><th>Incoming</th><th>Current</th></tr>
                </thead>
                <tbody>
                  {Object.entries(preview.counts).filter(([, n]) => n > 0 || preview.current?.[0]).map(([table, n]) => (
                    <tr key={table} className="border-t border-[var(--border)]">
                      <td className="py-0.5">{table}</td>
                      <td>{n}</td>
                      <td>{preview.current?.[table] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.mountRequiredBusinessIds?.length > 0 && <p className="mt-2 text-[10px] text-[var(--warning)]">Remount required: {preview.mountRequiredBusinessIds.join(', ')}</p>}
              {preview.missingContentFileIds?.length > 0 && <p className="mt-1 text-[10px] text-muted">Metadata-only files: {preview.missingContentFileIds.length}</p>}
            </div>
          )}
          {restored && (
            <p className="mt-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
              Snapshot restored. Audit event recorded.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
