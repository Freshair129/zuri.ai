'use client'

// @req FR-247 — the operator's deduplicated error list: grouped by fingerprint,
// showing occurrence count and first/last seen, with a resolve action. No
// request/response body, no field outside the fingerprinted name/message/frames
// ever reaches this view (ADR-095 D1).
// @spec ADR-095 D1; NFR-008
// @tested tests/unit/error-events-view.test.js

import { useCallback, useEffect, useState } from 'react'
import { Card, DataTable, EmptyState, StatusPill } from '@/components/ui'

const when = (iso) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—')

export default function ErrorEventsView({ initialEvents = null, fetcher = globalThis.fetch }) {
  const [events, setEvents] = useState(initialEvents)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    try {
      const response = await fetcher('/api/platform/error-events', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'โหลดรายการ error ไม่สำเร็จ')
      setEvents(body.events || [])
      setError('')
    } catch (failure) {
      setError(failure.message)
      setEvents((prior) => prior ?? [])
    }
  }, [fetcher])

  useEffect(() => {
    if (initialEvents === null) load()
  }, [initialEvents, load])

  async function resolve(event) {
    setBusyId(event.id)
    setError('')
    try {
      const response = await fetcher(`/api/platform/error-events/${event.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'ปิด error ไม่สำเร็จ')
      await load()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card data-testid="error-events-view">
      <p className="mb-3 text-xs text-muted">
        error ที่ระบบเจอจริง จัดกลุ่มด้วย fingerprint (ชื่อ + ข้อความ + ตำแหน่งแรกใน stack) — ไม่มีเนื้อหา
        request/response ปนอยู่ กดปิดเมื่อแก้แล้ว จะไม่นับเป็น active อีก (ADR-095 D1)
      </p>
      {error && <p className="mb-2 text-xs text-[var(--action-danger,#B83227)]">{error}</p>}
      {events === null ? (
        <EmptyState title="กำลังโหลด…" />
      ) : (
        <DataTable
          rowKey={(e) => e.id}
          empty={<EmptyState title="ไม่มี error ที่ยัง active" hint="ระบบยังไม่เจอ error ใหม่ตั้งแต่เริ่มเก็บ" />}
          columns={[
            { key: 'name', label: 'ชื่อ', render: (e) => <code className="text-[11px] font-semibold">{e.name}</code> },
            { key: 'message', label: 'ข้อความ', render: (e) => <span className="text-[12px]">{e.message}</span> },
            { key: 'occurrenceCount', label: 'จำนวนครั้ง', render: (e) => <b>{e.occurrenceCount.toLocaleString()}</b> },
            { key: 'firstSeenAt', label: 'พบครั้งแรก', render: (e) => <span className="text-[11px] text-muted">{when(e.firstSeenAt)}</span> },
            { key: 'lastSeenAt', label: 'ล่าสุด', render: (e) => <span className="text-[11px] text-muted">{when(e.lastSeenAt)}</span> },
            { key: 'status', label: 'สถานะ', render: (e) => <StatusPill status={e.resolvedAt ? 'DONE' : 'BLOCKED'} /> },
            {
              key: 'action', label: '',
              render: (e) => e.resolvedAt ? (
                <span className="text-[11px] text-muted">ปิดแล้ว</span>
              ) : (
                <button
                  type="button"
                  className="btn text-[11px]"
                  disabled={busyId === e.id}
                  onClick={() => resolve(e)}
                >
                  {busyId === e.id ? 'กำลังปิด…' : 'ปิด (resolve)'}
                </button>
              ),
            },
          ]}
          rows={events}
        />
      )}
    </Card>
  )
}
