'use client'

// @req FR-248 — one PAGE_VIEW UsageEvent per route change, fired from a single
// hook mounted once in the shell rather than instrumented per page (ADR-095
// D2). Renders nothing; a route change is the only thing it watches.
// @spec ADR-095 D2
// @tested tests/unit/usage-events-tracker.test.js

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

export function recordAction(name, fetcher = globalThis.fetch) {
  try {
    fetcher('/api/platform/usage-events', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'ACTION', actionName: name }),
      keepalive: true,
    }).catch(() => {
      // Best-effort: a lost beacon never blocks the action it describes.
    })
  } catch {
    // Same — fetch itself throwing (no network) must not surface to the caller.
  }
}

export default function UsagePageViewTracker({ fetcher = globalThis.fetch }) {
  const pathname = usePathname()
  const last = useRef(null)
  useEffect(() => {
    if (!pathname || pathname === last.current) return
    last.current = pathname
    try {
      fetcher('/api/platform/usage-events', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'PAGE_VIEW', route: pathname }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      // Best-effort beacon; a failed send is not this page's problem.
    }
  }, [pathname, fetcher])
  return null
}
