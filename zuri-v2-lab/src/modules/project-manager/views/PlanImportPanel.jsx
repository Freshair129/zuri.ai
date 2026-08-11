'use client'

// Agent plan import: paste PlanEnvelope JSON → validate → dry-run preview
// (inserts/updates/conflicts) → confirm transactional commit. Plans are data,
// never executed.

import { useRef, useState } from 'react'
import { FileSpreadsheet, Download } from 'lucide-react'
import { PageHeader, Card, SectionTitle, EmptyState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '../components/useApi'

const SAMPLE_HINT = 'Paste a PlanEnvelope JSON (schemaVersion "1.0") — see contracts/sample-plan.json'

export default function PlanImportPanel({ projectId }) {
  const scope = useScope()
  const [text, setText] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  // Project-scoped import page targets that project's workspace by default.
  const { data: contextProject } = useFetch(projectId ? `/api/projects/${projectId}` : null)
  const effectiveWorkspaceId = workspaceId || contextProject?.workspaceId || ''
  const [dryRun, setDryRun] = useState(null)
  const [errors, setErrors] = useState(null)
  const [committed, setCommitted] = useState(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  // FR-018 — Excel surface: upload → convert (per-row errors) → same pipeline.
  const uploadXlsx = async (file) => {
    if (!file) return
    setBusy(true)
    setErrors(null)
    setCommitted(null)
    setDryRun(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (effectiveWorkspaceId) form.append('workspaceId', effectiveWorkspaceId)
      if (projectId) form.append('projectId', projectId)
      const res = await fetch('/api/import/xlsx', { method: 'POST', body: form })
      const result = await res.json()
      if (result.envelope) {
        // Surface the converted envelope so confirm reuses the shared commit path.
        setText(JSON.stringify(result.envelope, null, 2))
      }
      if (!result.valid) {
        setErrors(result.errors)
        if (result.preview) setDryRun(result)
      } else {
        setDryRun(result)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const parsePlan = () => {
    try {
      return JSON.parse(text)
    } catch {
      setErrors(['Input is not valid JSON'])
      return null
    }
  }

  const runDry = async () => {
    setErrors(null)
    setCommitted(null)
    setDryRun(null)
    const plan = parsePlan()
    if (!plan) return
    setBusy(true)
    try {
      const result = await api('/api/import/dry-run', {
        method: 'POST',
        body: { plan, workspaceId: effectiveWorkspaceId || undefined, projectId },
      })
      if (!result.valid && !result.preview) {
        setErrors(result.errors)
      } else {
        setDryRun(result)
        if (!result.valid) setErrors(result.errors)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    const plan = parsePlan()
    if (!plan) return
    setBusy(true)
    try {
      const result = await api('/api/import/commit', {
        method: 'POST',
        body: { plan, workspaceId: effectiveWorkspaceId || undefined, projectId },
      })
      if (result.committed) {
        setCommitted(result)
        setDryRun(null)
        scope.refresh()
      } else {
        setErrors(result.errors)
      }
    } catch (err) {
      setErrors([err.message])
    } finally {
      setBusy(false)
    }
  }

  const PreviewList = ({ title, rows, tone }) => (
    <div>
      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-muted">{title} ({rows.length})</p>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted">none</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: tone.bg, color: tone.fg }}>
              <b>{r.kind}</b> {r.code} — {r.title || r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Agent plan import"
        title="Import Plan Envelope"
        subtitle="Structured plans generated outside the app: validate → dry-run → confirm. Nothing in a plan is ever executed as code."
      />
      <div className="grid grid-cols-[1.2fr_1fr] gap-4 max-md:grid-cols-1">
        <div>
        <Card className="mb-4">
          <SectionTitle caption="สำหรับข้อมูลในกระดาษ/ไฟล์เดิม — แบบฟอร์ม generate จาก schema ของระบบ (dropdown ครบ ไม่ drift)">
            Excel template
          </SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn flex items-center gap-1.5" href="/api/import/template" download>
              <Download size={13} aria-hidden /> ดาวน์โหลดแบบฟอร์ม
            </a>
            <label className="btn btn-primary flex cursor-pointer items-center gap-1.5">
              <FileSpreadsheet size={13} aria-hidden /> {busy ? 'กำลังตรวจ…' : 'อัปโหลดไฟล์ที่กรอกแล้ว'}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                aria-label="อัปโหลดไฟล์ Excel ที่กรอกแล้ว"
                onChange={(e) => uploadXlsx(e.target.files?.[0])}
                disabled={busy}
              />
            </label>
          </div>
          <p className="mt-2 text-[10px] text-muted">
            ระบบตรวจรายแถว (บอกชีต + เลขแถวที่ผิด) แล้วแสดงพรีวิวก่อน — ยืนยันด้วยปุ่มเดียวกับ JSON
          </p>
        </Card>
        <Card>
          <SectionTitle caption={SAMPLE_HINT}>Plan JSON</SectionTitle>
          <textarea
            className="input h-72 font-mono text-[10px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{ "schemaVersion": "1.0", "project": { ... }, "workstreams": [ ... ] }'
            aria-label="Plan envelope JSON"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={effectiveWorkspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label="Target workspace override">
              <option value="">Workspace from plan scope</option>
              {scope.scopedWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
            <button type="button" className="btn" onClick={runDry} disabled={busy || !text.trim()}>
              {busy ? 'Working…' : 'Validate + dry run'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={commit}
              disabled={busy || !dryRun || !dryRun.valid}
              title={!dryRun ? 'Run a dry run first' : !dryRun.valid ? 'Resolve conflicts first' : 'Commit transactionally'}
            >
              Confirm import
            </button>
          </div>
        </Card>
        </div>
        <div>
          {errors && (
            <Card className="mb-3" role="alert">
              <SectionTitle>Validation errors</SectionTitle>
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li key={i} className="rounded-lg px-2 py-1 text-[10px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                    {e}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {dryRun?.preview && (
            <Card className="mb-3">
              <SectionTitle caption={`Target workspace: ${dryRun.workspace?.code || '?'} — no writes performed yet`}>
                Dry-run preview
              </SectionTitle>
              <div className="space-y-3">
                <PreviewList title="Inserts" rows={dryRun.preview.inserts} tone={{ bg: 'var(--success-bg)', fg: 'var(--success)' }} />
                <PreviewList title="Updates" rows={dryRun.preview.updates} tone={{ bg: 'var(--rest-blue)', fg: 'var(--rest-blue-text)' }} />
                <PreviewList title="Conflicts" rows={dryRun.preview.conflicts} tone={{ bg: 'var(--danger-bg)', fg: 'var(--danger)' }} />
                <p className="text-[10px] text-muted">{dryRun.preview.dependencyCount} dependency edge(s) in plan.</p>
              </div>
            </Card>
          )}
          {committed && (
            <Card>
              <SectionTitle>Imported ✓</SectionTitle>
              <p className="text-xs">
                Project <b>{committed.projectCode}</b> committed transactionally. Audit event recorded.
              </p>
              <a className="btn btn-primary mt-3 inline-block" href={`/projects/${committed.projectId}`}>
                Open project
              </a>
            </Card>
          )}
          {!errors && !dryRun && !committed && (
            <EmptyState title="No plan analyzed yet" hint="Paste plan JSON and run the dry run to preview inserts, updates and conflicts." />
          )}
        </div>
      </div>
    </div>
  )
}
