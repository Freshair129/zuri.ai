'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Save, FlaskConical } from 'lucide-react'
import { Card, ModuleTabs, PageHeader, SectionTitle } from '@/components/ui'
import { COMMERCE_TABS } from '@/lib/module-tabs'
import { useScope } from '@/context/ScopeContext'
import PricingCatalogSubmit from '@/modules/commerce/ui/PricingCatalogSubmit'
import { Field, SelectField, PricingVariables, PricingFormulas, PricingPreviewInputs, PricingResults, PricingDiff, emptyPreviewInput } from '@/modules/commerce/ui/PricingRulesEditor'

// @req FR-252 — Business OWNER policy editor, exact server preview, immutable approval history.
// @spec ADR-097, SEC-001
// @tested tests/unit/pricing-rules-ui.test.js, tests/e2e/fr252-pricing-rules.spec.js

const BASE = '/api/commerce/pricing-rules'
const TABS = [['formulas', 'สูตร'], ['variables', 'ตัวแปร'], ['preview', 'ทดลองคำนวณ'], ['versions', 'เปรียบเทียบและประวัติ']]
const clone = (value) => JSON.parse(JSON.stringify(value))
const displayDate = (value) => value ? new Date(value).toLocaleString('th-TH') : '—'
function statusLabel(rule) {
  if (rule.status === 'DRAFT') return 'ร่าง'
  if (rule.status === 'REVOKED') return 'ถอนสิทธิ์แล้ว'
  if (rule.isActive) return 'ใช้งานอยู่'
  if (rule.expiresAt && new Date(rule.expiresAt) <= new Date()) return 'หมดอายุ'
  return rule.effectiveFrom && new Date(rule.effectiveFrom) > new Date() ? 'รอวันมีผล' : 'อนุมัติแล้ว'
}
async function api(url, method = 'GET', body, signal) {
  const response = await fetch(url, { method, signal, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) {
    const error = new Error(response.status === 409 ? 'มีผู้แก้ไขรุ่นนี้แล้ว กรุณาโหลดใหม่ก่อนบันทึกอีกครั้ง' : response.status === 404 || response.status === 403 ? 'ไม่พบข้อมูลหรือไม่มีสิทธิ์จัดการสูตรของ Business นี้ (ต้องเป็น OWNER)' : result.error || 'ไม่สามารถดำเนินการได้')
    error.details = result.details || []; error.status = response.status; throw error
  }
  return result
}

export function BusinessPricingConsole({ businessId }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null), [rules, setRules] = useState(null), [name, setName] = useState('')
  const [sourceId, setSourceId] = useState(null), [tab, setTab] = useState('formulas')
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [message, setMessage] = useState('')
  const [input, setInput] = useState(emptyPreviewInput), [preview, setPreview] = useState(null)
  const [reason, setReason] = useState(''), [effectiveFrom, setEffectiveFrom] = useState(''), [expiresAt, setExpiresAt] = useState('')
  const controller = useRef(null), alive = useRef(false), loadGeneration = useRef(0), editGeneration = useRef(0)
  const editable = data?.canManage === true && (!selected || selected.status === 'DRAFT')
  const active = data?.rules.find((rule) => rule.isActive)
  const dirty = !selected || selected.name !== name || JSON.stringify(selected.rules) !== JSON.stringify(rules)
  const clearPreview = () => { editGeneration.current += 1; setPreview(null) }
  const choose = (rule, template) => {
    setSelected(rule || null); setRules(clone(rule?.rules || template)); setName(rule?.name || ''); setSourceId(rule?.sourceRuleSetId || null)
    setReason(''); setError(null); setMessage(''); clearPreview()
  }
  async function load(preferredId) {
    const generation = ++loadGeneration.current
    setLoading(true)
    try {
      const response = await api(`${BASE}?businessId=${encodeURIComponent(businessId)}`, 'GET', undefined, controller.current?.signal)
      if (!alive.current || generation !== loadGeneration.current) return
      setData(response)
      const next = response.rules.find((rule) => rule.id === preferredId) || response.rules.find((rule) => rule.isActive) || response.rules[0]
      choose(next, response.template)
    } catch (err) { if (alive.current && err.name !== 'AbortError' && generation === loadGeneration.current) { setData(null); setError(err) } }
    finally { if (alive.current && generation === loadGeneration.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true; controller.current = new AbortController(); load()
    return () => { alive.current = false; loadGeneration.current += 1; editGeneration.current += 1; controller.current.abort() }
    // The parent keys this console by Business, clearing policy and outstanding requests on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])
  const changeRules = (next) => { clearPreview(); setRules(next); setError(null) }
  const changeInput = (next) => { clearPreview(); setInput(next); setError(null) }
  async function action(run) {
    setBusy(true); setError(null); setMessage('')
    try { await run() } catch (err) { if (alive.current && err.name !== 'AbortError') setError(err) }
    finally { if (alive.current) setBusy(false) }
  }
  const save = () => action(async () => {
    const body = { businessId, name: name.trim(), rules, ...(selected ? { version: selected.version, reason } : sourceId ? { sourceRuleSetId: sourceId } : {}) }
    const result = await api(selected ? `${BASE}/${selected.id}` : BASE, selected ? 'PATCH' : 'POST', body, controller.current.signal)
    if (!alive.current) return
    const saved = result.rule || result
    clearPreview()
    setSelected(saved); setRules(clone(saved.rules)); setName(saved.name)
    setData((current) => ({ ...current, rules: [saved, ...current.rules.filter((r) => r.id !== saved.id)] }))
    setMessage('บันทึกร่างแล้ว · ยังไม่ใช่สูตรที่อนุมัติใช้งาน')
  })
  const simulate = () => action(async () => {
    const generation = editGeneration.current
    const submittedInput = clone(input)
    if (!submittedInput.productCode.trim()) delete submittedInput.productCode
    const body = { businessId, rules, input: submittedInput, ...(active ? { compareRuleSetId: active.id } : {}) }
    const quantities = rules.profiles?.[input.profile]?.breaks || []
    const [result, ...tiers] = await Promise.all([api(`${BASE}/preview`, 'POST', body, controller.current.signal), ...quantities.map(async (quantity) => ({ quantity, ...await api(`${BASE}/preview`, 'POST', { ...body, input: { ...submittedInput, quantity } }, controller.current.signal) }))])
    if (!alive.current || generation !== editGeneration.current) return
    setPreview({ ...result, tiers }); setMessage('ตรวจสูตรและคำนวณสำเร็จ · เป็นผลทดลอง ไม่ได้เผยแพร่ราคา')
  })
  const transition = (type) => action(async () => {
    await api(`${BASE}/${selected.id}/actions`, 'POST', { businessId, version: selected.version, action: type, reason: reason.trim(), ...(type === 'APPROVE' ? { ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) } : {}) }, controller.current.signal)
    if (!alive.current) return
    await load(selected.id)
    if (alive.current) setMessage(type === 'APPROVE' ? 'อนุมัติรุ่นแล้วตามวันมีผล · ยังไม่ได้เผยแพร่ราคาขายเข้า GenesisRAG17' : 'ถอนสิทธิ์รุ่นแล้ว ระบบไม่ใช้รุ่นนี้คำนวณราคาใหม่')
  })
  const newDraft = (from) => { choose(null, from?.rules || data.template); setSourceId(from?.id || null); setName(from ? `${from.name} (รุ่นใหม่)` : ''); setTab('formulas') }

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><button type="button" className="btn inline-flex items-center gap-2" disabled={busy || loading} onClick={() => load(selected?.id)}><RefreshCw size={15} />โหลดใหม่</button>{data?.canManage && <button type="button" className="btn" disabled={busy || loading} onClick={() => newDraft(null)}>ร่างใหม่จากแม่แบบ</button>}</div>
    {loading && <p role="status" className="text-sm text-muted">กำลังโหลดสูตรของ Business…</p>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error.message}</p>{error.details?.map((detail, i) => <p key={i}>{detail.field}: {detail.message}</p>)}</div>}
    {message && <p role="status" className="rounded-lg bg-[var(--brand-tint)] p-3 text-sm">{message}</p>}
    {!loading && data && !data.canManage && <Card><p>ไม่มีสิทธิ์จัดการสูตรราคา ต้องเป็น OWNER ของ Business นี้</p></Card>}
    {!loading && data?.canManage && rules && <>
      {!data.rules.length && <Card><p className="text-sm">ยังไม่มีชุดสูตรใน Business นี้ เริ่มจากแม่แบบที่มีที่มา แล้วบันทึกและอนุมัติก่อนใช้งาน</p></Card>}
      <Card><div className="grid gap-3 md:grid-cols-3"><SelectField label="ชุดสูตรที่เลือก" disabled={busy} value={selected?.id || ''} options={[['', 'ร่างใหม่'], ...data.rules.map((rule) => [rule.id, `${rule.name} · v${rule.version} · ${statusLabel(rule)}`])]} onChange={(e) => choose(data.rules.find((rule) => rule.id === e.target.value), data.template)} /><Field label="ชื่อชุดสูตร" disabled={!editable || busy} value={name} onChange={(e) => setName(e.target.value)} /><div className="text-sm"><p>สถานะ: <strong>{selected ? statusLabel(selected) : 'ร่างใหม่'}</strong></p><p>รุ่นบันทึก: {selected?.version ?? 'ยังไม่บันทึก'}</p><p>มีผล: {displayDate(selected?.effectiveFrom)}</p><p>หมดอายุ: {displayDate(selected?.expiresAt)}</p></div></div>{!editable && <div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-sm text-muted">รุ่นที่อนุมัติหรือถอนสิทธิ์แล้วแก้ไขย้อนหลังไม่ได้</p><button type="button" disabled={busy} className="btn" onClick={() => newDraft(selected)}>คัดลอกเป็นร่างรุ่นใหม่</button></div>}<p className="mt-3 text-xs text-muted">สถานะเผยแพร่ความรู้: การอนุมัติสูตรไม่เผยแพร่ราคาอัตโนมัติ ส่งราคาขายจากบัญชีต้นทุนได้ในแท็บทดลองคำนวณ แล้วรอหลักฐานการเผยแพร่</p></Card>
      <div className="flex flex-wrap gap-2" role="group" aria-label="ส่วนจัดการสูตร">{TABS.map(([key, label]) => <button type="button" key={key} className={`btn ${tab === key ? 'btn-primary' : ''}`} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
      <Card>
        {tab === 'formulas' && <><SectionTitle caption="ตรวจนิพจน์และหน่วยบนระบบเมื่อบันทึกหรือทดลองคำนวณ">นิพจน์และขั้นคำนวณ</SectionTitle><PricingFormulas rules={rules} onChange={changeRules} disabled={!editable || busy} errors={error?.details} /></>}
        {tab === 'variables' && <><SectionTitle>ตัวแปรนโยบายราคา</SectionTitle><PricingVariables rules={rules} onChange={changeRules} disabled={!editable || busy} /></>}
        {tab === 'preview' && <><SectionTitle caption="เปรียบเทียบรุ่นที่ใช้งานกับสูตรที่เปิดอยู่ โดยใช้ข้อมูลต้นทุนเดียวกัน">ทดลองคำนวณราคา</SectionTitle><PricingPreviewInputs input={input} onChange={changeInput} disabled={busy} /><button type="button" className="btn btn-primary my-4 inline-flex items-center gap-2" onClick={simulate} disabled={busy}><FlaskConical size={15} />ตรวจสูตรและทดลองคำนวณ</button>{preview ? <PricingResults preview={preview} /> : <p className="text-sm text-muted">กรอกต้นทุนและข้อมูลลัง แล้วทดลองคำนวณก่อนอนุมัติ</p>}<PricingCatalogSubmit key={`${businessId}:${active?.id || 'none'}:${active?.version || 0}:${selected?.id || 'draft'}`} businessId={businessId} activeRule={selected?.id === active?.id && !dirty ? active : null} /></>}
        {tab === 'versions' && <div className="space-y-5"><SectionTitle caption="สูตรเดิมอ้างอิงรุ่นที่ใช้งานอยู่ หรือรุ่นต้นทางของร่าง">เปรียบเทียบและประวัติ</SectionTitle><PricingDiff before={active?.rules || data.rules.find((r) => r.id === sourceId)?.rules || selected?.rules || data.template} after={rules} /><div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-2 text-left font-semibold">ประวัติชุดสูตร</caption><thead><tr><th className="p-2">ชื่อ / รุ่น</th><th className="p-2">สถานะ</th><th className="p-2">เหตุผล</th><th className="p-2">ผู้อนุมัติ</th><th className="p-2">อนุมัติเมื่อ</th><th className="p-2">วันมีผล / หมดอายุ</th></tr></thead><tbody>{data.rules.map((rule) => <tr key={rule.id} className="border-t border-[var(--border)]"><td className="p-2"><button type="button" className="underline" disabled={busy} onClick={() => choose(rule, data.template)}>{rule.name} · v{rule.version}</button></td><td className="p-2">{statusLabel(rule)}</td><td className="p-2">{rule.revocationReason || rule.approvalReason || '—'}</td><td className="p-2">{rule.approvedByPersonId || '—'}</td><td className="p-2">{displayDate(rule.approvedAt)}</td><td className="p-2">{displayDate(rule.effectiveFrom)} / {displayDate(rule.expiresAt)}</td></tr>)}</tbody></table></div></div>}
      </Card>
      <Card><SectionTitle caption="อนุมัติสูตรไม่เปลี่ยนผลคำนวณเก่าย้อนหลัง และไม่เผยแพร่ราคาไป RAG อัตโนมัติ">บันทึกและกำหนดวันมีผล</SectionTitle><div className="grid gap-3 md:grid-cols-3"><Field label="เหตุผลการเปลี่ยนแปลง / อนุมัติ / ถอนสิทธิ์" disabled={busy} value={reason} onChange={(e) => setReason(e.target.value)} /><Field label="วันและเวลามีผล (ว่าง = ทันที)" type="datetime-local" disabled={busy || !editable} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /><Field label="วันและเวลาหมดอายุ (ไม่บังคับ)" type="datetime-local" disabled={busy || !editable} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div><div className="mt-4 flex flex-wrap gap-2">{editable && <><button type="button" className="btn btn-primary inline-flex items-center gap-2" disabled={busy || !name.trim() || !dirty || Boolean(selected && !reason.trim())} onClick={save}><Save size={15} />บันทึกร่าง</button><button type="button" className="btn" disabled={busy || !selected || dirty || !preview || !reason.trim()} onClick={() => transition('APPROVE')}>อนุมัติรุ่นและตั้งวันมีผล</button></>}{selected?.status === 'APPROVED' && <button type="button" className="btn" disabled={busy || !reason.trim()} onClick={() => transition('REVOKE')}>ถอนสิทธิ์รุ่นนี้</button>}</div>{editable && <p className="mt-2 text-xs text-muted">ก่อนอนุมัติ: บันทึกร่าง ทดลองคำนวณสูตรล่าสุด ตรวจแท็บความต่าง และระบุเหตุผลกับวันมีผล</p>}</Card>
    </>}
  </div>
}

export default function PricingRulesPage() {
  const scope = useScope()
  const business = scope.shell.activeBusiness
  return <div><ModuleTabs tabs={COMMERCE_TABS} /><PageHeader eyebrow="Commerce" title="สูตรคำนวณราคา" subtitle={`จัดการสูตร ตัวแปร ทดลองราคา และประวัติการอนุมัติ${business ? ` · ${business.name}` : ''}`} />{business ? <BusinessPricingConsole key={business.id} businessId={business.id} /> : <Card><p className="text-sm text-muted">เลือก Business ก่อนเพื่อจัดการสูตรคำนวณราคา</p></Card>}</div>
}
