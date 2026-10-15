'use client'

// @req FR-046 — Business Routing consumes one viewer-scoped entry read model.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js
// @req FR-044 — Business selection is a routing boundary before the BusinessShell.
// @spec ADR-015, SDD-022 — viewer grants decide visibility; Portfolio/Tenant are ancestry labels only.
// @tested tests/unit/business-routing-page.test.js, tests/unit/business-routing.test.js
// @req FR-066 — a person with no visible Business is not stranded on an empty
// list: they are routed to the pre-Business journey (Waiting Room, which sends
// an incomplete Profile to Profile setup first — AC-066.1) instead of being
// asked to create or select operating scope here.
// @spec ADR-027 D8, SDD-038
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { useScope } from '@/context/ScopeContext'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { classifyViewerFailure, SESSION_UNAVAILABLE_DETAIL_TH, SESSION_UNAVAILABLE_TITLE_TH } from '@/lib/viewer-failure'

function BusinessChoice({ business, onSelect, openingBusinessId }) {
  const { tenant, portfolio } = business
  const opening = openingBusinessId === business.id
  return (
    <Card className="group p-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--brand-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset"
        onClick={() => onSelect(business)}
        disabled={Boolean(openingBusinessId)}
        aria-busy={opening}
        aria-label={`Open Business ${business.name}`}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden>
          <Building2 size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{business.name}</span>
          <span className="mt-1 block truncate text-[11px] text-muted">{business.code}</span>
          <span className="mt-2 block truncate text-[10px] text-muted">
            Portfolio: {portfolio?.name || portfolio?.code || '—'} · Tenant: {tenant?.name || tenant?.code || '—'}
          </span>
        </span>
        <ArrowRight className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" size={17} aria-hidden />
      </button>
    </Card>
  )
}

