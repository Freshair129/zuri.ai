'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'

// @req FR-182 — the Reservations view of the SCM operations console.
// @req FR-180 — what is already promised, and what is therefore still ours to
//   sell. The table shows on-hand, committed, quote-held and available side by
//   side, because "why can we only promise 300" is the next question every
//   time. `live` is computed by the server on read: a hold whose clock ran out
//   is already spent even though its stored status is still ACTIVE (BR-031).
// @spec ADR-074 D8; BR-031; SEC-001
// @tested tests/unit/scm-console-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const PURPOSE_LABEL = { QUOTE: 'ใบเสนอราคา (หมดอายุได้)', ORDER: 'คำสั่งขายที่ยืนยันแล้ว' }
const STATUS_LABEL = { ACTIVE: 'ถืออยู่', RELEASED: 'ปล่อยแล้ว', CONVERTED: 'แปลงเป็นออเดอร์', EXPIRED: 'หมดอายุ' }

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}

function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

function useForm(initial) {
  const [values, setValues] = useState(initial)
  const bind = (name) => ({ name, value: values[name] ?? '', onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })) })
  return [values, bind, () => setValues(initial)]
}

export default function InventoryReservationsPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [atp, setAtp] = useState(null)
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setAtp(null); setRows([]); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const [availability, reservations] = await Promise.all([api(`/api/inventory/atp?${q}`), api(`/api/inventory/reservations?${q}`)])
    setAtp(availability); setRows(reservations)
  }, [businessId])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  const [hold, bindHold, resetHold] = useForm({ productId: '', quantity: '', purpose: 'QUOTE', customerCompany: '', quoteReference: '', holdDays: '7' })

  async function submit(fn) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await fn(); setMessage(result); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const counted = (atp?.products ?? []).filter((p) => p.available !== null)

  const place = () => submit(async () => {
    const row = await api('/api/inventory/reservations', 'POST', {
      businessId,
      productId: hold.productId || counted[0]?.productId,
      quantity: Number(hold.quantity),
      purpose: hold.purpose,
      ...(hold.customerCompany ? { customerCompany: hold.customerCompany } : {}),
      ...(hold.quoteReference ? { quoteReference: hold.quoteReference } : {}),
      ...(hold.purpose === 'QUOTE' && hold.holdDays ? { holdDays: Number(hold.holdDays) } : {}),
    })
    resetHold()
    return `จอง ${row.code} · ${row.quantity} หน่วย${row.expiresAt ? ` · ถึง ${new Date(row.expiresAt).toLocaleDateString('th-TH')}` : ''}`
  })

  const release = (row) => submit(async () => {
    const result = await api(`/api/inventory/reservations/${row.id}`, 'PATCH', { businessId, action: 'RELEASE', version: row.version })
    return `ปล่อย ${result.released?.code ?? row.code} แล้ว — ของกลับไปพร้อมขาย`
  })

  const atpColumns = [
    { key: 'code', label: 'SKU', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'onHand', label: 'คงเหลือจริง', render: (r) => r.onHand === null ? '—' : r.onHand },
    { key: 'committed', label: 'ผูกออเดอร์แล้ว' },
    { key: 'reservedForQuotes', label: 'ถือให้ใบเสนอราคา' },
    { key: 'available', label: 'ขายได้อีก', render: (r) => r.available === null ? <span className="text-muted">—</span> : <strong>{r.available}</strong> },
    { key: 'overCommitted', label: 'เกินตัว', render: (r) => r.overCommitted ? <span style={{ color: 'var(--danger)' }}>{r.overCommitted}</span> : '—' },
  ]

  const reservationColumns = [
    { key: 'code', label: 'เลขที่', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'purpose', label: 'ประเภท', render: (r) => PURPOSE_LABEL[r.purpose] || r.purpose },
    { key: 'quantity', label: 'จำนวน' },
    { key: 'customerCompany', label: 'ลูกค้า', render: (r) => r.customerCompany || '—' },
    { key: 'expiresAt', label: 'หมดอายุ', render: (r) => r.expiresAt ? new Date(r.expiresAt).toLocaleDateString('th-TH') : '—' },
    { key: 'status', label: 'สถานะ', render: (r) => `${STATUS_LABEL[r.status] || r.status}${r.status === 'ACTIVE' && !r.live ? ' (หมดเวลาแล้ว)' : ''}` },
    {
      key: 'actions',
      label: 'ดำเนินการ',
      render: (r) => r.status === 'ACTIVE'
        ? <button type="button" className="btn btn-xs" onClick={() => release(r)} disabled={busy}>ปล่อย</button>
        : <span className="text-muted">—</span>,
    },
  ]

  const liveHolds = rows.filter((r) => r.live).length

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-025"
      title="ของที่ขายได้และการจองสต็อก"
      subtitle={`ATP = คงเหลือ − ผูกออเดอร์ − ถือให้ใบเสนอราคา · การจองไม่เขียน ledger${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูของที่ขายได้</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {atp && <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Kpi label="SKU ที่นับสต๊อก" value={counted.length} />
      <Kpi label="การจองที่ยังถืออยู่" value={liveHolds} meta="หมดอายุคำนวณตอนอ่าน ไม่ต้องรอ worker" />
      <Kpi label="SKU ที่รับปากเกินตัว" value={counted.filter((p) => p.overCommitted > 0).length} tone={counted.some((p) => p.overCommitted > 0) ? 'bad' : 'good'} />
    </div>}

    {atp && <div className="mb-4">
      <SectionTitle caption="สินค้าไม่นับสต๊อกแสดง — ไม่ใช่ 0 เพราะไม่มี ledger ให้ลบ">ของที่ยังรับปากได้ (ATP)</SectionTitle>
      <DataTable columns={atpColumns} rows={atp.products} rowKey={(r) => r.productId} />
    </div>}

    {business && <div className="mb-4">
      <SectionTitle caption="การจองไม่ถูกลบ — จบที่ ปล่อยแล้ว / แปลงเป็นออเดอร์ / หมดอายุ เพื่อให้ย้อนดูได้ว่าทำไมวันนั้นรับปากไม่ได้">รายการจอง</SectionTitle>
      <DataTable columns={reservationColumns} rows={rows} rowKey={(r) => r.id} />
    </div>}

    {business && <Card>
      <SectionTitle caption="เกินกว่าที่ยังว่างจะถูกปฏิเสธ — นั่นคือเหตุผลที่ระบบนี้มีอยู่">จองสต็อก</SectionTitle>
      <fieldset disabled={busy || !counted.length} className="grid gap-3 md:grid-cols-3">
        <Select label="SKU" options={counted.map((p) => [p.productId, `${p.code} · ว่าง ${p.available}`])} {...bindHold('productId')} />
        <Input label="จำนวน" type="number" min="1" {...bindHold('quantity')} />
        <Select label="ประเภท" options={[['QUOTE', PURPOSE_LABEL.QUOTE], ['ORDER', PURPOSE_LABEL.ORDER]]} {...bindHold('purpose')} />
        <Input label="บริษัทลูกค้า" {...bindHold('customerCompany')} />
        <Input label="อ้างอิงใบเสนอราคา" placeholder="QT-2026-0912" {...bindHold('quoteReference')} />
        {hold.purpose === 'QUOTE' && <Input label="ถือกี่วัน" type="number" min="1" max="90" {...bindHold('holdDays')} />}
      </fieldset>
      {!counted.length && <p className="mt-2 text-xs text-muted">ยังไม่มี SKU แบบนับสต๊อก</p>}
      <div className="mt-3"><button type="button" className="btn btn-primary" onClick={place} disabled={busy || !hold.quantity || !counted.length}>จองสต็อก</button></div>
    </Card>}
  </div>
}
