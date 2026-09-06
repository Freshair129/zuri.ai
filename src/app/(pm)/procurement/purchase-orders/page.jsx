'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { PURCHASE_ORDER_ACTIONS } from '@/lib/validation/enums'

// @req FR-164 — the purchase-orders console: create an order against a
//   supplier (lines that may name an inventory SKU at the agreed cost), send
//   it, short-close it, cancel it; every money figure and every received /
//   outstanding quantity comes from the server's read, never from the page.
// @req FR-165 — post a goods receipt against a sent order, line by line (a
//   lot code and expiry for a LOT-tracked SKU, serials for a SERIAL-tracked
//   one), and see the order's receipt state and the Warehouse's on-hand follow.
// @spec ADR-066; SEC-001 — every request names the selected Business as a
//   selector the server validates against the trusted viewer.
// @tested tests/e2e/fr164-procurement.spec.js, tests/unit/procurement-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const STATUS_LABEL = { DRAFT: 'ร่าง', SENT: 'ส่งผู้ขายแล้ว', RECEIVED: 'รับของครบแล้ว', CLOSED: 'ปิดแล้ว', CANCELLED: 'ยกเลิก' }
const RECEIPT_STATE_LABEL = { NONE: 'ยังไม่รับ', PARTIAL: 'รับบางส่วน', COMPLETE: 'รับครบ' }
// Row buttons, derived from the action registry: which actions an order offers depends on its status and whether anything was received.
const isOpen = (o) => o.status === 'DRAFT' || o.status === 'SENT'
const ORDER_ACTION_UI = {
  SEND: { label: 'ส่งให้ผู้ขาย', primary: true, when: (o) => o.status === 'DRAFT' },
  CLOSE: { label: 'ปิดใบสั่งซื้อ', when: (o) => o.status === 'SENT' },
  CANCEL: { label: 'ยกเลิก', when: (o) => isOpen(o) && o.receiptCount === 0 },
}
const baht = (n) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)
const FILTERS = [['open', 'ที่เปิดอยู่', ''], ['all', 'ทั้งหมด', '&includeClosed=true']]
const splitSerials = (text) => (text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}
function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

const emptyLine = () => ({ productId: '', description: '', qty: '1', unitCost: '' })

