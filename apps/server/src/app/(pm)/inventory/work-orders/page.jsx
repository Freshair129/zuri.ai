'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import { CUSTOMIZATION_TECHNIQUES } from '@/lib/validation/enums'

// @req FR-182 — the Work Orders view of the SCM operations console.
// @req FR-176 — customization: open a run (which creates the branded output SKU
//   dedicated to one customer and one order), release it to the workshop, and
//   complete it with what came back good and what was ruined. The page shows
//   the gross issue so the scrap buffer is visible before anyone commits to it.
// @req FR-177 — kitting: open a run against a recipe, release it to the line,
//   and complete it with the sets assembled. A run that finished fewer than it
//   planned reads BLOCKED_SHORTAGE here, not COMPLETED.
// @spec ADR-074 D4, D5; BR-028; BR-029; SEC-001
// @tested tests/unit/scm-console-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'

const TECHNIQUE_LABEL = {
  LASER_ENGRAVING: 'ยิงเลเซอร์',
  SILK_SCREEN: 'สกรีนไหม',
  UV_DIGITAL_PRINT: 'พิมพ์ UV',
  HOT_STAMP_FOIL: 'ปั๊มฟอยล์',
  EMBOSSING: 'ปั๊มนูน',
}
const STATUS_LABEL = {
  DRAFT: 'ร่าง',
  RELEASED: 'ปล่อยงานแล้ว',
  IN_PROGRESS: 'กำลังผลิต',
  COMPLETED: 'เสร็จแล้ว',
  BLOCKED_SHORTAGE: 'ติดของขาด',
  CANCELLED: 'ยกเลิก',
}
const STATUS_TONE = { COMPLETED: 'good', BLOCKED_SHORTAGE: 'bad', CANCELLED: 'bad' }

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

