'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, ModuleTabs, PageHeader } from '@/components/ui'
import { PROCUREMENT_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'

// @req FR-165 — registry, actual receiving quantities and printable persisted GRNs.
// @spec ADR-066; SEC-001; FR-072
// @tested tests/e2e/fr165-receipt-workstation.spec.js
async function api(url, options = {}) {
  const response = await fetch(url, options)
  const body = await response.json()
  if (!response.ok) throw new Error(body.issues?.join(' · ') || body.error || 'Request failed')
  return body
}
const field = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const receiptDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(value))

export default function GoodsReceiptsPage() {
  const business = useScope().shell.activeBusiness
  return <div>
    <ModuleTabs tabs={PROCUREMENT_TABS} />
    <PageHeader title="รับสินค้า (Goods Receipts)" subtitle="บันทึกจำนวนที่มาถึงจริงและดูใบรับสินค้า" />
    {business ? <ReceiptStation key={business.id} businessId={business.id} /> : <Card>เลือก Business ก่อนเพื่อรับสินค้า</Card>}
  </div>
}

function ReceiptStation({ businessId }) {
  const [registry, setRegistry] = useState({ receipts: [], hasMore: false })
  const [orders, setOrders] = useState([])
  const [offset, setOffset] = useState(0)
  const [selectedPoId, setSelectedPoId] = useState('')
  const [lines, setLines] = useState({})
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const alive = useRef(false)
  const generation = useRef(0)
  const detailGeneration = useRef(0)
  const posting = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; detailGeneration.current++ } }, [])

  const refresh = useCallback(async () => {
    const current = ++generation.current
    setLoading(true)
    try {
      const query = `businessId=${encodeURIComponent(businessId)}`
      const [grns, pos] = await Promise.all([
        api(`/api/procurement/receipts?${query}&offset=${offset}&limit=50`),
        api(`/api/procurement/purchase-orders?${query}&status=SENT`),
      ])
      if (!alive.current || current !== generation.current) return
      setRegistry(grns); setOrders(pos.orders)
    } catch (err) { if (alive.current && current === generation.current) setError(err.message) }
    finally { if (alive.current && current === generation.current) setLoading(false) }
  }, [businessId, offset])
  useEffect(() => { refresh() }, [refresh])
  const order = orders.find(row => row.id === selectedPoId)
  const receivable = order?.lines.filter(line => line.outstandingQty > 0 && line.product?.stockPolicy !== 'SERVICE') ?? []
  const bindLine = (id, name) => ({ value: lines[id]?.[name] ?? '', onChange: event => setLines(old => ({ ...old, [id]: { ...old[id], [name]: event.target.value } })) })

  async function showReceipt(id) {
    const current = ++detailGeneration.current
    setReceipt(null); setError('')
    try {
      const detail = await api(`/api/procurement/receipts/${encodeURIComponent(id)}`)
      if (alive.current && current === detailGeneration.current) setReceipt(detail)
    } catch (err) { if (alive.current && current === detailGeneration.current) setError(err.message) }
  }

  async function post(event) {
    event.preventDefault()
    if (posting.current || !order || loading) return
    posting.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const entered = receivable.filter(line => lines[line.id]?.qty !== undefined && lines[line.id]?.qty !== '')
      if (entered.some(line => !Number.isInteger(Number(lines[line.id].qty)) || Number(lines[line.id].qty) < 0)) throw new Error('จำนวนรับต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
      const selected = entered.filter(line => Number(lines[line.id].qty) > 0)
      if (!selected.length) throw new Error('ระบุจำนวนรับอย่างน้อยหนึ่งรายการ')
      const result = await api(`/api/procurement/purchase-orders/${encodeURIComponent(order.id)}/receipts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(reference.trim() ? { supplierReference: reference.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
          lines: selected.map(line => {
            const input = lines[line.id]
            return { purchaseOrderLineId: line.id, qty: Number(input.qty),
              ...(input.lotCode?.trim() ? { lotCode: input.lotCode.trim() } : {}),
              ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
              ...(input.serialNos?.trim() ? { serialNos: input.serialNos.trim().split(/[\s,]+/) } : {}),
            }
          }),
        }),
      })
      if (!alive.current) return
      setMessage(`บันทึกรับสินค้า ${result.receipt.code} แล้ว`)
      setLines({}); setReference(''); setNotes(''); setSelectedPoId('')
      await showReceipt(result.receipt.id)
      await refresh()
    } catch (err) { if (alive.current) setError(err.message) }
    finally { posting.current = false; if (alive.current) setBusy(false) }
  }

  return <div className="space-y-4">
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Card>
      <h2 className="font-semibold">ประวัติใบรับสินค้า</h2>
      <p className="text-sm text-muted">แสดง {registry.receipts.length} รายการในหน้านี้</p>
      <button className="btn" onClick={refresh} disabled={busy || loading}>โหลดใหม่</button>
      {loading ? <p>กำลังโหลด…</p> : <table className="w-full text-left text-sm"><thead><tr><th>เลขที่ GRN</th><th>PO / ผู้ขาย</th><th>ใบส่งของ</th><th>วันที่รับ</th></tr></thead>
        <tbody>{registry.receipts.map(row => <tr key={row.id}>
          <td><button className="underline" onClick={() => showReceipt(row.id)}>{row.code}</button></td>
          <td>{row.purchaseOrder.code} · {row.purchaseOrder.supplier.name}</td><td>{row.supplierReference || '—'}</td><td>{receiptDate(row.receivedAt)}</td>
        </tr>)}</tbody></table>}
      {!loading && !registry.receipts.length && <p>ยังไม่มีใบรับสินค้าในหน้านี้</p>}
      <div className="flex gap-2"><button className="btn" disabled={offset === 0 || loading || busy} onClick={() => setOffset(value => Math.max(0, value - 50))}>ก่อนหน้า</button>
        <button className="btn" disabled={!registry.hasMore || loading || busy} onClick={() => setOffset(value => value + 50)}>ถัดไป</button></div>
    </Card>
    <Card>
      <h2 className="font-semibold">บันทึกรับสินค้า</h2>
      <form onSubmit={post} className="space-y-3">
        <fieldset disabled={busy || loading} className="space-y-3">
          <label className="block">ใบสั่งซื้อ<select aria-label="ใบสั่งซื้อสำหรับรับสินค้า" className={field} value={selectedPoId} onChange={event => { setSelectedPoId(event.target.value); setLines({}); setReference(''); setNotes('') }}>
            <option value="">เลือกใบสั่งซื้อ</option>{orders.map(row => <option key={row.id} value={row.id}>{row.code} · {row.supplier.name}</option>)}</select></label>
          <p className="text-xs text-muted">แสดงใบสั่งซื้อที่ส่งผู้ขายแล้ว สูงสุด 200 รายการล่าสุด</p>
          <label className="block">เลขที่ใบส่งของ<input className={field} value={reference} onChange={event => setReference(event.target.value)} /></label>
          <label className="block">หมายเหตุ<input className={field} value={notes} onChange={event => setNotes(event.target.value)} /></label>
          {receivable.map(line => <fieldset key={line.id} className="rounded border p-3"><legend>{line.description} · ค้างรับ {line.outstandingQty}</legend>
            <label>จำนวนรับ {line.description}<input aria-label={`จำนวนรับ ${line.description}`} className={field} type="number" min="0" max={line.outstandingQty} step="1" {...bindLine(line.id, 'qty')} /></label>
            {line.product?.counted && line.product.trackingMode === 'LOT' && <>
              <label>Lot {line.description}<input className={field} {...bindLine(line.id, 'lotCode')} /></label>
              <label>วันหมดอายุ {line.description}<input className={field} type="date" {...bindLine(line.id, 'expiresAt')} /></label>
            </>}
            {line.product?.counted && line.product.trackingMode === 'SERIAL' && <label>Serial {line.description}<input className={field} placeholder="คั่นด้วยจุลภาค" {...bindLine(line.id, 'serialNos')} /></label>}
          </fieldset>)}
          <button className="btn btn-primary" type="submit" disabled={!receivable.length}>{busy ? 'กำลังบันทึก…' : 'บันทึกรับของ'}</button>
        </fieldset>
      </form>
    </Card>
    {receipt && <Card className="receipt-print">
      <h2 className="font-semibold">ใบรับสินค้า {receipt.code}</h2>
      <p>{receipt.purchaseOrder.code} · {receipt.purchaseOrder.supplier.name}</p>
      <p>ใบส่งของ: {receipt.supplierReference || '—'} · วันที่รับ: {receiptDate(receipt.receivedAt)}</p>
      <table className="w-full text-left text-sm"><thead><tr><th>รายการ</th><th>จำนวน</th><th>Lot / Serial</th><th>การนับสต๊อก</th></tr></thead><tbody>
        {receipt.lines.map(line => <tr key={line.id}><td>{line.purchaseOrderLine.product?.code} {line.purchaseOrderLine.description}</td><td>{line.qty}</td>
          <td>{line.lotCode || '—'} {line.expiresAt?.slice(0, 10)} {line.serialNos.join(', ')}</td>
          <td>{line.purchaseOrderLine.product?.stockPolicy === 'TRACKED' ? 'สินค้านับสต๊อก' : 'รายการไม่นับสต๊อก'}</td></tr>)}
      </tbody></table><p>{receipt.notes}</p>
      <button className="btn print:hidden" onClick={() => window.print()}>พิมพ์ใบรับสินค้า</button>
      <style>{`@media print { body * { visibility: hidden; } .receipt-print, .receipt-print * { visibility: visible; } .receipt-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </Card>}
  </div>
}
