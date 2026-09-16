'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import { INVENTORY_LOCATION_TYPES } from '@/lib/validation/enums'

// @req FR-182 — the Locations view of the SCM operations console.
// @req FR-174 — where stock is, and the one way it changes place: on-hand per
//   location recomputed from the located ledger, reported BESIDE the
//   Business-wide total with its unlocated remainder rather than instead of it
//   (BR-026), and a transfer form that posts one atomic ISSUE/RECEIPT pair.
// @spec ADR-074 D1, D2; BR-026; SEC-001 — `businessId` is a selector the server
//   validates against the trusted viewer; nothing here widens scope.
// @tested tests/unit/scm-console-routes.test.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'

// The nine buckets, in the order goods actually travel — factory, vessel, port,
// raw store, the two workshop stages, finished goods, quarantine, customer.
const TYPE_LABEL = {
  CN_FACTORY: 'โรงงานจีน (EXW)',
  INTL_SEA_TRANSIT: 'ตู้สินค้าบนเรือ',
  TH_PORT_CUSTOMS: 'ท่าเรือ / ศุลกากร',
  TH_CENTRAL_RAW: 'คลังวัตถุดิบกลาง',
  TH_WIP_CUSTOMIZATION: 'ห้องสกรีน / ยิงเลเซอร์',
  TH_WIP_ASSEMBLY: 'ไลน์ประกอบ',
  TH_FINISHED_GOODS: 'คลังสินค้าสำเร็จรูป',
  TH_QUARANTINE_SCRAP: 'กักกัน / ของเสีย',
  CUSTOMER_SITE: 'หน้างานลูกค้า',
}

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

