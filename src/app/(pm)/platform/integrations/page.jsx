'use client'

import { useMemo, useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'

import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

// @req FR-080 — Platform Integrations accepts only connection metadata and an
// opaque Supabase Vault reference; raw credentials stay in the Vault dashboard.
// @spec ADR-032 D1-D4, SEC-016, SDD-044
// @tested tests/unit/fr080-ui-contract.test.js

const PROVIDERS = [
  ['openrouter', 'OpenRouter'],
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Gemini'],
  ['groq', 'Groq'],
]

function IntegrationRow({ row }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{row.name}</p>
          <p className="mt-0.5 text-[11px] text-muted">{row.providerName || row.provider} · {row.model || 'Model not set'}</p>
        </div>
        <StatusPill status={row.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] max-md:grid-cols-1">
        <div><span className="text-muted">Secret reference</span><p className="font-mono">{row.secretRefMasked || 'ยังไม่ได้ผูก Vault reference'}</p></div>
        <div><span className="text-muted">Version / expiry</span><p>{row.credentialVersion || '—'} · {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : 'refresh deadline 5m'}</p></div>
      </div>
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
  const submit = async (event) => {
    event.preventDefault()
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
                {PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="ชื่อ connection">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} required aria-label="ชื่อ connection" />
            </Field>
            <Field label="Model">
              <input className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder="เช่น openai/gpt-4o-mini" required aria-label="Model" />
            </Field>
            <Field label="Supabase Vault reference" hint="ไม่ใช่ API key — ใส่เฉพาะ supabase-vault:<uuid> เท่านั้น">
              <input className="input font-mono" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} placeholder="supabase-vault:…" aria-label="Supabase Vault reference" />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !businessId || !name.trim() || !model.trim()}>
              <KeyRound size={13} aria-hidden /> {busy ? 'กำลังบันทึก…' : 'บันทึก metadata'}
            </button>
          </form>
          {message && <p className="mt-2 text-[11px]" role="status">{message}</p>}
          {error && <p className="mt-2 text-[11px] text-[var(--danger)]" role="alert">{error}</p>}
        </Card>
        <div>
          <SectionTitle caption="แสดงเฉพาะ Business ที่ trusted viewer อนุญาต">Connections</SectionTitle>
          {rows.length === 0
            ? <Card><p className="text-[11px] text-muted">ยังไม่มี Phase 1 connection ในขอบเขตนี้</p></Card>
            : <div className="space-y-3">{rows.map((row) => <IntegrationRow key={row.id} row={row} />)}</div>}
        </div>
      </div>
    </div>
  )
}
