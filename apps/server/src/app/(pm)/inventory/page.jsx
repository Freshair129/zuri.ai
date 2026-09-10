'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import { INVENTORY_MOVEMENT_KINDS, INVENTORY_STOCK_POLICIES, INVENTORY_TRACKING_MODES } from '@/lib/validation/enums'

// @req FR-154 — the Inventory dashboard (คลังสินค้า): the Business's SKUs with
//   their stock policy, and the console forms that create a category, a
//   product master and a SKU through the FR-154 routes.
// @req FR-155 — on-hand per product recomputed by the server on every load
//   (an uncounted product shows "—", never a zero), the below-safety-stock
//   count, and the form that appends one ledger movement.
// @spec SEC-001 — every request names the selected Business as a selector the
//   server validates against the trusted viewer; nothing here widens scope.
// @req FR-182 — Inventory has more than one page since the SCM operations
//   console, so its views render as in-canvas tabs (FR-170) rather than only as
//   sidebar links; this page is the Dashboard tab.
// @tested tests/unit/inventory-routes.test.js, tests/unit/scm-console-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
// @req FR-168 — three natures, and the form below already narrows itself to the
// one chosen: the tracking mode and safety stock only exist for a counted good,
// so choosing ไม่นับสต๊อก or บริการ removes them rather than leaving fields that
// can never apply.
const POLICY_LABEL = { TRACKED: 'นับสต๊อก', UNTRACKED: 'ไม่นับสต๊อก', SERVICE: 'บริการ' }
const MODE_LABEL = { NONE: 'นับจำนวนรวม', LOT: 'ตาม Lot', SERIAL: 'ตาม Serial' }
const KIND_LABEL = { RECEIPT: 'รับเข้า', ISSUE: 'จ่ายออก', ADJUSTMENT: 'ปรับยอด' }

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

