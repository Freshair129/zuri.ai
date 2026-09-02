'use client'

// @req FR-012, FR-018 — Upload Plan Modal directly in /work surface
// Supports JSON PlanEnvelope and Excel (.xlsx) formats. Converges on the same
// dry-run → preview → confirm pipeline every intake surface uses (BR-009,
// SDD-009) — a pasted envelope is never sent straight to a write.
// @spec BR-009, SDD-009

import { useRef, useState } from 'react'
import { FileSpreadsheet, UploadCloud, CheckCircle2 } from 'lucide-react'
import { Modal, Field } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api } from './useApi'
import { buildPlanImportRequest } from './planImportRequest'

export default function UploadPlanModal({ open, onClose, onUploaded }) {
  // @req FR-046 — reuse the Workspace inventory ScopeContext already loaded
  // (/api/scope) instead of a second broad list fetch on this entry surface.
  const { workspaces } = useScope()
  const [workspaceId, setWorkspaceId] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  // Dry-run result awaiting confirmation, plus the exact request that produced
  // it — commit re-sends this unchanged so it can never write to a scope the
  // preview did not check.
  const [preview, setPreview] = useState(null)
  const [pendingRequest, setPendingRequest] = useState(null)
  const fileRef = useRef(null)

  const invalidatePreview = () => {
    setPreview(null)
    setPendingRequest(null)
  }

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    invalidatePreview()
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

  // Step 1 — validate + dry run. Never writes.
  const runDry = async (e) => {
    e.preventDefault()
    if (!jsonText.trim()) {
      setError('กรุณาวางเนื้อหา JSON หรือเลือกไฟล์ Plan')
      return
    }
    setBusy(true)
    setError(null)
    setPreview(null)
    setPendingRequest(null)
    try {
      let envelope
      try {
        envelope = JSON.parse(jsonText)
      } catch {
        throw new Error('รูปแบบ JSON ไม่ถูกต้อง')
      }

      const targetWs = workspaceId || workspaces?.[0]?.id
      const request = buildPlanImportRequest(envelope, { workspaceId: targetWs })
      const dry = await api('/api/import/dry-run', { method: 'POST', body: request })
      if (!dry.valid) {
        setError((dry.errors || []).join(', ') || 'Plan validation failed')
        if (dry.preview) setPreview(dry.preview)
        return
      }
      setPreview(dry.preview)
      setPendingRequest(request)
    } catch (err) {
      setError(err.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  // Step 2 — transactional commit of the exact request the preview validated.
  const confirmCommit = async () => {
    if (!pendingRequest) return
    setBusy(true)
    setError(null)
    try {
      const res = await api('/api/import/commit', { method: 'POST', body: pendingRequest })
      if (!res.committed) {
        setError((res.errors || []).join(', ') || 'Import failed')
        return
      }
      setSuccess(true)
      setPreview(null)
      setPendingRequest(null)
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
      <form onSubmit={runDry} className="space-y-3">
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
            onChange={(e) => { invalidatePreview(); setJsonText(e.target.value) }}
            placeholder="วาง PlanEnvelope JSON ที่สร้างจาก AI Agent หรือเครื่องมือภายนอกที่นี่..."
            required
          />
        </Field>

        <Field label="Space ปลายทาง (Target Workspace)">
          <select
            className="input"
            value={workspaceId}
            onChange={(e) => { invalidatePreview(); setWorkspaceId(e.target.value) }}
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

        {/* Dry-run preview — nothing has been written yet. */}
        {preview && pendingRequest && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px]">
            <p className="mb-1 flex items-center gap-1.5 font-bold text-emerald-800">
              <CheckCircle2 size={13} /> ตรวจสอบแล้ว ยังไม่มีการเขียนข้อมูล — กด "ยืนยันนำเข้า" เพื่อบันทึกจริง
            </p>
            <p className="text-emerald-900">
              เพิ่มใหม่ {preview.inserts.length} รายการ · อัปเดต {preview.updates.length} รายการ
              {preview.conflicts.length > 0 ? ` · ขัดแย้ง ${preview.conflicts.length} รายการ` : ''}
            </p>
          </div>
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
          {pendingRequest ? (
            <>
              <button type="button" className="btn" onClick={invalidatePreview} disabled={busy || success}>
                แก้ไข
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmCommit}
                disabled={busy || success}
              >
                {busy ? 'กำลังบันทึก…' : 'ยืนยันนำเข้า'}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={busy || success}>
              {busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบ (Validate + Preview)'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
