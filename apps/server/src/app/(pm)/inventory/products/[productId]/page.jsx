'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Card, DataTable, Kpi, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'
import {
  IDENTIFIER_KIND_LABEL,
  IDENTIFIER_KIND_OPTIONS,
  RECORD_STATUS_LABEL,
  UNIT_USAGE_LABEL,
  UNIT_USAGE_OPTIONS,
  conversionBlockReason,
  conversionLabel,
  identifierInputProblem,
  skuConsoleErrorText,
  unitsFor,
  writeBlockReason,
} from '@/modules/inventory/ui/sku-console'

// @req FR-175 — the SKU detail page displays the moving weighted average
//   landed cost, last receipt cost, and stock ledger receipt cost history.
// @req FR-203 — the SKU detail page's identifier desk: the barcodes, GTINs and
//   partner codes a SKU carries, a form that catches a bad GTIN check digit
//   before it is sent, and a two-step RETIRE. When the server refuses a value
//   because another SKU already holds it, the page asks `resolve` who holds it
//   and names that SKU, because "this barcode is already SKU-123" is the whole
//   point of refusing it.
// @req FR-204 — the unit-conversion desk on the same page: a pack size as an
//   integer factor ("1 BOX12 = 12 EA"), its usage, UPDATE and a two-step
//   RETIRE; a service and a serial-tracked SKU say why they take none instead
//   of offering a form that can only fail.
// @spec ADR-083 D3, D4; ADR-074 D3; BR-002, BR-027, BR-037; SEC-001 — `businessId` is the selected
//   Business, sent as a selector the server validates; a SKU from another
//   Business is shown read-only with the reason.
// @tested tests/unit/inventory-sku-console.test.js, tests/unit/inventory-product-page.test.js,
//   tests/e2e/fr203-sku-identifiers-console.spec.js

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { status: response.status, issues: result.issues })
  return result
}

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const POLICY_LABEL = { TRACKED: 'นับสต๊อก', UNTRACKED: 'ไม่นับสต๊อก', SERVICE: 'บริการ' }
const MODE_LABEL = { NONE: 'นับจำนวนรวม', LOT: 'ตาม Lot', SERIAL: 'ตาม Serial' }
const STATUS_LABEL = { ACTIVE: 'ใช้งาน', PHASE_OUT: 'เลิกขาย', ARCHIVED: 'เก็บถาวร' }

function Input({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} aria-label={label} {...props} /></label>
}

