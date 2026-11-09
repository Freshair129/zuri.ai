'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { PROCUREMENT_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import {
  buildSupplierCostSheetCommitPayload,
  createSupplierCostSheetPreviewState,
  supplierCostSheetDetailProductLabel,
  supplierCostSheetErrorMessage,
  supplierCostSheetMappingIssue,
  supplierCostSheetPreviewReducer,
} from '@/modules/procurement/components/cost-sheet-ui'

// @req FR-164, FR-154 — Business-scoped supplier cost-sheet import, Product
//   mapping confirmation, and cost-sheet history/detail.
// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053; ADR-066; SEC-001
// @tested tests/unit/supplier-cost-sheet-ui.test.js, tests/unit/module-tabs.test.js

const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
const STATUS_LABEL = { DRAFT: 'รอยืนยัน', CONFIRMED: 'ยืนยันแล้ว', SUPERSEDED: 'ถูกแทนที่' }
const CONFIDENCE_LABEL = {
  EXACT_PRODUCT_CODE: 'พบรหัส Product ตรงกัน',
  EXACT_IDENTIFIER: 'พบรหัสอ้างอิงตรงกัน',
  UNMATCHED: 'ไม่พบคำแนะนำ',
  AMBIGUOUS: 'พบหลายคำแนะนำ',
}

function responseErrorMessage(payload) {
  const translated = supplierCostSheetErrorMessage(payload)
  const issues = Array.isArray(payload?.issues) ? payload.issues : Array.isArray(payload?.details) ? payload.details : []
  if (issues.length) {
    const descriptions = issues.map((issue) => {
      if (typeof issue === 'string') return issue
      if (issue?.sourceSku) return `${issue.sourceSku}${issue.field ? ` · ${issue.field}` : ''}`
      return JSON.stringify(issue)
    })
    return `${translated || 'ตรวจข้อมูลไม่ผ่าน'}: ${descriptions.join(' · ')}`
  }
  return translated || payload?.error || 'คำขอไม่สำเร็จ กรุณาลองใหม่'
}

async function api(url, options = {}) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(responseErrorMessage(body)), { payload: body, status: response.status })
  return body
}

function money(value, currency = 'THB') {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency, maximumFractionDigits: 4 }).format(value ?? 0)
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString('th-TH') : '—'
}

function productLabel(product) {
  return [product?.code, product?.name].filter(Boolean).join(' · ') || product?.id || 'Product'
}

export default function SupplierCostSheetsPage() {
  const business = useScope().shell.activeBusiness

  return <div>
    <ModuleTabs tabs={PROCUREMENT_TABS} />
    <PageHeader
      eyebrow="Procurement · FEAT-024"
      title="นำเข้าตารางต้นทุนผู้ขาย"
      subtitle={`ตรวจรายการจากไฟล์โรงงานและยืนยันการจับคู่ Product ด้วยตนเอง${business ? ` · ${business.name}` : ''}`}
    />
    {business
      ? <CostSheetWorkspace key={business.id} businessId={business.id} />
      : <Card><p className="text-sm text-muted">เลือก Business ก่อนนำเข้าหรือดู Cost Sheet</p></Card>}
  </div>
}

