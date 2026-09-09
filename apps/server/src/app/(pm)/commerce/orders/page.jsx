'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { COMMERCE_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import { PAYMENT_KINDS, PAYMENT_METHODS, SALES_ORDER_ACTIONS, SALES_ORDER_ORIGINS } from '@/lib/validation/enums'

// @req FR-166 — the orders console: create a sales order (lines that may name
//   an inventory SKU, a conversation, a customer), confirm it, complete it
//   (optionally issuing stock through the Inventory ledger), cancel it; every
//   money figure comes from the server's read, never from the page.
// @req FR-163 — record a payment or refund on an order (PENDING) and verify or
//   reject it; the order's paid / balance / payment state follow.
// @spec ADR-065; SEC-001 — every request names the selected Business as a
//   selector the server validates against the trusted viewer.
// @tested tests/e2e/fr166-commerce-orders.spec.js, tests/unit/commerce-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const STATUS_LABEL = { DRAFT: 'ร่าง', CONFIRMED: 'ยืนยันแล้ว', COMPLETED: 'เสร็จสิ้น', CANCELLED: 'ยกเลิก' }
const ORIGIN_LABEL = { CHAT: 'แชท', WALK_IN: 'หน้าร้าน', ONLINE: 'ออนไลน์' }
const PAY_STATE_LABEL = { UNPAID: 'ยังไม่ชำระ', PARTIAL: 'ชำระบางส่วน', PAID: 'ชำระครบ', OVERPAID: 'ชำระเกิน', REFUNDED: 'คืนเงินแล้ว' }
const PAY_STATUS_LABEL = { PENDING: 'รอตรวจ', VERIFIED: 'ตรวจแล้ว', REJECTED: 'ปฏิเสธ' }
const KIND_LABEL = { PAYMENT: 'ชำระ', REFUND: 'คืนเงิน' }
const METHOD_LABEL = { TRANSFER: 'โอน', CASH: 'เงินสด', QR: 'QR', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
// Row buttons, derived from the action registry: which actions an order offers depends only on its status.
const isOpen = (status) => status === 'DRAFT' || status === 'CONFIRMED'
const ORDER_ACTION_UI = {
  CONFIRM: { label: 'ยืนยัน', when: (s) => s === 'DRAFT' },
  COMPLETE: { label: 'เสร็จสิ้น', primary: true, when: (s) => s === 'CONFIRMED' },
  CANCEL: { label: 'ยกเลิก', when: isOpen },
}
const baht = (n) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0)
const FILTERS = [['open', 'ที่เปิดอยู่', ''], ['all', 'ทั้งหมด', '&includeClosed=true']]

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}
function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

const emptyLine = () => ({ productId: '', description: '', qty: '1', unitPrice: '', discount: '' })