function Select({ label, options, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
}

const EMPTY_IDENTIFIER = { kind: 'GTIN', value: '', issuer: '', unit: '' }
const EMPTY_CONVERSION = { unit: '', name: '', factor: '', usage: 'ANY' }

export default function InventoryProductPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = business?.id
  const params = useParams()
  const productId = Array.isArray(params?.productId) ? params.productId[0] : params?.productId

  const [product, setProduct] = useState(null)
  const [identifiers, setIdentifiers] = useState([])
  const [conversions, setConversions] = useState([])
  const [showRetired, setShowRetired] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [holder, setHolder] = useState(null)
  const [message, setMessage] = useState('')
  const [identifier, setIdentifier] = useState(EMPTY_IDENTIFIER)
  const [conversion, setConversion] = useState(EMPTY_CONVERSION)
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)

  const refresh = useCallback(async () => {
    if (!productId || !businessId) { setProduct(null); setIdentifiers([]); setConversions([]); return }
    const retired = `includeRetired=${showRetired ? 'true' : 'false'}`
    try {
      const [row, ids, units] = await Promise.all([
        api(`/api/inventory/products/${encodeURIComponent(productId)}`),
        api(`/api/inventory/products/${encodeURIComponent(productId)}/identifiers?${retired}`),
        api(`/api/inventory/products/${encodeURIComponent(productId)}/unit-conversions?${retired}`),
      ])
      setProduct(row); setIdentifiers(ids); setConversions(units.conversions); setLoadError('')
    } catch (err) {
      setProduct(null); setIdentifiers([]); setConversions([])
      setLoadError(err.status === 404 ? 'ไม่พบ SKU นี้ใน Business ที่เลือก หรือคุณไม่มีสิทธิ์ดู' : skuConsoleErrorText(err))
    }
  }, [productId, businessId, showRetired])

  useEffect(() => { refresh() }, [refresh])

  const activeConversions = useMemo(() => conversions.filter((c) => c.status === 'ACTIVE'), [conversions])
  const unitOptions = useMemo(() => unitsFor(product, activeConversions), [product, activeConversions])
  const blocked = writeBlockReason(product, businessId)
  const conversionBlocked = conversionBlockReason(product)
  const identifierProblem = identifierInputProblem(identifier.kind, identifier.value)
  const factor = Number(conversion.factor)
  const conversionReady = conversion.unit.trim() && Number.isInteger(factor) && factor > 0

  async function run(fn) {
    if (busy) return
    setBusy(true); setError(''); setHolder(null); setMessage('')
    try { setMessage(await fn()); setConfirming(null); await refresh() }
    catch (err) {
      // A taken identifier is refused without naming its holder (a route only
      // passes array details through), so ask resolve — the same lookup an
      // intake makes — and name the SKU that already has it.
      if (err.message === 'INVENTORY_IDENTIFIER_TAKEN') {
        try {
          const found = await api(`/api/inventory/products/resolve?businessId=${encodeURIComponent(businessId)}&identifier=${encodeURIComponent(identifier.value.trim())}`)
          if (found.product && found.product.id !== product?.id) setHolder({ id: found.product.id, code: found.product.code })
          setError(skuConsoleErrorText(err, { holder: found.product && found.product.id !== product?.id ? found.product.code : null }))
        } catch { setError(skuConsoleErrorText(err)) }
      } else {
        setError(skuConsoleErrorText(err))
      }
    } finally { setBusy(false) }
  }

  const addIdentifier = () => run(async () => {
    const row = await api(`/api/inventory/products/${encodeURIComponent(productId)}/identifiers`, 'POST', {
      businessId, kind: identifier.kind, value: identifier.value.trim(),
      ...(identifier.issuer.trim() ? { issuer: identifier.issuer.trim() } : {}),
      ...(identifier.unit && identifier.unit !== product.unit ? { unit: identifier.unit } : {}),
    })
    setIdentifier(EMPTY_IDENTIFIER)
    return `เพิ่ม${IDENTIFIER_KIND_LABEL[row.kind]} ${row.value} แล้ว`
  })

  const retireIdentifier = (row) => run(async () => {
    await api(`/api/inventory/products/${encodeURIComponent(productId)}/identifiers`, 'PATCH', { identifierId: row.id, action: 'RETIRE', version: row.version })
    return `ยกเลิกรหัส ${row.value} แล้ว — รหัสนี้จะใช้กับ SKU อื่นไม่ได้อีก`
  })

  const addConversion = () => run(async () => {
    const row = await api(`/api/inventory/products/${encodeURIComponent(productId)}/unit-conversions`, 'POST', {
      businessId, unit: conversion.unit.trim(), factor, usage: conversion.usage, ...(conversion.name.trim() ? { name: conversion.name.trim() } : {}),
    })
    setConversion(EMPTY_CONVERSION)
    return `เพิ่มหน่วยแปลง ${conversionLabel(row, product.unit)} แล้ว`
  })

  const saveConversion = () => run(async () => {
    const fields = { factor: Number(editing.factor), usage: editing.usage, name: editing.name.trim() || null }
    const row = await api(`/api/inventory/products/${encodeURIComponent(productId)}/unit-conversions`, 'PATCH', { conversionId: editing.id, action: 'UPDATE', version: editing.version, fields })
    setEditing(null)
    return `บันทึกหน่วยแปลง ${conversionLabel(row, product.unit)} แล้ว`
  })

  const retireConversion = (row) => run(async () => {
    await api(`/api/inventory/products/${encodeURIComponent(productId)}/unit-conversions`, 'PATCH', { conversionId: row.id, action: 'RETIRE', version: row.version })
    if (editing?.id === row.id) setEditing(null)
    return `ยกเลิกหน่วยแปลง ${row.unit} แล้ว`
  })

  const confirmButton = (key, label, onConfirm) => confirming === key
    ? <span className="flex gap-1">
      <button type="button" className="btn px-2 py-1 text-xs" style={{ color: 'var(--danger)' }} onClick={onConfirm} disabled={busy}>ยืนยัน{label}</button>
      <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setConfirming(null)} disabled={busy}>ไม่</button>
    </span>
    : <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setConfirming(key)} disabled={busy || Boolean(blocked)}>{label}</button>

  const identifierColumns = [
    { key: 'kind', label: 'ชนิด', render: (r) => IDENTIFIER_KIND_LABEL[r.kind] || r.kind },
    { key: 'value', label: 'รหัส', render: (r) => <span className="font-mono text-xs">{r.value}</span> },
    { key: 'issuer', label: 'ผู้ออกรหัส', render: (r) => r.issuer || '—' },
    { key: 'unit', label: 'ติดอยู่บน', render: (r) => r.unit || product?.unit || '—' },
    { key: 'status', label: 'สถานะ', render: (r) => RECORD_STATUS_LABEL[r.status] || r.status },
    { key: 'action', label: '', render: (r) => r.status === 'ACTIVE' ? confirmButton(`identifier:${r.id}`, 'ยกเลิก', () => retireIdentifier(r)) : null },
  ]
  const conversionColumns = [
    { key: 'unit', label: 'หน่วย', render: (r) => <span className="font-mono text-xs">{conversionLabel(r, product?.unit)}</span> },
    { key: 'name', label: 'ชื่อ', render: (r) => r.name || '—' },
    { key: 'usage', label: 'ใช้กับ', render: (r) => UNIT_USAGE_LABEL[r.usage] || r.usage },
    { key: 'status', label: 'สถานะ', render: (r) => RECORD_STATUS_LABEL[r.status] || r.status },
    {
      key: 'action', label: '', render: (r) => r.status === 'ACTIVE'
        ? <span className="flex gap-1">
          <button type="button" className="btn px-2 py-1 text-xs" onClick={() => { setConfirming(null); setEditing({ id: r.id, version: r.version, unit: r.unit, factor: String(r.factor), usage: r.usage, name: r.name || '' }) }} disabled={busy || Boolean(blocked)}>แก้ไข</button>
          {confirmButton(`conversion:${r.id}`, 'ยกเลิก', () => retireConversion(r))}
        </span>
        : null,
    },
  ]
  const costColumns = [
    { key: 'occurredAt', label: 'วันที่รับของ', render: (r) => r.occurredAt ? new Date(r.occurredAt).toLocaleDateString('th-TH') : '—' },
    { key: 'reference', label: 'อ้างอิง', render: (r) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
    { key: 'quantity', label: 'จำนวน', render: (r) => `${r.quantity} ${product?.unit || ''}` },
    { key: 'costSatang', label: 'ต้นทุนต่อหน่วย', render: (r) => r.costSatang !== null ? `${(r.costSatang / 100).toFixed(2)} ฿` : 'ไม่มีต้นทุน' },
  ]

  const supplierCostColumns = [
    { key: 'minQty', label: 'เริ่มที่', render: (r) => String(r.minQty) + ' ' + (product?.unit || '') },
    { key: 'unitCostBaht', label: 'ต้นทุนโรงงาน', render: (r) => Number(r.unitCostBaht).toFixed(2) + ' ฿ / ' + (product?.unit || '') },
    { key: 'fxRateLocked', label: 'FX ล็อก', render: (r) => String(r.fxRateLocked) + ' ' + r.currency + ' → THB' },
    { key: 'supplier', label: 'ซัพพลายเออร์', render: (r) => r.sheet?.supplier?.name || r.sheet?.supplier?.code || '—' },
    { key: 'sheet', label: 'เวอร์ชัน', render: (r) => <span className="font-mono text-xs">{r.sheet?.code || '—'}</span> },
  ]

  return <div>
    <PageHeader
      eyebrow="Inventory · SKU"
      title={product ? product.code : 'รายละเอียด SKU'}
      subtitle={product ? `${product.name || 'ไม่มีชื่อ'} · ${POLICY_LABEL[product.stockPolicy] || product.stockPolicy} · ${STATUS_LABEL[product.status] || product.status}${business ? ` · ${business.name}` : ''}` : 'บาร์โค้ด รหัสคู่ค้า และหน่วยแปลงของ SKU'}
      actions={<span className="flex gap-2">
        <Link href="/inventory" className="btn"><ArrowLeft size={15} /> กลับไปคลังสินค้า</Link>
        <button type="button" className="btn" onClick={() => refresh()} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>
      </span>}
    />
    <ModuleTabs tabs={INVENTORY_TABS} />

    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อดู SKU</p></Card>}
    {loadError && <p role="alert" className="mb-3 text-sm text-red-700">{loadError}</p>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}{holder && <> · <Link className="underline" href={`/inventory/products/${holder.id}`}>เปิด SKU {holder.code}</Link></>}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {product && <div className="mb-4 grid gap-3 md:grid-cols-5">
      <Kpi label="คงเหลือ" value={product.onHand === null ? '—' : `${product.onHand} ${product.unit}`} meta={product.onHand === null ? 'ไม่มี ledger' : 'คำนวณจาก ledger'} />
      <Kpi label="ต้นทุนเฉลี่ยถ่วงน้ำหนัก" value={product.costing?.weightedAverageLandedCostSatang != null ? `${(product.costing.weightedAverageLandedCostSatang / 100).toFixed(2)} ฿` : '—'} meta={product.costing?.lastReceiptCostSatang != null ? `ล่าสุด ${(product.costing.lastReceiptCostSatang / 100).toFixed(2)} ฿` : 'ยังไม่มีต้นทุนรับเข้า'} />
      <Kpi label="การระบุหน่วย" value={product.stockPolicy === 'TRACKED' ? (MODE_LABEL[product.trackingMode] || product.trackingMode) : '—'} meta={`หน่วยฐาน ${product.unit}`} />
      <Kpi label="รหัสที่ใช้งาน" value={identifiers.filter((r) => r.status === 'ACTIVE').length} meta="บาร์โค้ด / รหัสคู่ค้า" />
      <Kpi label="หน่วยแปลง" value={activeConversions.length} meta={activeConversions.length ? activeConversions.map((c) => c.unit).join(', ') : 'ใช้หน่วยฐานอย่างเดียว'} />
    </div>}

    {business && <>
      {blocked && product && <Card className="mb-4"><p className="text-sm text-muted">{blocked}</p></Card>}

      <Card className="mb-4">
        <SectionTitle caption="ต้นทุนเฉลี่ยถ่วงน้ำหนักเคลื่อนที่ (Moving Weighted Average) จากบันทึกการรับของใน stock ledger · ดูดซับค่าขนส่งเข้าต้นทุนหน่วย">
          ต้นทุนและประวัติการรับเข้า (Landed Cost)
        </SectionTitle>
        <div className="mb-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">ต้นทุนเฉลี่ยถ่วงน้ำหนัก (WAVG)</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">
              {product?.costing?.weightedAverageLandedCostSatang != null
                ? `${(product.costing.weightedAverageLandedCostSatang / 100).toFixed(2)} ฿ / ${product?.unit || ''}`
                : 'ยังไม่มีข้อมูลต้นทุน'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">ต้นทุนรับเข้าครั้งล่าสุด</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">
              {product?.costing?.lastReceiptCostSatang != null
                ? `${(product.costing.lastReceiptCostSatang / 100).toFixed(2)} ฿ / ${product?.unit || ''}`
                : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">จำนวนครั้งที่รับของเข้าสต๊อก</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">
              {product?.costing?.costHistory?.length ?? 0} ครั้ง
            </p>
          </div>
        </div>
        <DataTable
          columns={costColumns}
          rows={product?.costing?.costHistory ?? []}
          rowKey={(r) => r.id}
          empty={<p className="mb-3 text-sm text-muted">ยังไม่มีประวัติการรับเข้าสต๊อกสำหรับ SKU นี้</p>}
        />
      </Card>

      <Card className="mb-4">
        <SectionTitle caption="price break จาก SupplierCostSheet ที่ยืนยันแล้ว · แปลงเป็นบาทด้วย FX ที่ล็อกอยู่กับชีต">
          ต้นทุนโรงงานและข้อมูลลัง
        </SectionTitle>
        <div className="mb-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">หน่วยต่อกล่อง</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{product?.unitsPerCarton ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">CBM ต่อกล่อง</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{product?.cartonCbm ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">กิโลกรัมต่อกล่อง</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{product?.cartonKg ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3">
            <span className="text-xs text-muted">ประเภทขนส่ง</span>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{product?.freightGoodsType || '—'}</p>
          </div>
        </div>
        <DataTable
          columns={supplierCostColumns}
          rows={product?.supplierCostPriceBreaks ?? []}
          rowKey={(r) => r.id}
          empty={<p className="mb-3 text-sm text-muted">ยังไม่มี price break จาก cost sheet ที่ยืนยันแล้ว</p>}
        />
      </Card>

      <label className="mb-3 flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" aria-label="แสดงรายการที่ยกเลิกแล้ว" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> แสดงรายการที่ยกเลิกแล้ว
      </label>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle caption="หนึ่งรหัสเป็นของ SKU เดียว · GTIN ตรวจเลขตรวจสอบ · รหัสที่ยกเลิกแล้วยังกันไม่ให้ใช้ซ้ำ">บาร์โค้ด / รหัสคู่ค้า</SectionTitle>
          <DataTable columns={identifierColumns} rows={identifiers} rowKey={(r) => r.id} empty={<p className="mb-3 text-sm text-muted">ยังไม่มีบาร์โค้ดหรือรหัสคู่ค้า — สแกนหรือ resolve SKU นี้ไม่ได้</p>} />
          <fieldset disabled={busy || Boolean(blocked)} className="mt-3 grid gap-3 md:grid-cols-2">
            <Select label="ชนิดรหัส" options={IDENTIFIER_KIND_OPTIONS} value={identifier.kind} onChange={(e) => setIdentifier((v) => ({ ...v, kind: e.target.value }))} />
            <Input label="รหัส" placeholder={identifier.kind === 'GTIN' ? '8850123456786' : 'ACME-TMB-01'} value={identifier.value} onChange={(e) => setIdentifier((v) => ({ ...v, value: e.target.value }))} />
            <Input label="ผู้ออกรหัส (ถ้ามี)" placeholder="GS1 / ชื่อซัพพลายเออร์" value={identifier.issuer} onChange={(e) => setIdentifier((v) => ({ ...v, issuer: e.target.value }))} />
            <Select label="รหัสนี้ติดอยู่บนหน่วย" options={(unitOptions.length ? unitOptions : [{ unit: '', label: '—' }]).map((u) => [u.unit, u.label])} value={identifier.unit || product?.unit || ''} onChange={(e) => setIdentifier((v) => ({ ...v, unit: e.target.value }))} />
          </fieldset>
          {identifier.value && identifierProblem && <p className="mt-2 text-xs" style={{ color: 'var(--warning)' }}>{identifierProblem}</p>}
          <div className="mt-3"><button type="button" className="btn btn-primary" onClick={addIdentifier} disabled={busy || Boolean(blocked) || Boolean(identifierProblem)}>เพิ่มรหัส</button></div>
        </Card>

        <Card>
          <SectionTitle caption="แพ็ก / กล่อง / ลัง เป็นตัวคูณของหน่วยฐาน ไม่ใช่ SKU ใหม่ · ledger นับหน่วยฐานเสมอ">หน่วยแปลง</SectionTitle>
          {conversionBlocked
            ? <p className="text-sm text-muted">{conversionBlocked}</p>
            : <>
              <DataTable columns={conversionColumns} rows={conversions} rowKey={(r) => r.id} empty={<p className="mb-3 text-sm text-muted">ยังไม่มีหน่วยแปลง — SKU นี้ใช้หน่วยฐาน {product?.unit ?? ''} อย่างเดียว</p>} />
              {editing && <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                <p className="mb-2 text-xs font-semibold">แก้ไขหน่วย {editing.unit}</p>
                <fieldset disabled={busy || Boolean(blocked)} className="grid gap-3 md:grid-cols-3">
                  <Input label={`ตัวคูณ (1 ${editing.unit} = ? ${product?.unit ?? ''})`} type="number" min="1" step="1" value={editing.factor} onChange={(e) => setEditing((v) => ({ ...v, factor: e.target.value }))} />
                  <Select label="ใช้กับงาน" options={UNIT_USAGE_OPTIONS} value={editing.usage} onChange={(e) => setEditing((v) => ({ ...v, usage: e.target.value }))} />
                  <Input label="ชื่อหน่วย" value={editing.name} onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))} />
                </fieldset>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={saveConversion} disabled={busy || !(Number.isInteger(Number(editing.factor)) && Number(editing.factor) > 0)}>บันทึกหน่วยแปลง</button>
                  <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>ยกเลิกการแก้ไข</button>
                </div>
              </div>}
              <fieldset disabled={busy || Boolean(blocked)} className="mt-3 grid gap-3 md:grid-cols-2">
                <Input label="รหัสหน่วย" placeholder="BOX12" value={conversion.unit} onChange={(e) => setConversion((v) => ({ ...v, unit: e.target.value }))} />
                <Input label={`ตัวคูณ (1 หน่วยนี้ = ? ${product?.unit ?? 'หน่วยฐาน'})`} type="number" min="1" step="1" placeholder="12" value={conversion.factor} onChange={(e) => setConversion((v) => ({ ...v, factor: e.target.value }))} />
                <Input label="ชื่อหน่วย (ถ้ามี)" placeholder="กล่อง 12 ชิ้น" value={conversion.name} onChange={(e) => setConversion((v) => ({ ...v, name: e.target.value }))} />
                <Select label="ใช้กับ" options={UNIT_USAGE_OPTIONS} value={conversion.usage} onChange={(e) => setConversion((v) => ({ ...v, usage: e.target.value }))} />
              </fieldset>
              {conversionReady && product && <p className="mt-2 text-xs text-muted">{conversionLabel({ unit: conversion.unit.trim(), factor }, product.unit)}</p>}
              <div className="mt-3"><button type="button" className="btn btn-primary" onClick={addConversion} disabled={busy || Boolean(blocked) || !conversionReady}>เพิ่มหน่วยแปลง</button></div>
            </>}
        </Card>
      </div>
    </>}
  </div>
}
