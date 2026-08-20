'use client'

import { useMemo, useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'

import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { LLM_PROVIDER_CATALOG, providerByKey } from '@/platform/integrations/llm/provider-catalog'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'

// FR-080 / NFR-008 — a value shaped like a raw secret (or any other non-reference
// text) must be flagged the moment it is typed, not only after the server round
// trip. `isSupabaseVaultSecretRef` is the same pattern the API/service enforce
// (SDD-044), imported rather than re-declared so the client can never drift from
// what the server actually accepts. The message never echoes the entered value —
// a string shaped like a secret must not be restated inside the page (ADR-032 D2).
const SECRET_REF_ERROR_ID = 'integration-secret-ref-error'
const SECRET_REF_ERROR_TEXT = 'รูปแบบไม่ถูกต้อง — ต้องเป็น supabase-vault:<uuid> เท่านั้น ห้ามวางค่า secret จริงที่นี่'

// @req FR-080 — Platform Integrations accepts only connection metadata and an
// opaque Supabase Vault reference; raw credentials stay in the Vault dashboard.
// @req FR-048 — the provider choices are derived from the port's allow-list,
// never hand-copied, so the form cannot offer what the port would reject.
// @spec ADR-032 D1-D4, SEC-016, SDD-044, NFR-008
// @tested tests/unit/fr080-ui-contract.test.js

// FR-080 AC-075.3 — the health field, rendered as a state plus the reasons behind
// it. A pill alone would tell an operator that something is wrong without telling
// them what to fix, which is the whole reason `reasons` is a list and not a boolean.
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
      {reasons.length > 0 && (
        <ul className="mt-1.5 list-disc pl-4 text-muted">
          {reasons.map((reason) => <li key={reason} className="font-mono">{reason}</li>)}
        </ul>
      )}
      {kind === 'CHANNEL' && (
        <p className="mt-1.5 text-muted">
          รับ event ล่าสุด: {lastEvent || 'ยังไม่เคยรับ event'}
        </p>
      )}
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
          <p className="mt-0.5 text-[11px] text-muted">
            {isChannel ? 'Channel' : 'Model provider'} · {row.providerName || row.provider}
            {isChannel ? '' : ` · ${row.model || 'Model not set'}`}
          </p>
        </div>
        <StatusPill status={row.status} />
      </div>
      {!isChannel && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] max-md:grid-cols-1">
          <div><span className="text-muted">Secret reference</span><p className="font-mono">{row.secretRefMasked || 'ยังไม่ได้ผูก Vault reference'}</p></div>
          <div><span className="text-muted">Version / expiry</span><p>{row.credentialVersion || '—'} · {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'refresh deadline 5m'}</p></div>
        </div>
      )}
      <HealthPanel health={row.health} kind={row.kind} />
    </Card>
  )
}

export default function IntegrationsPage() {
  const scope = useScope()
  const currentBusiness = scope.currentBusiness
  const businessId = currentBusiness?.id || ''
  const path = `/api/platform/integrations${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`
  const integrations = useFetch(path, [businessId])
  const [provider, setProvider] = useState('openrouter')
  const [name, setName] = useState('Phase 1 LLM')
  const [model, setModel] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  const rows = useMemo(() => Array.isArray(integrations.data) ? integrations.data : [], [integrations.data])
  const secretRefTrimmed = secretRef.trim()
  // Empty stays valid — the reference is optional (FR-080). Client validation is
  // a courtesy only: the service still re-checks the same shape and the resolver
  // still fails closed, so relaxing or removing this never widens what is accepted.
  const secretRefInvalid = secretRefTrimmed.length > 0 && !isSupabaseVaultSecretRef(secretRefTrimmed)
  const submit = async (event) => {
    event.preventDefault()
    if (secretRefInvalid) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await api('/api/platform/integrations', {
        method: 'POST',
        body: {
          businessId,
          provider,
          name: name.trim(),
          model: model.trim(),
          secretRef: secretRef.trim() || undefined,
        },
      })
      setMessage('บันทึก connection metadata แล้ว')
      setSecretRef('')
      await integrations.reload()
    } catch (caught) {
      setError(caught?.message || 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (integrations.loading) return <LoadingCard />
  if (integrations.error) return <ErrorState title="โหลด Integration ไม่สำเร็จ" detail={integrations.error} retry={integrations.reload} />

  return (
    <div>
      <PageHeader
        eyebrow="Platform / Integrations"
        title="Integration connections"
        subtitle="จัดการเฉพาะ metadata ของ connection ตาม Business — ค่า secret จริงเก็บใน Supabase Vault"
      />
      <Card warm>
        <div className="flex items-start gap-2">
          <ShieldCheck size={16} style={{ color: 'var(--action-primary)' }} aria-hidden />
          <p className="text-[11px] leading-5">สร้าง secret ใน Supabase Dashboard → Vault ก่อน แล้วนำมาใส่เฉพาะ reference รูปแบบ <code>supabase-vault:&lt;uuid&gt;</code> ที่นี่ หน้านี้จะไม่รับหรือแสดงค่า secret จริง</p>
        </div>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card>
          <SectionTitle caption={currentBusiness ? `Business ปัจจุบัน: ${currentBusiness.name}` : 'เลือก Business จากตัวเลือกด้านบนก่อนสร้าง connection'}>เพิ่ม connection metadata</SectionTitle>
          <form onSubmit={submit}>
            <Field label="Provider">
              <select className="input" value={provider} onChange={(event) => setProvider(event.target.value)} aria-label="Provider">
                {LLM_PROVIDER_CATALOG.map(({ key, name }) => <option key={key} value={key}>{name}</option>)}
              </select>
            </Field>
            <Field label="ชื่อ connection">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} required aria-label="ชื่อ connection" />
            </Field>
            <Field label="Model">
              <input className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder={`เช่น ${providerByKey(provider)?.modelHint ?? ''}`} required aria-label="Model" />
            </Field>
            <Field label="Supabase Vault reference" hint="ไม่ใช่ API key — ใส่เฉพาะ supabase-vault:<uuid> เท่านั้น">
              <input
                className="input font-mono"
                value={secretRef}
                onChange={(event) => setSecretRef(event.target.value)}
                placeholder="supabase-vault:…"
                aria-label="Supabase Vault reference"
                aria-invalid={secretRefInvalid}
                aria-describedby={secretRefInvalid ? SECRET_REF_ERROR_ID : undefined}
              />
              {secretRefInvalid && (
                <p id={SECRET_REF_ERROR_ID} role="alert" className="mt-0.5 text-[10px] text-[var(--danger)]">
                  {SECRET_REF_ERROR_TEXT}
                </p>
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !businessId || !name.trim() || !model.trim() || secretRefInvalid}>
              <KeyRound size={13} aria-hidden /> {busy ? 'กำลังบันทึก…' : 'บันทึก metadata'}
            </button>
          </form>
          {message && <p className="mt-2 text-[11px]" role="status">{message}</p>}
          {error && <p className="mt-2 text-[11px] text-[var(--danger)]" role="alert">{error}</p>}
        </Card>
        <div>
          <SectionTitle caption="Model provider ที่สร้างจากหน้านี้ และ LINE OA channel ที่ ingress บันทึกหลักฐานไว้ — เฉพาะ Business ที่ trusted viewer อนุญาต">Connections</SectionTitle>
          {rows.length === 0
            ? <Card><p className="text-[11px] text-muted">ยังไม่มี connection ในขอบเขตนี้</p></Card>
            : <div className="space-y-3">{rows.map((row) => <IntegrationRow key={row.id} row={row} />)}</div>}
        </div>
      </div>
    </div>
  )
}
