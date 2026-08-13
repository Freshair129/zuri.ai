'use client'

// @req FR-045 - Business-scoped File Manager surface.
// @spec SDD-023, ADR-016, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { useState } from 'react'
import { PageHeader, Card, EmptyState, Field, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import ManagedFilesPanel from '@/modules/project-manager/components/ManagedFilesPanel'

export default function BusinessFilesPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  const mounts = useFetch(businessId ? `/api/files/mounts?businessId=${encodeURIComponent(businessId)}` : null, [businessId])
  const [deviceKey, setDeviceKey] = useState('desktop-main')
  const [rootPath, setRootPath] = useState('')
  if (!businessId) return <EmptyState title="Choose a Business" hint="Files are isolated to the selected operating Business." />
  return <div>
    <PageHeader eyebrow="Development" title="Files" subtitle="Business-wide managed metadata with Project grouping, explicit device mounts and rebuildable cache." />
    <Card className="mb-4"><SectionTitle caption="Absolute paths stay device-local and are excluded from portable snapshots">Local workspace mount</SectionTitle>
      <form className="grid gap-3 md:grid-cols-[180px_1fr_auto]" onSubmit={async (event) => { event.preventDefault(); await api('/api/files/mounts', { method: 'POST', body: { businessId, deviceKey, rootPath } }); setRootPath(''); mounts.reload() }}>
        <Field label="Device key"><input className="input" value={deviceKey} onChange={(event) => setDeviceKey(event.target.value)} required /></Field>
        <Field label="Absolute Windows root"><input className="input" value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="D:\\zuri-workspace\\business" required /></Field>
        <button className="btn btn-primary self-end" type="submit">Save mount</button>
      </form>
      {(mounts.data || []).map((mount) => <p key={mount.id} className="mt-2 text-[10px] text-muted">{mount.deviceKey} · {mount.rootPath} · {mount.status}</p>)}
    </Card>
    <ManagedFilesPanel businessId={businessId} businessTools />
  </div>
}
