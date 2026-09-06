'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, MessageCircle, Sparkles, Terminal, Sliders } from 'lucide-react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LineStudioShell } from '@/modules/line-oa-studio/ui'

// @req FR-149 — configure server-owned LINE accounts and inspect persistent delivery jobs.
// @spec ADR-061, SEC-001
// @tested tests/e2e/fr149-line-server-console.spec.js
async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.issues?.join(' · ') || result.error || 'Request failed')
  return result
}
const fieldClass = 'w-full rounded-lg border border-[var(--border)] bg-white p-2 text-sm'
function Field({ label, ...props }) {
  return <label className="grid gap-1 text-xs font-semibold">{label}<input className={fieldClass} {...props} /></label>
}

function Account({ account, onAction, busy }) {
  const [mode, setMode] = useState(account.executionMode)
  const [access, setAccess] = useState(account.modelAccess)
  const [push, setPush] = useState(account.allowDelayedPush)
  const [quiesced, setQuiesced] = useState(false)
  const [jobs, setJobs] = useState(null)
  const [acknowledged, setAcknowledged] = useState({})
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setMode(account.executionMode); setAccess(account.modelAccess); setPush(account.allowDelayedPush) }, [account])
  async function loadJobs() {
    try { setError(''); const result = await api(`/api/line-oa/accounts/${account.id}/jobs`); setJobs(result.jobs ?? result) }
    catch (err) { setError(err.message) }
  }
  async function acknowledgeUnknown(job) {
    if (!acknowledged[job.id] || resolving) return
    setResolving(true)
    try {
      setError('')
      await api(`/api/line-oa/jobs/${job.id}/acknowledge-unknown`, 'POST', { version: job.version, acknowledgePossibleDelivery: true })
      await loadJobs()
    } catch (err) { setError(err.message) } finally { setResolving(false) }
  }
  return <Card>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{account.displayName}</h2><p className="text-xs text-muted">{account.basicId || account.code}</p></div><StatusPill status={account.effectiveStatus} /></div>
    <p className="my-3 text-sm">LINE transport: {account.serverEnabled ? 'Zuri Server' : account.transportMode === 'EDGE' ? 'Legacy Edge' : 'Server ยังไม่เปิด'} · Connection: {account.health?.connection?.status || 'ไม่พร้อม'}</p>
    <details className="my-3 text-xs text-muted"><summary>ข้อมูลสำหรับเชื่อมต่อ</summary><div className="mt-2 grid gap-1 break-all"><p>Account: {account.id}</p><p>Connection: {account.integrationConnectionId}</p><p>Business: {account.businessId}</p><p>Tenant: {account.tenantId}</p><p>Webhook: /api/line-oa/accounts/{account.id}/webhook</p></div></details>
    <fieldset disabled={busy || account.status === 'ARCHIVED'} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">ประมวลผลคำตอบ<select aria-label="ประมวลผลคำตอบ" className={fieldClass} value={mode} onChange={e => setMode(e.target.value)}><option value="SERVER">Server</option><option value="EDGE">Edge worker</option></select></label>
        <label className="grid gap-1 text-xs font-semibold">การใช้โมเดล<select aria-label="การใช้โมเดล" className={fieldClass} value={access} onChange={e => setAccess(e.target.value)}><option value="LOCAL_ONLY">Local only</option><option value="EXTERNAL_MODEL_ALLOWED">อนุญาต Cloud API</option></select></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={push} onChange={e => setPush(e.target.checked)} />อนุญาต Push คำตอบภายหลัง หาก reply token หมดอายุ</label>
      <p className="text-xs text-muted">Local only บน Server ตอบจากข้อมูลธุรกิจที่อนุญาตโดยไม่เรียกโมเดลภายนอก; บน Edge ใช้การประมวลผลในเครื่อง หาก Edge ไม่พร้อม งานจะรอและไม่มีการเปลี่ยนไปใช้ Cloud เอง</p>
      <div><button className="btn" onClick={() => onAction(account, { action: 'CONFIGURE_EXECUTION', executionMode: mode, modelAccess: access, allowDelayedPush: push })}>บันทึกการประมวลผล</button></div>
      {!account.serverEnabled && account.transportMode === 'CLOUD' && <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={quiesced} onChange={e => setQuiesced(e.target.checked)} />หยุดตัวรับและตัวส่ง LINE เดิมแล้ว และเตรียม webhook ให้ส่งมาที่ Server นี้</label>}
      <div className="flex flex-wrap gap-2">
        {account.serverEnabled ? <button className="btn" onClick={() => onAction(account, { action: 'DISABLE_SERVER' })}>ปิด Server transport</button> : account.transportMode === 'CLOUD' ? <button className="btn btn-primary" disabled={!quiesced} onClick={() => onAction(account, { action: 'ENABLE_SERVER', legacyQuiesced: true })}>เปิด Server transport</button> : <button className="btn" onClick={() => onAction(account, { action: 'SWITCH_TRANSPORT_MODE', transportMode: 'CLOUD' })}>เตรียมย้ายไป Server</button>}
        {account.status === 'CONNECTED' && <button className="btn" onClick={() => onAction(account, { action: 'PAUSE' })}>พักบัญชี</button>}
        {account.status === 'PAUSED' && <button className="btn" onClick={() => onAction(account, { action: 'RESUME' })}>เปิดใช้งานต่อ</button>}
        <button className="btn" onClick={loadJobs}>ดูสถานะข้อความ</button>
      </div>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {jobs && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">เวลา</th><th className="p-2">งาน</th><th className="p-2">สถานะ</th><th className="p-2">รายละเอียด</th></tr></thead><tbody>{Array.isArray(jobs) && jobs.map(job => <tr key={job.id} className="border-t border-[var(--border)]"><td className="p-2">{new Date(job.createdAt).toLocaleString()}</td><td className="p-2">{job.id.slice(0, 8)}</td><td className="p-2">{job.status}</td><td className="p-2">{job.errorCode || job.executionMode}{job.status === 'UNKNOWN' && <div className="mt-2 grid max-w-sm gap-2"><label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(acknowledged[job.id])} onChange={e => setAcknowledged(previous => ({ ...previous, [job.id]: e.target.checked }))} /><span>ตรวจสอบแล้วและรับทราบว่าลูกค้าอาจได้รับข้อความนี้ ระบบจะปิดงานและไม่ส่งซ้ำ</span></label><button className="btn" disabled={!acknowledged[job.id] || resolving || busy} onClick={() => acknowledgeUnknown(job)}>รับทราบว่าอาจส่งแล้ว และปิดงาน</button></div>}</td></tr>)}</tbody></table>{Array.isArray(jobs) && jobs.length === 0 && <p className="p-2 text-muted">ยังไม่มีข้อความในคิว</p>}</div>}
  </Card>
}

