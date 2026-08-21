'use client'

// @req FR-046 — Business Routing consumes one viewer-scoped entry read model.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js
// @req FR-044 — Business selection is a routing boundary before the BusinessShell.
// @spec ADR-015, SDD-022 — viewer grants decide visibility; Portfolio/Tenant are ancestry labels only.
// @tested tests/unit/business-routing-page.test.js, tests/unit/business-routing.test.js
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { Card, EmptyState, ErrorState, PageHeader } from '@/components/ui'
import BusinessRoutingShell from '@/components/layouts/BusinessRoutingShell'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

function BusinessChoice({ business, onSelect }) {
  const { tenant, portfolio } = business
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
  const entry = useFetch('/api/entry')
  const availableBusinesses = entry.data?.businesses || []

  useEffect(() => {
    if (entry.error === 'AUTH_REQUIRED' || entry.error === 'SESSION_UNAVAILABLE') {
      router.replace('/login')
    }
  }, [entry.error, router])

  if (entry.loading || entry.error === 'AUTH_REQUIRED' || entry.error === 'SESSION_UNAVAILABLE') return <LoadingCard />

  if (entry.error) {
    return <ErrorState title="Unable to load Business Routing" detail={entry.error} retry={entry.reload} />
  }

  const enterBusiness = (business) => {
    scope.select({ portfolioId: business.portfolio?.id || null, businessId: business.id })
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
            <BusinessChoice key={item.id} business={item} onSelect={enterBusiness} />
          ))}
        </div>
      )}
    </BusinessRoutingShell>
  )
}