export default function InventoryPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [summary, setSummary] = useState(null)
  const [categories, setCategories] = useState([])
  const [masters, setMasters] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setSummary(null); setCategories([]); setMasters([]); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const [stock, cats, pms] = await Promise.all([api(`/api/inventory/stock?${q}`), api(`/api/inventory/categories?${q}`), api(`/api/inventory/product-masters?${q}`)])
    setSummary(stock); setCategories(cats); setMasters(pms)
  }, [businessId])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  const [category, bindCategory, resetCategory] = useForm({ code: '', nameTh: '', nameEn: '' })
  const [master, bindMaster, resetMaster] = useForm({ code: '', categoryId: '', nameTh: '', nameEn: '', baseCost: '' })
  const [sku, bindSku, resetSku] = useForm({ code: '', productMasterId: '', name: '', stockPolicy: 'TRACKED', trackingMode: 'NONE', safetyStock: '10' })
  const [move, bindMove, resetMove] = useForm({ productId: '', kind: 'RECEIPT', quantity: '', lotCode: '', serialNos: '', reference: '' })

  const products = summary?.products ?? []
  const trackedProducts = useMemo(() => products.filter((p) => p.stockPolicy === 'TRACKED'), [products])

  async function submit(fn, reset) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await fn(); reset(); setMessage(result); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const createCategory = () => submit(async () => {
    const row = await api('/api/inventory/categories', 'POST', { businessId, code: category.code, nameTh: category.nameTh, nameEn: category.nameEn })
    return `สร้างหมวดหมู่ ${row.code} แล้ว`
  }, resetCategory)

  const createMaster = () => submit(async () => {
    const row = await api('/api/inventory/product-masters', 'POST', { businessId, code: master.code, categoryId: master.categoryId || categories[0]?.id, nameTh: master.nameTh, nameEn: master.nameEn, ...(master.baseCost ? { baseCost: Number(master.baseCost) } : {}) })
    return `สร้างสินค้าหลัก ${row.code} แล้ว`
  }, resetMaster)

  const createSku = () => submit(async () => {
    const row = await api('/api/inventory/products', 'POST', {
      businessId, code: sku.code, productMasterId: sku.productMasterId || masters[0]?.id, ...(sku.name ? { name: sku.name } : {}),
      stockPolicy: sku.stockPolicy, ...(sku.stockPolicy === 'TRACKED' ? { trackingMode: sku.trackingMode } : {}), safetyStock: Number(sku.safetyStock || 0),
    })
    return `สร้าง SKU ${row.code} (${POLICY_LABEL[row.stockPolicy]}) แล้ว`
  }, resetSku)

  const recordMove = () => submit(async () => {
    const serialNos = move.serialNos.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    const row = await api('/api/inventory/stock-movements', 'POST', {
      businessId, productId: move.productId || trackedProducts[0]?.productId, kind: move.kind, quantity: Number(move.quantity),
      ...(move.lotCode ? { lotCode: move.lotCode } : {}), ...(serialNos.length ? { serialNos } : {}), ...(move.reference ? { reference: move.reference } : {}),
    })
    return `${KIND_LABEL[row.kind]} ${Math.abs(row.quantity)} หน่วย · คงเหลือ ${row.onHandBefore} → ${row.onHandAfter}`
  }, resetMove)

  const columns = [
    { key: 'code', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'ชื่อ', render: (r) => r.name || '—' },
    { key: 'stockPolicy', label: 'นโยบายสต๊อก', render: (r) => POLICY_LABEL[r.stockPolicy] || r.stockPolicy },
    { key: 'trackingMode', label: 'การระบุหน่วย', render: (r) => r.stockPolicy === 'TRACKED' ? (MODE_LABEL[r.trackingMode] || r.trackingMode) : '—' },
    { key: 'onHand', label: 'คงเหลือ', render: (r) => r.onHand === null ? <span className="text-muted">—</span> : <span style={{ color: r.belowSafetyStock ? 'var(--danger)' : 'inherit' }}>{r.onHand} {r.unit}</span> },
    { key: 'safetyStock', label: 'Safety stock', render: (r) => r.stockPolicy === 'TRACKED' ? r.safetyStock : '—' },
  ]

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-020"
      title="คลังสินค้า"
      subtitle={`สินค้าแบบนับสต๊อกและไม่นับสต๊อก · หมวดหมู่ · สินค้าหลัก · SKU · Lot · Serial · Bundle${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูคลังสินค้า</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {summary && <div className="mb-4 grid gap-3 md:grid-cols-4">
      <Kpi label="SKU ทั้งหมด" value={summary.counts.products} />
      <Kpi label="นับสต๊อก" value={summary.counts.tracked} meta="on-hand คำนวณจาก ledger ทุกครั้งที่โหลด" />
      <Kpi label="ไม่นับสต๊อก" value={summary.counts.untracked} meta="ไม่มี ledger — บริการ / สั่งผลิต" />
      <Kpi label="ต่ำกว่า safety stock" value={summary.counts.belowSafetyStock} tone={summary.counts.belowSafetyStock ? 'bad' : 'good'} />
    </div>}

    {summary && <div className="mb-4">
      <SectionTitle caption="ยอดคงเหลือคือผลรวมของความเคลื่อนไหวใน ledger — ไม่มีตัวเลขเก็บไว้ในตัวสินค้า">สินค้า (SKU)</SectionTitle>
      <DataTable columns={columns} rows={products} rowKey={(r) => r.productId} />
    </div>}

    {business && <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <SectionTitle caption="category_id — ชื่อไทย/อังกฤษ รหัสไม่ซ้ำใน Tenant">หมวดหมู่ใหม่</SectionTitle>
        <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
          <Input label="รหัส" placeholder="eco-friendly" {...bindCategory('code')} />
          <Input label="ชื่อ (ไทย)" {...bindCategory('nameTh')} />
          <Input label="ชื่อ (อังกฤษ)" {...bindCategory('nameEn')} />
        </fieldset>
        <div className="mt-3"><button type="button" className="btn" onClick={createCategory} disabled={busy || !category.code}>สร้างหมวดหมู่</button></div>
      </Card>

      <Card>
        <SectionTitle caption="product_master — สินค้าหลักในหมวดหมู่ พร้อมต้นทุนฐาน">สินค้าหลักใหม่</SectionTitle>
        <fieldset disabled={busy || !categories.length} className="grid gap-3 md:grid-cols-2">
          <Input label="รหัส" placeholder="PM-001" {...bindMaster('code')} />
          <Select label="หมวดหมู่" options={categories.map((c) => [c.id, `${c.code} · ${c.nameTh}`])} {...bindMaster('categoryId')} />
          <Input label="ชื่อ (ไทย)" {...bindMaster('nameTh')} />
          <Input label="ชื่อ (อังกฤษ)" {...bindMaster('nameEn')} />
          <Input label="ต้นทุนฐาน" type="number" min="0" step="0.01" {...bindMaster('baseCost')} />
        </fieldset>
        {!categories.length && <p className="mt-2 text-xs text-muted">สร้างหมวดหมู่ก่อน</p>}
        <div className="mt-3"><button type="button" className="btn" onClick={createMaster} disabled={busy || !master.code || !categories.length}>สร้างสินค้าหลัก</button></div>
      </Card>

      <Card>
        <SectionTitle caption="product_id — SKU ของสินค้าหลัก เลือกนับสต๊อกหรือไม่นับ และวิธีระบุหน่วย">SKU ใหม่</SectionTitle>
        <fieldset disabled={busy || !masters.length} className="grid gap-3 md:grid-cols-2">
          <Input label="รหัส SKU" placeholder="SKU-001-RED" {...bindSku('code')} />
          <Select label="สินค้าหลัก" options={masters.map((m) => [m.id, `${m.code} · ${m.nameTh}`])} {...bindSku('productMasterId')} />
          <Input label="ชื่อ SKU" {...bindSku('name')} />
          <Select label="นโยบายสต๊อก" options={INVENTORY_STOCK_POLICIES.map((p) => [p, POLICY_LABEL[p]])} {...bindSku('stockPolicy')} />
          {sku.stockPolicy === 'TRACKED' && <Select label="การระบุหน่วย" options={INVENTORY_TRACKING_MODES.map((m) => [m, MODE_LABEL[m]])} {...bindSku('trackingMode')} />}
          {sku.stockPolicy === 'TRACKED' && <Input label="Safety stock" type="number" min="0" {...bindSku('safetyStock')} />}
        </fieldset>
        {!masters.length && <p className="mt-2 text-xs text-muted">สร้างสินค้าหลักก่อน</p>}
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={createSku} disabled={busy || !sku.code || !masters.length}>สร้าง SKU</button></div>
      </Card>

      <Card>
        <SectionTitle caption="บันทึกลง ledger — รับเข้า / จ่ายออก / ปรับยอด; สินค้าที่ไม่นับสต๊อกจะถูกปฏิเสธ">ความเคลื่อนไหวสต๊อก</SectionTitle>
        <fieldset disabled={busy || !trackedProducts.length} className="grid gap-3 md:grid-cols-2">
          <Select label="SKU" options={trackedProducts.map((p) => [p.productId, `${p.code}${p.name ? ` · ${p.name}` : ''}`])} {...bindMove('productId')} />
          <Select label="ประเภท" options={INVENTORY_MOVEMENT_KINDS.map((k) => [k, KIND_LABEL[k]])} {...bindMove('kind')} />
          <Input label="จำนวน" type="number" {...bindMove('quantity')} />
          <Input label="Lot (ถ้าสินค้านับตาม Lot)" placeholder="LOT-2026-09" {...bindMove('lotCode')} />
          <label className="grid gap-1 text-xs font-semibold md:col-span-2">Serial (ถ้าสินค้านับตาม Serial — คั่นด้วยช่องว่างหรือจุลภาค)<textarea className={fieldClass} rows={2} aria-label="Serial" {...bindMove('serialNos')} /></label>
          <Input label="อ้างอิง (PO / ใบส่งของ)" {...bindMove('reference')} />
        </fieldset>
        {!trackedProducts.length && <p className="mt-2 text-xs text-muted">ยังไม่มี SKU แบบนับสต๊อก</p>}
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={recordMove} disabled={busy || !move.quantity || !trackedProducts.length}>บันทึก</button></div>
      </Card>
    </div>}
  </div>
}
