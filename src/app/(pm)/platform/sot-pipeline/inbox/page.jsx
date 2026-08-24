'use client'

// @req FR-100 — the approval inbox: pending decisions in one queue, exactly two
// actions (approve / reject-with-reason), each recorded as an individual
// audited decision. The payload is displayed verbatim and never edited here.
// @spec FR-100
// @tested tests/unit/sot-inbox-ui.test.js
import { Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { Card, ErrorState, PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

const TYPE_TH = {
  PRICE_ROW: 'ราคา',
  ENTITY: 'ข้อมูลหลัก',
  FILE_CLASSIFICATION: 'จัดประเภทไฟล์',
  PHASE_GATE: 'ประตูเฟส',
}

function SotInboxPageInner() {
  const { businessId } = useScope()
  const params = useSearchParams()
  const phaseId = params.get('phaseId') || ''
  const [typeFilter, setTypeFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [actionError, setActionError] = useState(null)

  const planQuery = useFetch(
    businessId ? `/api/platform/sot/plan?businessId=${businessId}` : null,
    [businessId]
  )
  const tenantId = planQuery.data?.tenantId

  const listPath = useMemo(() => {
    if (!tenantId || !businessId) return null
    const q = new URLSearchParams({ tenantId, businessId, status: 'PENDING' })
    if (typeFilter) q.set('decisionType', typeFilter)
    if (phaseId) q.set('phaseId', phaseId)
    return `/api/platform/sot/decisions?${q.toString()}`
  }, [tenantId, businessId, typeFilter, phaseId])
  const { data, error, loading } = useFetch(listPath, [listPath, refreshKey])

  async function decide(decision, action, reason) {
    setBusyId(decision.id)
    setActionError(null)
    try {
      await api(`/api/platform/sot/decisions/${decision.id}/decide`, {
        method: 'POST',
        body: { decision: action, ...(reason ? { reason } : {}) },
      })
      setRefreshKey((k) => k + 1)
    } catch (err) {
      setActionError(err?.message || String(err))
    } finally {
      setBusyId(null)
    }
  }

  function onReject(decision) {
    const reason = window.prompt('เหตุผลที่ตีกลับ (จำเป็น):')
    if (reason && reason.trim()) decide(decision, 'REJECTED', reason.trim())
  }

  if (!businessId) return <ErrorState message="เลือก Business ก่อนเพื่อเปิดกล่องรออนุมัติ" />
  if (planQuery.error) return <ErrorState message={planQuery.error} />
  if (loading || planQuery.loading) return <LoadingCard />

  const decisions = data?.decisions || []

  return (
    <div>
      <PageHeader
        title="SoT Pipeline — กล่องรออนุมัติ"
        subtitle={phaseId ? `เฉพาะเฟส ${phaseId}` : 'ทุกเฟส'}
        actions={(
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">ทุกชนิด</option>
            {Object.entries(TYPE_TH).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        )}
      />
      {actionError ? <ErrorState message={actionError} /> : null}
      {error ? <ErrorState message={error} /> : null}
      {decisions.length === 0 ? (
        <Card>ไม่มีรายการรออนุมัติ{typeFilter || phaseId ? 'ตามตัวกรองนี้' : ''} 🎉</Card>
      ) : (
        <div style={{ display: 'grid', gap: '.6rem' }}>
          {decisions.map((decision) => (
            <Card key={decision.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap' }}>
                <strong>{decision.subjectRef}</strong>
                <span className="pill pill-planned">{TYPE_TH[decision.decisionType] || decision.decisionType}</span>
                {decision.phaseId ? <span className="pill pill-gate">{decision.phaseId}</span> : null}
                <span style={{ fontSize: '.8em', color: 'var(--muted, #667)' }}>
                  v{decision.decisionVersion} · จาก {decision.submittedBy}
                </span>
              </div>
              <pre style={{ margin: '.45rem 0', fontSize: '.8em', overflowX: 'auto', background: 'var(--surface-2, #f4f4f2)', padding: '.5rem .6rem', borderRadius: 6 }}>
                {JSON.stringify(decision.payload, null, 1)}
              </pre>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button disabled={busyId === decision.id} onClick={() => decide(decision, 'APPROVED')}>
                  อนุมัติ
                </button>
                <button disabled={busyId === decision.id} onClick={() => onReject(decision)}>
                  ตีกลับ…
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default function SotInboxPage() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={<LoadingCard />}>
      <SotInboxPageInner />
    </Suspense>
  )
}