export default function BusinessesPage() {
  const router = useRouter()
  const scope = useScope()
  const entry = useFetch('/api/entry')
  const [openingBusinessId, setOpeningBusinessId] = useState(null)
  const [entryError, setEntryError] = useState(null)
  const [creatingBusiness, setCreatingBusiness] = useState(false)
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [newBusinessName, setNewBusinessName] = useState('')
  const [creationError, setCreationError] = useState(null)
  const availableBusinesses = entry.data?.businesses || []
  const ownedTenants = [...new Map(availableBusinesses
    .filter((business) => business.canCreateBusiness === true)
    .map((business) => [business.tenant.id, { ...business.tenant, portfolio: business.portfolio }])).values()]
  // @req FR-046 — SESSION_UNAVAILABLE (session store outage) is kept apart
  // from AUTH_REQUIRED (no valid session) so an outage never bounces an
  // already-logged-in person to /login (D1-entry-layers-09).
  const viewerFailure = classifyViewerFailure({ body: entry.error })

  useEffect(() => {
    if (viewerFailure === 'AUTH_REQUIRED') {
      router.replace('/login')
    }
  }, [viewerFailure, router])

  // @req FR-066 — no Business access yet → the pre-Business journey, never an
  // operating-scope prompt (AC-066.1). The Waiting Room forwards an incomplete
  // Profile to Profile setup.
  const noBusinessAccess = !entry.loading && !entry.error && (entry.data?.businesses || []).length === 0
  useEffect(() => {
    if (noBusinessAccess) router.replace('/waiting-room')
  }, [noBusinessAccess, router])

  if (entry.loading || noBusinessAccess || viewerFailure === 'AUTH_REQUIRED') return <LoadingCard />

  if (viewerFailure === 'SESSION_UNAVAILABLE') {
    return <ErrorState title={SESSION_UNAVAILABLE_TITLE_TH} detail={SESSION_UNAVAILABLE_DETAIL_TH} retry={entry.reload} />
  }

  if (entry.error) {
    return <ErrorState title="Unable to load Business Routing" detail={entry.error} retry={entry.reload} />
  }

  const enterBusiness = async (business) => {
    setOpeningBusinessId(business.id)
    setEntryError(null)
    // Persist the explicit choice before navigation; the entry-specific refresh
    // keeps BusinessShellGuard in its existing LOADING state until it settles.
    scope.select({ portfolioId: business.portfolio?.id || null, businessId: business.id })
    const scopeConfirmed = await scope.refreshForBusinessEntry(business.id)
    if (!scopeConfirmed) {
      setOpeningBusinessId(null)
      setEntryError('ไม่สามารถยืนยันขอบเขตธุรกิจล่าสุดได้ กรุณาลองเปิดธุรกิจอีกครั้ง')
      return false
    }

    router.push('/overview')
    return true
  }

  const createBusiness = async (event) => {
    event.preventDefault()
    const tenant = ownedTenants.find((item) => item.id === selectedTenantId) || ownedTenants[0]
    const name = newBusinessName.trim()
    if (!tenant || !name) return

    setCreatingBusiness(true)
    setCreationError(null)
    try {
      const created = await api('/api/scope', {
        method: 'POST',
        body: { entity: 'business', data: { tenantId: tenant.id, name } },
      })
      const entered = await enterBusiness({
        id: created.id,
        name: created.name,
        code: created.code,
        tenant,
        portfolio: tenant.portfolio,
      })
      if (!entered) {
        setCreationError('Business created, but its current access could not be confirmed. Refresh the list before opening it.')
        setCreatingBusiness(false)
        await entry.reload()
      }
    } catch (error) {
      setCreationError(`Unable to create Business: ${error.message}`)
      setCreatingBusiness(false)
    }
  }

  return (
    <BusinessRoutingShell>
      <PageHeader
        eyebrow="Business Routing"
        title="Choose a Business"
        subtitle="Select the Business you want to work in. Portfolio and Tenant are context labels only."
      />
      {entryError ? <p className="mb-3 text-sm text-[var(--danger)]" role="alert">{entryError}</p> : null}
      {openingBusinessId ? <p className="mb-3 text-sm text-muted" role="status">กำลังตรวจสอบสิทธิ์ธุรกิจ…</p> : null}
      {ownedTenants.length > 0 ? (
        <section className="mb-6 max-w-3xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-bold">Add a Business to an owned Tenant</h2>
          <p className="mt-1 text-xs text-muted">This creates the Business inside the selected Tenant you already own.</p>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={createBusiness}>
            <label className="grid gap-1 text-xs font-semibold" htmlFor="same-tenant-business-tenant">
              Tenant
              <select
                id="same-tenant-business-tenant"
                className="input"
                value={selectedTenantId || ownedTenants[0].id}
                onChange={(event) => setSelectedTenantId(event.target.value)}
                disabled={creatingBusiness || Boolean(openingBusinessId)}
              >
                {ownedTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.code})</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold" htmlFor="same-tenant-business-name">
              Business name
              <input
                id="same-tenant-business-name"
                className="input"
                value={newBusinessName}
                onChange={(event) => setNewBusinessName(event.target.value)}
                maxLength={120}
                required
                disabled={creatingBusiness || Boolean(openingBusinessId)}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingBusiness || Boolean(openingBusinessId) || !newBusinessName.trim()}
              >
                {creatingBusiness ? 'Creating…' : 'Create Business in this Tenant'}
              </button>
            </div>
          </form>
          {creationError ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{creationError}</p> : null}
        </section>
      ) : null}
      {availableBusinesses.length === 0 ? (
        <EmptyState
          title="No Business is available"
          hint="Your current viewer does not have access to a Business yet."
        />
      ) : (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {availableBusinesses.map((item) => (
            <BusinessChoice
              key={item.id}
              business={item}
              onSelect={enterBusiness}
              openingBusinessId={openingBusinessId}
            />
          ))}
        </div>
      )}
    </BusinessRoutingShell>
  )
}
