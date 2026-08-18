'use client'

import { useEffect, useMemo, useState } from 'react'

import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-078 — Business-scoped review UI exposes only redacted identifiers,
// evidence flags and explicit decisions; it never displays source PII or writes
// Customer rows directly.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-ui.test.js

const ACTIONS = [
  ['', 'ยังไม่ตัดสินใจ'],
  ['CREATE_SEPARATE', 'สร้างเป็นลูกค้าแยก'],
  ['LINK_EXISTING', 'ผูกกับ Customer เดิม'],
  ['REJECT', 'ไม่รับแถวนี้'],
  ['DEFER', 'พักไว้ก่อน'],
]

function ReviewItem({ item, draft, setDraft }) {
  const action = draft?.action || item.latestDecision?.action || ''
  const targetCustomerId = draft?.targetCustomerId ?? item.latestDecision?.targetCustomerId ?? ''
  return (
    <div className="border-t border-[var(--border)] py-3 first:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold">Review item</p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted">{item.reviewItemId}</p>
          <p className="mt-1 text-[10px] text-muted">source row {item.sourceRow ?? '—'} · {item.sourceSha256}</p>
        </div>
        <div className="text-right text-[10px] text-muted">
          <p>{item.reasonCode}</p>
          <p className="mt-1">evidence: {Object.entries(item.evidence || {}).filter(([, value]) => value === true).map(([key]) => key).join(', ') || '—'}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
        <Field label="แนวทาง">
          <select
            className="input"
            value={action}
            onChange={(event) => setDraft(item.reviewItemId, { action: event.target.value, targetCustomerId })}
            aria-label={`แนวทาง ${item.reviewItemId}`}
          >
            {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {action === 'LINK_EXISTING' && (
          <Field label="Target Customer ID" hint="ระบบจะตรวจ Tenant/Business ซ้ำที่ server">
            <input
              className="input font-mono"
              value={targetCustomerId}
              onChange={(event) => setDraft(item.reviewItemId, { action, targetCustomerId: event.target.value.trim() })}
              placeholder="UUID ของ Customer เดิม"
              aria-label={`Target Customer ID ${item.reviewItemId}`}
            />
          </Field>
        )}
      </div>
    </div>
  )
}

function ReviewCaseCard({ reviewCase, businessId, onSaved }) {
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    setDrafts({})
    setError(null)
    setMessage(null)
  }, [reviewCase.reviewCaseId, reviewCase.version])

  const setDraft = (reviewItemId, value) => setDrafts((current) => ({ ...current, [reviewItemId]: value }))

  const submit = async () => {
    const decisions = Object.entries(drafts)
      .filter(([, decision]) => decision?.action)
      .map(([provenanceId, decision]) => ({ provenanceId, ...decision }))
    if (!decisions.length) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api(`/api/platform/customer-import-reviews/${reviewCase.reviewCaseId}/decisions`, {
        method: 'POST',
        body: { businessId, expectedVersion: reviewCase.version, decisions },
      })
      setMessage('บันทึกแนวทางแล้ว — ยังไม่มีการสร้างหรือแก้ Customer')
      await onSaved()
    } catch (caught) {
      setError(caught?.message || 'บันทึกไม่สำเร็จ กรุณาโหลดคิวใหม่')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Duplicate review case</p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted">{reviewCase.reviewCaseId}</p>
          <p className="mt-1 text-[10px] text-muted">{reviewCase.reasonCode} · {reviewCase.itemCount} items · version {reviewCase.version}</p>
        </div>
        <StatusPill status={reviewCase.status} />
      </div>
      <div className="mt-3 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] text-muted">
        Redacted evidence: {Object.entries(reviewCase.evidenceSummary || {}).filter(([, value]) => value === true).map(([key]) => key).join(', ') || '—'}
      </div>
      <div className="mt-3">
        {reviewCase.items.map((item) => (
          <ReviewItem key={item.reviewItemId} item={item} draft={drafts[item.reviewItemId]} setDraft={setDraft} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={busy || !Object.keys(drafts).length} onClick={submit}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกแนวทาง'}
        </button>
        {message && <span className="text-[11px]" role="status">{message}</span>}
        {error && <span className="text-[11px] text-[var(--danger)]" role="alert">{error}</span>}
      </div>
    </Card>
  )
}

export default function CustomerImportReviewsPage() {
  const scope = useScope()
  const businessId = scope.currentBusiness?.id || ''
  const path = businessId
    ? `/api/platform/customer-import-reviews?businessId=${encodeURIComponent(businessId)}&status=OPEN`
    : ''
  const queue = useFetch(path, [businessId])
  const cases = useMemo(() => queue.data?.cases || [], [queue.data])

  if (!businessId) return <Card><p className="text-sm text-muted">เลือก Business ก่อนเปิดคิว Customer Review</p></Card>
  if (queue.loading) return <LoadingCard />
  if (queue.error) return <ErrorState title="โหลด Customer Review ไม่สำเร็จ" detail={queue.error} retry={queue.reload} />

  return (
    <div>
      <PageHeader
        eyebrow="Platform / Customer Review"
        title="Duplicate customer review"
        subtitle="อนุมัติแนวทางสำหรับแถวที่ซ้ำใน SmartGift โดยระบบยังไม่ publish หรือแก้ Customer"
      />
      <Card warm>
        <SectionTitle caption={`Business ปัจจุบัน: ${scope.currentBusiness?.name || businessId}`}>คิวแบบ redacted</SectionTitle>
        <p className="text-[11px] leading-5 text-muted">
          แสดงเฉพาะ review item ID, source row, hash และ evidence flags ไม่มีชื่อ เบอร์ อีเมล เลขภาษี หรือข้อมูลจาก DuckDB ใน browser การเลือก LINK_EXISTING จะตรวจ scope ที่ server และทุกการตัดสินใจเก็บแบบ append-only
        </p>
        <p className="mt-2 text-[11px] text-muted">{queue.data?.counts?.cases || 0} cases · {queue.data?.counts?.items || 0} items · mission MIS-SG-CUSTOMER-DATA-BACKFILL-001</p>
      </Card>
      <div className="mt-4 space-y-3">
        {cases.length === 0
          ? <Card><p className="text-[11px] text-muted">ยังไม่มี review case ที่พร้อมให้ตัดสินใจ</p></Card>
          : cases.map((reviewCase) => <ReviewCaseCard key={reviewCase.reviewCaseId} reviewCase={reviewCase} businessId={businessId} onSaved={queue.reload} />)}
      </div>
    </div>
  )
}
