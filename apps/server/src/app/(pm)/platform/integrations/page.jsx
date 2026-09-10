'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, CheckCircle2, ChevronRight, KeyRound, MessageSquare, Search, ShieldCheck } from 'lucide-react'

import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { LLM_PROVIDER_CATALOG, providerByKey } from '@/platform/integrations/llm/provider-catalog'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'
import { deriveConnectorCatalog } from '@/platform/integrations/core/connector-catalog'

// @req FR-080 — Platform retains model provider metadata and exposes a read-only
//   LINE status projection. Account identity, webhook and transport settings have
//   one owner in LINE OA Studio.
// @req FR-130 — connector state is derived from the integration read model.
// @spec ADR-032 D1-D4, ADR-060 D2-D3, SEC-016, SDD-044
// @tested tests/unit/fr080-ui-contract.test.js, tests/unit/integrations-page-claims.test.js

const SECRET_REF_ERROR_ID = 'integration-secret-ref-error'
const SECRET_REF_ERROR_TEXT = 'รูปแบบไม่ถูกต้อง — ต้องเป็น supabase-vault:<uuid> เท่านั้น ห้ามวางค่า secret จริงที่นี่'

const HEALTH_HINT = {
  CONNECTED: 'ทำงานปกติ',
  DEGRADED: 'ยังพิสูจน์ไม่ได้ว่าทำงานอยู่',
  ERROR: 'ใช้งานไม่ได้',
  DISABLED: 'ปิดใช้งานอยู่',
  MISCONFIGURED: 'ตั้งค่าไม่ครบ',
}

function HealthPanel({ health, kind }) {
  if (!health) return null
  const { state, reasons = [], evidence = {} } = health
  const lastEvent = evidence.lastEventAt ? new Date(evidence.lastEventAt).toLocaleString() : null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Health</span>
        <StatusPill status={state} />
        <span className="text-muted">{HEALTH_HINT[state] || ''}</span>
      </div>
      {reasons.length > 0 && <ul className="mt-1.5 list-disc pl-4 text-muted">{reasons.map((reason) => <li key={reason} className="font-mono">{reason}</li>)}</ul>}
      {kind === 'CHANNEL' && <p className="mt-1.5 text-muted">รับ event ล่าสุด: {lastEvent || 'ยังไม่เคยรับ event'}</p>}
    </div>
  )
}

function IntegrationRow({ row }) {
  const isChannel = row.kind === 'CHANNEL'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{row.name}</p>
          <p className="mt-0.5 text-[11px] text-muted">{isChannel ? 'Channel' : 'Model provider'} · {row.providerName || row.provider}{isChannel ? '' : ` · ${row.model || 'Model not set'}`}</p>
        </div>
        <StatusPill status={row.status} />
      </div>
      {!isChannel && <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] max-md:grid-cols-1"><div><span className="text-muted">Secret reference</span><p className="font-mono">{row.secretRefMasked || 'ยังไม่ได้ผูก Vault reference'}</p></div><div><span className="text-muted">Version / expiry</span><p>{row.credentialVersion || '—'} · {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'refresh deadline 5m'}</p></div></div>}
      <HealthPanel health={row.health} kind={row.kind} />
    </Card>
  )
}