function CostSheetWorkspace({ businessId }) {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [sheets, setSheets] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fxRateLocked, setFxRateLocked] = useState('')
  const [file, setFile] = useState(null)
  const [previewState, dispatchPreview] = useReducer(supplierCostSheetPreviewReducer, undefined, createSupplierCostSheetPreviewState)
  const [statusFilter, setStatusFilter] = useState('')
  const [detail, setDetail] = useState(null)
  const [selectedSheetId, setSelectedSheetId] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [validationIssues, setValidationIssues] = useState([])
  const [catalogWarning, setCatalogWarning] = useState('')
  const [message, setMessage] = useState('')
  const fileInput = useRef(null)
  const detailGeneration = useRef(0)
  const refreshGeneration = useRef(0)

  const showError = useCallback((err) => {
    setError(err?.message || 'คำขอไม่สำเร็จ กรุณาลองใหม่')
    setValidationIssues(err?.payload?.issues || err?.payload?.details || [])
  }, [])

  const refresh = useCallback(async () => {
    const current = ++refreshGeneration.current
    setLoading(true)
    setError('')
    const query = new URLSearchParams({ businessId, limit: '100' })
    if (statusFilter) query.set('status', statusFilter)
    const productQuery = new URLSearchParams({ businessId })
    const productResult = api(`/api/inventory/products?${productQuery}`).then((value) => ({ value })).catch((err) => ({ error: err }))
    try {
      const [vendorRows, registry, productsResult] = await Promise.all([
        api(`/api/procurement/suppliers?businessId=${encodeURIComponent(businessId)}`),
        api(`/api/procurement/cost-sheets?${query}`),
        productResult,
      ])
      if (current !== refreshGeneration.current) return
      setSuppliers(Array.isArray(vendorRows) ? vendorRows.filter((row) => row.status === 'ACTIVE') : [])
      setSheets(Array.isArray(registry?.sheets) ? registry.sheets : [])
      if (productsResult.error) {
        setProducts([])
        setCatalogWarning(productsResult.error.message)
      } else {
        const rows = Array.isArray(productsResult.value) ? productsResult.value : productsResult.value?.products
        setProducts(Array.isArray(rows) ? rows.filter((row) => row.status !== 'ARCHIVED') : [])
        setCatalogWarning('')
      }
    } catch (err) {
      if (current === refreshGeneration.current) showError(err)
    } finally {
      if (current === refreshGeneration.current) setLoading(false)
    }
  }, [businessId, statusFilter, showError])

  useEffect(() => {
    refresh()
    return () => { refreshGeneration.current += 1 }
  }, [refresh])
  useEffect(() => () => { detailGeneration.current += 1 }, [])

  const preview = previewState.sheet
  const previewLines = Array.isArray(preview?.preview?.lines) ? preview.preview.lines : []
  const sourceSkus = useMemo(() => [...new Set(previewLines.map((line) => line.sku).filter(Boolean))], [previewLines])
  const pendingSkus = sourceSkus.filter((sku) => previewState.mappings[sku]?.confirmed !== true || !previewState.mappings[sku]?.productId)
  const canCommit = Boolean(preview?.status === 'DRAFT' && preview?.id && preview?.preview?.hash && sourceSkus.length && pendingSkus.length === 0)
  const productOptions = useMemo(() => {
    const options = new Map()
    for (const product of products) if (product?.id && product.status !== 'ARCHIVED') options.set(product.id, product)
    for (const line of previewLines) {
      for (const candidate of line.mapping?.candidates || []) {
        if (candidate?.productId && !options.has(candidate.productId)) {
          options.set(candidate.productId, { id: candidate.productId, code: candidate.code, name: candidate.name, status: 'ACTIVE' })
        }
      }
    }
    return [...options.values()].sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')))
  }, [products, previewLines])

  async function downloadTemplate() {
    if (!supplierId || busy) return
    setBusy(true); setError(''); setValidationIssues([]); setMessage('')
    try {
      const query = new URLSearchParams({ businessId, currency: currency.trim() || 'USD', fxRateLocked })
      const response = await fetch(`/api/procurement/cost-sheets/template?${query}`)
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw Object.assign(new Error(responseErrorMessage(body)), { payload: body })
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = 'zuri-supplier-cost-sheet-template.xlsx'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
      setMessage('ดาวน์โหลดแม่แบบแล้ว — กรอก CostSheet แล้วเลือกไฟล์เพื่อทำ Preview')
    } catch (err) { showError(err) }
    finally { setBusy(false) }
  }

  async function previewWorkbook() {
    if (!file || !supplierId || !currency.trim() || !(Number(fxRateLocked) > 0) || busy) return
    setBusy(true); setError(''); setValidationIssues([]); setMessage('')
    const form = new FormData()
    form.append('businessId', businessId)
    form.append('supplierId', supplierId)
    form.append('currency', currency.trim())
    form.append('fxRateLocked', fxRateLocked)
    form.append('file', file)
    try {
      const result = await api('/api/procurement/cost-sheets/xlsx', { method: 'POST', body: form })
      dispatchPreview({ type: 'previewSucceeded', sheet: result.sheet })
      detailGeneration.current += 1
      setDetailLoading(false)
      setSelectedSheetId(result.sheet?.id || '')
      if (result.sheet?.status === 'CONFIRMED') {
        setDetail(result.sheet)
        setMessage(`ไฟล์นี้ตรงกับ Cost Sheet ${result.sheet.code} ที่ยืนยันแล้ว — แสดง Product mappings ที่บันทึกไว้`)
      } else if (result.sheet?.status === 'SUPERSEDED') {
        setDetail(result.sheet)
        setMessage('ไฟล์นี้ตรงกับ Cost Sheet เวอร์ชันที่ถูกแทนที่แล้ว — เปลี่ยนตัวกรองเป็นทุกสถานะเพื่อค้นหาเวอร์ชันล่าสุด')
      } else {
        setDetail(null)
        setMessage(result.replayed ? 'พบ Preview เดิม — ตรวจคำแนะนำและยืนยัน Product ด้วยตนเอง' : `ตรวจไฟล์แล้ว ${result.sheet?.lineCount ?? result.sheet?.preview?.lines?.length ?? 0} รายการ`)
      }
      await refresh()
    } catch (err) { showError(err) }
    finally { setBusy(false) }
  }

  async function commitPreview() {
    const payload = buildSupplierCostSheetCommitPayload({ businessId, sheet: preview, mappings: previewState.mappings })
    if (!payload || !canCommit || busy) return
    setBusy(true); setError(''); setValidationIssues([]); setMessage('')
    try {
      const result = await api('/api/procurement/cost-sheets/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      dispatchPreview({ type: 'commitSucceeded', sheet: result.sheet, replayed: result.replayed })
      detailGeneration.current += 1
      setDetailLoading(false)
      setDetail(result.sheet)
      setSelectedSheetId(result.sheet?.id || '')
      setMessage(result.replayed ? `Cost Sheet ${result.sheet?.code} ยืนยันไว้แล้ว` : `ยืนยัน Cost Sheet ${result.sheet?.code} แล้ว`)
      await refresh()
    } catch (err) { showError(err) }
    finally { setBusy(false) }
  }

  async function openDetail(id) {
    const current = ++detailGeneration.current
    setSelectedSheetId(id)
    setDetail(null)
    setDetailLoading(true); setError(''); setValidationIssues([])
    try {
      const result = await api(`/api/procurement/cost-sheets/${encodeURIComponent(id)}`)
      if (current === detailGeneration.current) setDetail(result)
    } catch (err) { if (current === detailGeneration.current) showError(err) }
    finally { if (current === detailGeneration.current) setDetailLoading(false) }
  }

  function changeSupplier(value) {
    setSupplierId(value)
    dispatchPreview({ type: 'supplierChanged' })
    setError(''); setValidationIssues([]); setMessage('')
  }

  function changeFile(nextFile) {
    setFile(nextFile)
    dispatchPreview({ type: 'fileChanged' })
    setError(''); setValidationIssues([]); setMessage('')
    if (fileInput.current) fileInput.current.value = ''
  }

  function changeInput(setter, value) {
    setter(value)
    dispatchPreview({ type: 'inputChanged' })
    setError(''); setValidationIssues([]); setMessage('')
  }

  const detailLines = detail?.lines?.length ? detail.lines : detail?.preview?.lines || []

  return <div className="space-y-4">
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p>{error}</p>
      {validationIssues.length > 0 && <ul className="mt-2 list-disc pl-5">{validationIssues.map((issue, index) => <li key={index}>{typeof issue === 'string' ? issue : issue?.sourceSku ? `${issue.sourceSku}${issue.field ? ` · ${issue.field}` : ''}` : JSON.stringify(issue)}</li>)}</ul>}
    </div>}
    {message && <p role="status" className="text-sm" style={{ color: 'var(--success)' }}>{message}</p>}

    <Card>
      <SectionTitle caption="เลือกผู้ขายที่ยังใช้งานอยู่และใส่ค่า FX ที่ยืนยันสำหรับไฟล์นี้ — ระบบจะไม่เรียกอัตราแลกเปลี่ยนอัตโนมัติ">นำเข้าไฟล์ต้นทุน</SectionTitle>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-xs font-semibold">ผู้ขาย<select className={fieldClass} aria-label="ผู้ขายสำหรับ Cost Sheet" value={supplierId} onChange={(event) => changeSupplier(event.target.value)}>
          <option value="">— เลือกผู้ขาย —</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}
        </select></label>
        <label className="grid gap-1 text-xs font-semibold">สกุลเงิน<input className={fieldClass} aria-label="สกุลเงินของไฟล์ต้นทุน" value={currency} maxLength={3} onChange={(event) => changeInput(setCurrency, event.target.value.toUpperCase())} placeholder="USD" /></label>
        <label className="grid gap-1 text-xs font-semibold">FX ที่ล็อกไว้<input className={fieldClass} aria-label="อัตราแลกเปลี่ยนที่ล็อกไว้" type="number" min="0.000001" step="any" value={fxRateLocked} onChange={(event) => changeInput(setFxRateLocked, event.target.value)} placeholder="เช่น 34.50" /></label>
        <div className="flex items-end"><button type="button" className="btn" onClick={downloadTemplate} disabled={busy || !supplierId}>ดาวน์โหลดแม่แบบ .xlsx</button></div>
        <label className="grid gap-1 text-xs font-semibold md:col-span-3">ไฟล์ต้นทุน (.xlsx)<input ref={fileInput} className={fieldClass} aria-label="ไฟล์ต้นทุน .xlsx" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => changeFile(event.target.files?.[0] || null)} />
          {file && <span className="font-normal text-muted">เลือกแล้ว: {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MiB</span>}
        </label>
        <div className="flex items-end"><button type="button" className="btn btn-primary" onClick={previewWorkbook} disabled={busy || !supplierId || !file || !currency.trim() || !(Number(fxRateLocked) > 0)}>อ่านไฟล์และทำ Preview</button></div>
      </fieldset>
      <p className="mt-3 text-xs text-muted">ระบบอ่านเฉพาะชีต CostSheet ตามหัวตารางของแม่แบบ ขนาดไฟล์ไม่เกิน 5 MiB และไม่สร้าง SupplierCostLine ก่อนคุณยืนยันทุก SKU</p>
    </Card>

    {preview && <Card>
      <SectionTitle caption={`${preview.code} · ${preview.supplier?.name || suppliers.find((row) => row.id === preview.supplierId)?.name || 'ผู้ขาย'} · ${preview.currency} · FX ${preview.fxRateLocked}`}>Preview และยืนยัน Product</SectionTitle>
      <p className="mb-3 text-sm">{preview.status === 'CONFIRMED'
        ? `ยืนยัน Cost Sheet นี้แล้ว · ${previewLines.length} แถว · ${sourceSkus.length} SKU · แสดง Product mappings ที่บันทึกไว้`
        : preview.status === 'SUPERSEDED'
          ? `Cost Sheet นี้ถูกแทนที่แล้ว · ${previewLines.length} แถว · ${sourceSkus.length} SKU`
          : `ตรวจข้อมูลไฟล์ผ่านแล้ว ${previewLines.length} แถว · ${sourceSkus.length} SKU · ยังไม่ยืนยัน ${pendingSkus.length} SKU`}</p>
      {catalogWarning && <p role="status" className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">โหลดรายการ Product เพิ่มไม่ได้: {catalogWarning} คุณยังเลือกจากคำแนะนำที่ Preview ส่งมาได้; การบันทึกจะตรวจสิทธิ์ Inventory อีกครั้ง</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-left text-sm">
          <thead><tr className="border-b text-xs text-muted"><th className="p-2">SKU ผู้ขาย</th><th className="p-2">ขั้นต่ำ</th><th className="p-2">ต้นทุนต่อหน่วย</th><th className="p-2">ต้นทุนโดยประมาณ</th><th className="p-2">หน่วย/ลัง</th><th className="p-2">CBM · กก.</th><th className="p-2">ประเภทขนส่ง · Lead time</th><th className="p-2">ข้อสังเกตจากการตรวจ</th><th className="p-2">เลือก Product (ไม่ยืนยันอัตโนมัติ)</th></tr></thead>
          <tbody>{previewLines.map((line, index) => {
            const selection = previewState.mappings[line.sku]
            const candidates = Array.isArray(line.mapping?.candidates) ? line.mapping.candidates : []
            const issue = supplierCostSheetMappingIssue(line, previewState.mappings)
            return <tr key={`${line.sku}-${line.minQty}-${index}`} className="border-b align-top">
              <td className="p-2 font-mono text-xs">{line.sku}</td>
              <td className="p-2">{line.minQty}</td>
              <td className="p-2">{money(line.unitCostForeign, preview.currency)}</td>
              <td className="p-2">{money(line.unitCostBaht, 'THB')}</td>
              <td className="p-2">{line.unitsPerCarton ?? '—'}</td>
              <td className="p-2">{line.cartonCbm ?? '—'} · {line.cartonKg ?? '—'}</td>
              <td className="p-2">{line.freightGoodsType || '—'} · {line.leadTimeDays === null || line.leadTimeDays === undefined ? '—' : `${line.leadTimeDays} วัน`}</td>
              <td className="p-2"><span className={issue ? 'text-amber-800' : 'text-green-700'}>{issue || 'ยืนยันแล้ว'}</span></td>
              <td className="p-2">
                <p className="mb-1 text-xs text-muted">{CONFIDENCE_LABEL[line.mapping?.confidence] || 'ไม่มีคำแนะนำ'}{candidates.length > 0 ? `: ${candidates.map(productLabel).join(' / ')}` : ''}</p>
                <select className={fieldClass} aria-label={`จับคู่ Product สำหรับ ${line.sku} ขั้นต่ำ ${line.minQty}`} value={selection?.productId || ''} disabled={busy || preview.status !== 'DRAFT'} onChange={(event) => dispatchPreview({ type: 'mappingChanged', sourceSku: line.sku, productId: event.target.value })}>
                  <option value="">— ยังไม่ยืนยัน —</option>{productOptions.map((product) => <option key={product.id} value={product.id}>{productLabel(product)}</option>)}
                </select>
                {candidates.map((candidate) => <button key={candidate.productId} type="button" className="btn mt-1 mr-1 px-2 py-1 text-xs" disabled={busy || preview.status !== 'DRAFT'} onClick={() => dispatchPreview({ type: 'mappingChanged', sourceSku: line.sku, productId: candidate.productId })}>เลือกคำแนะนำ {productLabel(candidate)}</button>)}
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy || !canCommit} onClick={commitPreview}>{preview.status === 'CONFIRMED' ? 'ยืนยัน Cost Sheet แล้ว' : 'ยืนยัน Cost Sheet และบันทึก'}</button>
        {!canCommit && preview.status === 'DRAFT' && <span className="text-xs text-muted">เลือกและยืนยัน Product ให้ครบทุก SKU ก่อนบันทึก</span>}
        {preview.status === 'SUPERSEDED' && <span className="text-xs text-muted">เปิดเวอร์ชันล่าสุดจากรายการ Cost Sheet ก่อนดำเนินการ</span>}
        {previewState.commitResult && <span role="status" className="text-sm text-green-800">ผลบันทึก: {STATUS_LABEL[previewState.commitResult.sheet?.status] || previewState.commitResult.sheet?.status}</span>}
      </div>
    </Card>}

    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle caption="รายการล่าสุดสูงสุด 100 Cost Sheet ใน Business นี้">Cost Sheet ที่มีอยู่</SectionTitle>
        <div className="flex gap-2">
          <select className={fieldClass} aria-label="กรองสถานะ Cost Sheet" value={statusFilter} disabled={busy} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">ทุกสถานะ</option><option value="DRAFT">รอยืนยัน</option><option value="CONFIRMED">ยืนยันแล้ว</option><option value="SUPERSEDED">ถูกแทนที่</option>
          </select>
          <button type="button" className="btn" onClick={() => refresh()} disabled={loading || busy}>โหลดใหม่</button>
        </div>
      </div>
      {loading ? <p className="text-sm text-muted">กำลังโหลดรายการ…</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead><tr className="border-b text-xs text-muted"><th className="p-2">รหัส</th><th className="p-2">ผู้ขาย</th><th className="p-2">สถานะ</th><th className="p-2">วันที่นำเข้า</th></tr></thead>
          <tbody>{sheets.map((sheet) => <tr key={sheet.id} className={`border-b ${selectedSheetId === sheet.id ? 'bg-[var(--brand-tint)]' : ''}`}>
            <td className="p-2"><button type="button" className="font-mono text-xs underline" onClick={() => openDetail(sheet.id)}>{sheet.code}</button></td>
            <td className="p-2">{sheet.supplier?.name || '—'}</td><td className="p-2">{STATUS_LABEL[sheet.status] || sheet.status}</td><td className="p-2">{dateLabel(sheet.createdAt)}</td>
          </tr>)}</tbody>
        </table>
        {!sheets.length && <p className="py-3 text-sm text-muted">ยังไม่มี Cost Sheet ในสถานะนี้</p>}
      </div>}
    </Card>

    {(detail || detailLoading) && <Card>
      <SectionTitle caption={detail ? `${detail.code} · ${detail.supplier?.name || 'ผู้ขาย'} · ${dateLabel(detail.createdAt)}` : 'กำลังโหลดรายละเอียด'}>รายละเอียด Cost Sheet</SectionTitle>
      {detailLoading && <p className="text-sm text-muted">กำลังโหลด…</p>}
      {detail && <>
        <p className="mb-3 text-sm">สถานะ {STATUS_LABEL[detail.status] || detail.status} · สกุลเงิน {detail.currency} · FX ที่ล็อก {detail.fxRateLocked} · จำนวน {detail.lineCount} แถว</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm">
          <thead><tr className="border-b text-xs text-muted"><th className="p-2">SKU ผู้ขาย</th><th className="p-2">Product</th><th className="p-2">ขั้นต่ำ</th><th className="p-2">ต้นทุน</th><th className="p-2">จำนวน/ลัง</th><th className="p-2">CBM · กก.</th></tr></thead>
          <tbody>{detailLines.map((line, index) => {
            const product = products.find((row) => row.id === line.productId)
            const candidate = detail?.preview?.lines?.find((row) => row.sku === (line.sourceSku || line.sku))?.mapping?.candidates?.find((row) => row.productId === line.productId)
            const productName = supplierCostSheetDetailProductLabel({ status: detail.status, line, product, candidate })
            return <tr key={`${line.sourceSku || line.sku}-${line.minQty}-${index}`} className="border-b">
            <td className="p-2 font-mono text-xs">{line.sourceSku || line.sku}</td><td className="p-2">{productName}</td><td className="p-2">{line.minQty}</td>
            <td className="p-2">{money(line.unitCostBaht ?? line.unitCostForeign, line.unitCostBaht !== undefined ? 'THB' : detail.currency)}</td><td className="p-2">{line.unitsPerCarton ?? '—'}</td><td className="p-2">{line.cartonCbm ?? '—'} · {line.cartonKg ?? '—'}</td>
          </tr>})}</tbody>
        </table>{!detailLines.length && <p className="py-3 text-sm text-muted">Cost Sheet นี้ยังไม่มีรายละเอียดรายการ</p>}</div>
      </>}
    </Card>}

    <p className="text-xs text-muted"><Link className="underline" href="/procurement">กลับหน้าจัดซื้อ</Link></p>
  </div>
}
