'use client'

// @req FR-236 — the review surface in the Knowledge (GKS) slot: edit, approve
//   and reject a LINE FAQ candidate, every decision audited.
// @spec ADR-090 D6
// @tested tests/unit/knowledge-candidates-ui.test.js
import { useCallback, useEffect, useState } from 'react'
import { Card, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'

// FR-232 (erasure fan-out, a later task) is the only writer of TOMBSTONED;
// this page already renders it correctly if a row ever arrives in that state.
const STATUS_LABEL = {
  PENDING_REVIEW: 'รอตรวจ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธแล้ว',
  'TOMBSTONED': 'ถูกลบ (erasure)',
}

function messageFrom(error) {
  return error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function CandidateRow({ candidate, onChanged }) {
  const [question, setQuestion] = useState(candidate.question)
  const [answer, setAnswer] = useState(candidate.answer)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const editable = candidate.status === 'PENDING_REVIEW'
  const dirty = question !== candidate.question || answer !== candidate.answer

  const run = async (name, action) => {
    setBusy(name); setError('')
    try { await action(); await onChanged() } catch (cause) { setError(messageFrom(cause)) } finally { setBusy('') }
  }

  const save = () => run('save', () => jsonRequest(`/api/knowledge/candidates/${candidate.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, answer, version: candidate.version }),
  }))

  const decide = (decision) => run(decision, () => jsonRequest(`/api/knowledge/candidates/${candidate.id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, version: candidate.version }),
  }))

  return (
    <Card className="mb-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <StatusPill status={candidate.status} />
        <span className="text-[11px] text-muted">
          {STATUS_LABEL[candidate.status] || candidate.status} · {new Date(candidate.createdAt).toLocaleString('th-TH')}
        </span>
      </div>
      <label className="mb-1 block text-[11px] font-semibold text-muted">คำถาม (canonical)</label>
      <textarea
        className="mb-2 w-full rounded border p-2 text-sm"
        rows={2}
        value={question}
        disabled={!editable}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <label className="mb-1 block text-[11px] font-semibold text-muted">คำตอบ (canonical, ไม่มีชื่อ/เบอร์/LINE id/ข้อความอ้างอิงลูกค้า)</label>
      <textarea
        className="mb-3 w-full rounded border p-2 text-sm"
        rows={3}
        value={answer}
        disabled={!editable}
        onChange={(event) => setAnswer(event.target.value)}
      />
      {error && <p className="mb-2 text-[12px] text-red-600">{error}</p>}
      {editable && (
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" disabled={!dirty || Boolean(busy)} onClick={save}>
            {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
          </button>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy) || dirty} onClick={() => decide('APPROVE')}>
            {busy === 'APPROVE' ? 'กำลังอนุมัติ…' : 'อนุมัติ'}
          </button>
          <button type="button" className="btn btn-danger" disabled={Boolean(busy) || dirty} onClick={() => decide('REJECT')}>
            {busy === 'REJECT' ? 'กำลังปฏิเสธ…' : 'ปฏิเสธ'}
          </button>
        </div>
      )}
      {candidate.status === 'APPROVED' && candidate.admittedSourceId && (
        <p className="mt-2 text-[11px] text-muted">admitted source: {candidate.admittedSourceId}</p>
      )}
    </Card>
  )
}

export default function KnowledgeCandidateReview() {
  const scope = useScope()
  const businessId = scope?.shell?.activeBusiness?.id
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!businessId) return
    setLoading(true); setError('')
    try {
      const rows = await jsonRequest(`/api/knowledge/candidates?businessId=${encodeURIComponent(businessId)}`)
      setCandidates(Array.isArray(rows) ? rows : [])
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { void reload() }, [reload])

  if (!businessId) {
    return <Card>เลือก Business ก่อนเพื่อดู LINE FAQ candidates</Card>
  }

  return (
    <div>
      <SectionTitle caption="ร่างจากบทสนทนา LINE ที่ consent = GRANTED เท่านั้น ไม่มีชื่อ/เบอร์/LINE id/ข้อความอ้างอิงลูกค้า">
        LINE FAQ candidates ({candidates.length})
      </SectionTitle>
      {loading && <p className="text-[12px] text-muted">กำลังโหลด…</p>}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {!loading && candidates.length === 0 && <Card>ยังไม่มี candidate สำหรับ Business นี้</Card>}
      {candidates.map((candidate) => (
        <CandidateRow key={candidate.id} candidate={candidate} onChanged={reload} />
      ))}
    </div>
  )
}
