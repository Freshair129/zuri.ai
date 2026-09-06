'use client'

// @req FR-105 — Platform Control mounts through a server-component guard
// (PlatformControlGuard.jsx), which cannot pass an onClick retry handler to
// the shared ErrorState directly (Server → Client props must be
// serializable). This small client boundary is the retry button for that
// guard's SESSION_UNAVAILABLE state.
// @req FR-046 — a session-store outage renders a retry state instead of
// bouncing the operator to /login.
// @spec ADR-048, ADR-017, SDD-024, SEC-020
// @tested tests/unit/platform-control-guard.test.js

import { useRouter } from 'next/navigation'
import { ErrorState } from '@/components/ui'

export default function PlatformControlSessionRetry({ title, detail }) {
  const router = useRouter()
  return <ErrorState title={title} detail={detail} retry={() => router.refresh()} />
}
