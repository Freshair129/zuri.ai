'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Printer, RefreshCw, Save } from 'lucide-react'
import { Card, DataTable, EmptyState, Field, ModuleTabs, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { COMMERCE_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import PaymentQR from './PaymentQR'

// @req FR-186 — the Billing console uses the selected Business, exposes the
// owner configuration flow, and keeps POST preview separate from POST issue.
// Seller identity and PromptPay values come only from persisted configuration;
// this page has no business or recipient defaults.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/integration/fr186-billing.test.js

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const DOCUMENT_LABEL = { INVOICE: 'ใบแจ้งหนี้', RECEIPT: 'ใบเสร็จรับเงิน', TAX_INVOICE: 'ใบกำกับภาษี', ABB_TAX_INVOICE: 'ใบกำกับภาษีอย่างย่อ' }
const STATUS_LABEL = { UNAVAILABLE: 'ยังไม่พร้อมใช้งาน', CONFIGURED: 'พร้อมออกเอกสาร' }

async function api(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}

const money = (value) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
const moneySatang = (value) => money((Number(value) || 0) / 100)
const dateInput = (value) => value ? String(value).slice(0, 10) : ''
const isoDate = (value) => value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null
const newKey = () => globalThis.crypto?.randomUUID?.() || `billing-${Date.now()}-${Math.random().toString(36).slice(2)}`

function linkedDocumentId() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('documentId') || ''
}

function setDocumentLink(id) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('documentId', id)
  else url.searchParams.delete('documentId')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function Input({ label, ...props }) {
  return <Field label={label}><input className={fieldClass} aria-label={label} {...props} /></Field>
}

function Select({ label, options, ...props }) {
  return <Field label={label}><select className={fieldClass} aria-label={label} {...props}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
}

function emptyConfig(branches = []) {
  const branch = branches[0]
  return {
    legalAddress: '', vatRegistered: 'false', vatRateBps: '', vatTreatment: '', taxPolicyVersion: '',
    taxEffectiveAt: '', taxVerifiedAt: '', nonVatDocumentPolicy: '', walkInDocumentPolicy: '',
    promptPayTargetType: '', promptPayTarget: '', promptPayActive: false, promptPayVerifiedAt: '',
    active: true, branchId: branch?.id || '', branchAddress: branch?.address || '', taxBranchCode: branch?.taxBranchCode || '', expectedVersion: undefined,
  }
}

function configFrom(data) {
  const profile = data.profile
  const branch = data.branches?.[0]
  return {
    legalAddress: data.sellerLink?.legalAddress || '',
    vatRegistered: profile?.vatRegistered ? 'true' : 'false', vatRateBps: profile?.vatRateBps ?? '',
    vatTreatment: profile?.vatTreatment || '', taxPolicyVersion: profile?.taxPolicyVersion || '',
    taxEffectiveAt: dateInput(profile?.taxEffectiveAt), taxVerifiedAt: dateInput(profile?.taxVerifiedAt),
    nonVatDocumentPolicy: profile?.nonVatDocumentPolicy || '', walkInDocumentPolicy: profile?.walkInDocumentPolicy || '',
    promptPayTargetType: profile?.promptPayTargetType || '', promptPayTarget: profile?.promptPayTarget || '',
    promptPayActive: profile?.promptPayActive === true, promptPayVerifiedAt: dateInput(profile?.promptPayVerifiedAt),
    active: profile?.active !== false, branchId: branch?.id || '', branchAddress: branch?.address || '',
    taxBranchCode: branch?.taxBranchCode || '', expectedVersion: profile?.version,
  }
}

function buyerForRequest(buyer) {
  if (buyer.source === 'ANONYMOUS_WALK_IN') return { source: buyer.source }
  return { source: buyer.source, name: buyer.name, taxId: buyer.taxId, branchCode: buyer.branchCode, address: buyer.address }
}

function DocumentView({ result }) {
  const snapshot = result?.snapshot
  if (!snapshot) return null
  const order = snapshot.order || {}
  const tax = snapshot.tax || {}
  return <Card className="mt-4" data-testid="billing-document-result">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
      <div><p className="text-xs font-bold">{snapshot.seller?.legalName || snapshot.seller?.businessName || 'ผู้ขายตามการตั้งค่า'}</p><p className="text-[11px] text-muted">{snapshot.seller?.legalAddress || 'ที่อยู่ผู้ขายยังไม่พร้อม'}</p><p className="text-[11px] text-muted">เลขผู้เสียภาษี {snapshot.seller?.taxId || '—'}</p></div>
      <div className="text-right"><p className="text-sm font-bold">{DOCUMENT_LABEL[result.documentType] || result.documentType}</p><p className="font-mono text-xs">{result.documentNumber || 'PREVIEW'}</p><StatusPill status={result.status} /></div>
    </div>
    <div className="grid gap-2 border-b border-[var(--border)] py-3 text-xs md:grid-cols-2">
      <div><p className="font-semibold">ผู้ซื้อ</p><p>{snapshot.buyer?.name || 'ลูกค้าหน้าร้านแบบไม่ระบุชื่อ'}</p><p className="text-muted">{snapshot.buyer?.taxId || '—'} · {snapshot.buyer?.branchCode || '—'}</p><p className="text-muted">{snapshot.buyer?.address || '—'}</p></div>
      <div><p className="font-semibold">ออเดอร์</p><p className="font-mono">{order.code || order.id}</p><p className="text-muted">สถานะการชำระ {order.paymentState || '—'}</p><p className="text-muted">ออกเมื่อ {result.issuedAt ? new Date(result.issuedAt).toLocaleString('th-TH') : 'ยังไม่ออกเลข'}</p></div>
    </div>
    <DataTable columns={[{ key: 'description', label: 'รายการ' }, { key: 'qty', label: 'จำนวน' }, { key: 'unitPrice', label: 'ราคา/หน่วย', render: (line) => moneySatang(line.unitPriceSatang) }, { key: 'total', label: 'รวม', render: (line) => moneySatang(line.lineTotalSatang) }]} rows={order.lines || []} rowKey={(line) => line.id || `${line.productId}-${line.sortOrder}`} />
    <div className="mt-3 ml-auto grid max-w-xs gap-1 text-right text-xs"><span>ก่อนภาษี {money(tax.net)}</span><span>VAT {money(tax.vat)} ({tax.vatRateBps ? `${tax.vatRateBps / 100}%` : 'ไม่จด VAT'})</span><strong className="border-t border-[var(--border)] pt-2 text-sm">รวม {money(tax.gross)} บาท</strong></div>
    {snapshot.promptPay?.payload && <PaymentQR payload={snapshot.promptPay.payload} amount={(snapshot.promptPay.amountSatang ?? 0) / 100} />}
    <div className="mt-3 flex justify-end"><button type="button" className="btn" onClick={() => window.print()}><Printer size={15} /> พิมพ์</button></div>
  </Card>
}

export default function BillingWorkspace({ businessId: businessIdProp }) {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  const businessId = businessIdProp !== undefined ? businessIdProp : business?.id
  const activeBusinessRef = useRef(businessId)
  const requestGeneration = useRef(0)
  const actionGeneration = useRef(0)
  const [orders, setOrders] = useState([])
  const [billing, setBilling] = useState(null)
  const [config, setConfig] = useState(emptyConfig())
  const [selectedOrderId, setSelectedOrderId] = useState('')
  const [documentType, setDocumentType] = useState('RECEIPT')
  const [buyer, setBuyer] = useState({ source: 'ISSUANCE_INPUT', name: '', taxId: '', branchCode: '', address: '' })
  const [includePromptPay, setIncludePromptPay] = useState(false)
  const [preview, setPreview] = useState(null)
  const [issued, setIssued] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')

  useEffect(() => {
    activeBusinessRef.current = businessId
    requestGeneration.current += 1
    actionGeneration.current += 1
    return () => { requestGeneration.current += 1; actionGeneration.current += 1 }
  }, [businessId])

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current
    const actionAtStart = actionGeneration.current
    if (!businessId) {
      if (generation === requestGeneration.current && activeBusinessRef.current === businessId) { setOrders([]); setBilling(null); setConfig(emptyConfig()) }
      return
    }
    const q = `businessId=${encodeURIComponent(businessId)}`
    const documentId = linkedDocumentId()
    const [orderResult, billingResult, linkedDocument] = await Promise.all([
      api(`/api/commerce/orders?${q}&includeClosed=true&limit=50`),
      api(`/api/commerce/billing/config?${q}`),
      documentId ? api(`/api/commerce/billing/documents/${encodeURIComponent(documentId)}`).catch(() => null) : Promise.resolve(null),
    ])
    if (generation !== requestGeneration.current || activeBusinessRef.current !== businessId) return
    setOrders(orderResult.orders || [])
    const linkedForBusiness = linkedDocument?.businessId === businessId
    if (linkedForBusiness && actionGeneration.current === actionAtStart) {
      setSelectedOrderId(linkedDocument.orderId)
      setIssued(linkedDocument)
      setPreview(null)
    } else {
      setSelectedOrderId((current) => current || orderResult.orders?.[0]?.id || '')
      if (!linkedForBusiness && documentId && actionGeneration.current === actionAtStart) {
        setDocumentLink(null)
        setIssued(null)
        setPreview(null)
      }
    }
    if (actionGeneration.current !== actionAtStart) return
    setBilling(billingResult)
    setConfig(configFrom(billingResult))
  }, [businessId])

  useEffect(() => { refresh().catch((err) => { if (activeBusinessRef.current === businessId) setError(err.message) }) }, [refresh, businessId])

  const selectedOrder = useMemo(() => orders.find((order) => order.id === selectedOrderId) || null, [orders, selectedOrderId])
  const patchBuyer = (name, value) => setBuyer((current) => ({ ...current, [name]: value }))
  const patchConfig = (name, value) => setConfig((current) => ({ ...current, [name]: value }))
  const clearDocumentState = () => {
    actionGeneration.current += 1
    setPreview(null); setIssued(null); setDocumentLink(null); setIdempotencyKey('')
  }

  async function saveConfig() {
    if (!businessId || busy) return
    const generation = ++actionGeneration.current
    const requestedBusinessId = businessId
    setBusy(true); setError(''); setMessage('')
    try {
      const selectedBranch = billing?.branches?.find((branch) => branch.id === config.branchId)
      const result = await api(`/api/commerce/billing/config?businessId=${encodeURIComponent(businessId)}`, 'PATCH', {
        legalAddress: config.legalAddress || null,
        vatRegistered: config.vatRegistered === 'true', vatRateBps: config.vatRateBps === '' ? null : Number(config.vatRateBps),
        vatTreatment: config.vatTreatment || null, taxPolicyVersion: config.taxPolicyVersion || null,
        taxEffectiveAt: isoDate(config.taxEffectiveAt), taxVerifiedAt: isoDate(config.taxVerifiedAt),
        nonVatDocumentPolicy: config.nonVatDocumentPolicy || null, walkInDocumentPolicy: config.walkInDocumentPolicy || null,
        promptPayProvider: config.promptPayTarget ? 'PROMPTPAY' : null, promptPayTargetType: config.promptPayTargetType || null,
        promptPayTarget: config.promptPayTarget || null, promptPayActive: config.promptPayActive, promptPayVerifiedAt: isoDate(config.promptPayVerifiedAt), active: config.active,
        ...(config.branchId ? { branchId: config.branchId, branchAddress: config.branchAddress || selectedBranch?.address || null, taxBranchCode: config.taxBranchCode || selectedBranch?.taxBranchCode || null } : {}),
        ...(config.expectedVersion ? { expectedVersion: config.expectedVersion } : {}),
      })
      if (generation !== actionGeneration.current || activeBusinessRef.current !== requestedBusinessId) return
      const merged = { ...billing, ...result, branches: result.branches || billing?.branches || [], sellerLink: result.sellerLink || billing?.sellerLink }
      setBilling(merged); setConfig(configFrom(merged)); setMessage('บันทึกการตั้งค่าแล้ว')
    } catch (err) {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setError(err.message)
    } finally {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setBusy(false)
    }
  }

  function requestBody(withKey = false) {
    return { orderId: selectedOrderId, branchId: config.branchId, documentType, buyer: buyerForRequest(buyer), includePromptPay, ...(withKey ? { idempotencyKey: idempotencyKey || newKey() } : {}) }
  }

  async function previewDocument() {
    if (!selectedOrderId || busy) return
    const generation = ++actionGeneration.current
    const requestedBusinessId = businessId
    setBusy(true); setError(''); setMessage(''); setIssued(null)
    try {
      const result = await api('/api/commerce/billing/documents/preview', 'POST', requestBody())
      if (generation !== actionGeneration.current || activeBusinessRef.current !== requestedBusinessId) return
      setPreview(result); setMessage('สร้างตัวอย่างเอกสารแล้ว — ยังไม่บันทึกเลขเอกสารหรือรายการถาวร')
    } catch (err) {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setError(err.message)
    } finally {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setBusy(false)
    }
  }

  async function issueDocument() {
    if (!selectedOrderId || busy) return
    const generation = ++actionGeneration.current
    const requestedBusinessId = businessId
    const key = idempotencyKey || newKey(); setIdempotencyKey(key)
    setBusy(true); setError(''); setMessage(''); setPreview(null)
    try {
      const result = await api('/api/commerce/billing/documents', 'POST', { ...requestBody(), idempotencyKey: key })
      if (generation !== actionGeneration.current || activeBusinessRef.current !== requestedBusinessId) return
      setIssued(result); setDocumentLink(result.id); setMessage(`ออก ${result.documentNumber} แล้ว · ข้อมูลเอกสารถูกบันทึกแบบแก้ไขไม่ได้`)
    } catch (err) {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setError(err.message)
    } finally {
      if (generation === actionGeneration.current && activeBusinessRef.current === requestedBusinessId) setBusy(false)
    }
  }

  return <div>
    <ModuleTabs tabs={COMMERCE_TABS} />
    <PageHeader eyebrow="Commerce · Billing" title="Billing & tax documents" subtitle={`ออกเอกสารจากออเดอร์ที่มีอยู่ โดยผู้ขายและ PromptPay มาจากการตั้งค่าของ Business${business ? ` · ${business.name}` : ''}`} actions={<button type="button" className="btn" onClick={() => refresh().catch((err) => { if (activeBusinessRef.current === businessId) setError(err.message) })} disabled={busy}><RefreshCw size={15} /> โหลดใหม่</button>} />
    {!business && <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อจัดการเอกสาร</p></Card>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    {business && <>
      <Card className="mb-4">
        <SectionTitle caption="ผู้มีสิทธิ์ของ Business แก้ค่าได้ · Legal name และเลขผู้เสียภาษีอ่านจาก LegalEntity ที่มีอยู่">Issuer, tax & PromptPay configuration</SectionTitle>
        <p className="mb-3 text-xs">สถานะ: <strong>{STATUS_LABEL[billing?.status] || 'ยังไม่ตั้งค่า'}</strong> · LegalEntity: {billing?.sellerLink?.legalName || 'ยังไม่เชื่อมโยง'} · เลขผู้เสียภาษีและการยืนยันตัวตนตั้งที่ LegalEntity</p>
        <fieldset disabled={busy} className="grid gap-x-3 md:grid-cols-3">
          <div className="md:col-span-3"><Input label="ที่อยู่ LegalEntity" value={config.legalAddress} onChange={(e) => patchConfig('legalAddress', e.target.value)} placeholder="ที่อยู่ตามข้อมูลนิติบุคคลที่ยืนยันแล้ว" /></div>
          <Select label="จด VAT" value={config.vatRegistered} onChange={(e) => patchConfig('vatRegistered', e.target.value)} options={[['', '— ยังไม่กำหนด —'], ['false', 'ไม่จด VAT'], ['true', 'จด VAT']]} />
          <Input label="VAT rate (basis points)" type="number" min="0" max="10000" step="1" value={config.vatRateBps} onChange={(e) => patchConfig('vatRateBps', e.target.value)} placeholder="เช่น 700" />
          <Select label="วิธีรวม VAT" value={config.vatTreatment} onChange={(e) => patchConfig('vatTreatment', e.target.value)} options={[['', '— ยังไม่กำหนด —'], ['INCLUSIVE', 'รวม VAT ในราคา'], ['EXCLUSIVE', 'บวก VAT จากราคาสุทธิ']]} />
          <Input label="Tax policy version" value={config.taxPolicyVersion} onChange={(e) => patchConfig('taxPolicyVersion', e.target.value)} placeholder="เวอร์ชันนโยบายที่อนุมัติ" />
          <Input label="Tax effective date" type="date" value={config.taxEffectiveAt} onChange={(e) => patchConfig('taxEffectiveAt', e.target.value)} />
          <Input label="Tax verified date" type="date" value={config.taxVerifiedAt} onChange={(e) => patchConfig('taxVerifiedAt', e.target.value)} />
          <Select label="เอกสารกรณีไม่จด VAT" value={config.nonVatDocumentPolicy} onChange={(e) => patchConfig('nonVatDocumentPolicy', e.target.value)} options={[['', '— ยังไม่กำหนด —'], ['ALLOW_INVOICE_RECEIPT', 'อนุญาต Invoice/Receipt'], ['DENY', 'ไม่อนุญาต']]} />
          <Select label="ลูกค้าหน้าร้านไม่ระบุชื่อ" value={config.walkInDocumentPolicy} onChange={(e) => patchConfig('walkInDocumentPolicy', e.target.value)} options={[['', '— ยังไม่กำหนด —'], ['ALLOW_ANONYMOUS_RECEIPT', 'อนุญาต Receipt เท่านั้น'], ['DENY', 'ไม่อนุญาต']]} />
          <Select label="สาขาที่ออกเอกสาร" value={config.branchId} onChange={(e) => { const branch = billing?.branches?.find((item) => item.id === e.target.value); patchConfig('branchId', e.target.value); patchConfig('branchAddress', branch?.address || ''); patchConfig('taxBranchCode', branch?.taxBranchCode || '') }} options={[['', '— เลือกสาขาที่ตั้งค่าแล้ว —'], ...(billing?.branches || []).map((branch) => [branch.id, `${branch.code} · ${branch.name}`])]} />
          <Input label="ที่อยู่สาขา" value={config.branchAddress} onChange={(e) => patchConfig('branchAddress', e.target.value)} placeholder="ที่อยู่สาขา" />
          <Input label="รหัสสาขาภาษี" value={config.taxBranchCode} onChange={(e) => patchConfig('taxBranchCode', e.target.value)} placeholder="รหัสที่มีอยู่ของสาขา" />
          <Select label="ประเภท PromptPay" value={config.promptPayTargetType} onChange={(e) => patchConfig('promptPayTargetType', e.target.value)} options={[['', '— ยังไม่กำหนด —'], ['MOBILE', 'เบอร์มือถือ'], ['TAX_ID', 'เลขผู้เสียภาษี']]} />
          <Input label="PromptPay recipient" value={config.promptPayTarget} onChange={(e) => patchConfig('promptPayTarget', e.target.value)} placeholder="ค่าที่ผู้ดูแล Business ระบุเอง" />
          <Input label="PromptPay verified date" type="date" value={config.promptPayVerifiedAt} onChange={(e) => patchConfig('promptPayVerifiedAt', e.target.value)} />
          <label className="mb-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={config.promptPayActive} onChange={(e) => patchConfig('promptPayActive', e.target.checked)} />เปิดใช้ PromptPay ที่ยืนยันแล้ว</label>
          <label className="mb-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={config.active} onChange={(e) => patchConfig('active', e.target.checked)} />เปิดใช้โปรไฟล์</label>
        </fieldset>
        <button type="button" className="btn btn-primary" disabled={busy || !billing} onClick={saveConfig}><Save size={15} /> บันทึกการตั้งค่า</button>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <SectionTitle caption="เลือกออเดอร์แล้วสร้างตัวอย่างหรือออกเอกสารตามข้อมูลผู้ซื้อที่ส่งครั้งนี้">Orders</SectionTitle>
          {orders.length === 0 ? <EmptyState title="ยังไม่มีออเดอร์" hint="สร้างออเดอร์จากแท็บ Orders ก่อนออกเอกสาร" /> : <div className="grid max-h-[560px] gap-1 overflow-y-auto">{orders.map((order) => <button key={order.id} type="button" className={`rounded-lg border p-3 text-left text-xs ${selectedOrderId === order.id ? 'border-[var(--action-primary)] bg-[var(--brand-surface)]' : 'border-[var(--border)]'}`} onClick={() => { setSelectedOrderId(order.id); clearDocumentState() }}><span className="font-mono font-semibold">{order.code}</span><span className="float-right">{money(order.total)} บาท</span><span className="mt-1 block text-muted">{order.status} · {order.paymentState}</span></button>)}</div>}
        </Card>
        <Card>
          <SectionTitle caption="ตัวอย่างไม่บันทึกเลขเอกสาร · การออกเอกสารใช้รหัสเดิมเพื่อเรียกดูเอกสารเดิมเมื่อส่งซ้ำ">Document request</SectionTitle>
          {selectedOrder ? <>
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="ประเภทเอกสาร" value={documentType} onChange={(e) => { setDocumentType(e.target.value); clearDocumentState() }} options={Object.entries(DOCUMENT_LABEL).map(([value, label]) => [value, label])} />
              <Select label="สาขา" value={config.branchId} onChange={(e) => { setConfig((current) => ({ ...current, branchId: e.target.value })); clearDocumentState() }} options={[['', '— เลือกจากการตั้งค่า —'], ...(billing?.branches || []).map((branch) => [branch.id, `${branch.code} · ${branch.name}`])]} />
            </div>
            <Select label="แหล่งข้อมูลผู้ซื้อ" value={buyer.source} onChange={(e) => { patchBuyer('source', e.target.value); if (e.target.value === 'ANONYMOUS_WALK_IN') setBuyer({ source: e.target.value, name: '', taxId: '', branchCode: '', address: '' }) }} options={[['ISSUANCE_INPUT', 'ข้อมูลผู้ซื้อที่ส่งในครั้งนี้'], ['ANONYMOUS_WALK_IN', 'ลูกค้าหน้าร้านไม่ระบุชื่อ (Receipt เท่านั้น)']]} />
            {buyer.source === 'ISSUANCE_INPUT' && <div className="grid gap-3 md:grid-cols-2"><Input label="ชื่อผู้ซื้อ" value={buyer.name} onChange={(e) => patchBuyer('name', e.target.value)} /><Input label="เลขผู้เสียภาษีผู้ซื้อ 13 หลัก" value={buyer.taxId} onChange={(e) => patchBuyer('taxId', e.target.value)} /><Input label="รหัสสาขาผู้ซื้อ" value={buyer.branchCode} onChange={(e) => patchBuyer('branchCode', e.target.value)} /><div className="md:col-span-2"><Input label="ที่อยู่ผู้ซื้อ" value={buyer.address} onChange={(e) => patchBuyer('address', e.target.value)} /></div></div>}
            <label className="mb-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={includePromptPay} onChange={(e) => setIncludePromptPay(e.target.checked)} />แนบ PromptPay จากโปรไฟล์ที่ active และ verified</label>
            <div className="flex flex-wrap gap-2"><button type="button" className="btn" disabled={busy || !selectedOrderId} onClick={previewDocument}><FileText size={15} /> Preview</button><button type="button" className="btn btn-primary" disabled={busy || !selectedOrderId} onClick={issueDocument}>ออกเอกสารจริง</button></div>
            {preview && <DocumentView result={preview} />}
            {issued && <DocumentView result={issued} />}
          </> : <p className="text-sm text-muted">เลือกออเดอร์เพื่อเริ่ม</p>}
          {!selectedOrder && issued && <DocumentView result={issued} />}
        </Card>
      </div>
    </>}
  </div>
}
