'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Card, ModuleTabs, PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { INVENTORY_TABS } from '@/lib/module-tabs'

// @req FR-184 — the existing Inventory console gains a physical count desk:
// explicit NONE/LOT observations, durable preview, stale refusal and one retry key.
// @spec ADR-074; BR-008; SEC-001
// @tested tests/e2e/fr184-stocktake.spec.js

const inputClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const buttonClass = 'rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const lineInput = ({ productId, locationId, lotId, countedQuantity }) => ({ productId, locationId, lotId, countedQuantity })
const keyOf = line => JSON.stringify([line.productId, line.locationId, line.lotId])

async function request(url, { body, signal } = {}) {
  let response
  try {
    response = await fetch(url, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(body ? 'ยังยืนยันการบันทึกไม่ได้ กรุณาลองคำขอเดิมอีกครั้ง หรือตรวจสถานะที่บันทึกไว้' : 'อ่านข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')
  }
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error(value.error || 'อ่านข้อมูลไม่สำเร็จ'), { status: response.status, details: value.details })
  return value
}
function errorText(error) {
  if (error.message === 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE') return 'ยอดสต็อกเปลี่ยนแล้ว กรุณาตรวจสอบยอดก่อนบันทึกใหม่'
  if (error.message === 'INVENTORY_STOCKTAKE_INCOMPLETE') return 'ยังนับไม่ครบ กรุณาระบุรายการที่ขาด รวมถึงยอดที่ยังไม่ระบุจุดจัดเก็บ'
  if (error.status === 403 || error.status === 404) return 'ไม่พบรายการใน Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ'
  return error.message
}
function setPreviewUrl(id) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('previewId', id)
  else url.searchParams.delete('previewId')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
}

