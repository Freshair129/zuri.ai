'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, LoaderCircle, TerminalSquare } from 'lucide-react'
import EntryShell from '@/components/layouts/EntryShell'

// @req FR-220 — a signed-in person approves a Claude Code or Codex installation
// for themselves after checking the code and the device label; this page never
// sees or shows a credential.
// @spec ADR-087 D1, D2; SEC-001, SEC-008, SEC-025
// @tested tests/unit/harness-credential.test.js
const STORAGE = 'zuri.harness.pairing.approval'
const TOKEN = /^[\w-]{43}$/
const HARNESS_NAME = { CLAUDE_CODE: 'Claude Code', CODEX: 'Codex' }
const messages = {
  PAIRING_EXPIRED_OR_UNAVAILABLE: 'คำขอนี้หมดอายุแล้ว กรุณาสั่ง pair ใหม่จากเครื่องที่ใช้ agent',
  PAIRING_ALREADY_DECIDED: 'คำขอนี้ได้รับการยืนยันหรือยกเลิกแล้ว',
  PAIRING_ORIGIN_REFUSED: 'ที่อยู่เว็บไม่ตรงกับเซิร์ฟเวอร์ที่ตั้งไว้ กรุณาติดต่อผู้ดูแล',
  PAIRING_BUSY_TRY_LATER: 'มีคำขอจำนวนมาก กรุณาลองใหม่สักครู่',
  HARNESS_PAIRING_NOT_ALLOWED: 'บัญชีนี้ยังไม่มีสิทธิ์จับคู่เครื่อง ต้องเป็นสมาชิกของธุรกิจอย่างน้อยหนึ่งแห่ง',
}

export default function HarnessPairPage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [request, setRequest] = useState(null)
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
          history.replaceState(null, '', '/harness/pair')
        }
        const token = sessionStorage.getItem(STORAGE) || ''
        if (!TOKEN.test(token)) throw new Error('กรุณาสั่ง pair จาก Claude Code หรือ Codex แล้วเปิดลิงก์ที่ได้อีกครั้ง')
        setCode(token)
        const response = await fetch('/api/platform/harness-pairing/approve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'inspect', code: token }), cache: 'no-store',
        })
        if (!active) return
        if (response.status === 401) { router.replace('/login?next=/harness/pair'); return }
        const body = await response.json()
        if (response.status === 410 || (response.ok && body.state !== 'PENDING')) sessionStorage.removeItem(STORAGE)
        if (!response.ok) throw new Error(messages[body.error] || 'อ่านคำขอไม่ได้ กรุณาสั่ง pair ใหม่')
        setRequest(body)
      } catch (failure) {
        if (active) setError(failure.message)
      } finally {
        if (active) setBusy(false)
      }
    }
    load()
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => { active = false; clearInterval(timer) }
  }, [router])

  async function decide(action) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/platform/harness-pairing/approve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, code }), cache: 'no-store',
      })
      if (response.status === 401) { router.replace('/login?next=/harness/pair'); return }
      const body = await response.json()
      if ([409, 410].includes(response.status)) sessionStorage.removeItem(STORAGE)
      if (!response.ok) throw new Error(messages[body.error] || 'ยืนยันไม่สำเร็จ กรุณาลองใหม่')
      setRequest((prior) => ({ ...prior, ...body }))
      sessionStorage.removeItem(STORAGE)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const remaining = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - clock) / 1000)) : 0
  const approved = request?.state === 'APPROVED'
  const pending = request?.state === 'PENDING'
  return (
    <EntryShell backdrop>
      <div className="flex items-center gap-3 text-amber-700"><TerminalSquare aria-hidden="true" /><span className="font-semibold">Zuri harness plugin</span></div>
      <h1 className="mt-5 text-2xl font-bold">{approved ? 'จับคู่เครื่องแล้ว' : 'จับคู่เครื่องนี้ให้ส่งยอด token ในนามคุณ'}</h1>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="mt-4 flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={18} />กำลังตรวจสอบ…</p>}
      {approved && (
        <div role="status" className="mt-5 space-y-3" data-testid="harness-pair-approved">
          <CheckCircle2 className="text-green-700" size={36} />
          <p>กลับไปที่ terminal ได้เลย plugin จะรับการจับคู่ให้อัตโนมัติ</p>
          <p className="text-sm text-muted">ถ้าคุณไม่ใช่ operator เครื่องนี้จะส่งยอดได้หลัง operator เปิดใช้งานใน /control/roadmap</p>
        </div>
      )}
      {request?.state === 'DENIED' && <p role="status" className="mt-5">ยกเลิกคำขอแล้ว ไม่มีการออกกุญแจให้เครื่องนี้</p>}
      {request?.state === 'CANCELLED' && <p role="status" className="mt-5">เครื่องนั้นยกเลิกคำขอนี้แล้ว</p>}
      {pending && (
        <div className="mt-5 space-y-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="harness-pair-request">
            <p className="font-semibold">{request.deviceLabel}{request.osUser ? ` · ${request.osUser}` : ''}</p>
            <p className="mt-1 text-xs text-muted">{HARNESS_NAME[request.harness] || request.harness} · จะส่งยอดในนาม <b>{request.person}</b></p>
            <p className="mt-4 text-sm">ตรวจว่ารหัสตรงกับที่แสดงใน terminal</p>
            <p className="mt-1 font-mono text-3xl tracking-widest" data-testid="harness-pair-check-code">{request.checkCode}</p>
          </div>
          <p className="text-sm text-muted">กุญแจที่ออกให้ส่งยอดการใช้ token ได้อย่างเดียว อ่านหรือแก้ข้อมูลธุรกิจไม่ได้ และ operator เพิกถอนได้ทุกเมื่อ</p>
          {!request.allowed && <p className="text-sm text-red-700">{messages.HARNESS_PAIRING_NOT_ALLOWED}</p>}
          <p role="status" className="text-sm text-muted">{remaining ? `คำขอหมดอายุใน ${Math.ceil(remaining / 60)} นาที` : 'คำขอหมดอายุแล้ว กรุณาสั่ง pair ใหม่'}</p>
          <button type="button" onClick={() => decide('approve')} disabled={busy || !remaining || !request.allowed}
            className="min-h-12 w-full rounded-lg bg-amber-600 px-4 font-semibold text-white hover:bg-amber-700 disabled:opacity-40">ยืนยันจับคู่เครื่องนี้</button>
          <button type="button" onClick={() => decide('deny')} disabled={busy || !remaining}
            className="min-h-11 w-full rounded-lg border border-[var(--border)] px-4 disabled:opacity-40">ยกเลิก</button>
        </div>
      )}
    </EntryShell>
  )
}