export default function PurchaseOrdersPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [filter, setFilter] = useState('open')
  const [data, setData] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [openId, setOpenId] = useState(null)
  const [form, setForm] = useState({ supplierId: '', expectedAt: '', notes: '' })
  const [lines, setLines] = useState([emptyLine()])
  const [receipt, setReceipt] = useState({ supplierReference: '', lines: {} })
  const bindForm = (name) => ({ name, value: form[name] ?? '', onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })) })

  const refresh = useCallback(async () => {
    if (!businessId) { setData(null); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const extra = FILTERS.find(([key]) => key === filter)?.[2] ?? ''
    const [orders, vendors, skus] = await Promise.all([
      api(`/api/procurement/purchase-orders?${q}${extra}`),
      api(`/api/procurement/suppliers?${q}`).catch(() => []),
      api(`/api/inventory/products?${q}`).catch(() => []),
    ])
    setData(orders); setSuppliers(Array.isArray(vendors) ? vendors : []); setProducts(Array.isArray(skus) ? skus : [])
    setForm((f) => (f.supplierId || !vendors?.length ? f : { ...f, supplierId: vendors[0].id }))
  }, [businessId, filter])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  async function run(fn) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { setMessage(await fn()); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const setLine = (i, name, value) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [name]: value } : l)))
  const setReceiptLine = (lineId, name, value) => setReceipt((r) => ({ ...r, lines: { ...r.lines, [lineId]: { ...(r.lines[lineId] || {}), [name]: value } } }))

  const create = () => run(async () => {
    const order = await api('/api/procurement/purchase-orders', 'POST', {
      businessId, supplierId: form.supplierId,
      ...(form.expectedAt ? { expectedAt: form.expectedAt } : {}), ...(form.notes ? { notes: form.notes } : {}),
      lines: lines.filter((l) => l.productId || l.description).map((l) => ({
        ...(l.productId ? { productId: l.productId } : {}), ...(l.description ? { description: l.description } : {}),
        qty: Number(l.qty || 1), unitCost: Number(l.unitCost || 0),
      })),
    })
    setLines([emptyLine()]); setForm((f) => ({ ...f, expectedAt: '', notes: '' }))
    return `สร้างใบสั่งซื้อ ${order.code} ยอดรวม ${baht(order.total)} บาท`
  })

  const act = (order, action) => run(async () => {
    const result = await api(`/api/procurement/purchase-orders/${order.id}`, 'PATCH', { action, version: order.version })
    return `${result.code}: ${STATUS_LABEL[result.status]}`
  })

  const post = (order) => run(async () => {
    const entries = Object.entries(receipt.lines).filter(([, v]) => Number(v.qty) > 0)
    const result = await api(`/api/procurement/purchase-orders/${order.id}/receipts`, 'POST', {
      ...(receipt.supplierReference ? { supplierReference: receipt.supplierReference } : {}),
      lines: entries.map(([purchaseOrderLineId, v]) => ({
        purchaseOrderLineId, qty: Number(v.qty),
        ...(v.lotCode ? { lotCode: v.lotCode } : {}), ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}),
        ...(splitSerials(v.serialNos).length ? { serialNos: splitSerials(v.serialNos) } : {}),
      })),
    })
    setReceipt({ supplierReference: '', lines: {} })
    return `บันทึกรับของ ${result.receipt.code} · ${result.order.code} ${RECEIPT_STATE_LABEL[result.order.receiptState]}`
  })

  const columns = [
    { key: 'code', label: 'รหัส', render: (o) => <button type="button" className="font-mono text-xs underline" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{o.code}</button> },
    { key: 'supplier', label: 'ผู้ขาย', render: (o) => o.supplier?.name || '—' },
    { key: 'total', label: 'ยอดรวม', render: (o) => baht(o.total) },
    { key: 'receiptState', label: 'การรับของ', render: (o) => <span style={{ color: o.receiptState === 'COMPLETE' ? 'var(--success)' : 'inherit' }}>{RECEIPT_STATE_LABEL[o.receiptState]}{o.receiptState !== 'NONE' ? ` (${baht(o.receivedValue)})` : ''}</span> },
    { key: 'expectedAt', label: 'กำหนดส่ง', render: (o) => o.expectedAt ? new Date(o.expectedAt).toLocaleDateString('th-TH') : '—' },
    { key: 'status', label: 'สถานะ', render: (o) => STATUS_LABEL[o.status] || o.status },
    { key: 'actions', label: '', render: (o) => <div className="flex flex-wrap gap-1">
      {PURCHASE_ORDER_ACTIONS.filter((a) => ORDER_ACTION_UI[a]?.when(o)).map((a) => (
        <button key={a} type="button" className={`btn px-2 py-1 text-xs ${ORDER_ACTION_UI[a].primary ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act(o, a)}>{ORDER_ACTION_UI[a].label}</button>
      ))}
    </div> },
  ]

  const open = data?.orders.find((o) => o.id === openId)
  const receivable = open?.status === 'SENT'
  const anyQty = Object.values(receipt.lines).some((v) => Number(v.qty) > 0)

  return <div>
    <PageHeader
      eyebrow="Procurement · FEAT-024"
      title="ใบสั่งซื้อ (Purchase Orders)"
      subtitle={`สั่งซื้อจากผู้ขาย รับของเข้าคลัง — ยอดที่รับแล้วและค้างรับคำนวณจากใบรับของทุกครั้ง${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูใบสั่งซื้อ</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {data && <div className="mb-4 grid gap-3 md:grid-cols-4">
      <Kpi label="ใบสั่งซื้อที่เปิดอยู่" value={data.summary.open} />
      <Kpi label="รอรับของ" value={data.summary.awaitingDelivery} tone={data.summary.awaitingDelivery ? 'warn' : undefined} />
      <Kpi label="รับบางส่วน" value={data.summary.partiallyReceived} />
      <Kpi label="มูลค่าที่ยังไม่ได้รับ" value={baht(data.summary.outstandingValue)} />
    </div>}

    {business && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="ตัวกรอง">
      {FILTERS.map(([key, label]) => <button key={key} type="button" className={`btn px-3 py-1 text-xs ${filter === key ? 'btn-primary' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
    </div>}

    {data && <div className="mb-4">
      <SectionTitle caption="คลิกรหัสเพื่อดูรายการ ใบรับของ และบันทึกรับของ">รายการใบสั่งซื้อ</SectionTitle>
      <DataTable columns={columns} rows={data.orders} rowKey={(o) => o.id} />
    </div>}

    {open && <Card className="mb-4">
      <SectionTitle caption={`${open.code} · ${STATUS_LABEL[open.status]} · ${open.supplier?.name ?? ''} · ยอดรวม ${baht(open.total)} · รับแล้ว ${baht(open.receivedValue)} · ค้างรับ ${baht(open.outstandingValue)}`}>รายละเอียดใบสั่งซื้อ</SectionTitle>
      <DataTable columns={[
        { key: 'description', label: 'รายการ', render: (l) => <span>{l.description}{l.product ? <span className="ml-1 font-mono text-xs text-muted">{l.product.code}{l.product.counted ? '' : ' · ไม่นับสต๊อก'}</span> : null}</span> },
        { key: 'qty', label: 'สั่ง' },
        { key: 'receivedQty', label: 'รับแล้ว' },
        { key: 'outstandingQty', label: 'ค้างรับ' },
        { key: 'unitCost', label: 'ต้นทุน/หน่วย', render: (l) => baht(l.unitCost) },
        { key: 'lineTotal', label: 'รวม', render: (l) => baht(l.lineTotal) },
      ]} rows={open.lines} rowKey={(l) => l.id} />
      <h3 className="mt-4 text-sm font-bold">ใบรับของ (GRN)</h3>
      <DataTable columns={[
        { key: 'code', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
        { key: 'receivedAt', label: 'วันที่รับ', render: (r) => new Date(r.receivedAt).toLocaleString('th-TH') },
        { key: 'supplierReference', label: 'เลขที่ใบส่งของ', render: (r) => r.supplierReference || '—' },
        { key: 'lines', label: 'รายการ', render: (r) => r.lines.map((l) => `${open.lines.find((x) => x.id === l.purchaseOrderLineId)?.description ?? l.purchaseOrderLineId} × ${l.qty}${l.lotCode ? ` (Lot ${l.lotCode})` : ''}`).join(' · ') },
      ]} rows={open.receipts} rowKey={(r) => r.id} empty={<p className="text-sm text-muted">ยังไม่มีใบรับของ</p>} />
      {receivable && <fieldset disabled={busy} className="mt-4 grid gap-3">
        <SectionTitle caption="กรอกเฉพาะรายการที่มาถึง · SKU ที่นับสต๊อกจะเข้า ledger ของคลังทันที (ต้องมีสิทธิ์คลังสินค้า) · Lot / วันหมดอายุ สำหรับ SKU ที่นับตาม Lot · Serial สำหรับ SKU ที่นับตาม Serial">บันทึกรับของ</SectionTitle>
        {open.lines.map((l, i) => l.outstandingQty > 0 && <div key={l.id} className="grid gap-2 md:grid-cols-5">
          <div className="text-xs md:pt-6">{i + 1}. {l.description} <span className="text-muted">(ค้าง {l.outstandingQty})</span></div>
          <Input label={`รับเข้า ${i + 1}`} type="number" min="0" max={l.outstandingQty} value={receipt.lines[l.id]?.qty ?? ''} onChange={(e) => setReceiptLine(l.id, 'qty', e.target.value)} />
          {l.product?.trackingMode === 'LOT' && <Input label={`Lot ${i + 1}`} placeholder="LOT-2026-09" value={receipt.lines[l.id]?.lotCode ?? ''} onChange={(e) => setReceiptLine(l.id, 'lotCode', e.target.value)} />}
          {l.product?.trackingMode === 'LOT' && <Input label={`หมดอายุ ${i + 1}`} type="date" value={receipt.lines[l.id]?.expiresAt ?? ''} onChange={(e) => setReceiptLine(l.id, 'expiresAt', e.target.value)} />}
          {l.product?.trackingMode === 'SERIAL' && <label className="grid gap-1 text-xs font-semibold md:col-span-2">Serial {i + 1}<textarea className={fieldClass} rows={2} aria-label={`Serial ${i + 1}`} value={receipt.lines[l.id]?.serialNos ?? ''} onChange={(e) => setReceiptLine(l.id, 'serialNos', e.target.value)} /></label>}
        </div>)}
        <div className="grid gap-3 md:grid-cols-3">
          <Input label="เลขที่ใบส่งของ" placeholder="เลขที่ใบส่งของ / ใบกำกับของผู้ขาย" value={receipt.supplierReference} onChange={(e) => setReceipt((r) => ({ ...r, supplierReference: e.target.value }))} />
          <div className="flex items-end"><button type="button" className="btn btn-primary" onClick={() => post(open)} disabled={busy || !anyQty}>บันทึกรับของ</button></div>
        </div>
      </fieldset>}
    </Card>}

    {business && <Card>
      <SectionTitle caption="PO-YYYYMMDD-NNN ออกให้อัตโนมัติ · ต้นทุนต่อหน่วยคือราคาที่ตกลงกับผู้ขายครั้งนี้ · แก้รายการได้เฉพาะตอนเป็นร่าง">ใบสั่งซื้อใหม่</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <Select label="ผู้ขาย" options={[['', '— เลือกผู้ขาย —'], ...suppliers.map((s) => [s.id, `${s.code} · ${s.name}`])]} {...bindForm('supplierId')} />
        <Input label="กำหนดส่ง" type="date" {...bindForm('expectedAt')} />
        <Input label="หมายเหตุ" {...bindForm('notes')} />
        {lines.map((line, i) => <div key={i} className="grid gap-2 md:col-span-3 md:grid-cols-4">
          <label className="grid gap-1 text-xs font-semibold">สินค้า (SKU)<select className={fieldClass} aria-label={`สินค้า ${i + 1}`} value={line.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}><option value="">— ระบุเอง —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code}{p.name ? ` · ${p.name}` : ''}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold">รายการ<input className={fieldClass} aria-label={`รายการ ${i + 1}`} value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">จำนวน<input className={fieldClass} aria-label={`จำนวน ${i + 1}`} type="number" min="1" value={line.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">ต้นทุน/หน่วย<input className={fieldClass} aria-label={`ต้นทุน ${i + 1}`} type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => setLine(i, 'unitCost', e.target.value)} /></label>
        </div>)}
        <div className="md:col-span-3"><button type="button" className="btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ เพิ่มรายการ</button></div>
      </fieldset>
      <div className="mt-3"><button type="button" className="btn btn-primary" onClick={create} disabled={busy || !form.supplierId || !lines.some((l) => (l.productId || l.description) && l.unitCost !== '')}>สร้างใบสั่งซื้อ</button></div>
    </Card>}
  </div>
}
