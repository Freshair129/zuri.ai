'use client'

// @req FR-038 — owner-only role and per-domain Membership permission administration.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
// @req FR-062 — the list only contains what this caller may administer; a row
// the server did not mark manageable renders read-only, and a failed save is
// reported rather than silently discarded.
// @spec SDD-035
// @tested tests/unit/fr062-permissions-read-scope.test.js
// @req FR-106 — the Enterprise API key panel: list, mint (raw key shown exactly
// once, with a copy affordance), and revoke behind a confirmation.
// @spec SEC-006
// @tested tests/unit/platform-users-view.test.js
import { useState } from 'react'
import { ShieldCheck, KeyRound, Copy, UserPlus } from 'lucide-react'
import { Card, ErrorState, Field, PageHeader, SectionTitle } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { DOMAINS } from '@/config/domains'
import { useScope } from '@/context/ScopeContext'
import {
  DOMAIN_OPTIONS,
  buildApiKeyPanel,
  describeInviteFailure,
  inviteBusinessOptions,
  validateMemberInvite,
} from '@/modules/identity/platform-users-view'

function PermissionRow({ membership, onSaved }) {
  const [role, setRole] = useState(membership.role)
  const [domainKeys, setDomainKeys] = useState(membership.domainKeys)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // @req FR-062 — authority is the server's statement, not a client inference.
  // A row the server did not mark manageable is read-only here; previously every
  // row rendered a working-looking Save, and three quarters of them could only
  // ever 404.
  const manageable = membership.manageable !== false
  const toggle = (key) => setDomainKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/platform/users', { method: 'PATCH', body: { membershipId: membership.id, role, domainKeys } })
      onSaved()
    } catch (caught) {
      // This `catch` is the point of the fix: without it a rejected save became
      // an unhandled rejection — the button un-greyed, nothing was written, and
      // the page reported success by saying nothing at all.
      setError(caught?.message || 'Save failed')
    } finally {
      setBusy(false)
    }
  }
  const effectiveKeys = role === 'OWNER' ? DOMAINS.map((domain) => domain.key) : domainKeys
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1"><p className="text-sm font-bold">{membership.person.displayName}</p><p className="text-[10px] text-muted">{membership.person.code} · {membership.business?.name || 'Tenant-wide'}</p></div>
        <select className="input w-auto" value={role} disabled={!manageable} onChange={(event) => setRole(event.target.value)} aria-label={`Role for ${membership.person.displayName}`}><option value="OWNER">Owner</option><option value="MEMBER">Member</option></select>
        {manageable
          ? <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
          : <span className="text-[10px] text-muted">Read-only</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
        {DOMAINS.map((domain) => (
          <label key={domain.key} className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={effectiveKeys.includes(domain.key)} disabled={!manageable || role === 'OWNER'} onChange={() => toggle(domain.key)} /> {domain.label}
          </label>
        ))}
      </div>
      {role === 'OWNER' && <p className="mt-2 text-[10px] text-muted">Owner visibility is role-bound to all current domains.</p>}
      {!manageable && <p className="mt-2 text-[10px] text-muted">Tenant-wide Membership — visible here, but administered outside this surface.</p>}
      {error && <p className="mt-2 text-[10px] text-[var(--danger)]" role="alert">{error}</p>}
    </Card>
  )
}

/**
 * @req FR-038 — the missing half of Membership administration: attaching an
 * existing Person to a Business. Until this form the roster could only be
 * edited, never added to, so a colleague with an account had no path to a first
 * Business-level grant (D3-identity-onboarding-forms-12).
 */
