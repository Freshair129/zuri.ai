// @req FR-085 — a page of work-status controls reads release state in one scoped
//   batch instead of one full-graph GET /api/work/:id per control; ids the batch
//   lacks keep the per-item read so authorization/scope behaviour is unchanged.
// @spec ADR-035, NFR-008
// @tested tests/unit/status-select-release-batch.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WorkReleaseBatchContext,
  releaseBatchById,
  useBatchedWorkRelease,
} from '@/modules/project-manager/components/WorkReleaseNotice'

globalThis.React = React

function probe(id, initialRelease, batch) {
  let seen
  function Probe() {
    seen = useBatchedWorkRelease(id, initialRelease)
    return null
  }
  renderToStaticMarkup(
    batch === undefined ? createElement(Probe) : createElement(WorkReleaseBatchContext.Provider, { value: batch }, createElement(Probe)),
  )
  return seen
}

describe('FR-085 StatusSelect release batch', () => {
  it('indexes only items that carry a release state', () => {
    const held = { held: true, blockers: [], truncated: false, restricted: false }
    expect(releaseBatchById([{ id: 'a', release: held }, { id: 'b' }, { release: held }, null])).toEqual({ a: held })
    expect(releaseBatchById(undefined)).toEqual({})
  })

  it('serves a loading state while the batch is in flight, without a per-item read', () => {
    expect(probe('a', undefined, { byId: {}, loading: true, error: null })).toEqual({
      batched: true, state: { loading: true, release: null, error: null },
    })
  })

  it('serves the batched release once loaded', () => {
    const release = { held: false, blockers: [], truncated: false, restricted: false }
    expect(probe('a', undefined, { byId: { a: release }, loading: false, error: null })).toEqual({
      batched: true, state: { loading: false, release, error: null },
    })
  })

  it('falls back to the per-item read for an id the batch does not contain or a failed batch', () => {
    expect(probe('missing', undefined, { byId: { a: {} }, loading: false, error: null }).batched).toBe(false)
    expect(probe('a', undefined, { byId: {}, loading: false, error: 'boom' }).batched).toBe(false)
  })

  it('never overrides a row-supplied initialRelease and works with no provider', () => {
    expect(probe('a', { held: false }, { byId: { a: { held: true } }, loading: false, error: null }).batched).toBe(false)
    expect(probe('a', undefined, undefined).batched).toBe(false)
  })
})
