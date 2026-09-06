'use client'

// @req FR-045 - Business-scoped File Manager surface.
// @spec SDD-023, ADR-016, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { useState } from 'react'
import { PageHeader, Card, ErrorState, Field, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import ManagedFilesPanel from '@/modules/project-manager/components/ManagedFilesPanel'

export default function BusinessFilesPage() {
  const scope = useScope()
  // BusinessShellGuard resolves BUSINESS_REQUIRED/FORBIDDEN and redirects to
  // `/businesses` before this page mounts, so an authorized `activeBusinessId`
  // is a precondition here (FR-044; ADR-015 Consequences). The page owning a
  // second "choose a Business" empty state was a pre-FR-044 leftover that no
  // route could reach.
  const businessId = scope.shell.activeBusinessId
  const mounts = useFetch(businessId ? `/api/files/mounts?businessId=${encodeURIComponent(businessId)}` : null, [businessId])
  const [deviceKey, setDeviceKey] = useState('desktop-main')
  const [rootPath, setRootPath] = useState('')
  // A failed save used to leave the form looking as though it had worked: the
  // row simply never appeared, which is indistinguishable from "no mounts yet".
  const [saveError, setSaveError] = useState(null)
  return <div>
    <PageHeader eyebrow="Development" title="Files" subtitle="Business-wide managed metadata with Project grouping, explicit device mounts and rebuildable cache." />
    <Card className="mb-4"><SectionTitle caption="Absolute paths stay device-local and are excluded from portable snapshots">Local workspace mount</SectionTitle>
      <form className="grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={async (event) => {
        event.preventDefault()
        setSaveError(null)
        try {
          await api('/api/files/mounts', { method: 'POST', body: { businessId, deviceKey, rootPath } })
          setRootPath('')
          mounts.reload()
        } catch (err) {
          setSaveError(err.message)
        }
      }}>
        <Field label="Device key"><input className="input" value={deviceKey} onChange={(event) => setDeviceKey(event.target.value)} required /></Field>
        <Field label="Absolute Windows root"><input className="input" value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="D:\\zuri-workspace\\business" required /></Field>
        <button className="btn btn-primary self-end" type="submit">Save mount</button>
      </form>
      {saveError && <p className="mt-2 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }} role="alert">{saveError}</p>}
      {/* A failed mounts fetch rendered as no rows at all — the same picture as
          a Business with no mounts, which is the one thing the reader must not
          confuse it with before typing an absolute path. */}
      {mounts.error
        ? <ErrorState title="Could not load mounts" detail={mounts.error} retry={mounts.reload} />
        : (mounts.data || []).map((mount) => <p key={mount.id} className="mt-2 text-[10px] text-muted">{mount.deviceKey} · {mount.rootPath} · {mount.status}</p>)}
    </Card>
    <ManagedFilesPanel businessId={businessId} businessTools />
  </div>
}