export default function IntegrationsPage() {
  const scope = useScope()
  const businesses = scope.businesses || []
  const currentBusiness = scope.currentBusiness || scope.shell?.activeBusiness || businesses[0]
  const [activeView, setActiveView] = useState('CATALOG')
  const [filterTab, setFilterTab] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [targetBusinessId, setTargetBusinessId] = useState(currentBusiness?.id || '')
  const selectedBusiness = useMemo(() => businesses.find((business) => business.id === targetBusinessId) || currentBusiness, [businesses, targetBusinessId, currentBusiness])
  const businessId = selectedBusiness?.id || ''

  useEffect(() => {
    setTargetBusinessId(currentBusiness?.id || businesses[0]?.id || '')
  }, [businesses, currentBusiness?.id])

  const integrations = useFetch(`/api/platform/integrations${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`, [businessId])
  const lineRegistry = useFetch(`/api/platform/integrations/line-registry${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`, [businessId])
  const rows = useMemo(() => Array.isArray(integrations.data) ? integrations.data : [], [integrations.data])
  const registryRows = useMemo(() => Array.isArray(lineRegistry.data) ? lineRegistry.data : [], [lineRegistry.data])
  const groupRows = useMemo(() => registryRows.filter((row) => row.kind === 'GROUP'), [registryRows])
  const userRows = useMemo(() => registryRows.filter((row) => row.kind === 'USER'), [registryRows])
  const derivedCatalog = useMemo(() => deriveConnectorCatalog(rows), [rows])
  const filteredCatalog = useMemo(() => derivedCatalog.filter((item) => {
    if (filterTab === 'CONNECTED' && item.state !== 'CONNECTED') return false
    if (filterTab === 'NOT_CONNECTED' && item.state === 'CONNECTED') return false
    const query = searchQuery.trim().toLowerCase()
    return !query || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query) || item.type.toLowerCase().includes(query)
  }), [derivedCatalog, filterTab, searchQuery])

  const [provider, setProvider] = useState('openrouter')
  const [name, setName] = useState('Phase 1 LLM')
  const [model, setModel] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const secretRefTrimmed = secretRef.trim()
  const secretRefInvalid = secretRefTrimmed.length > 0 && !isSupabaseVaultSecretRef(secretRefTrimmed)

  const submitModel = async (event) => {
    event.preventDefault()
    if (secretRefInvalid) return
    setBusy(true); setError(null); setMessage(null)
    try {
      await api('/api/platform/integrations', { method: 'POST', body: { businessId, provider, name: name.trim(), model: model.trim(), secretRef: secretRefTrimmed || undefined } })
      setMessage('บันทึก connection metadata แล้ว')
      setSecretRef('')
      await integrations.reload()
    } catch (caught) {
      setError(caught?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {activeView === 'CATALOG' ? (
        <PageHeader eyebrow="Platform" title="Connectors" subtitle="สถานะ connection และ model metadata ของ Business ที่เลือก" actions={<div className="flex items-center gap-2"><input className="input h-9 text-xs" placeholder="Search connectors…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><select className="input h-9 text-xs" value={targetBusinessId} onChange={(event) => setTargetBusinessId(event.target.value)} aria-label="Business"><option value="">เลือก Business</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></div>} />
      ) : (
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3"><div className="flex items-center gap-3"><button type="button" className="btn btn-secondary h-8 px-2.5 text-xs" onClick={() => setActiveView('CATALOG')}><ArrowLeft size={14} className="mr-1" /> Back to Connectors</button><div><h1 className="text-lg font-bold">{activeView === 'LINE_STATUS' ? 'LINE OA status projection' : 'AI Model & Provider Settings'}</h1><p className="text-[11px] text-muted">{activeView === 'LINE_STATUS' ? 'การตั้งค่าบัญชีและ webhook อยู่ใน LINE OA Studio' : 'ตั้งค่า Vault reference และ Model AI'}</p></div></div><span className="rounded bg-[var(--surface-muted)] px-2.5 py-1 text-[11px] font-semibold text-muted">{selectedBusiness?.name || 'เลือก Business'}</span></div>
      )}

      {activeView === 'CATALOG' && <>
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2.5"><button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filterTab === 'ALL' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted'}`} onClick={() => setFilterTab('ALL')}>All ({filteredCatalog.length})</button><button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filterTab === 'CONNECTED' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted'}`} onClick={() => setFilterTab('CONNECTED')}>Connected</button><button type="button" className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filterTab === 'NOT_CONNECTED' ? 'bg-[var(--foreground)] text-[var(--background)]' : 'text-muted'}`} onClick={() => setFilterTab('NOT_CONNECTED')}>Not connected</button></div>
        {integrations.loading ? <LoadingCard /> : integrations.error ? <ErrorState error={integrations.error} /> : <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">{filteredCatalog.map((item) => { const isLine = item.id === 'line-oa'; const isModel = item.category === 'AI_MODELS' && item.providerCodes.length > 0; const settingsView = isLine ? 'LINE_STATUS' : isModel ? 'MODEL_SETTINGS' : null; const connected = item.state === 'CONNECTED'; return <div key={item.id} data-connector={item.id} data-connector-state={item.state} className="grid grid-cols-12 items-center px-4 py-3"><div className="col-span-6 flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ backgroundColor: item.iconColor }}>{isLine ? <MessageSquare size={16} /> : isModel ? <Bot size={16} /> : item.name.slice(0, 1)}</div><div><p className="flex items-center gap-1.5 text-xs font-bold">{item.name}{isLine && <span className="rounded-full bg-[#06C755]/15 px-2 py-0.5 text-[10px] font-semibold text-[#06C755]">{groupRows.length} Groups Registered</span>}</p><p className="text-[11px] text-muted">{item.description}</p></div></div><div className="col-span-3 flex items-center gap-1.5"><span className="text-xs text-muted">{item.type}</span><span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-muted">{item.badge}</span></div><div className="col-span-3 flex justify-end"><div className="flex items-center gap-2">{connected ? <span className="flex items-center gap-1 text-xs text-[var(--success)]"><CheckCircle2 size={13} /> Connected</span> : <span className="text-xs text-muted">{item.state}</span>}{settingsView && <button type="button" className="btn btn-secondary h-7 px-2 text-[11px] font-semibold" onClick={() => setActiveView(settingsView)}>{isLine ? 'Open LINE OA Studio' : 'Settings'} <ChevronRight size={12} className="ml-0.5" /></button>}</div></div></div> })}</div>}
      </>}

      {activeView === 'LINE_STATUS' && <div className="space-y-4"><Card warm><div className="flex items-start gap-2"><ShieldCheck size={16} style={{ color: 'var(--action-primary)' }} aria-hidden /><p className="text-[11px] leading-5">LINE OA Studio เป็นเจ้าของ account identity, webhook และ transport แล้ว หน้า Platform นี้แสดง status projection เท่านั้น</p></div></Card><Card><SectionTitle caption="Registry read model — แก้ไขที่ LINE OA Studio Projects">LINE registry status</SectionTitle><div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4"><div><span className="text-muted">Group ID</span><p className="font-bold">{groupRows.length}</p></div><div><span className="text-muted">User ID</span><p className="font-bold">{userRows.length}</p></div><div><span className="text-muted">Business</span><p className="font-bold">{selectedBusiness?.name || '—'}</p></div><div><span className="text-muted">Webhook owner</span><p className="font-bold">zuri.command-agent</p></div></div><p className="mt-3 text-[11px] text-muted">BR-011: Platform ไม่ตรวจ challenge และไม่ส่ง reply ไป LINE; ให้ zuri.command-agent ดำเนินการตาม contract</p><div className="mt-4 flex flex-wrap gap-2"><a className="btn btn-primary" href="/line-oa/edge-connection">จัดการบัญชีและ webhook</a><a className="btn btn-secondary" href="/line-oa/projects">จัดการ Group/User registry</a></div></Card></div>}

      {activeView === 'MODEL_SETTINGS' && <><Card warm><div className="flex items-start gap-2"><ShieldCheck size={16} style={{ color: 'var(--action-primary)' }} aria-hidden /><p className="text-[11px] leading-5">สร้าง secret ใน Supabase Dashboard → Vault ก่อน แล้วนำมาใส่เฉพาะ reference รูปแบบ <code>supabase-vault:&lt;uuid&gt;</code> ที่นี่ หน้านี้จะไม่รับหรือแสดงค่า secret จริง</p></div></Card><div className="grid grid-cols-2 gap-4 max-md:grid-cols-1"><Card><SectionTitle caption={selectedBusiness ? `Business ปัจจุบัน: ${selectedBusiness.name}` : 'เลือก Business ก่อนสร้าง connection'}>เพิ่ม connection metadata</SectionTitle><form onSubmit={submitModel}><Field label="Provider"><select className="input" value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Provider">{LLM_PROVIDER_CATALOG.map(({ key, name: providerName }) => <option key={key} value={key}>{providerName}</option>)}</select></Field><Field label="ชื่อ connection"><input className="input" value={name} onChange={(event) => setName(event.target.value)} required aria-label="ชื่อ connection" /></Field><Field label="Model"><input className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder={`เช่น ${providerByKey(provider)?.modelHint ?? ''}`} required aria-label="Model" /></Field><Field label="Supabase Vault reference" hint="ไม่ใช่ API key — ใส่เฉพาะ supabase-vault:<uuid> เท่านั้น"><input className="input font-mono" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} placeholder="supabase-vault:…" aria-label="Supabase Vault reference" aria-invalid={secretRefInvalid} aria-describedby={secretRefInvalid ? SECRET_REF_ERROR_ID : undefined} />
      {secretRefInvalid && (
        <p id={SECRET_REF_ERROR_ID} role="alert" className="mt-0.5 text-[10px] text-[var(--danger)]">{SECRET_REF_ERROR_TEXT}</p>
      )}</Field><button type="submit" className="btn btn-primary" disabled={busy || !businessId || !name.trim() || !model.trim() || secretRefInvalid}><KeyRound size={13} aria-hidden /> {busy ? 'กำลังบันทึก…' : 'บันทึก metadata'}</button></form>{message && <p className="mt-2 text-[11px]" role="status">{message}</p>}{error && <p className="mt-2 text-[11px] text-[var(--danger)]" role="alert">{error}</p>}</Card><div><SectionTitle caption="Model provider ที่สร้างจากหน้านี้ และ LINE OA channel ที่ ingress บันทึกหลักฐานไว้">Connections</SectionTitle>{rows.length === 0 ? <Card><p className="text-[11px] text-muted">ยังไม่มี connection ในขอบเขตนี้</p></Card> : <div className="space-y-3">{rows.map((row) => <IntegrationRow key={row.id} row={row} />)}</div>}</div></div></>}
    </div>
  )
}