export default function InventoryWorkOrdersPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [cwos, setCwos] = useState([])
  const [kwos, setKwos] = useState([])
  const [products, setProducts] = useState([])
  const [recipes, setRecipes] = useState([])
  const [locations, setLocations] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setCwos([]); setKwos([]); setProducts([]); setRecipes([]); setLocations([]); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const [c, k, stock, rec, locs] = await Promise.all([
      api(`/api/inventory/customization-work-orders?${q}`),
      api(`/api/inventory/kitting-work-orders?${q}`),
      api(`/api/inventory/stock?${q}`),
      api(`/api/inventory/recipes?${q}`),
      api(`/api/inventory/locations?${q}`),
    ])
    setCwos(c); setKwos(k); setRecipes(rec); setLocations(locs)
    setProducts((stock.products ?? []).filter((p) => p.stockPolicy === 'TRACKED'))
  }, [businessId])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  const [cwo, bindCwo, resetCwo] = useForm({ rawProductId: '', technique: 'LASER_ENGRAVING', netQuantity: '', customerId: '', salesOrderId: '', sourceLocationId: '', wipLocationId: '' })
  const [kwo, bindKwo, resetKwo] = useForm({ recipeId: '', plannedQty: '', salesOrderId: '', sourceLocationId: '', wipLocationId: '', targetLocationId: '', outputLotCode: '', laborCostSatang: '' })

  async function submit(fn) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await fn(); setMessage(result); await refresh() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const openCwo = () => submit(async () => {
    const row = await api('/api/inventory/customization-work-orders', 'POST', {
      businessId,
      rawProductId: cwo.rawProductId || products[0]?.productId,
      technique: cwo.technique,
      netQuantity: Number(cwo.netQuantity),
      ...(cwo.customerId ? { customerId: cwo.customerId } : {}),
      ...(cwo.salesOrderId ? { salesOrderId: cwo.salesOrderId } : {}),
      ...(cwo.sourceLocationId ? { sourceLocationId: cwo.sourceLocationId } : {}),
      ...(cwo.wipLocationId ? { wipLocationId: cwo.wipLocationId } : {}),
    })
    resetCwo()
    return `เปิด ${row.code} · เบิกรวมเผื่อเสีย ${row.grossIssueQty} จากยอดสุทธิ ${row.plannedQty}`
  })

  const openKwo = () => submit(async () => {
    const row = await api('/api/inventory/kitting-work-orders', 'POST', {
      businessId,
      recipeId: kwo.recipeId || recipes[0]?.id,
      plannedQty: Number(kwo.plannedQty),
      ...(kwo.salesOrderId ? { salesOrderId: kwo.salesOrderId } : {}),
      ...(kwo.sourceLocationId ? { sourceLocationId: kwo.sourceLocationId } : {}),
      ...(kwo.wipLocationId ? { wipLocationId: kwo.wipLocationId } : {}),
      ...(kwo.targetLocationId ? { targetLocationId: kwo.targetLocationId } : {}),
      ...(kwo.outputLotCode ? { outputLotCode: kwo.outputLotCode } : {}),
      ...(kwo.laborCostSatang ? { laborCostSatang: Number(kwo.laborCostSatang) } : {}),
    })
    resetKwo()
    return `เปิด ${row.code} · แผน ${row.plannedQty} ชุด`
  })

  // RELEASE / COMPLETE / CANCEL all go through the one PATCH the route
  // validates against the declared vocabulary — the page never invents a verb.
  const act = (kind, row, action, extra = {}) => submit(async () => {
    const path = kind === 'CWO' ? 'customization-work-orders' : 'kitting-work-orders'
    const result = await api(`/api/inventory/${path}/${row.id}`, 'PATCH', { businessId, action, version: row.version, ...extra })
    const order = result.order ?? result
    return `${order.code} → ${STATUS_LABEL[order.status] || order.status}`
  })

  const completeCwo = (row) => {
    const completedQty = Number(window.prompt(`${row.code}: ได้งานดีกี่ชิ้น? (เบิกไป ${row.issuedQty})`, String(row.plannedQty)) ?? '')
    if (!Number.isFinite(completedQty)) return
    const scrapQty = Number(window.prompt(`${row.code}: เสียกี่ชิ้น?`, '0') ?? '')
    if (!Number.isFinite(scrapQty)) return
    act('CWO', row, 'COMPLETE', { completedQty, scrapQty })
  }

  const completeKwo = (row) => {
    const assembledQty = Number(window.prompt(`${row.code}: ประกอบได้กี่ชุด? (แผน ${row.plannedQty})`, String(row.plannedQty)) ?? '')
    if (!Number.isFinite(assembledQty)) return
    const scrapQty = Number(window.prompt(`${row.code}: ชุดที่เสียระหว่างประกอบ?`, '0') ?? '')
    if (!Number.isFinite(scrapQty)) return
    act('KWO', row, 'COMPLETE', { assembledQty, scrapQty })
  }

  const actions = (kind, complete) => ({
    key: 'actions',
    label: 'ดำเนินการ',
    render: (r) => <span className="flex gap-2">
      {r.status === 'DRAFT' && <button type="button" className="btn btn-xs" onClick={() => act(kind, r, 'RELEASE')} disabled={busy}>ปล่อยงาน</button>}
      {(r.status === 'IN_PROGRESS' || r.status === 'RELEASED') && <button type="button" className="btn btn-xs btn-primary" onClick={() => complete(r)} disabled={busy}>ปิดงาน</button>}
      {r.status !== 'COMPLETED' && r.status !== 'CANCELLED' && <button type="button" className="btn btn-xs" onClick={() => act(kind, r, 'CANCEL')} disabled={busy}>ยกเลิก</button>}
    </span>,
  })

  const cwoColumns = [
    { key: 'code', label: 'เลขที่', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'technique', label: 'เทคนิค', render: (r) => TECHNIQUE_LABEL[r.technique] || r.technique },
    { key: 'plannedQty', label: 'แผน' },
    { key: 'grossIssueQty', label: 'เบิก (รวมเผื่อเสีย)' },
    { key: 'completedQty', label: 'ได้งานดี' },
    { key: 'scrapQty', label: 'เสีย' },
    { key: 'status', label: 'สถานะ', render: (r) => STATUS_LABEL[r.status] || r.status },
    actions('CWO', completeCwo),
  ]

  const kwoColumns = [
    { key: 'code', label: 'เลขที่', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'plannedQty', label: 'แผน' },
    { key: 'assembledQty', label: 'ประกอบได้' },
    { key: 'scrapQty', label: 'เสีย' },
    { key: 'unitCostSatang', label: 'ต้นทุน/ชุด', render: (r) => r.unitCostSatang === null || r.unitCostSatang === undefined ? '—' : `${(r.unitCostSatang / 100).toFixed(2)} ฿` },
    { key: 'status', label: 'สถานะ', render: (r) => STATUS_LABEL[r.status] || r.status },
    actions('KWO', completeKwo),
  ]

  const openCount = (rows) => rows.filter((r) => r.status === 'RELEASED' || r.status === 'IN_PROGRESS').length
  const blockedCount = (rows) => rows.filter((r) => r.status === 'BLOCKED_SHORTAGE').length
  const blocked = blockedCount(cwos) + blockedCount(kwos)

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-025"
      title="ใบสั่งงานผลิต"
      subtitle={`สกรีน / ยิงเลเซอร์ และการประกอบชุดของขวัญ · เบิกเผื่อเสียตามที่สูตรประกาศไว้${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูใบสั่งงาน</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {business && <div className="mb-4 grid gap-3 md:grid-cols-4">
      <Kpi label="ใบสั่งสกรีน/เลเซอร์" value={cwos.length} meta={`กำลังผลิต ${openCount(cwos)}`} />
      <Kpi label="ใบสั่งประกอบ" value={kwos.length} meta={`กำลังผลิต ${openCount(kwos)}`} />
      <Kpi label="ติดของขาด" value={blocked} tone={blocked ? 'bad' : 'good'} meta="ของเสียเกินที่เผื่อไว้" />
      <Kpi label="สูตรที่ใช้ได้" value={recipes.length} />
    </div>}

    {business && <div className="mb-4">
      <SectionTitle caption="ปล่อยงานย้ายของเข้าห้องผลิต ปิดงานตัดของจริงและรับชิ้นงานที่ล็อกลูกค้าแล้ว — ย้อนกลับไม่ได้">ใบสั่งสกรีน / ยิงเลเซอร์</SectionTitle>
      <DataTable columns={cwoColumns} rows={cwos} rowKey={(r) => r.id} />
    </div>}

    {business && <div className="mb-4">
      <SectionTitle caption="ระเบิด BOM พร้อมเผื่อเสีย ตรวจของว่างจาก ATP ไม่ใช่ยอดคงเหลือดิบ">ใบสั่งประกอบชุด</SectionTitle>
      <DataTable columns={kwoColumns} rows={kwos} rowKey={(r) => r.id} />
    </div>}

    {business && <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <SectionTitle caption="ระบบสร้าง SKU ที่สกรีนแล้วให้เอง ล็อกกับลูกค้าและออเดอร์นี้ถาวร">เปิดใบสั่งสกรีน</SectionTitle>
        <fieldset disabled={busy || !products.length} className="grid gap-3 md:grid-cols-2">
          <Select label="SKU วัตถุดิบ" options={products.map((p) => [p.productId, `${p.code}${p.name ? ` · ${p.name}` : ''}`])} {...bindCwo('rawProductId')} />
          <Select label="เทคนิค" options={CUSTOMIZATION_TECHNIQUES.map((t) => [t, TECHNIQUE_LABEL[t] || t])} {...bindCwo('technique')} />
          <Input label="จำนวนสุทธิ" type="number" min="1" {...bindCwo('netQuantity')} />
          <Input label="Customer id" {...bindCwo('customerId')} />
          <Input label="Sales order id" {...bindCwo('salesOrderId')} />
          <Select label="จากจุด" options={[['', '(ไม่ระบุ)'], ...locations.map((l) => [l.id, l.code])]} {...bindCwo('sourceLocationId')} />
          <Select label="ห้องผลิต" options={[['', '(ไม่ระบุ)'], ...locations.map((l) => [l.id, l.code])]} {...bindCwo('wipLocationId')} />
        </fieldset>
        {!products.length && <p className="mt-2 text-xs text-muted">ยังไม่มี SKU แบบนับสต๊อก</p>}
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={openCwo} disabled={busy || !cwo.netQuantity || !products.length}>เปิดใบสั่ง</button></div>
      </Card>

      <Card>
        <SectionTitle caption="SKU ผลลัพธ์ต้องมีรหัส FlowAccount อยู่แล้ว ไม่งั้นระบบจะปฏิเสธ">เปิดใบสั่งประกอบ</SectionTitle>
        <fieldset disabled={busy || !recipes.length} className="grid gap-3 md:grid-cols-2">
          <Select label="สูตร (BOM)" options={recipes.map((r) => [r.id, `${r.code} · batch ${r.batchSize}`])} {...bindKwo('recipeId')} />
          <Input label="จำนวนชุดที่วางแผน" type="number" min="1" {...bindKwo('plannedQty')} />
          <Input label="Sales order id" {...bindKwo('salesOrderId')} />
          <Input label="Lot ผลลัพธ์ (ถ้าจำเป็น)" {...bindKwo('outputLotCode')} />
          <Input label="ค่าแรงประกอบ (สตางค์)" type="number" min="0" {...bindKwo('laborCostSatang')} />
          <Select label="จากจุด" options={[['', '(ไม่ระบุ)'], ...locations.map((l) => [l.id, l.code])]} {...bindKwo('sourceLocationId')} />
          <Select label="ไลน์ประกอบ" options={[['', '(ไม่ระบุ)'], ...locations.map((l) => [l.id, l.code])]} {...bindKwo('wipLocationId')} />
          <Select label="คลังสินค้าสำเร็จรูป" options={[['', '(ไม่ระบุ)'], ...locations.map((l) => [l.id, l.code])]} {...bindKwo('targetLocationId')} />
        </fieldset>
        {!recipes.length && <p className="mt-2 text-xs text-muted">ยังไม่มีสูตร (BOM)</p>}
        <div className="mt-3"><button type="button" className="btn btn-primary" onClick={openKwo} disabled={busy || !kwo.plannedQty || !recipes.length}>เปิดใบสั่ง</button></div>
      </Card>
    </div>}
  </div>
}