export default function InventoryLocationsPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const [locations, setLocations] = useState([])
  const [products, setProducts] = useState([])
  const [located, setLocated] = useState(null)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!businessId) { setLocations([]); setProducts([]); setLocated(null); return }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const [locs, stock] = await Promise.all([api(`/api/inventory/locations?${q}`), api(`/api/inventory/stock?${q}`)])
    setLocations(locs)
    setProducts((stock.products ?? []).filter((p) => p.stockPolicy === 'TRACKED'))
  }, [businessId])

  useEffect(() => { refresh().catch((err) => setError(err.message)) }, [refresh])

  const loadLocated = useCallback(async (productId) => {
    if (!businessId || !productId) { setLocated(null); return }
    setLocated(await api(`/api/inventory/location-stock?businessId=${encodeURIComponent(businessId)}&productId=${encodeURIComponent(productId)}`))
  }, [businessId])

  useEffect(() => { loadLocated(selectedProductId).catch((err) => setError(err.message)) }, [selectedProductId, loadLocated])

  const [location, bindLocation, resetLocation] = useForm({ code: '', name: '', type: 'TH_CENTRAL_RAW', isVirtual: 'false' })
  const [move, bindMove, resetMove] = useForm({ productId: '', sourceLocationId: '', targetLocationId: '', quantity: '', lotCode: '', reference: '' })

  async function submit(fn, reset) {
    if (!businessId || busy) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await fn(); reset(); setMessage(result); await refresh(); await loadLocated(selectedProductId) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const createLocation = () => submit(async () => {
    const row = await api('/api/inventory/locations', 'POST', {
      businessId, code: location.code, name: location.name, type: location.type, isVirtual: location.isVirtual === 'true',
    })
    return `สร้างจุดจัดเก็บ ${row.code} (${TYPE_LABEL[row.type] || row.type}) แล้ว`
  }, resetLocation)

  const transfer = () => submit(async () => {
    const row = await api('/api/inventory/transfers', 'POST', {
      businessId,
      productId: move.productId || products[0]?.productId,
      sourceLocationId: move.sourceLocationId,
      targetLocationId: move.targetLocationId,
      quantity: Number(move.quantity),
      ...(move.lotCode ? { lotCode: move.lotCode } : {}),
      ...(move.reference ? { reference: move.reference } : {}),
    })
    return `โอน ${row.quantity} หน่วยแล้ว — ยอดรวมทั้ง Business ไม่เปลี่ยน (${row.onHandAfter})`
  }, resetMove)

  const locationColumns = [
    { key: 'code', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', label: 'ชื่อ' },
    { key: 'type', label: 'ประเภท', render: (r) => TYPE_LABEL[r.type] || r.type },
    { key: 'isVirtual', label: 'เสมือน', render: (r) => r.isVirtual ? 'ใช่ (ไม่ใช่สถานที่ของเรา)' : '—' },
    { key: 'status', label: 'สถานะ' },
  ]

  const locatedColumns = [
    { key: 'code', label: 'จุดจัดเก็บ', render: (r) => <span className="font-mono text-xs">{r.code ?? '—'}</span> },
    { key: 'type', label: 'ประเภท', render: (r) => TYPE_LABEL[r.type] || r.type || '—' },
    { key: 'onHand', label: 'คงเหลือ' },
  ]

  return <div>
    <PageHeader
      eyebrow="Inventory · FEAT-025"
      title="จุดจัดเก็บและการโอนสต็อก"
      subtitle={`เก้าจุดตั้งแต่โรงงานจีนถึงหน้างานลูกค้า · โอนแบบตัดต้นทาง-เพิ่มปลายทางในธุรกรรมเดียว${business ? ` · ${business.name}` : ''}`}
      actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => setError(err.message))} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดูจุดจัดเก็บ</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {business && <div className="mb-4">
      <SectionTitle caption="จุดจัดเก็บถูก archive ไม่ถูกลบ เพราะแถวใน ledger ชี้มาที่มัน">จุดจัดเก็บ</SectionTitle>
      <DataTable columns={locationColumns} rows={locations} rowKey={(r) => r.id} />
    </div>}

    {business && <div className="mb-4">
      <SectionTitle caption="ยอดที่ยังไม่ระบุจุดคือแถวที่เขียนก่อน ADR-074 — รายงานคู่กับยอดรวม ไม่ยัดรวมเข้าจุดใดจุดหนึ่ง">คงเหลือแยกตามจุด</SectionTitle>
      <div className="mb-3 max-w-md">
        <Select
          label="SKU"
          options={[['', 'เลือก SKU'], ...products.map((p) => [p.productId, `${p.code}${p.name ? ` · ${p.name}` : ''}`])]}
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
        />
      </div>
      {located && <>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <Kpi label="ยอดรวมทั้ง Business" value={located.total} />
          <Kpi label="ระบุจุดแล้ว" value={located.located.reduce((sum, r) => sum + r.onHand, 0)} />
          <Kpi label="ยังไม่ระบุจุด" value={located.unlocated} meta="แถวที่เขียนก่อนมีระบบจุดจัดเก็บ" />
        </div>
        <DataTable columns={locatedColumns} rows={located.located} rowKey={(r) => r.locationId} />
      </>}
    </div>}

    {business && <Card>
      <SectionTitle caption="รหัสไม่ซ้ำใน Tenant · isVirtual สำหรับที่ที่ไม่ใช่ของเรา เช่น โรงงานคู่ค้าหรือตู้บนเรือ">จุดจัดเก็บใหม่</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-4">
        <Input label="รหัส" placeholder="LOC-TH-RAW-01" {...bindLocation('code')} />
        <Input label="ชื่อ" placeholder="คลังวัตถุดิบกลาง" {...bindLocation('name')} />
        <Select label="ประเภท" options={INVENTORY_LOCATION_TYPES.map((t) => [t, TYPE_LABEL[t] || t])} {...bindLocation('type')} />
        <Select label="เสมือน" options={[['false', 'ไม่ใช่'], ['true', 'ใช่']]} {...bindLocation('isVirtual')} />
      </fieldset>
      <div className="mt-3"><button type="button" className="btn" onClick={createLocation} disabled={busy || !location.code || !location.name}>สร้างจุดจัดเก็บ</button></div>
    </Card>}

    {business && <Card className="mt-4">
      <SectionTitle caption="ตัดต้นทางและเพิ่มปลายทางในธุรกรรมเดียว — ยอดรวมทั้ง Business ไม่เปลี่ยนโดยโครงสร้าง">โอนสต็อก</SectionTitle>
      <fieldset disabled={busy || locations.length < 2 || !products.length} className="grid gap-3 md:grid-cols-3">
        <Select label="SKU" options={products.map((p) => [p.productId, `${p.code}${p.name ? ` · ${p.name}` : ''}`])} {...bindMove('productId')} />
        <Select label="จากจุด" options={[['', 'เลือกต้นทาง'], ...locations.map((l) => [l.id, `${l.code} · ${l.name}`])]} {...bindMove('sourceLocationId')} />
        <Select label="ไปจุด" options={[['', 'เลือกปลายทาง'], ...locations.map((l) => [l.id, `${l.code} · ${l.name}`])]} {...bindMove('targetLocationId')} />
        <Input label="จำนวน" type="number" min="1" {...bindMove('quantity')} />
        <Input label="Lot (ถ้าระบุ)" placeholder="LOT-2026-09" {...bindMove('lotCode')} />
        <Input label="อ้างอิง" placeholder="CWO-20260910-001" {...bindMove('reference')} />
      </fieldset>
      {locations.length < 2 && <p className="mt-2 text-xs text-muted">ต้องมีจุดจัดเก็บอย่างน้อยสองจุดก่อนจึงจะโอนได้</p>}
      <div className="mt-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={transfer}
          disabled={busy || !move.quantity || !move.sourceLocationId || !move.targetLocationId || locations.length < 2}
        >โอนสต็อก</button>
      </div>
    </Card>}
  </div>
}
