'use client'

// @req FR-044 — Business selection is a routing boundary before the BusinessShell.
// @spec ADR-015, SDD-022 — viewer grants decide visibility; Portfolio/Tenant are ancestry labels only.
// @tested tests/unit/business-routing-page.test.js, tests/unit/business-routing.test.js
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { buildBusinessRouting } from '@/lib/business-routing'

function BusinessChoice({ item, onSelect }) {
  const { business, tenant, portfolio } = item
  return (
    <Card className="group p-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[var(--brand-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset"
        onClick={() => onSelect(business)}
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
  const viewer = useFetch('/api/viewer')
  const inventory = useFetch('/api/scope')
  const availableBusinesses = useMemo(() => buildBusinessRouting({
    viewer: viewer.data,
    portfolios: inventory.data?.portfolios,
    tenants: inventory.data?.tenants,
    businesses: inventory.data?.businesses,
  }), [viewer.data, inventory.data])

  if (viewer.loading || inventory.loading) return <LoadingCard />

  const reload = () => {
    viewer.reload()
    inventory.reload()
  }

  if (viewer.error || inventory.error) {
    return <ErrorState title="Unable to load Business Routing" detail={viewer.error || inventory.error} retry={reload} />
  }

  const enterBusiness = (business) => {
    const tenant = inventory.data?.tenants?.find((item) => item.id === business.tenantId)
    scope.select({ portfolioId: tenant?.portfolioId || null, businessId: business.id })
    router.push('/overview')
  }

  return (
    <BusinessRoutingShell>
      <PageHeader
        eyebrow="Business Routing"
        title="Choose a Business"
        subtitle="Select the Business you want to work in. Portfolio and Tenant are context labels only."
      />
      {availableBusinesses.length === 0 ? (
        <EmptyState
          title="No Business is available"
          hint="Your current viewer does not have access to a Business yet."
        />
      ) : (
        <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
          {availableBusinesses.map((item) => (
            <BusinessChoice key={item.business.id} item={item} onSelect={enterBusiness} />
          ))}
        </div>
      )}
    </BusinessRoutingShell>
  )
}