function AddMemberCard({ onAdded }) {
  const scope = useScope()
  const { options, defaultId } = inviteBusinessOptions({
    businesses: scope.businesses,
    activeBusinessId: scope.shell?.activeBusinessId ?? null,
  })
  const [businessId, setBusinessId] = useState(defaultId || '')
  const [identifier, setIdentifier] = useState('')
  const [domainKeys, setDomainKeys] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [added, setAdded] = useState(null)
  const selected = businessId || defaultId || ''
  const toggle = (key) => setDomainKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    setAdded(null)
    const check = validateMemberInvite({ businessId: selected, identifier, domainKeys })
    if (!check.ok) {
      setError(check.error)
      return
    }
    setBusy(true)
    try {
      const created = await api('/api/platform/users/memberships', { method: 'POST', body: check.payload })
      setAdded(created)
      setIdentifier('')
      setDomainKeys([])
      onAdded()
    } catch (caught) {
      setError(describeInviteFailure(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Field label="ธุรกิจ">
              <select className="input" value={selected} onChange={(event) => setBusinessId(event.target.value)} aria-label="ธุรกิจที่จะเพิ่มสมาชิก">
                <option value="">— เลือกธุรกิจ —</option>
                {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="min-w-[220px] flex-1">
            <Field label="รหัสบุคคล หรืออีเมล" hint="ต้องตรงทุกตัวอักษร และบุคคลต้องมีบัญชีอยู่แล้ว">
              <input className="input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="PER-0001 หรือ name@example.com" aria-label="รหัสบุคคลหรืออีเมล" />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <UserPlus size={14} aria-hidden /> {busy ? 'กำลังเพิ่ม…' : 'เพิ่มสมาชิก'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
          {DOMAIN_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={domainKeys.includes(option.key)} onChange={() => toggle(option.key)} /> {option.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted">เพิ่มเป็น MEMBER เสมอ — การเลื่อนเป็น OWNER ทำได้ในรายการด้านล่าง และถูกบันทึกแยกกัน</p>
        {added && <p className="mt-2 text-[10px] text-[var(--ok,#16a34a)]" role="status">เพิ่ม {added.person?.displayName} ({added.person?.code}) เข้า {added.business?.name} แล้ว</p>}
        {error && <p className="mt-2 text-[10px] text-[var(--danger)]" role="alert">{error}</p>}
      </form>
    </Card>
  )
}

/**
 * @req FR-106 — list / mint / revoke for Enterprise API keys. The raw secret is
 * rendered once, from the mint response, and is never re-fetchable: the list
 * endpoint carries metadata only.
 */
function ApiKeyPanel() {
  const keys = useFetch('/api/platform/api-access-keys')
  const [label, setLabel] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [minted, setMinted] = useState(null)
  const [copied, setCopied] = useState(false)

  if (keys.loading) return <LoadingCard />
  // A refusal here is not the page's headline — the roster above still works —
  // so it is reported in place rather than replacing the whole page.
  if (keys.error) return <Card><p className="text-[11px] text-[var(--danger)]" role="alert">{keys.error}</p></Card>

  const panel = buildApiKeyPanel(keys.data || {})
  if (!panel.available) {
    return <Card><p className="text-[11px] text-muted">ต้องเป็นเจ้าของระดับ Tenant หรือผู้ดูแลระบบติดตั้ง จึงจะจัดการคีย์ Enterprise API ได้</p></Card>
  }
  const selectedTenant = tenantId || panel.defaultTenantId || ''

  const mint = async (event) => {
    event.preventDefault()
    setError(null)
    setMinted(null)
    setCopied(false)
    if (!label.trim()) {
      setError('ตั้งชื่อกำกับคีย์ก่อน')
      return
    }
    setBusy(true)
    try {
      const created = await api('/api/platform/api-access-keys', { method: 'POST', body: { label: label.trim(), tenantId: selectedTenant } })
      setMinted(created)
      setLabel('')
      keys.reload()
    } catch (caught) {
      setError(caught?.message || 'สร้างคีย์ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (row) => {
    // Irreversible and immediate — a revoked key stops working on the very next
    // request, and there is no un-revoke. The confirmation is the only thing
    // standing between a mis-click and a broken integration.
    if (typeof window !== 'undefined' && !window.confirm(`เพิกถอนคีย์ "${row.label}" ? การเชื่อมต่อที่ใช้คีย์นี้จะหยุดทำงานทันที`)) return
    setError(null)
    try {
      await api(`/api/platform/api-access-keys/${row.id}`, { method: 'DELETE', body: { reason: 'REVOKED_FROM_CONSOLE' } })
      if (minted?.id === row.id) setMinted(null)
      keys.reload()
    } catch (caught) {
      setError(caught?.message || 'เพิกถอนคีย์ไม่สำเร็จ')
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.key)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card>
      <form onSubmit={mint} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <Field label="Tenant">
            <select className="input" value={selectedTenant} onChange={(event) => setTenantId(event.target.value)} aria-label="Tenant ของคีย์">
              {panel.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name || tenant.code}</option>)}
            </select>
          </Field>
        </div>
        <div className="min-w-[200px] flex-1">
          <Field label="ชื่อกำกับคีย์" hint="เช่น ชื่อระบบที่จะเรียกใช้">
            <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="erp-integration" aria-label="ชื่อกำกับคีย์" />
          </Field>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <KeyRound size={14} aria-hidden /> {busy ? 'กำลังสร้าง…' : 'สร้างคีย์'}
        </button>
      </form>

      {minted?.key && (
        <div className="mt-3 border-t border-[var(--border)] pt-3" role="status">
          <p className="text-[11px] font-bold">คีย์นี้แสดงเพียงครั้งเดียว — คัดลอกและเก็บไว้ในที่ปลอดภัยก่อนออกจากหน้านี้</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-[var(--surface-2,rgba(0,0,0,0.05))] px-2 py-1 text-[11px]">{minted.key}</code>
            <button type="button" className="btn" onClick={copy}><Copy size={13} aria-hidden /> คัดลอก</button>
            {copied && <span className="text-[10px] text-muted">คัดลอกแล้ว</span>}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        {panel.rows.length === 0 && <p className="text-[11px] text-muted">ยังไม่มีคีย์ Enterprise API ใน Tenant ของคุณ</p>}
        {panel.rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-[180px] flex-1">
              <p className="text-[12px] font-bold">{row.label}</p>
              <p className="text-[10px] text-muted">{row.prefix} · {row.tenantLabel} · {row.statusLabel}</p>
            </div>
            {row.canRevoke
              ? <button type="button" className="btn" onClick={() => revoke(row)}>เพิกถอน</button>
              : <span className="text-[10px] text-muted">เพิกถอนแล้ว</span>}
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-[10px] text-[var(--danger)]" role="alert">{error}</p>}
    </Card>
  )
}

export default function UsersPermissionsPage() {
  const users = useFetch('/api/platform/users')
  if (users.loading) return <LoadingCard />
  if (users.error) return <ErrorState title="Access denied" detail={users.error} retry={users.reload} />
  return (
    <div>
      <PageHeader eyebrow="Platform" title="Users & permissions" subtitle="Owner-only Membership role and domain visibility grants." />
      <SectionTitle caption="เพิ่มบุคคลที่มีบัญชีอยู่แล้วเข้าธุรกิจที่คุณเป็นเจ้าของ เป็น MEMBER พร้อมสิทธิ์โดเมนที่เลือก">เพิ่มสมาชิกเข้าธุรกิจ</SectionTitle>
      <AddMemberCard onAdded={users.reload} />
      <SectionTitle caption="Changes are audited. MEMBER is deny-by-default until one or more domains are granted.">Memberships</SectionTitle>
      <div className="space-y-3">{users.data.map((membership) => <PermissionRow key={membership.id} membership={membership} onSaved={users.reload} />)}</div>
      <SectionTitle caption="คีย์สำหรับ Enterprise API — ผูกกับ Tenant เดียว แสดงค่าเต็มครั้งเดียวตอนสร้าง และเพิกถอนได้ทันที">Enterprise API keys</SectionTitle>
      <ApiKeyPanel />
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted"><ShieldCheck size={13} aria-hidden /> DEV is a separate platform grant and never appears as a Membership role.</p>
    </div>
  )
}
