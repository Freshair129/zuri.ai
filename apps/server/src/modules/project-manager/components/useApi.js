'use client'

// @spec SDD-007 — the UI reads through client fetch to API handlers, which
// delegate to services; there is no server-component read path in the MVP.
import { createElement, useCallback, useEffect, useState } from 'react'

// @req FR-045 - capability requests may add explicit, narrow headers without bypassing JSON error handling.
// @tested tests/unit/fr045-api-ui-contract.test.js

// In-flight GET coalescing. Three shell components (BusinessShellGuard,
// DomainBar, CommandPalette) each call `useFetch('/api/viewer')` on their own,
// so one page load issued three identical requests — measured on production at
// ~6.5s each. This shares the promise while a request is still open and drops
// it the moment it settles, so it is NOT a cache: a later call, and every
// `reload()` after a mutation, still goes to the server. Only plain GETs with
// no body and no custom headers qualify, so a capability header (FR-045) or any
// mutation is never coalesced with anything.
//
// Callers of a coalesced GET share one response object. Every consumer here
// treats API results as read-only view models; a consumer that mutates what it
// receives would now be mutating a sibling's copy too.
const inFlightGets = new Map()

export async function api(path, { method = 'GET', body, headers } = {}) {
  const coalescable = method === 'GET' && !body && !headers
  if (coalescable) {
    const open = inFlightGets.get(path)
    if (open) return open
    const request = requestJson(path, { method, body, headers })
    inFlightGets.set(path, request)
    const settle = () => {
      if (inFlightGets.get(path) === request) inFlightGets.delete(path)
    }
    // Both handlers, so a rejection is observed here and does not surface as an
    // unhandled rejection; the original promise still rejects for its callers.
    request.then(settle, settle)
    return request
  }
  return requestJson(path, { method, body, headers })
}

async function requestJson(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message = data?.error || `Request failed (${res.status})`
    const issues = data?.issues ? `: ${data.issues.join('; ')}` : ''
    const error = new Error(message + issues)
    // T3b-1 FIX 6: purely additive — every existing consumer only reads
    // `.message`. Attaching the HTTP status lets a caller branch on the
    // actual status instead of sniffing message text (e.g. StrategyEditModals'
    // 409-vs-everything-else split for an already-linked Project), which
    // silently degrades to a generic red error the moment the server's
    // message wording changes.
    error.status = res.status
    throw error
  }
  return data
}

/**
 * Fetch hook with loading/error/reload.
 */
export function useFetch(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null })

  const reload = useCallback(async () => {
    if (!path) {
      setState({ data: null, loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await api(path)
      setState({ data, loading: false, error: null })
    } catch (err) {
      setState({ data: null, loading: false, error: err.message })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}

// Written with createElement instead of JSX (this file keeps the plain .js
// extension, and this repo's vitest config has no JSX loader configured for
// .js — only .jsx/.tsx — so real JSX here would break any test that imports
// this module transitively, e.g. `import { api } from './useApi'` elsewhere
// in project-manager/components). Rendered output is unchanged.
export function LoadingCard() {
  return createElement(
    'div',
    { className: 'card grid place-items-center p-10 text-xs text-muted', role: 'status' },
    'Loading…'
  )
}
