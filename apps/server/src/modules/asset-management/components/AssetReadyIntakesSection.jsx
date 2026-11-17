'use client'

// @req FR-133, FR-135 — register a ready intake from the Asset Register workspace.
// @spec SDD-080, BR-023, SEC-023
// @tested tests/unit/asset-scanner-ui.test.js
import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui'

async function responsePayload(response) {
  try {
    const payload = await response.json()
    return payload && typeof payload === 'object' ? payload : {}
  } catch {
    return {}
  }
}

export default function AssetReadyIntakesSection({ business, onRegistered }) {
  const [items, setItems] = useState([])
  const [assetCodes, setAssetCodes] = useState({})
  const [loading, setLoading] = useState(true)
  const [submittingId, setSubmittingId] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const submissionLock = useRef(false)

  useEffect(() => {
    if (!business?.id) {
      setItems([])
      setLoading(false)
      return undefined
    }

    let active = true
    setItems([])
    setAssetCodes({})
    setSuccess('')

    async function loadReadyIntakes() {
      setLoading(true)
      setError('')
      const params = new URLSearchParams({
        businessId: business.id,
        status: 'READY_FOR_REGISTRATION',
      })

      try {
        const response = await fetch('/api/assets/intakes?' + params.toString())
        const payload = await responsePayload(response)
        if (!response.ok) throw new Error(payload.error || 'โหลดรายการรับเข้าไม่สำเร็จ')
        if (active) setItems(Array.isArray(payload.items) ? payload.items : [])
      } catch (loadError) {
        if (active) setError(loadError.message || 'โหลดรายการรับเข้าไม่สำเร็จ')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadReadyIntakes()
    return () => {
      active = false
    }
  }, [business?.id])

  async function registerIntake(intake) {
    if (submissionLock.current || !business?.id) return
    submissionLock.current = true
    setSubmittingId(intake.id)
    setError('')
    setSuccess('')

    try {
      const assetCode = assetCodes[intake.id]?.trim()
      const response = await fetch('/api/assets/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          intakeId: intake.id,
          ...(assetCode ? { assetCode } : {}),
        }),
      })
      const payload = await responsePayload(response)
      if (!response.ok) throw new Error(payload.error || 'ลงทะเบียนทรัพย์สินไม่สำเร็จ')

      setItems((current) => current.filter((item) => item.id !== intake.id))
      setSuccess('ลงทะเบียนแล้ว' + (payload.asset?.assetCode ? ' · รหัสทรัพย์สิน ' + payload.asset.assetCode : ''))
      setAssetCodes((current) => {
        const next = { ...current }
        delete next[intake.id]
        return next
      })
      await onRegistered?.()
    } catch (submitError) {
      setError(submitError.message || 'ลงทะเบียนทรัพย์สินไม่สำเร็จ')
    } finally {
      submissionLock.current = false
      setSubmittingId(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">รายการรับเข้าที่พร้อมลงทะเบียน</h2>
          <p className="mt-1 text-xs text-muted">เลือกรายการที่ตรวจหลักฐานครบแล้วเพื่อออก Asset ID</p>
        </div>
        <span className="rounded-full bg-[var(--surface-subtle)] px-2.5 py-1 text-[11px] font-semibold text-muted">
          {items.length} รายการ
        </span>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {success && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</p>}

      {loading ? (
        <p className="mt-4 text-xs text-muted">กำลังโหลดรายการรับเข้า...</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-muted">ไม่มีรายการที่พร้อมลงทะเบียน</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {items.map((intake) => (
            <li key={intake.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{intake.name || 'ไม่ระบุชื่อรายการ'}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {[intake.code, intake.categoryCode, intake.serialNumber].filter(Boolean).join(' · ') || 'ไม่มีรหัสหรือรายละเอียดเพิ่มเติม'}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  ราคาทุน: {intake.cost ? intake.cost + (intake.currency ? ' ' + intake.currency : '') : '-'}
                  {' · '}รับเข้า {intake.createdAt ? new Date(intake.createdAt).toLocaleDateString('th-TH') : '-'}
                </p>
              </div>
              <input
                type="text"
                value={assetCodes[intake.id] || ''}
                onChange={(event) => setAssetCodes((current) => ({ ...current, [intake.id]: event.target.value }))}
                placeholder="รหัสทรัพย์สิน (ถ้ากำหนดเอง)"
                aria-label={'รหัสทรัพย์สินสำหรับ ' + (intake.name || intake.code || intake.id)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs lg:w-56"
              />
              <button
                type="button"
                onClick={() => registerIntake(intake)}
                disabled={submittingId !== null}
                className="btn btn-primary whitespace-nowrap px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingId === intake.id ? 'กำลังลงทะเบียน...' : 'ลงทะเบียนทรัพย์สิน'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
