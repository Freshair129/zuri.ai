'use client'

// @req FR-042 - HR / People peer domain directory.
// @spec ADR-013, SDD-020 - People is Business-scoped; Project Team stays in Development.
// @tested tests/unit/people-directory.test.js

import Link from 'next/link'
import { Users, UserRound } from 'lucide-react'
import { Card, EmptyState, ErrorState, Kpi, PageHeader, SectionTitle } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'

export default function PeopleDirectory({ directoryOnly = false }) {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  const { data, loading, error, reload } = useFetch(
    businessId ? `/api/people?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )

  if (!businessId) {
    // @req FR-044 — Business Routing is `/businesses`; `/` is the marketing
    // Landing (FR-056). This CTA sent the user out of the shell instead of to
    // the selector it names.
    return (
      <EmptyState
        title="Choose a business first"
        hint="HR / People is always scoped to one operating Business."
        action={<Link href="/businesses" className="btn btn-primary">Choose Business</Link>}
      />
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="HR / People"
        title={directoryOnly ? 'People Directory' : `${scope.shell.activeBusiness?.name || 'Business'} People`}
        subtitle="Business workforce records, separate from project assignment and delivery capacity."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && data && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3 max-md:grid-cols-1">
            <Kpi label="People" value={data.summary.peopleCount} meta="visible in this Business" />
            <Kpi label="Business scoped" value={data.summary.businessScopedCount} meta="direct membership" />
            <Kpi label="Tenant scoped" value={data.summary.tenantScopedCount} meta="shared within tenant" />
          </div>
          <Card>
            <SectionTitle caption="Master data and membership scope; project assignment lives in Development > Project Team">
              People Directory
            </SectionTitle>
            {data.people.length === 0 ? (
              <EmptyState title="No people in this Business" hint="Add a membership from Platform when workforce data is ready." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="border-b border-[var(--border)] text-[10px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-2">Person</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2">Scope</th>
                      <th className="px-2 py-2">Branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((entry) => (
                      <tr key={entry.membershipId} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden>
                              <UserRound size={14} />
                            </span>
                            <span>
                              <span className="block font-bold">{entry.person.displayName}</span>
                              <span className="block text-[10px] text-muted">{entry.person.email || entry.person.code}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-3">{entry.role}</td>
                        <td className="px-2 py-3"><span className="pill pill-planned">{entry.businessScope}</span></td>
                        <td className="px-2 py-3">{entry.branch?.name || 'Tenant-wide'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-3 flex items-center gap-1 text-[10px] text-muted"><Users size={12} aria-hidden /> Project Team is a separate Project-local view.</p>
        </>
      )}
    </div>
  )
}
