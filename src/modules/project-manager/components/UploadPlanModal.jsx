'use client'

// @req FR-012, FR-018 — Upload Plan Modal directly in /work surface
// Supports JSON PlanEnvelope and Excel (.xlsx) formats.
// @spec BR-009

import { useRef, useState } from 'react'
import { FileSpreadsheet, UploadCloud, CheckCircle2 } from 'lucide-react'
import { Modal, Field } from '@/components/ui'
import { api, useFetch } from './useApi'

export default function UploadPlanModal({ open, onClose, onUploaded }) {
  const { data: workspaces } = useFetch('/api/workspaces')
  const [workspaceId, setWorkspaceId] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const fileRef = useRef(null)

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result)
        setJsonText(JSON.stringify(parsed, null, 2))
      } catch (err) {
        setError('ไฟล์ที่เลือกไม่ใช่ JSON ที่ถูกต้อง')
      }
    }
    reader.readAsText(file)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!jsonText.trim()) {
      setError('กรุณาวางเนื้อหา JSON หรือเลือกไฟล์ Plan')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let envelope
      try {
        envelope = JSON.parse(jsonText)
      } catch {
        throw new Error('รูปแบบ JSON ไม่ถูกต้อง')
      }

      const targetWs = workspaceId || workspaces?.[0]?.id

      const res = await api('/api/import/plan', {
        method: 'POST',
        body: {
          envelope,
          workspaceId: targetWs,
          dryRun: false,
        },
      })

      if (!res.ok && res.errors) {
        throw new Error(res.errors.join(', '))
      }

      setSuccess(true)
      setTimeout(() => {
        onUploaded?.(res)
        onClose()
        setSuccess(false)
        setJsonText('')
      }, 1000)
    } catch (err) {
      setError(err.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="📥 Upload Execution Plan (นำเข้าแผนงาน)">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-muted">เลือกไฟล์ PlanEnvelope (JSON):</label>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            type="button"
            className="btn btn-sm flex items-center gap-1.5 text-xs font-medium"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={14} /> เลือกไฟล์จากเครื่อง
          </button>
        </div>

        <Field label="เนื้อหา Plan JSON (PlanEnvelope schemaVersion 1.0)">
          <textarea
            className="input font-mono text-[11px]"
            rows={8}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder="วาง PlanEnvelope JSON ที่สร้างจาก AI Agent หรือเครื่องมือภายนอกที่นี่..."
            required
          />
        </Field>

        <Field label="Space ปลายทาง (Target Workspace)">
          <select
            className="input"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {(workspaces || []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {success && (
          <p className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold text-green-700 bg-green-50">
            <CheckCircle2 size={14} /> นำเข้าแผนงานสำเร็จ กำลังรีเฟรชตารางงาน...
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || success}>
            {busy ? 'กำลังประมวลผล…' : 'นำเข้าแผนงานทันที'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