export default function CommerceOrdersPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [filter, setFilter] = useState('open')
  const [data, setData] = useState(null)
  const [products, setProducts] = useState([])
  const [conversations, setConversations] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [openId, setOpenId] = useState(null)
  const [issueStock, setIssueStock] = useState(false)
  const [form, setForm] = useState({ origin: 'WALK_IN', conversationId: '', discount: '', notes: '' })
  const [lines, setLines] = useState([emptyLine()])
  const [pay, setPay] = useState({ kind: 'PAYMENT', method: 'TRANSFER', amount: '', bankReference: '', note: '' })
  const bind = (state, set) => (name) => ({ name, value: state[name] ?? '', onChange: (e) => set((f) => ({ ...f, [name]: e.target.value })) })
  const bindForm = bind(form, setForm)
  const bindPay = bind(pay, setPay)

  const refresh = useCallback(async () => {
    if (!businessId) { setData(null); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const extra = FILTERS.find(([key]) => key === filter)?.[2] ?? ''
    const [orders, skus, inbox] = await Promise.all([
      api(`/api/commerce/orders?${q}${extra}`),
      api(`/api/inventory/products?${q}`).catch(() => []),
      api(`/api/crm/conversations?${q}`).catch(() => ({ conversations: [] })),
    ])
    setData(orders); setProducts(Array.isArray(skus) ? skus : []); setConversations(inbox.conversations ?? [])
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
  const create = () => run(async () => {
    const order = await api('/api/commerce/orders', 'POST', {
      businessId, origin: form.origin, ...(form.conversationId ? { conversationId: form.conversationId } : {}),
      ...(form.discount ? { discount: Number(form.discount) } : {}), ...(form.notes ? { notes: form.notes } : {}),
      lines: lines.filter((l) => l.productId || l.description).map((l) => ({
        ...(l.productId ? { productId: l.productId } : {}), ...(l.description ? { description: l.description } : {}),
        qty: Number(l.qty || 1), unitPrice: Number(l.unitPrice || 0), ...(l.discount ? { discount: Number(l.discount) } : {}),
      })),
    })
    setLines([emptyLine()]); setForm((f) => ({ ...f, discount: '', notes: '' }))
    return `สร้างออเดอร์ ${order.code} ยอดรวม ${baht(order.total)} บาท`
  })

  const act = (order, action) => run(async () => {
    const result = await api(`/api/commerce/orders/${order.id}`, 'PATCH', { action, version: order.version, ...(action === 'COMPLETE' ? { issueStock } : {}) })
    return `${result.code}: ${STATUS_LABEL[result.status]}`
  })

  const record = (order) => run(async () => {
    const result = await api(`/api/commerce/orders/${order.id}/payments`, 'POST', {
      kind: pay.kind, method: pay.method, amount: Number(pay.amount), ...(pay.bankReference ? { bankReference: pay.bankReference } : {}), ...(pay.note ? { note: pay.note } : {}),
    })
    setPay((p) => ({ ...p, amount: '', bankReference: '', note: '' }))
    return `บันทึก ${result.code} (${KIND_LABEL[result.kind]} ${baht(result.amount)} บาท) รอตรวจสอบ`
  })

  const verify = (payment, action) => run(async () => {
    const result = await api(`/api/commerce/payments/${payment.id}`, 'PATCH', { action, version: payment.version })
    return `${result.payment.code}: ${PAY_STATUS_LABEL[result.payment.status]} · ออเดอร์ ${result.order.code} ${PAY_STATE_LABEL[result.order.paymentState]}`
  })

  const columns = [
    { key: 'code', label: 'รหัส', render: (o) => <button type="button" className="font-mono text-xs underline" onClick={() => setOpenId(openId === o.id ? null : o.id)}>{o.code}</button> },
    { key: 'customer', label: 'ลูกค้า', render: (o) => o.customer?.displayName || '—' },
    { key: 'origin', label: 'ที่มา', render: (o) => ORIGIN_LABEL[o.origin] || o.origin },
    { key: 'total', label: 'ยอดรวม', render: (o) => baht(o.total) },
    { key: 'paid', label: 'ชำระแล้ว', render: (o) => baht(o.net) },
    { key: 'paymentState', label: 'การชำระ', render: (o) => <span style={{ color: o.paymentState === 'PAID' ? 'var(--success)' : o.paymentState === 'UNPAID' ? 'var(--danger)' : 'inherit' }}>{PAY_STATE_LABEL[o.paymentState]}{o.pending ? ` (รอ ${baht(o.pending)})` : ''}</span> },
    { key: 'status', label: 'สถานะ', render: (o) => STATUS_LABEL[o.status] || o.status },
    { key: 'actions', label: '', render: (o) => <div className="flex flex-wrap gap-1">
      {SALES_ORDER_ACTIONS.filter((a) => ORDER_ACTION_UI[a]?.when(o.status)).map((a) => (
        <button key={a} type="button" className={`btn px-2 py-1 text-xs ${ORDER_ACTION_UI[a].primary ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act(o, a)}>{ORDER_ACTION_UI[a].label}</button>
      ))}
    </div> },
  ]

  const open = data?.orders.find((o) => o.id === openId)

  return <div>
    <ModuleTabs tabs={COMMERCE_TABS} />
    <PageHeader
      eyebrow="Commerce · FEAT-023"
      title="ออเดอร์ (Orders)"
      subtitle={`สร้างออเดอร์ รับชำระ ตรวจสลิป — ยอดชำระและยอดคงค้างคำนวณจากการชำระที่ตรวจสอบแล้ว${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูออเดอร์</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {data && <div className="mb-4 grid gap-3 md:grid-cols-3">
      <Kpi label="ออเดอร์ที่เปิดอยู่" value={data.summary.open} />
      <Kpi label="ยังชำระไม่ครบ" value={data.summary.unpaid} tone={data.summary.unpaid ? 'warn' : 'good'} />
      <Kpi label="การชำระรอตรวจ" value={data.summary.pendingPayments} tone={data.summary.pendingPayments ? 'warn' : undefined} />
    </div>}

    {business && <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="ตัวกรอง">
      {FILTERS.map(([key, label]) => <button key={key} type="button" className={`btn px-3 py-1 text-xs ${filter === key ? 'btn-primary' : ''}`} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      <label className="ml-auto flex items-center gap-2 text-xs"><input type="checkbox" checked={issueStock} onChange={(e) => setIssueStock(e.target.checked)} />ตัดสต๊อกเมื่อเสร็จสิ้น (ต้องมีสิทธิ์คลังสินค้า)</label>
    </div>}

    {data && <div className="mb-4">
      <SectionTitle caption="คลิกรหัสเพื่อดูรายการและการชำระของออเดอร์">รายการออเดอร์</SectionTitle>
      <DataTable columns={columns} rows={data.orders} rowKey={(o) => o.id} />
    </div>}

    {open && <Card className="mb-4">
      <SectionTitle caption={`${open.code} · ${STATUS_LABEL[open.status]} · ยอดรวม ${baht(open.total)} · ชำระแล้ว ${baht(open.net)} · คงค้าง ${baht(open.balanceDue)}`}>รายละเอียดออเดอร์</SectionTitle>
      <DataTable columns={[{ key: 'description', label: 'รายการ' }, { key: 'qty', label: 'จำนวน' }, { key: 'unitPrice', label: 'ราคา/หน่วย', render: (l) => baht(l.unitPrice) }, { key: 'discount', label: 'ส่วนลด', render: (l) => baht(l.discount) }, { key: 'lineTotal', label: 'รวม', render: (l) => baht(l.lineTotal) }]} rows={open.lines} rowKey={(l) => l.id} />
      <h3 className="mt-4 text-sm font-bold">การชำระเงิน</h3>
      <DataTable columns={[
        { key: 'code', label: 'รหัส', render: (p) => <span className="font-mono text-xs">{p.code}</span> },
        { key: 'kind', label: 'ประเภท', render: (p) => KIND_LABEL[p.kind] },
        { key: 'method', label: 'ช่องทาง', render: (p) => METHOD_LABEL[p.method] || p.method },
        { key: 'amount', label: 'จำนวนเงิน', render: (p) => baht(p.amount) },
        { key: 'bankReference', label: 'อ้างอิงธนาคาร', render: (p) => p.bankReference || '—' },
        { key: 'status', label: 'สถานะ', render: (p) => PAY_STATUS_LABEL[p.status] },
        { key: 'actions', label: '', render: (p) => p.status === 'PENDING' ? <div className="flex gap-1">
          <button type="button" className="btn btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => verify(p, 'VERIFY')}>ตรวจแล้ว</button>
          <button type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => verify(p, 'REJECT')}>ปฏิเสธ</button>
        </div> : null },
      ]} rows={open.payments} rowKey={(p) => p.id} empty={<p className="text-sm text-muted">ยังไม่มีการชำระ</p>} />
      {open.status !== 'CANCELLED' && <fieldset disabled={busy} className="mt-4 grid gap-3 md:grid-cols-5">
        <Select label="ประเภทการชำระ" options={PAYMENT_KINDS.map((k) => [k, KIND_LABEL[k]])} {...bindPay('kind')} />
        <Select label="ช่องทาง" options={PAYMENT_METHODS.map((m) => [m, METHOD_LABEL[m]])} {...bindPay('method')} />
        <Input label="จำนวนเงิน" type="number" min="0" step="0.01" {...bindPay('amount')} />
        <Input label="อ้างอิงธนาคาร" placeholder="เลขอ้างอิงสลิป" {...bindPay('bankReference')} />
        <div className="flex items-end"><button type="button" className="btn btn-primary" onClick={() => record(open)} disabled={busy || !pay.amount}>บันทึกการชำระ</button></div>
      </fieldset>}
    </Card>}

    {business && <Card>
      <SectionTitle caption="ORD-YYYYMMDD-NNN ออกให้อัตโนมัติ · ผูกบทสนทนาแล้วที่มาเป็น 'แชท' และลูกค้าตามมา · ราคาต่อหน่วยระบุเองเสมอ">ออเดอร์ใหม่</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <Select label="ที่มา" options={SALES_ORDER_ORIGINS.map((o) => [o, ORIGIN_LABEL[o]])} {...bindForm('origin')} />
        <div className="md:col-span-2"><Select label="บทสนทนา" options={[['', '— ไม่ผูกบทสนทนา —'], ...conversations.map((c) => [c.id, `${c.customer?.displayName ?? c.id} · ${c.channel}`])]} {...bindForm('conversationId')} /></div>
        {lines.map((line, i) => <div key={i} className="grid gap-2 md:col-span-3 md:grid-cols-5">
          <label className="grid gap-1 text-xs font-semibold">สินค้า (SKU)<select className={fieldClass} aria-label={`สินค้า ${i + 1}`} value={line.productId} onChange={(e) => setLine(i, 'productId', e.target.value)}><option value="">— ระบุเอง —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code}{p.name ? ` · ${p.name}` : ''}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-semibold">รายการ<input className={fieldClass} aria-label={`รายการ ${i + 1}`} value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">จำนวน<input className={fieldClass} aria-label={`จำนวน ${i + 1}`} type="number" min="1" value={line.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">ราคา/หน่วย<input className={fieldClass} aria-label={`ราคา ${i + 1}`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">ส่วนลด<input className={fieldClass} aria-label={`ส่วนลด ${i + 1}`} type="number" min="0" step="0.01" value={line.discount} onChange={(e) => setLine(i, 'discount', e.target.value)} /></label>
        </div>)}
        <div className="md:col-span-3"><button type="button" className="btn" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ เพิ่มรายการ</button></div>
        <Input label="ส่วนลดทั้งออเดอร์" type="number" min="0" step="0.01" {...bindForm('discount')} />
        <div className="md:col-span-2"><Input label="หมายเหตุ" {...bindForm('notes')} /></div>
      </fieldset>
      <div className="mt-3"><button type="button" className="btn btn-primary" onClick={create} disabled={busy || !lines.some((l) => (l.productId || l.description) && l.unitPrice !== '')}>สร้างออเดอร์</button></div>
    </Card>}
  </div>
}
