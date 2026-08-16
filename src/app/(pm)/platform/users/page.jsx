'use client'

// @req FR-038 — owner-only role and per-domain Membership permission administration.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
// @req FR-062 — the list only contains what this caller may administer; a row
// the server did not mark manageable renders read-only, and a failed save is
// reported rather than silently discarded.
// @spec SDD-035
// @tested tests/unit/fr062-permissions-read-scope.test.js
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Card, ErrorState, PageHeader, SectionTitle } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { DOMAINS } from '@/config/domains'

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

export default function UsersPermissionsPage() {
  const users = useFetch('/api/platform/users')
  if (users.loading) return <LoadingCard />
  if (users.error) return <ErrorState title="Access denied" detail={users.error} retry={users.reload} />
  return (
    <div>
      <PageHeader eyebrow="Platform" title="Users & permissions" subtitle="Owner-only Membership role and domain visibility grants." />
      <SectionTitle caption="Changes are audited. MEMBER is deny-by-default until one or more domains are granted.">Memberships</SectionTitle>
      <div className="space-y-3">{users.data.map((membership) => <PermissionRow key={membership.id} membership={membership} onSaved={users.reload} />)}</div>
      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted"><ShieldCheck size={13} aria-hidden /> DEV is a separate platform grant and never appears as a Membership role.</p>
    </div>
  )
}
