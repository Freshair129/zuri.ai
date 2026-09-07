'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { PROCUREMENT_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import { SUPPLIER_ACTIONS } from '@/lib/validation/enums'

// @req FR-164 — the Procurement dashboard: what is on order (open purchase
//   orders, awaiting delivery, partially received, the outstanding value —
//   every number computed by the server on this load from the lines and the
//   receipt lines) and the Business's suppliers: list, create, archive.
// @req FR-165 — the entry to the purchase-orders console where receipts are posted.
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
const STATUS_LABEL = { ACTIVE: 'ใช้งาน', ARCHIVED: 'เก็บถาวร' }
// Row buttons, derived from the action registry: an active supplier can be archived; nothing else is offered here.
const SUPPLIER_ACTION_UI = {
  ARCHIVE: { label: 'เก็บถาวร', when: (s) => s === 'ACTIVE' },
}
const baht = (n) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 }).format(n ?? 0)

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}

const emptySupplier = () => ({ code: '', name: '', contactName: '', phone: '', email: '', paymentTerms: '', leadTimeDays: '' })

export default function ProcurementDashboardPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [orders, setOrders] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(emptySupplier())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const bind = (name) => ({ name, value: form[name] ?? '', onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })) })

  const refresh = useCallback(async () => {
    if (!businessId) { setOrders(null); setSuppliers([]); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const [list, rows] = await Promise.all([api(`/api/procurement/purchase-orders?${q}`), api(`/api/procurement/suppliers?${q}&includeArchived=true`)])
    setOrders(list); setSuppliers(rows)
  }, [businessId])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  async function run(fn) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { setMessage(await fn()); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const create = () => run(async () => {
    const supplier = await api('/api/procurement/suppliers', 'POST', {
      businessId, code: form.code, name: form.name,
      ...(form.contactName ? { contactName: form.contactName } : {}), ...(form.phone ? { phone: form.phone } : {}), ...(form.email ? { email: form.email } : {}),
      ...(form.paymentTerms ? { paymentTerms: form.paymentTerms } : {}), ...(form.leadTimeDays ? { leadTimeDays: Number(form.leadTimeDays) } : {}),
    })
    setForm(emptySupplier())
    return `สร้างผู้ขาย ${supplier.code} แล้ว`
  })

  const act = (supplier, action) => run(async () => {
    const result = await api(`/api/procurement/suppliers/${supplier.id}`, 'PATCH', { action, version: supplier.version })
    return `${result.code}: ${STATUS_LABEL[result.status]}`
  })

  const columns = [
    { key: 'code', label: 'รหัส', render: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { key: 'name', label: 'ชื่อ' },
    { key: 'contactName', label: 'ผู้ติดต่อ', render: (s) => s.contactName || '—' },
    { key: 'phone', label: 'โทรศัพท์', render: (s) => s.phone || '—' },
    { key: 'paymentTerms', label: 'เงื่อนไขชำระ', render: (s) => s.paymentTerms || '—' },
    { key: 'leadTimeDays', label: 'Lead time', render: (s) => (s.leadTimeDays ?? null) === null ? '—' : `${s.leadTimeDays} วัน` },
    { key: 'purchaseOrders', label: 'ใบสั่งซื้อ' },
    { key: 'status', label: 'สถานะ', render: (s) => STATUS_LABEL[s.status] || s.status },
    { key: 'actions', label: '', render: (s) => <div className="flex flex-wrap gap-1">
      {SUPPLIER_ACTIONS.filter((a) => SUPPLIER_ACTION_UI[a]?.when(s.status)).map((a) => (
        <button key={a} type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => act(s, a)}>{SUPPLIER_ACTION_UI[a].label}</button>
      ))}
    </div> },
  ]

  return <div>
    <ModuleTabs tabs={PROCUREMENT_TABS} />
    <PageHeader
      eyebrow="Procurement · FEAT-024"
      title="จัดซื้อและผู้ขาย"
      subtitle={`ใบสั่งซื้อที่เปิดอยู่ ของที่รอรับ และผู้ขายของธุรกิจ — ตัวเลขคำนวณจากรายการและใบรับของทุกครั้ง${business ? ` · ${business.name}` : ''}`}
      actions={<>
        <Link className="btn btn-primary" href="/procurement/purchase-orders"><ClipboardList size={15} /> ใบสั่งซื้อ</Link>
        <button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>
      </>}
    />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูงานจัดซื้อ</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {orders && <div className="mb-4 grid gap-3 md:grid-cols-4">
      <Kpi label="ใบสั่งซื้อที่เปิดอยู่" value={orders.summary.open} meta={`ร่าง ${orders.summary.draft}`} />
      <Kpi label="รอรับของ" value={orders.summary.awaitingDelivery} tone={orders.summary.awaitingDelivery ? 'warn' : undefined} meta="ส่งผู้ขายแล้ว ยังไม่รับ" />
      <Kpi label="รับบางส่วน" value={orders.summary.partiallyReceived} meta="มีใบรับของแล้วแต่ยังไม่ครบ" />
      <Kpi label="มูลค่าที่ยังไม่ได้รับ" value={baht(orders.summary.outstandingValue)} meta="ของใบสั่งซื้อที่ส่งแล้ว" />
    </div>}

    {business && <div className="mb-4">
      <SectionTitle caption="ผู้ขายที่เก็บถาวรยังคงอยู่ในระบบ แต่ออกใบสั่งซื้อใหม่ไม่ได้">ผู้ขาย (Suppliers)</SectionTitle>
      <DataTable columns={columns} rows={suppliers} rowKey={(s) => s.id} empty={<p className="text-sm text-muted">ยังไม่มีผู้ขาย — สร้างรายแรกด้านล่าง</p>} />
    </div>}

    {business && <Card>
      <SectionTitle caption="รหัสผู้ขายไม่ซ้ำกันในองค์กร · รหัสเป็นแค่ป้าย ไม่ใช่กุญแจ">ผู้ขายใหม่</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-4">
        <Input label="รหัสผู้ขาย" placeholder="SUP-001" {...bind('code')} />
        <Input label="ชื่อผู้ขาย" {...bind('name')} />
        <Input label="ผู้ติดต่อ" {...bind('contactName')} />
        <Input label="โทรศัพท์" {...bind('phone')} />
        <Input label="อีเมล" type="email" {...bind('email')} />
        <Input label="เงื่อนไขชำระเงิน" placeholder="เครดิต 30 วัน" {...bind('paymentTerms')} />
        <Input label="Lead time (วัน)" type="number" min="0" {...bind('leadTimeDays')} />
      </fieldset>
      <div className="mt-3"><button type="button" className="btn btn-primary" onClick={create} disabled={busy || !form.code || !form.name}>สร้างผู้ขาย</button></div>
    </Card>}
  </div>
}
