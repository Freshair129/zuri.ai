'use client'

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { PageHeader, Card, SectionTitle, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from '@/modules/project-manager/components/useApi'

export default function BackupPage() {
  const scope = useScope()
  const [snapshotText, setSnapshotText] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)

  const exportSnapshot = async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = await api('/api/backup/export')
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `zuri-v2-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
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

  const runPreview = async () => {
    setError(null)
    setRestored(false)
    setPreview(null)
    const snapshot = parseSnapshot()
    if (!snapshot) return
    setBusy(true)
    try {
      const result = await api('/api/backup/import', { method: 'POST', body: { snapshot } })
      if (!result.valid) setError(result.errors.join('; '))
      else setPreview(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    const snapshot = parseSnapshot()
    if (!snapshot) return
    if (!window.confirm('Restore this snapshot? Current local data will be REPLACED.')) return
    setBusy(true)
    setError(null)
    try {
      const result = await api('/api/backup/import', { method: 'POST', body: { snapshot, confirm: true } })
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
          <button type="button" className="btn btn-primary flex items-center gap-1.5" onClick={exportSnapshot} disabled={busy}>
            <Download size={13} aria-hidden /> Download snapshot
          </button>
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
