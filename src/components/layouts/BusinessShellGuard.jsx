'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ErrorState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import { resolveBusinessShellDecision } from '@/lib/business-shell-guard'

// @req FR-044 — final BusinessShell chrome mounts only after viewer/business
// routing state is resolved.
// @spec ADR-015, SDD-022 — guard states redirect before AppShell render.
// @tested tests/unit/business-shell-guard.test.js, tests/unit/entry-routing-boundary.test.js

function Redirecting({ destination }) {
  return <LoadingCard label={`Redirecting to ${destination}`} />
}

export default function BusinessShellGuard({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const scope = useScope()
  const viewer = useFetch('/api/viewer')
  const decision = resolveBusinessShellDecision({
    pathname,
    scopeLoaded: scope.loaded,
    viewerLoading: viewer.loading,
    viewerError: viewer.error,
    selection: scope.selection,
    businesses: scope.businesses,
    projects: scope.projects,
    viewer: viewer.data,
  })

  useEffect(() => {
    if (decision.redirect && pathname !== decision.redirect) {
      router.replace(decision.redirect)
    }
  }, [decision.redirect, pathname, router])

  if (decision.state === 'BYPASS') return children
  if (decision.state === 'LOADING') return <LoadingCard />
  if (decision.redirect) return <Redirecting destination={decision.redirect} />
  if (decision.state === 'NOT_FOUND') {
    return <ErrorState title="Project not found" detail="The requested Project is not present in the current scope." />
  }
  if (decision.state !== 'READY') return <LoadingCard />

  return children
}
