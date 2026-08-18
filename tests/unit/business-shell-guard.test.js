import { describe, expect, it } from 'vitest'
import { resolveBusinessShellDecision, projectIdFromPath } from '@/lib/business-shell-guard'
import { deriveShell } from '@/lib/shell-mode'

// @req FR-044 — route states must be resolved before BusinessShell render.
// @spec ADR-015, SDD-022
// @tested tests/unit/business-shell-guard.test.js

const businesses = [{ id: 'b-1', name: 'Business 1' }, { id: 'b-2', name: 'Business 2' }]
const viewer = { visibleBusinessIds: ['b-1'], visibleDomains: ['projects', 'people'] }
const base = { scopeLoaded: true, businesses, viewer }

describe('BusinessShell route guard', () => {
  it('requires viewer before mounting a shell', () => {
    expect(resolveBusinessShellDecision({ ...base, viewer: null, selection: { businessId: 'b-1' } })).toMatchObject({
      state: 'AUTH_REQUIRED',
      redirect: '/login',
    })
  })

  it('turns a failed viewer resolution into the login transition', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      viewer: null,
      viewerError: 'Viewer unavailable',
      selection: { businessId: 'b-1' },
    })).toMatchObject({ state: 'AUTH_REQUIRED', redirect: '/login', reason: 'VIEWER_ERROR' })
  })

  it('requires an explicit Business selection even with one visible Business', () => {
    expect(resolveBusinessShellDecision({ ...base, selection: {} })).toMatchObject({
      state: 'BUSINESS_REQUIRED',
      redirect: '/businesses',
    })
  })

  it('rejects a selected Business the viewer cannot access', () => {
    expect(resolveBusinessShellDecision({ ...base, selection: { businessId: 'b-2' } })).toMatchObject({
      state: 'FORBIDDEN',
      redirect: '/businesses',
      reason: 'BUSINESS_ACCESS',
    })
  })

  it('allows an authorized Business and preserves the project resource shell', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/projects/p-1/team',
      selection: { businessId: 'b-1' },
      projects: [{ id: 'p-1', businessId: 'b-1' }],
    })).toMatchObject({ state: 'READY', businessId: 'b-1' })
  })

  it('redirects a known project owner mismatch to the selected Business Overview', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/projects/p-2',
      selection: { businessId: 'b-1' },
      projects: [{ id: 'p-2', businessId: 'b-2' }],
    })).toMatchObject({
      state: 'FORBIDDEN',
      redirect: '/overview',
      reason: 'PROJECT_BUSINESS_MISMATCH',
    })
  })

  it('allows a shared project with no direct Business owner', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/projects/p-shared',
      selection: { businessId: 'b-1' },
      projects: [{ id: 'p-shared', businessId: null }],
    })).toMatchObject({ state: 'READY', businessId: 'b-1' })
  })

  it('returns a non-shell NOT_FOUND state for an unknown Project', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/projects/missing-project',
      selection: { businessId: 'b-1' },
      projects: [],
    })).toMatchObject({ state: 'NOT_FOUND', reason: 'PROJECT_NOT_FOUND' })
  })

  it('rejects a domain without a viewer grant before AppShell render', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/people/directory',
      selection: { businessId: 'b-1' },
      viewer: { ...viewer, visibleDomains: ['projects'] },
    })).toMatchObject({
      state: 'FORBIDDEN',
      redirect: '/overview',
      reason: 'DOMAIN_ACCESS',
      domain: 'people',
    })
  })

  it('keeps Business Overview available as the shell root after a domain denial', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/overview',
      selection: { businessId: 'b-1' },
      viewer: { ...viewer, visibleDomains: ['people'] },
    })).toMatchObject({ state: 'READY', businessId: 'b-1' })
  })

  it('treats Profile as a Platform identity route, not Development fallback', () => {
    expect(resolveBusinessShellDecision({
      ...base,
      pathname: '/profile',
      selection: { businessId: 'b-1' },
      viewer: { ...viewer, visibleDomains: ['platform'] },
    })).toMatchObject({ state: 'READY', businessId: 'b-1' })
  })

  it('bypasses the BusinessShell for entry and routing paths', () => {
    for (const pathname of ['/', '/login', '/businesses']) {
      expect(resolveBusinessShellDecision({ ...base, pathname })).toEqual({ state: 'BYPASS' })
    }
  })

  it('extracts project ids without treating sibling routes as project resources', () => {
    expect(projectIdFromPath('/projects/p-1/files')).toBe('p-1')
    expect(projectIdFromPath('/projects')).toBe(null)
    expect(projectIdFromPath('/projects/new')).toBe(null)
  })
})

