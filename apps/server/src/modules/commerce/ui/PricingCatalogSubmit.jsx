'use client'

import { useEffect, useRef, useState } from 'react'
import { Field, SelectField, money } from './PricingRulesEditor'

// @req FR-252 — explicit approval sends ledger-backed sell prices into governed Knowledge admission.
// @spec ADR-097, ADR-075, SEC-001
// @tested tests/unit/pricing-rules-ui.test.js, tests/e2e/fr252-pricing-rules.spec.js

export default function PricingCatalogSubmit({ businessId, activeRule }) {
  const [products, setProducts] = useState([]), [loading, setLoading] = useState(Boolean(activeRule))
  const [productId, setProductId] = useState(''), [quantities, setQuantities] = useState([]), [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null), [preview, setPreview] = useState(null)
  const controller = useRef(null), alive = useRef(false), attempt = useRef(null)
  useEffect(() => {
    alive.current = true
    controller.current = new AbortController()
    if (activeRule) {
      fetch(`/api/inventory/products?businessId=${encodeURIComponent(businessId)}&status=ACTIVE`, { signal: controller.current.signal })
        .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'ไม่สามารถโหลดรายการสินค้าได้'); return body })
        .then((rows) => { if (alive.current) setProducts(rows) })
        .catch((err) => { if (alive.current && err.name !== 'AbortError') setError(err.message) })
        .finally(() => { if (alive.current) setLoading(false) })
    }
    return () => { alive.current = false; controller.current.abort() }
  }, [businessId, activeRule])
  const invalidate = () => { setPreview(null); setResult(null); setError(''); attempt.current = null }
  async function submit(previewOnly = false) {
    const body = { businessId, productId, quantities: [...quantities].sort((a, b) => a - b), reason: reason.trim(), expectedRuleSetId: activeRule.id, expectedRuleVersion: activeRule.version }
    const signature = JSON.stringify(body)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    setBusy(true); setError(''); setResult(null)
    if (previewOnly) setPreview(null)
    try {
      const response = await fetch('/api/commerce/pricing-rules/catalog', { method: 'POST', signal: controller.current.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, idempotencyKey: attempt.current.key, ...(previewOnly ? { previewOnly: true } : { previewHash: preview.previewHash }) }) })
      const payload = await response.json()
      if (!response.ok) {
        if (alive.current && ['PRICING_CATALOG_PREVIEW_CHANGED', 'PRICING_CATALOG_POLICY_CHANGED'].includes(payload.error)) {
          invalidate()
          throw new Error('ต้นทุนหรือสูตรเปลี่ยนแล้ว กรุณาโหลดสูตรล่าสุดและตรวจราคาอีกครั้งก่อนยืนยัน')
        }
        throw new Error(payload.error || 'ตรวจหรือส่งราคาเข้าคิวไม่สำเร็จ')
      }
      if (alive.current) { if (previewOnly) setPreview(payload); else setResult(payload) }
    } catch (err) { if (alive.current && err.name !== 'AbortError') setError(err.message) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section aria-label="ส่งราคาขายเข้า Knowledge" className="mt-6 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--brand-surface)] p-4">
    <h3 className="text-sm font-bold">ยืนยันราคาขายจากบัญชีต้นทุนและส่งเข้า Knowledge</h3>
    <p className="text-sm text-muted">ระบบใช้ต้นทุนรับเข้าที่มีหลักฐานใน Inventory และสูตรที่อนุมัติใช้งานอยู่ การส่งนี้ไม่ใช้ตัวเลขทดลองด้านบน และต้องผ่าน Quality Gate กับหลักฐานการเผยแพร่ก่อน RAG ใช้งาน</p>
    {!activeRule ? <p className="text-sm">เลือกชุดสูตรที่อนุมัติและใช้งานอยู่ก่อนส่งราคาขาย</p> : <>
      <p className="text-xs">สูตร: {activeRule.name} · รุ่นบันทึก {activeRule.version} · กลุ่มราคาองค์กร</p>
      {loading && <p role="status" className="text-sm">กำลังโหลด SKU ที่มีสิทธิ์…</p>}
      {!loading && !error && !products.length && <p className="text-sm">ยังไม่มี SKU ที่ใช้งานอยู่ใน Business นี้</p>}
      <fieldset disabled={busy || loading} className="grid gap-3 md:grid-cols-2">
        <SelectField label="สินค้าที่จะเผยแพร่ราคา (Inventory SKU)" value={productId} options={[['', 'เลือก SKU'], ...products.map((p) => [p.id, `${p.code}${p.name ? ` · ${p.name}` : ''}`])]} onChange={(e) => { setProductId(e.target.value); invalidate() }} />
        <Field label="เหตุผลยืนยันราคาขายเพื่อส่งเข้า Knowledge" value={reason} onChange={(e) => { setReason(e.target.value); invalidate() }} />
        <fieldset className="md:col-span-2"><legend className="mb-2 text-xs font-semibold">ระดับจำนวนที่จะเผยแพร่ (ชิ้น)</legend><div className="flex flex-wrap gap-4">{activeRule.rules.profiles.corporate.breaks.map((quantity) => <label key={quantity} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`เผยแพร่ระดับ ${quantity} ชิ้น`} checked={quantities.includes(quantity)} onChange={(e) => { setQuantities((current) => e.target.checked ? [...current, quantity] : current.filter((q) => q !== quantity)); invalidate() }} />{quantity}</label>)}</div></fieldset>
      </fieldset>
    </>}
    {error && <p role="alert" className="text-sm text-red-700">ส่งราคาไม่ได้: {error}</p>}
    <button type="button" className="btn" disabled={!activeRule || busy || loading || !productId || !quantities.length || !reason.trim() || Boolean(result) || Boolean(preview)} onClick={() => submit(true)}>ตรวจราคาจาก Inventory</button>
    {preview && <CatalogPriceReview preview={preview} />}
    <button type="button" className="btn btn-primary" disabled={!activeRule || busy || loading || !preview || Boolean(result)} onClick={() => submit(false)}>ยืนยันราคาขายและส่งเข้า Knowledge</button>
    {result && <div role="status" className="space-y-1 text-sm"><p>สถานะรับเข้าคิว: {result.status}</p><p>สถานะการเผยแพร่: {result.publicationStatus || 'UNKNOWN'} · ยังไม่ยืนยันว่า RAG ใช้ราคาใหม่นี้แล้ว</p><p className="break-all text-xs">เอกสารราคา: {result.fileAssetId || '—'}</p></div>}
  </section>
}

export function CatalogPriceReview({ preview }) {
  return <div className="overflow-x-auto rounded-lg bg-white p-3"><table className="w-full text-left text-sm"><caption className="pb-2 text-left font-semibold">ราคาขายจากบัญชีต้นทุนที่จะยืนยัน · รุ่น {preview.ruleVersion}</caption><thead><tr><th className="p-2">จำนวน</th><th className="p-2">ราคาขายต่อชิ้น</th><th className="p-2">ราคาขายรวม</th></tr></thead><tbody>{preview.prices.map((price) => <tr key={price.quantity} className="border-t border-[var(--border)]"><td className="p-2">{price.quantity}</td><td className="p-2">{money(price.unitPriceSatang)}</td><td className="p-2">{money(price.totalPriceSatang)}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-muted">NOT_SUBMITTED · ยังไม่ได้ส่งเข้าคิว ตรวจราคาทุกระดับก่อนยืนยัน หากต้นทุนหรือสูตรเปลี่ยน ระบบจะให้ตรวจใหม่</p></div>
}
