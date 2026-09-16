'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react'
import { Card, DataTable, EmptyState, Field, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { COMMERCE_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import PaymentQR from './PaymentQR'

// @req FR-183 — the POS console selects configured Branch/WarehouseLocation
// records, lets the cashier enter each unit price, and submits one atomic
// checkout. Payment remains PENDING until the existing Commerce verifier acts.
// No terminal registry, price catalogue, fabricated recipient, or tax claim is
// created by this surface.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/integration/fr183-pos.test.js

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const PAYMENT_LABEL = { TRANSFER: 'โอนเงิน', CASH: 'เงินสด', QR: 'QR', CARD: 'บัตร', OTHER: 'อื่น ๆ' }
const money = (value) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
const lineTotal = (line) => Math.max(0, (Number(line.qty) || 0) * (Number(line.unitPrice) || 0) - (Number(line.discount) || 0))
const totalOf = (lines) => lines.reduce((sum, line) => sum + lineTotal(line), 0)
const validUnitPrice = (value) => {
  const text = String(value ?? '').trim()
  const amount = Number(text)
  return text !== '' && Number.isFinite(amount) && amount >= 0 && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9
}

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

function Input({ label, ...props }) {
  return <Field label={label}><input className={fieldClass} aria-label={label} {...props} /></Field>
}

function Select({ label, options, ...props }) {
  return <Field label={label}><select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
}

export default function PosWorkspace({ businessId: businessIdProp }) {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = businessIdProp ?? business?.id
  const activeBusinessRef = useRef(businessId)
  const requestGeneration = useRef(0)
  const [catalogue, setCatalogue] = useState(null)
  const [branchId, setBranchId] = useState('')
  const [warehouseLocationId, setWarehouseLocationId] = useState('')
  const [terminalLabel, setTerminalLabel] = useState('')
  const [lines, setLines] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [receivedAmount, setReceivedAmount] = useState('')
  const [bankReference, setBankReference] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    activeBusinessRef.current = businessId
    requestGeneration.current += 1
    return () => { requestGeneration.current += 1 }
  }, [businessId])

  const refresh = useCallback(async () => {
    if (!businessId) { setCatalogue(null); return }
    const generation = ++requestGeneration.current
    const data = await api(`/api/commerce/pos/catalogue?businessId=${encodeURIComponent(businessId)}`)
    if (generation !== requestGeneration.current || activeBusinessRef.current !== businessId) return
    setCatalogue(data)
    setBranchId((current) => current || data.branches?.[0]?.id || '')
    setWarehouseLocationId((current) => current || data.warehouseLocations?.[0]?.id || '')
  }, [businessId])

  useEffect(() => { refresh().catch((err) => { if (activeBusinessRef.current === businessId) setError(err.message) }) }, [refresh, businessId])

  const total = useMemo(() => totalOf(lines), [lines])
  const change = paymentMethod === 'CASH' ? Math.max(0, (Number(receivedAmount) || 0) - total) : 0
  const setLine = (index, name, value) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [name]: value } : line))

  function addProduct(item) {
    setResult(null); setError('')
    setLines((current) => {
      const existing = current.findIndex((line) => line.productId === item.productId)
      if (existing >= 0) return current.map((line, index) => index === existing ? { ...line, qty: String(Number(line.qty || 0) + 1) } : line)
      return [...current, { productId: item.productId, description: '', qty: '1', unitPrice: '', discount: '' }]
    })
  }

  async function checkout() {
    if (!businessId || busy || lines.length === 0) return
    const generation = ++requestGeneration.current
    const requestedBusinessId = businessId
    setBusy(true); setError(''); setResult(null)
    try {
      if (lines.some((line) => !validUnitPrice(line.unitPrice))) throw new Error('กรุณาระบุราคาต่อหน่วยให้ครบทุกรายการ')
      const amount = total
      if (amount <= 0) throw new Error('กรุณาระบุราคาต่อหน่วยที่มากกว่าศูนย์')
      const response = await api('/api/commerce/pos/checkout', 'POST', {
        businessId, branchId, warehouseLocationId, ...(terminalLabel.trim() ? { terminalLabel: terminalLabel.trim() } : {}),
        lines: lines.map((line) => ({ ...(line.productId ? { productId: line.productId } : {}), ...(line.description.trim() ? { description: line.description.trim() } : {}), qty: Number(line.qty), unitPrice: Number(line.unitPrice), ...(line.discount ? { discount: Number(line.discount) } : {}) })),
        payment: { method: paymentMethod, ...(paymentMethod === 'CASH' ? { receivedAmount: Number(receivedAmount) } : { amount, receivedAmount: amount }), ...(bankReference.trim() ? { bankReference: bankReference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      })
      if (generation !== requestGeneration.current || activeBusinessRef.current !== requestedBusinessId) return
      setResult(response); setLines([]); setReceivedAmount(''); setBankReference(''); setNote('')
      setBusy(false)
      await refresh().catch((err) => { if (activeBusinessRef.current === requestedBusinessId) setError(err.message) })
    } catch (err) {
      if (generation === requestGeneration.current && activeBusinessRef.current === requestedBusinessId) setError(err.message)
    } finally {
      if (generation === requestGeneration.current && activeBusinessRef.current === requestedBusinessId) setBusy(false)
    }
  }

  const items = catalogue?.items || []
  return <div>
    <ModuleTabs tabs={COMMERCE_TABS} />
    <PageHeader eyebrow="Commerce · Point of sale" title="POS checkout" subtitle={`ราคาต่อหน่วยระบุโดยแคชเชียร์ · การขายหน้าร้านและการชำระจะถูกบันทึกเพื่อตรวจสอบ${business ? ` · ${business.name}` : ''}`} actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => { if (activeBusinessRef.current === businessId) setError(err.message) })} disabled={busy}><RefreshCw size={15} /> โหลดสต๊อก</button>} />
    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อเปิด POS</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {result && <Card className="mb-4" role="status"><SectionTitle caption="การรับชำระจะตรวจสอบต่อในรายการ Commerce">บันทึกการขายแล้ว</SectionTitle><div className="grid gap-1 text-sm md:grid-cols-3"><p>ออเดอร์ <strong className="font-mono">{result.orderCode}</strong></p><p>การชำระ <strong>{result.paymentCode} · รอตรวจสอบ</strong></p><p>รวม <strong>{money(result.totalAmount)} บาท</strong>{result.paymentMethod === 'CASH' ? ` · เงินทอน ${money(result.changeAmount)} บาท` : ''}</p></div>{result.promptPay?.payload && <PaymentQR payload={result.promptPay.payload} amount={(result.promptPay.amountSatang ?? 0) / 100} />}</Card>}

    {business && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div className="grid gap-4">
        <Card>
          <SectionTitle caption="เลือกเฉพาะ Branch และ WarehouseLocation ที่ active ของ Business นี้">Checkout context</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3"><Select label="สาขา" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={[['', '— เลือกสาขา —'], ...(catalogue?.branches || []).map((branch) => [branch.id, `${branch.code} · ${branch.name}`])]} /><Select label="WarehouseLocation" value={warehouseLocationId} onChange={(e) => setWarehouseLocationId(e.target.value)} options={[['', '— เลือกคลัง —'], ...(catalogue?.warehouseLocations || []).map((location) => [location.id, `${location.code} · ${location.name}`])]} /><Input label="ป้าย terminal (ถ้ามี)" value={terminalLabel} onChange={(e) => setTerminalLabel(e.target.value)} placeholder="ระบุเพื่ออ้างอิงเท่านั้น" /></div>
        </Card>
        <Card>
          <SectionTitle caption="ไม่มีราคาใน catalogue — กรอก manual unitPrice ก่อน Checkout">สินค้า</SectionTitle>
          {items.length === 0 ? <EmptyState title="ยังไม่มีสินค้า active" hint="เพิ่ม Product ใน Inventory ก่อนใช้ POS" /> : <DataTable columns={[{ key: 'code', label: 'SKU' }, { key: 'name', label: 'สินค้า' }, { key: 'stock', label: 'คงเหลือ', render: (item) => item.stockPolicy === 'TRACKED' ? item.onHand : 'ไม่ติดตาม' }, { key: 'action', label: '', render: (item) => <button type="button" className="btn px-2 py-1 text-xs" onClick={() => addProduct(item)} disabled={item.stockPolicy === 'TRACKED' && item.onHand <= 0}><Plus size={14} /> เพิ่ม</button> }]} rows={items} rowKey={(item) => item.productId} />}
        </Card>
      </div>
      <Card>
          <SectionTitle caption="การขาย การชำระ และการตัดสต๊อกจะบันทึกร่วมกันในครั้งเดียว">ตะกร้า <span className="font-normal text-muted">({lines.length} รายการ)</span></SectionTitle>
        {lines.length === 0 ? <EmptyState title="ตะกร้าว่าง" hint="เลือกสินค้าแล้วกรอกราคาเอง" /> : <div className="grid gap-3">{lines.map((line, index) => <div key={`${line.productId || 'manual'}-${index}`} className="rounded-lg border border-[var(--border)] p-3"><div className="mb-2 flex items-center justify-between text-xs font-semibold"><span>{items.find((item) => item.productId === line.productId)?.code || 'รายการกำหนดเอง'}</span><button type="button" className="text-red-700" aria-label={`ลบรายการ ${index + 1}`} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={14} /></button></div><div className="grid gap-2 md:grid-cols-2"><Input label={`รายละเอียด ${index + 1}`} value={line.description} onChange={(e) => setLine(index, 'description', e.target.value)} placeholder={items.find((item) => item.productId === line.productId)?.name || 'ไม่ต้องกรอกเมื่อเลือกสินค้า'} /><Input label={`จำนวน ${index + 1}`} type="number" min="1" step="1" value={line.qty} onChange={(e) => setLine(index, 'qty', e.target.value)} /><Input label={`ราคา/หน่วย ${index + 1}`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(e) => setLine(index, 'unitPrice', e.target.value)} required /><Input label={`ส่วนลด ${index + 1}`} type="number" min="0" step="0.01" value={line.discount} onChange={(e) => setLine(index, 'discount', e.target.value)} /></div><p className="mt-2 text-right text-xs font-semibold">รวมรายการ {money(lineTotal(line))} บาท</p></div>)}</div>}
        <div className="mt-4 border-t border-[var(--border)] pt-3"><p className="flex justify-between text-base font-bold">ยอดรวม <span>{money(total)} บาท</span></p><div className="mt-3 grid gap-3"><Select label="ช่องทางชำระ" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} options={Object.entries(PAYMENT_LABEL).map(([value, label]) => [value, label])} />{paymentMethod === 'CASH' && <Input label="รับเงินสด" type="number" min="0" step="0.01" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} placeholder={`อย่างน้อย ${money(total)}`} />}{paymentMethod !== 'CASH' && <p className="rounded-lg bg-[var(--brand-surface)] p-2 text-xs text-muted">ระบบจะบันทึกยอดชำระเท่ากับยอดออเดอร์และรอตรวจสอบตามขั้นตอนการเงิน{paymentMethod === 'QR' ? ' · ผู้รับ QR ต้องตั้งค่าและยืนยันใน Billing' : ''}</p>}<Input label="อ้างอิงธนาคาร (ถ้ามี)" value={bankReference} onChange={(e) => setBankReference(e.target.value)} /><Input label="หมายเหตุ (ถ้ามี)" value={note} onChange={(e) => setNote(e.target.value)} /></div><p className="mt-2 text-right text-xs text-muted">เงินทอนโดยประมาณ {money(change)} บาท</p><button type="button" className="btn btn-primary mt-3 w-full justify-center" onClick={checkout} disabled={busy || lines.length === 0 || !branchId || !warehouseLocationId || total <= 0 || lines.some((line) => !validUnitPrice(line.unitPrice)) || (paymentMethod === 'CASH' && Number(receivedAmount) < total)}><ShoppingCart size={15} /> {busy ? 'กำลังบันทึก…' : 'Checkout · บันทึกการขาย'}</button></div>
      </Card>
    </div>}
  </div>
}
