import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyViewerFailure } from '@/lib/viewer-failure'

// @req FR-046 — a 503 SESSION_UNAVAILABLE viewer failure must never classify
// the same as a 401 AUTH_REQUIRED one; every guard/page shares this one
// classifier instead of re-deriving (or forgetting) the split by hand.
// @req FR-123 — plugin-consent-view.js made this split by hand already; this
// file is that logic extracted once (D1-journey-states-tests-docs-01).
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/viewer-failure.test.js

const fromRoot = (...parts) => resolve(process.cwd(), ...parts)

describe('classifyViewerFailure', () => {
  it('reads a known code straight out of a string body (the useFetch() shape)', () => {
    expect(classifyViewerFailure({ body: 'AUTH_REQUIRED' })).toBe('AUTH_REQUIRED')
    expect(classifyViewerFailure({ body: 'SESSION_UNAVAILABLE' })).toBe('SESSION_UNAVAILABLE')
    expect(classifyViewerFailure({ body: 'FORBIDDEN' })).toBe('FORBIDDEN')
  })

  it('reads a known code out of a JSON body object (the raw fetch-response shape)', () => {
    expect(classifyViewerFailure({ body: { error: 'AUTH_REQUIRED' } })).toBe('AUTH_REQUIRED')
    expect(classifyViewerFailure({ body: { error: 'SESSION_UNAVAILABLE' } })).toBe('SESSION_UNAVAILABLE')
  })

  it('falls back to the HTTP status when the body carries no recognized code', () => {
    expect(classifyViewerFailure({ status: 503 })).toBe('SESSION_UNAVAILABLE')
    expect(classifyViewerFailure({ status: 401 })).toBe('AUTH_REQUIRED')
    expect(classifyViewerFailure({ status: 403 })).toBe('FORBIDDEN')
  })

  it('accepts a stringly-typed status (e.g. from an Error thrown by resolveRequestViewer)', () => {
    expect(classifyViewerFailure({ status: '503' })).toBe('SESSION_UNAVAILABLE')
    expect(classifyViewerFailure({ status: '401' })).toBe('AUTH_REQUIRED')
  })

  it('prefers a recognized body code over a conflicting status', () => {
    // The status is the fallback signal; a call site that already has the
    // more specific body code must not have it overridden by a stale status.
    expect(classifyViewerFailure({ status: 401, body: 'SESSION_UNAVAILABLE' })).toBe('SESSION_UNAVAILABLE')
    expect(classifyViewerFailure({ status: 503, body: 'AUTH_REQUIRED' })).toBe('AUTH_REQUIRED')
  })

  it('classifies an unrecognized message as UNKNOWN rather than guessing', () => {
    expect(classifyViewerFailure({ body: 'Viewer unavailable' })).toBe('UNKNOWN')
    expect(classifyViewerFailure({ body: 'Principal was not found' })).toBe('UNKNOWN')
  })

  it('classifies an empty or missing failure as UNKNOWN', () => {
    expect(classifyViewerFailure()).toBe('UNKNOWN')
    expect(classifyViewerFailure({})).toBe('UNKNOWN')
    expect(classifyViewerFailure({ body: null, status: null })).toBe('UNKNOWN')
    expect(classifyViewerFailure({ body: undefined, status: undefined })).toBe('UNKNOWN')
  })

  it('ignores a body that is neither a string nor an {error} object', () => {
    expect(classifyViewerFailure({ body: 42 })).toBe('UNKNOWN')
    expect(classifyViewerFailure({ body: {} })).toBe('UNKNOWN')
    expect(classifyViewerFailure({ body: { error: 503 } })).toBe('UNKNOWN')
  })

  it('does not treat an arbitrary numeric status as any known code', () => {
    expect(classifyViewerFailure({ status: 500 })).toBe('UNKNOWN')
    expect(classifyViewerFailure({ status: 404 })).toBe('UNKNOWN')
  })
})

// @req FR-046 — a grep-based sweep so a new page/guard that reacts to a failed
// viewer resolution cannot silently regress into re-deriving (or dropping) the
// 401-vs-503 split this file exists to stop; every file in the list below must
// import the shared classifier rather than hand-rolling its own check.
describe('every viewer-reacting guard/page imports the shared classifier', () => {
  const CONSUMERS = [
    'src/lib/business-shell-guard.js',
    'src/components/layouts/BusinessShellGuard.jsx',
    'src/app/(entry)/businesses/page.jsx',
    'src/app/(entry)/waiting-room/page.jsx',
    'src/app/(entry)/workspace-home/page.jsx',
    'src/app/(entry)/onboarding/profile/page.jsx',
  ]

  it.each(CONSUMERS)('%s imports something from the shared viewer-failure module', (path) => {
    const source = readFileSync(fromRoot(path), 'utf8')
    // business-shell-guard.js lives in src/lib itself and uses the relative
    // form (`./viewer-failure`); every other consumer uses the `@/lib` alias.
    expect(source).toMatch(/from ['"](?:@\/lib\/viewer-failure|\.\/viewer-failure)['"]/)
  })

  // business-shell-guard.js and the four entry pages call the classifier
  // directly; BusinessShellGuard.jsx delegates classification to
  // business-shell-guard.js and only needs the shared Thai copy — it still
  // must import the module (checked above), just not this specific export.
  const DIRECT_CLASSIFIERS = CONSUMERS.filter((path) => path !== 'src/components/layouts/BusinessShellGuard.jsx')

  it.each(DIRECT_CLASSIFIERS)('%s calls classifyViewerFailure directly', (path) => {
    const source = readFileSync(fromRoot(path), 'utf8')
    expect(source).toContain('classifyViewerFailure')
  })

  it('never reintroduces the collapsed 401-or-503 string check this file replaced', () => {
    for (const path of CONSUMERS) {
      const source = readFileSync(fromRoot(path), 'utf8')
      expect(source, path).not.toMatch(/===\s*'AUTH_REQUIRED'\s*\|\|.*===\s*'SESSION_UNAVAILABLE'/)
    }
  })
})
