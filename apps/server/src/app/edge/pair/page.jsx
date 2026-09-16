'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Monitor, LoaderCircle } from 'lucide-react'
import EntryShell from '@/components/layouts/EntryShell'

// @req FR-144 — phone/browser approval, scoped Business choice and no credential in this surface.
// @spec SEC-001, SEC-008, SEC-025
// @tested tests/e2e/edge-pairing.spec.js
const STORAGE = 'zuri.edge.pairing.approval'
const TOKEN = /^[\w-]{43}$/
const messages = {
  PAIRING_EXPIRED_OR_UNAVAILABLE: 'คำขอนี้หมดอายุแล้ว กรุณากดเชื่อมต่อใหม่บน Desktop',
  PAIRING_ALREADY_DECIDED: 'คำขอนี้ได้รับการยืนยันหรือยกเลิกแล้ว',
  PAIRING_ORIGIN_REFUSED: 'ที่อยู่เว็บไม่ตรงกับเซิร์ฟเวอร์ที่ตั้งไว้ กรุณาติดต่อผู้ดูแล',
  PAIRING_BUSY_TRY_LATER: 'มีคำขอจำนวนมาก กรุณาลองใหม่สักครู่',
}
export default function EdgePairPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [request, setRequest] = useState(null)
  const [businessId, setBusinessId] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now())

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const fragment = window.location.hash.slice(1)
        if (TOKEN.test(fragment)) {
          sessionStorage.setItem(STORAGE, fragment)
          history.replaceState(null, '', '/edge/pair')
        }
        const token = sessionStorage.getItem(STORAGE) || ''
        if (!TOKEN.test(token)) throw new Error('กรุณากดเชื่อมต่อ Zuri จาก Desktop หรือสแกน QR ใหม่')
        setCode(token)
        const response = await fetch('/api/edge/pairing/approve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'inspect', code: token }), cache: 'no-store',
        })
        if (!active) return
        if (response.status === 401) { router.replace('/login?next=/edge/pair'); return }
        const body = await response.json()
        if (response.status === 410 || (response.ok && body.state !== 'PENDING')) sessionStorage.removeItem(STORAGE)
        if (!response.ok) throw new Error(messages[body.error] || 'ไม่สามารถอ่านคำขอได้ กรุณาลองเชื่อมต่อใหม่')
        setRequest(body)
        if (body.businesses?.length === 1) setBusinessId(body.businesses[0].id)
      } catch (failure) { if (active) setError(failure.message) }
      finally { if (active) setBusy(false) }
    }
    load()
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => { active = false; clearInterval(timer) }
  }, [router])

  async function decide(action) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/edge/pairing/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, code, businessId }), cache: 'no-store',
      })
      if (response.status === 401) { router.replace('/login?next=/edge/pair'); return }
      const body = await response.json()
      if ([409, 410].includes(response.status)) sessionStorage.removeItem(STORAGE)
      if (!response.ok) throw new Error(messages[body.error] || 'ยืนยันไม่สำเร็จ กรุณาตรวจสิทธิ์และลองใหม่')
      setRequest(body)
      sessionStorage.removeItem(STORAGE)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  const remaining = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - clock) / 1000)) : 0
  const approved = ['APPROVED', 'REDEEMING', 'CONSUMED'].includes(request?.state)
  const pending = request?.state === 'PENDING'
  return (
    <EntryShell backdrop>
      <div className="flex items-center gap-3 text-amber-700"><Monitor aria-hidden="true" /><span className="font-semibold">Zuri Edge Device</span></div>
      <h1 className="mt-5 text-2xl font-bold">{approved ? 'ยืนยันการเชื่อมต่อแล้ว' : 'เชื่อมต่อเครื่องนี้กับ Zuri'}</h1>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={18} />กำลังตรวจสอบ…</p>}
      {approved && <div role="status" className="mt-5 space-y-3">
        <CheckCircle2 className="text-green-700" size={36} />
        <p>กลับไปที่ Desktop ได้เลย แอปจะรับการเชื่อมต่อให้อัตโนมัติ</p>
        <p className="text-sm text-muted">ตรวจสถานะพร้อมรับงานต่อบน Desktop</p>
      </div>}
      {request?.state === 'DENIED' && <p role="status" className="mt-5">ยกเลิกคำขอแล้ว ไม่มีการออกกุญแจให้เครื่องนี้</p>}
      {request?.state === 'CANCELLED' && <p role="status" className="mt-5">Desktop ยกเลิกคำขอนี้แล้ว</p>}
      {pending && <div className="mt-5 space-y-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold">{request.label}</p>
          <p className="mt-1 break-all text-xs text-muted">{request.deviceId}</p>
          <p className="mt-4 text-sm">ตรวจว่ารหัสตรงกับที่แสดงบน Desktop</p>
          <p className="mt-1 font-mono text-3xl tracking-widest" data-testid="pairing-check-code">{request.checkCode}</p>
        </div>
        <label className="block text-sm font-medium" htmlFor="pairing-business">ธุรกิจที่ต้องการเชื่อมต่อ</label>
        <select id="pairing-business" value={businessId} onChange={event => setBusinessId(event.target.value)}
          className="min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3" disabled={busy || !remaining}>
          <option value="">เลือกธุรกิจ</option>
          {request.businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
        </select>
        {!request.businesses.length && <p className="text-sm text-red-700">บัญชีนี้ไม่มีสิทธิ์จับคู่อุปกรณ์ กรุณาให้เจ้าของธุรกิจยืนยัน</p>}
        <p role="status" className="text-sm text-muted">{remaining ? 'คำขอหมดอายุใน ' + Math.ceil(remaining / 60) + ' นาที' : 'คำขอหมดอายุแล้ว กรุณากดเชื่อมต่อใหม่บน Desktop'}</p>
        <button onClick={() => decide('approve')} disabled={busy || !businessId || !remaining}
          className="min-h-12 w-full rounded-lg bg-amber-600 px-4 font-semibold text-white hover:bg-amber-700 disabled:opacity-40">ยืนยันเชื่อมต่อเครื่องนี้</button>
        <button onClick={() => decide('deny')} disabled={busy || !remaining}
          className="min-h-11 w-full rounded-lg border border-[var(--border)] px-4 disabled:opacity-40">ยกเลิก</button>
      </div>}
    </EntryShell>
  )
}
