'use client'

// @req FR-185 — select authorized owner content/accounts for durable planning,
// preserve retry identity, and review immutable revisions without a send action.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, PageHeader, StatusPill } from '@/components/ui'
import { api } from '@/modules/project-manager/components/useApi'
import { ScopeNotice } from '../MarketingState'
import { broadcastPayloadTemplate } from '../marketing-broadcast-client-contract'

const CRITERIA_HASH = '40a2ec2eb918a1ac9ba76e6a0f811b8b3e38eec32f0fe654388123122b780268'
const inputClass = 'input w-full'
const buttonClass = 'btn btn-primary disabled:opacity-50'

export default function BroadcastWorkspace({ businessId }) {
  const alive = useRef(false)
  const pendingRequest = useRef(null)
  const detailGeneration = useRef(0)
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [briefId, setBriefId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(false)

  const refresh = useCallback(async () => {
    const query = `businessId=${encodeURIComponent(businessId)}`
    const [intents, content, accounts] = await Promise.allSettled([
      api(`/api/growth/broadcast-intents?${query}`),
      api(`/api/growth/content?${query}`),
      api(`/api/line-oa/accounts?${query}`),
    ])
    if (!alive.current) return
    setCatalog({
      intents: intents.status === 'fulfilled' ? intents.value : null,
      content: content.status === 'fulfilled' ? content.value : null,
      accounts: accounts.status === 'fulfilled' ? accounts.value : null,
    })
    setLoading(false)
  }, [businessId])

  useEffect(() => {
    alive.current = true
    if (businessId) refresh()
    return () => { alive.current = false; detailGeneration.current += 1 }
  }, [businessId, refresh])

  if (!businessId) return <ScopeNotice />
  const briefs = catalog?.content?.briefs ?? []
  const accounts = catalog?.accounts?.accounts ?? []
  const selectedContent = briefs.find(row => row.id === briefId)
  const selectedAccount = accounts.find(row => row.id === accountId)
  const locked = submitting || uncertain
  const showForm = catalog?.intents?.canWrite && (!detail || editing)

  function reset() {
    detailGeneration.current += 1
    pendingRequest.current = null
    setDetail(null); setEditing(false); setBriefId(''); setAccountId(''); setCode(''); setError(''); setMessage(''); setUncertain(false)
  }

  async function openIntent(id) {
    const generation = ++detailGeneration.current
    setSubmitting(true); setError('')
    try {
      const result = await api(`/api/growth/broadcast-intents/${encodeURIComponent(id)}?businessId=${encodeURIComponent(businessId)}`)
      if (!alive.current || generation !== detailGeneration.current) return
      if (result.businessId !== businessId) throw new Error('รายการไม่ตรงกับ Business ที่เลือก')
      setDetail(result); setEditing(false)
    } catch (requestError) {
      if (alive.current && generation === detailGeneration.current) setError(requestError.message)
    } finally { if (alive.current && generation === detailGeneration.current) setSubmitting(false) }
  }

  async function submit(action, event) {
    event?.preventDefault()
    if (submitting) return
    setSubmitting(true); setError(''); setMessage('')
    try {
      if (!pendingRequest.current) {
        let payload
        if (action !== 'archive') {
          if (!selectedContent?.currentVersion?.id || !selectedContent.currentVersion.payloadHash || selectedContent.status === 'ARCHIVED') throw new Error('เลือกเนื้อหาที่มีเวอร์ชันพร้อมใช้งานก่อนบันทึก')
          if (accountId && !selectedAccount) throw new Error('บัญชี LINE ที่เลือกอ่านไม่ได้ กรุณาโหลดรายการใหม่')
          payload = broadcastPayloadTemplate({ briefId: selectedContent.id, contentVersionId: selectedContent.currentVersion.id,
            payloadHash: selectedContent.currentVersion.payloadHash, lineOaAccountId: selectedAccount?.id ?? '',
            accountVersion: selectedAccount?.version, criteriaHash: CRITERIA_HASH })
        }
        pendingRequest.current = action === 'create'
          ? { path: '/api/growth/broadcast-intents', method: 'POST', body: { businessId, idempotencyKey: `broadcast-${crypto.randomUUID()}`, ...(code.trim() ? { code: code.trim() } : {}), payload } }
          : { path: `/api/growth/broadcast-intents/${detail.id}`, method: 'PATCH', body: { action, businessId, expectedVersion: detail.version, ...(payload ? { payload } : {}) } }
      }
      const request = pendingRequest.current
      const result = await api(request.path, request)
      if (!alive.current) return
      if (result.businessId !== businessId || !result.id || !Number.isInteger(result.currentRevision) || !Array.isArray(result.revisions)) throw new Error('ยังยืนยันผลการบันทึกไม่ได้')
      pendingRequest.current = null
      setUncertain(false); setDetail(result); setEditing(false)
      setMessage(result.status === 'ARCHIVED' ? 'เก็บแผนเข้าคลังแล้ว' : 'บันทึกแผนแล้ว')
      await refresh()
    } catch (requestError) {
      if (!alive.current) return
      if (requestError.status && requestError.status < 500) {
        pendingRequest.current = null; setUncertain(false)
        setError(requestError.status === 409 ? 'รายการเปลี่ยนแล้ว กรุณาเปิดแผนล่าสุดและตรวจทานก่อนแก้ไข' : requestError.message)
      } else {
        setUncertain(Boolean(pendingRequest.current))
        setError(pendingRequest.current ? 'ยังยืนยันการบันทึกไม่ได้ กดลองคำขอเดิมอีกครั้งเพื่อดูผล' : requestError.message)
      }
    } finally { if (alive.current) setSubmitting(false) }
  }

  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING" title="Broadcast planning" subtitle="วางแผนจากเนื้อหาจริงเพื่อทบทวน · Dispatch is unavailable" />
    <p className="mb-4 text-sm text-muted">ยังไม่เปิดการส่ง LINE การคัดผู้รับ และการตรวจความยินยอม ณ เวลาส่ง</p>
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {loading && <Card className="p-4">กำลังโหลดแผนและรายการอ้างอิง…</Card>}
    {!loading && !catalog?.intents && <Card className="p-4">อ่านแผนไม่ได้ <button className="btn" onClick={refresh}>ลองโหลดใหม่</button></Card>}
    {showForm && <Card className="mb-5 p-4"><h2 className="mb-3 font-semibold">{editing ? 'แก้ไขเป็นเวอร์ชันใหม่' : 'สร้างแผนใหม่'}</h2>
      <form onSubmit={event => submit(editing ? 'revise' : 'create', event)} className="grid gap-3 sm:grid-cols-2">
        {!editing && <label className="text-sm">รหัสแผน (ไม่บังคับ)<input aria-label="รหัสแผน" value={code} disabled={locked} onChange={event => setCode(event.target.value)} className={inputClass} /></label>}
        <label className="text-sm">เนื้อหาที่ใช้วางแผน<select aria-label="เนื้อหาที่ใช้วางแผน" required value={briefId} disabled={locked || !catalog?.content} onChange={event => setBriefId(event.target.value)} className={inputClass}><option value="">เลือกเนื้อหา</option>{briefs.filter(row => row.status !== 'ARCHIVED').map(row => <option key={row.id} value={row.id}>{row.title} · {row.code} · v{row.currentRevision}</option>)}</select></label>
        <label className="text-sm">บัญชี LINE OA<select aria-label="บัญชี LINE OA" value={accountId} disabled={locked || !catalog?.accounts} onChange={event => setAccountId(event.target.value)} className={inputClass}><option value="">ยังไม่เลือกบัญชี</option>{accounts.filter(row => row.status !== 'ARCHIVED').map(row => <option key={row.id} value={row.id}>{row.displayName} · {row.code}</option>)}</select></label>
        <button type={uncertain ? 'button' : 'submit'} onClick={uncertain ? () => submit(editing ? 'revise' : 'create') : undefined} className={buttonClass} disabled={submitting || (!uncertain && !selectedContent)}>{submitting ? 'กำลังบันทึก…' : uncertain ? 'ลองคำขอเดิมอีกครั้ง' : 'บันทึกแผน'}</button>
      </form>
      {!catalog?.content && <p className="mt-3 text-sm">อ่านรายการ Content ไม่ได้ <button className="btn" onClick={refresh} disabled={locked}>โหลดรายการใหม่</button></p>}
      {catalog?.content && !briefs.length && <p className="mt-3 text-sm">ยังไม่มีเนื้อหาใน Business นี้ <a className="underline" href="/growth/content">เปิด Content</a></p>}
      {!catalog?.accounts && <p className="mt-3 text-sm">อ่านบัญชี LINE ไม่ได้ สามารถเก็บแผนโดยยังไม่เลือกบัญชี</p>}
      {selectedContent && <p className="mt-3 text-sm text-muted">ใช้เวอร์ชัน {selectedContent.currentRevision} · {selectedContent.approval?.valid ? 'Content อนุมัติแล้ว' : 'Content ยังไม่พร้อมเผยแพร่'} · การเก็บแผนไม่ใช่การอนุมัติส่ง</p>}
    </Card>}
    {detail && <Card className="mb-5 p-4" data-testid="broadcast-detail"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{detail.code}</h2><StatusPill status={detail.status} /></div>
      <p className="mt-2 text-sm">เวอร์ชันแผน {detail.currentRevision} · {detail.referenceState?.state === 'READY' ? 'ข้อมูลอ้างอิงตรงกับเวอร์ชันปัจจุบัน' : 'ข้อมูลอ้างอิงบางส่วนไม่พร้อมใช้ ต้องตรวจทานก่อนดำเนินการต่อ'}</p>
      <h3 className="mt-4 text-sm font-semibold">ประวัติเวอร์ชัน</h3><ul className="mt-2 space-y-2 text-sm">{detail.revisions?.map(row => <li key={row.id} className="rounded-lg border border-[var(--border)] p-2">เวอร์ชัน {row.revision} · {new Date(row.createdAt).toLocaleString('th-TH')} · {briefs.find(brief => brief.id === row.payload?.content?.briefId)?.title || 'อ่านชื่อเนื้อหาไม่ได้'}</li>)}</ul>
      <div className="mt-4 flex flex-wrap gap-2">{detail.canWrite && <><button className="btn" disabled={locked || detail.currentVersion?.state !== 'READY' || !detail.currentVersion?.payload?.content?.briefId} onClick={() => { setBriefId(detail.currentVersion.payload.content.briefId); setAccountId(detail.currentVersion.payload.account?.lineOaAccountId ?? ''); setEditing(true); setError('') }}>แก้ไขแผน</button><button className="btn" disabled={locked} onClick={() => submit('archive')}>เก็บแผนเข้าคลัง</button></>}
        <button className="btn" disabled={locked} onClick={() => openIntent(detail.id)}>เปิดแผนล่าสุด</button><button className="btn" disabled={locked} onClick={reset}>สร้างแผนใหม่</button>
        {uncertain && !showForm && <button className={buttonClass} disabled={submitting} onClick={() => submit('archive')}>ลองคำขอเดิมอีกครั้ง</button>}
      </div>
    </Card>}
    {catalog?.intents && <Card className="p-4"><h2 className="mb-3 font-semibold">แผนที่บันทึกไว้</h2>{catalog.intents.intents.length ? <div className="space-y-2">{catalog.intents.intents.map(intent => <button key={intent.id} className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-left text-sm disabled:opacity-50" disabled={locked} onClick={() => openIntent(intent.id)}><span>{intent.code} · เวอร์ชัน {intent.currentRevision}</span><StatusPill status={intent.status} /></button>)}</div> : <p className="text-sm text-muted">ยังไม่มีแผนใน Business นี้</p>}</Card>}
  </main>
}