describe('the guard is the only decider of "no Business"', () => {
  // @req FR-044, FR-020 - the guard reads `selection.businessId`; every page
  // inside the `(pm)` shell reads `shell.activeBusinessId`, which `deriveShell`
  // computes separately and which CAN disagree with the selection (a
  // single-Business install is implicitly scoped even with no selection at
  // all). Three pages therefore kept their own "choose a Business" empty state
  // for the disagreement in the other direction - READY with no active
  // Business. This sweep is the proof that direction does not exist, which is
  // what ADR-015 asserts ("BusinessShell can assume an authorized
  // activeBusinessId"). If deriveShell ever gains a way to return a falsy
  // activeBusinessId for a selection the guard admitted, this fails and the
  // shell pages need a state again - rather than rendering with a null id.
  const BUSINESS_SETS = [
    [],
    [{ id: 'b-1' }],
    [{ id: 'b-1' }, { id: 'b-2' }],
    [{ id: 'b-1' }, { id: 'b-2' }, { id: 'b-3' }],
  ]
  const SELECTIONS = [{}, { businessId: null }, { businessId: 'b-1' }, { businessId: 'b-2' }, { businessId: 'gone' }]
  const GRANTS = ['projects', 'people', 'files']
  const VIEWERS = [
    { visibleBusinessIds: [], visibleDomains: GRANTS },
    { visibleBusinessIds: ['b-1'], visibleDomains: GRANTS },
    { visibleBusinessIds: ['b-1', 'b-2'], visibleDomains: GRANTS },
    { visibleBusinessIds: ['gone'], visibleDomains: GRANTS },
  ]
  // The three surfaces that owned the removed empty states, plus the shell root.
  const PATHS = ['/overview', '/people', '/people/directory', '/files']

  it('never reaches READY with a falsy shell.activeBusinessId', () => {
    let readyCases = 0
    for (const businesses of BUSINESS_SETS) {
      for (const selection of SELECTIONS) {
        for (const viewer of VIEWERS) {
          for (const pathname of PATHS) {
            const decision = resolveBusinessShellDecision({
              pathname, scopeLoaded: true, businesses, selection, viewer, projects: [],
            })
            if (decision.state !== 'READY') continue
            readyCases += 1
            const shell = deriveShell({ businesses, workspaces: [], selection })
            const where = JSON.stringify({ pathname, businesses, selection, viewer })
            expect(shell.activeBusinessId, where).toBe(decision.businessId)
            expect(shell.activeBusinessId, where).toBeTruthy()
          }
        }
      }
    }
    // A sweep that admitted nothing would pass vacuously.
    expect(readyCases).toBeGreaterThan(0)
  })

  it('sends every un-selected and unauthorized case to Business Routing instead', () => {
    const businesses = [{ id: 'b-1' }, { id: 'b-2' }]
    const viewer = { visibleBusinessIds: ['b-1'], visibleDomains: ['projects', 'people', 'files'] }
    for (const selection of [{}, { businessId: null }, { businessId: 'b-2' }, { businessId: 'gone' }]) {
      const decision = resolveBusinessShellDecision({
        pathname: '/overview', scopeLoaded: true, businesses, selection, viewer,
      })
      expect(decision.state, JSON.stringify(selection)).not.toBe('READY')
      expect(decision.redirect, JSON.stringify(selection)).toBe('/businesses')
    }
  })
})