export default function LineOaPage() {
  const [viewMode, setViewMode] = useState('studio') // 'studio' | 'transport_console'
  const scope = useScope()
  const business = scope?.shell?.activeBusiness
  const [accounts, setAccounts] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [connectionId, setConnectionId] = useState('')

  const refresh = useCallback(async () => {
    if (!business?.id) { setAccounts([]); return }
    const result = await api(`/api/line-oa/accounts?businessId=${encodeURIComponent(business.id)}`)
    setAccounts(result.accounts)
  }, [business?.id])

  useEffect(() => { setAccounts([]); setConnectionId(''); setMessage(''); setError(''); refresh().catch(err => setError(err.message)) }, [refresh])

  async function run(task) { setBusy(true); setError(''); setMessage(''); try { await task(); await refresh() } catch (err) { setError(err.message) } finally { setBusy(false) } }
  async function action(account, data) { await run(() => api(`/api/line-oa/accounts/${account.id}`, 'PATCH', { ...data, version: account.version })) }
  async function provision(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    await run(async () => {
      const result = await api('/api/line-oa/connections', 'POST', { businessId: business.id, name: form.get('name'), destination: form.get('destination'), secretRef: form.get('secretRef') })
      setConnectionId(result.id); setMessage('สร้าง Connection แล้ว เชื่อมบัญชีในขั้นตอนถัดไป')
    })
  }
  async function connect(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    await run(async () => { await api('/api/line-oa/accounts', 'POST', { businessId: business.id, integrationConnectionId: connectionId, code: form.get('code'), displayName: form.get('displayName'), ...(form.get('basicId') ? { basicId: form.get('basicId') } : {}) }); setMessage('เชื่อมบัญชีแล้ว เตรียม credentials และเปิด Server transport เมื่อพร้อม') })
  }

  return (
    <div className="space-y-4">
      {/* Top View Mode Switcher */}
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs text-xs font-thai">
          <button
            onClick={() => setViewMode('studio')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              viewMode === 'studio'
                ? 'bg-brand-amber text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>LINE Studio Enterprise</span>
          </button>
          <button
            onClick={() => setViewMode('transport_console')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl font-semibold transition-all ${
              viewMode === 'transport_console'
                ? 'bg-slate-850 text-white shadow-xs dark:bg-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Server Transport & Job Console (FR-149)</span>
          </button>
        </div>
      </div>

      {viewMode === 'studio' ? (
        <div className="w-full">
          <LineStudioShell />
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <PageHeader eyebrow="LINE OA Studio" title="บัญชี LINE และการตอบข้อความ" subtitle={business ? business.name : 'เลือก Business ก่อนจัดการบัญชี'} actions={<button className="btn" disabled={busy || !business} onClick={() => run(refresh)}><RefreshCw size={15} />รีเฟรช</button>} />
          {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="mb-4 rounded-lg bg-[var(--brand-surface)] p-3 text-sm">{message}</p>}
          {business && <>
            <div className="mb-4 grid gap-4 xl:grid-cols-2">{accounts.map(account => <Account key={`${business.id}-${account.id}`} account={account} onAction={action} busy={busy} />)}</div>
            {accounts.length === 0 && !error && <Card className="mb-4"><MessageCircle size={20} /><p className="mt-2 text-sm">ยังไม่มีบัญชี LINE OA สำหรับ Business นี้</p></Card>}
            <div className="grid gap-4 xl:grid-cols-2">
              <Card><SectionTitle>1. เตรียม Connection — เฉพาะเจ้าของ Business</SectionTitle><p className="mb-3 text-xs text-muted">ผู้ดูแล deployment จัดเก็บ channel secret และ access token ใน secret mount แล้วระบุชื่ออ้างอิงที่นี่</p><form onSubmit={provision}><fieldset disabled={busy} className="grid gap-3"><Field label="ชื่อ Connection" name="name" required maxLength={200} /><Field label="Bot user ID / destination" name="destination" placeholder="U… (32 hex characters)" required pattern="U[0-9a-fA-F]{32}" /><Field label="ชื่ออ้างอิง Secret" name="secretRef" placeholder="deployment-secret:line-main" required pattern="deployment-secret:[A-Za-z0-9_-]{1,100}" /><button className="btn" type="submit">สร้าง Connection</button></fieldset></form></Card>
              <Card><SectionTitle>2. เชื่อมบัญชี LINE OA</SectionTitle><form onSubmit={connect}><fieldset disabled={busy} className="grid gap-3"><Field label="Connection ID" value={connectionId} onChange={e => setConnectionId(e.target.value)} required /><Field label="รหัสบัญชี" name="code" placeholder="oa-main" required minLength={3} pattern="[a-z0-9]+(-[a-z0-9]+)*" /><Field label="ชื่อแสดง" name="displayName" required /><Field label="LINE basic ID (ถ้ามี)" name="basicId" placeholder="@yourshop" /><button className="btn btn-primary" type="submit">เชื่อมบัญชี</button></fieldset></form></Card>
            </div>
          </>}
        </div>
      )}
    </div>
  )
}