function StocktakeDesk({ businessId }) {
  const alive = useRef(false)
  const operation = useRef(0)
  const [products, setProducts] = useState([])
  const [locations, setLocations] = useState([])
  const [productId, setProductId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [lotId, setLotId] = useState('')
  const [lots, setLots] = useState([])
  const [count, setCount] = useState('')
  const [located, setLocated] = useState(null)
  const [draft, setDraft] = useState([])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const selectedProduct = products.find(row => row.productId === productId)
  const committed = preview?.status === 'COMMITTED'

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    const query = `businessId=${encodeURIComponent(businessId)}`
    Promise.all([
      request(`/api/inventory/stock?${query}`, { signal: controller.signal }),
      request(`/api/inventory/locations?${query}`, { signal: controller.signal }),
    ]).then(([stock, rows]) => {
      if (!alive.current) return
      setProducts(stock.products ?? [])
      setLocations(rows)
    }).catch(error => { if (alive.current && error.name !== 'AbortError') setError(errorText(error)) })
      .finally(() => { if (alive.current) setLoading(false) })

    async function loadSaved() {
      const id = new URL(window.location.href).searchParams.get('previewId')
      const token = ++operation.current
      if (!id) { setPreview(null); return }
      setBusy(true)
      try {
        const saved = await request(`/api/inventory/stocktakes/${encodeURIComponent(id)}?${query}`, { signal: controller.signal })
        if (!alive.current || token !== operation.current) return
        if (saved.businessId !== businessId) throw new Error('รายการไม่ตรงกับ Business ที่เลือก')
        if (saved.status === 'COMMITTED' && (!Number.isInteger(saved.result?.movementCount) || !Array.isArray(saved.result?.lineBalances))) throw new Error('อ่านผลการบันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
        setPreview(saved); setDraft(saved.lines.map(lineInput)); setStale(false)
      } catch (error) {
        if (!alive.current || token !== operation.current || error.name === 'AbortError') return
        setPreview(null); setError(errorText(error))
        if (error.status === 403 || error.status === 404) setPreviewUrl(null)
      } finally { if (alive.current && token === operation.current) setBusy(false) }
    }
    loadSaved()
    window.addEventListener('popstate', loadSaved)
    return () => { alive.current = false; operation.current += 1; controller.abort(); window.removeEventListener('popstate', loadSaved) }
  }, [businessId])

  useEffect(() => {
    setLots([]); setLotId(''); setLocated(null); setCount('')
    if (!productId) return
    const controller = new AbortController()
    const query = `businessId=${encodeURIComponent(businessId)}&productId=${encodeURIComponent(productId)}`
    Promise.all([
      request(`/api/inventory/location-stock?${query}`, { signal: controller.signal }),
      selectedProduct?.trackingMode === 'LOT' ? request(`/api/inventory/lots?${query}`, { signal: controller.signal }) : Promise.resolve([]),
    ]).then(([stock, lotRows]) => { if (!controller.signal.aborted) { setLocated(stock); setLots(lotRows) } })
      .catch(error => { if (!controller.signal.aborted) setError(errorText(error)) })
    return () => controller.abort()
  }, [businessId, productId, selectedProduct?.trackingMode])

  function invalidate() {
    operation.current += 1
    setPreview(null); setStale(false); setError(''); setPreviewUrl(null)
  }
  function addLine(event) {
    event.preventDefault()
    if (busy || committed) return
    if (!selectedProduct || !locationId || (selectedProduct.trackingMode === 'LOT' && !lotId)) {
      setError('กรุณาเลือกสินค้า จุดจัดเก็บ และล็อตให้ครบ'); return
    }
    if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) > 2147483647) {
      setError('จำนวนที่นับได้ต้องเป็นจำนวนเต็มตั้งแต่ 0 ถึง 2,147,483,647'); return
    }
    const line = { productId, locationId: locationId === 'UNLOCATED' ? null : locationId, lotId: selectedProduct.trackingMode === 'LOT' ? lotId : null, countedQuantity: Number(count) }
    if (draft.some(row => keyOf(row) === keyOf(line))) { setError('มีสินค้า จุดจัดเก็บ และล็อตนี้แล้ว กรุณาลบรายการเดิมก่อนแก้จำนวน'); return }
    invalidate(); setDraft(rows => [...rows, { ...line, lotCode: lots.find(row => row.id === lotId)?.code }]); setCount('')
  }
  async function execute(commit) {
    if (busy || committed || !draft.length || (commit && (!preview?.complete || stale))) return
    const token = ++operation.current
    setBusy(true); setError('')
    try {
      const body = commit
        ? { businessId, previewId: preview.previewId, snapshotToken: preview.snapshotToken, idempotencyKey: `stocktake-${preview.previewId}`, lines: preview.lines.map(lineInput) }
        : { businessId, lines: draft.map(lineInput) }
      const result = await request(`/api/inventory/stocktakes/${commit ? 'commit' : 'preview'}`, { body })
      if (!alive.current || token !== operation.current) return
      if (result.businessId !== businessId) throw new Error('รายการไม่ตรงกับ Business ที่เลือก')
      if (commit && (result.status !== 'COMMITTED' || !Number.isInteger(result.result?.movementCount) || !Array.isArray(result.result?.lineBalances))) throw new Error('ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจสถานะที่บันทึกไว้')
      setPreview(result); setDraft(result.lines.map(lineInput)); setStale(false); setPreviewUrl(result.previewId)
      if (commit && productId) {
        try {
          const stock = await request(`/api/inventory/location-stock?businessId=${encodeURIComponent(businessId)}&productId=${encodeURIComponent(productId)}`)
          if (alive.current && token === operation.current) setLocated(stock)
        } catch {
          if (alive.current && token === operation.current) { setLocated(null); setError('บันทึกยอดนับแล้ว แต่อ่านยอดสต็อกล่าสุดไม่สำเร็จ') }
        }
      }
    } catch (error) {
      if (!alive.current || token !== operation.current) return
      setError(errorText(error))
      if (error.message === 'INVENTORY_STOCKTAKE_SNAPSHOT_STALE') setStale(true)
    } finally { if (alive.current && token === operation.current) setBusy(false) }
  }
  const productName = id => products.find(row => row.productId === id)?.name || preview?.lines.find(row => row.productId === id)?.productName || 'สินค้า'
  const locationName = id => id ? locations.find(row => row.id === id)?.name || 'จุดจัดเก็บ' : 'ยังไม่ระบุจุดจัดเก็บ'
  const eligible = products.filter(row => row.stockPolicy === 'TRACKED' && ['NONE', 'LOT'].includes(row.trackingMode) && row.status !== 'ARCHIVED')

  return <div className="space-y-4">
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {committed && <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">บันทึกยอดนับแล้ว · ปรับยอด {preview.result.movementCount} รายการ</div>}
    <Card className="p-4">
      <form onSubmit={addLine} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">สินค้าที่ตรวจนับ<select aria-label="สินค้าที่ตรวจนับ" className={inputClass} value={productId} disabled={loading || busy || committed} onChange={event => setProductId(event.target.value)}><option value="">เลือกสินค้า</option>{eligible.map(row => <option key={row.productId} value={row.productId}>{row.code} · {row.name}</option>)}</select></label>
        <label className="text-sm">จุดจัดเก็บที่ตรวจนับ<select aria-label="จุดจัดเก็บที่ตรวจนับ" className={inputClass} value={locationId} disabled={loading || busy || committed} onChange={event => setLocationId(event.target.value)}><option value="">เลือกจุดจัดเก็บ</option><option value="UNLOCATED">ยังไม่ระบุจุดจัดเก็บ</option>{locations.filter(row => row.status !== 'ARCHIVED').map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        {selectedProduct?.trackingMode === 'LOT' && <label className="text-sm">ล็อตที่ตรวจนับ<select aria-label="ล็อตที่ตรวจนับ" className={inputClass} value={lotId} disabled={busy || committed} onChange={event => setLotId(event.target.value)}><option value="">เลือกลอต</option>{lots.map(row => <option key={row.id} value={row.id}>{row.code}</option>)}</select></label>}
        <label className="text-sm">จำนวนที่นับได้<input aria-label="จำนวนที่นับได้" className={inputClass} inputMode="numeric" value={count} disabled={busy || committed} onChange={event => setCount(event.target.value)} placeholder="ระบุจำนวนจริง รวมถึง 0" /></label>
        <button type="submit" className={`${buttonClass} flex items-center justify-center gap-2 sm:col-span-2`} disabled={loading || busy || committed || !eligible.length}><Plus size={16} />เพิ่มรายการนับ</button>
      </form>
      <p className="mt-3 text-xs text-muted">รองรับสินค้าแบบนับชิ้นและ LOT เท่านั้น การตรวจนับ SERIAL ยังไม่เปิดใช้งาน</p>
      {!loading && !eligible.length && <p className="mt-3 text-sm">ไม่มีสินค้าที่ตรวจนับได้ใน Business นี้</p>}
      {located && <div data-testid="located-summary" className="mt-4 rounded-lg bg-[var(--surface)] p-3 text-sm">
        <p>ยอดรวมทั้ง Business: {located.total} · ยังไม่ระบุจุดจัดเก็บ: {located.unlocated}</p>
        {located.located.map(row => <p key={row.locationId}>{row.code} · {row.name}: {row.onHand}</p>)}
      </div>}
    </Card>
    {draft.length > 0 && <Card className="p-4">
      <h2 className="mb-3 font-semibold">รายการที่นับได้ ({draft.length})</h2>
      <div className="space-y-2">{draft.map((row, index) => <div key={keyOf(row)} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="min-w-0 flex-1"><p className="break-words font-medium">{productName(row.productId)}</p><p>{locationName(row.locationId)} · นับได้ {row.countedQuantity}</p>{row.lotId && <p>ล็อต: {row.lotCode || lots.find(lot => lot.id === row.lotId)?.code || preview?.lines.find(line => line.lotId === row.lotId)?.lotCode || 'เลือกแล้ว'}</p>}</div>
        <button aria-label={`ลบรายการนับ ${index + 1}`} className="rounded-lg p-2 text-red-700 disabled:opacity-40" disabled={busy || committed} onClick={() => { invalidate(); setDraft(rows => rows.filter((_, at) => at !== index)) }}><Trash2 size={17} /></button>
      </div>)}</div>
      {!committed && <button className={`${buttonClass} mt-4 w-full`} disabled={busy} onClick={() => execute(false)}>{busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบยอดก่อนบันทึก'}</button>}
    </Card>}
    {preview && <Card className="p-4" data-testid="stocktake-preview">
      <h2 className="font-semibold">{committed ? 'ผลการตรวจนับที่บันทึกไว้' : 'ตรวจทานยอดก่อนบันทึก'}</h2>
      {!preview.complete && <div className="mt-2 text-sm text-amber-800"><p>ยังนับไม่ครบ · เพิ่มรายการต่อไปนี้ก่อนยืนยัน</p>{preview.missingBuckets.map(row => <p key={keyOf(row)}>{productName(row.productId)} · {locationName(row.locationId)}{row.lotId ? ` · ล็อต ${lots.find(lot => lot.id === row.lotId)?.code || row.lotId}` : ''} · ในระบบ {row.expectedQuantity}</p>)}</div>}
      <div className="mt-3 space-y-3">{preview.lines.map(line => <div key={keyOf(line)} className="rounded-lg border border-[var(--border)] p-3 text-sm">
        <p className="font-medium">{line.productCode} · {line.productName || productName(line.productId)}</p>
        <p>{line.locationName || locationName(line.locationId)}{line.lotCode ? ` · ล็อต ${line.lotCode}` : ''}</p>
        <div className="mt-2 grid grid-cols-3 gap-2"><p>ในระบบ<br /><strong>{line.expectedQuantity}</strong></p><p>นับได้<br /><strong>{line.countedQuantity}</strong></p><p>ส่วนต่าง<br /><strong>{line.variance > 0 ? '+' : ''}{line.variance}</strong></p></div>
        {committed && <p className="mt-2">ยอดหลังบันทึก: <strong>{preview.result.lineBalances.find(row => keyOf(row) === keyOf(line))?.postCommitQuantity ?? 'อ่านผลไม่ได้'}</strong></p>}
      </div>)}</div>
      {!committed && <button className={`${buttonClass} mt-4 w-full`} disabled={busy || !preview.complete || stale} onClick={() => execute(true)}>ยืนยันบันทึกยอดนับ</button>}
      {committed && <button className="mt-4 w-full rounded-lg border border-[var(--border)] px-4 py-2 text-sm" onClick={() => { invalidate(); setDraft([]); setCount('') }}>เริ่มรายการนับใหม่</button>}
    </Card>}
  </div>
}

export default function InventoryStocktakesPage() {
  const { currentBusiness } = useScope()
  return <div className="space-y-5">
    <PageHeader title="ตรวจนับสต็อก" subtitle="ระบุจำนวนจริง ตรวจทานส่วนต่าง แล้วบันทึกพร้อมกันทั้งรายการ" />
    <ModuleTabs tabs={INVENTORY_TABS} />
    {currentBusiness?.id ? <StocktakeDesk key={currentBusiness.id} businessId={currentBusiness.id} /> : <Card className="p-4">เลือก Business ก่อนตรวจนับสินค้า</Card>}
  </div>
}
