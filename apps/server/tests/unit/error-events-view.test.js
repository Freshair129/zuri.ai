// @req FR-247 — the operator error list renders occurrence count, first/last
//   seen, resolve for an active row, and no request/response content.
// @spec ADR-095 D1
// @tested tests/unit/error-events-view.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ErrorEventsView from '@/modules/platform-control/components/ErrorEventsView'

globalThis.React = React

const event = (over) => ({
  id: 'ee-1', fingerprint: 'fp-1', name: 'Error', message: 'QUEUE_UNAVAILABLE',
  frames: [{ file: 'route.js', line: 10, function: 'handler' }], occurrenceCount: 3,
  firstSeenAt: '2026-09-16T01:00:00.000Z', lastSeenAt: '2026-09-16T05:00:00.000Z',
  correlationId: 'corr-1', route: '/api/x', resolvedAt: null, resolvedByPersonId: null, ...over,
})

describe('FR-247 error events view', () => {
  it('renders an active error with its count and a resolve action, no resolved one', () => {
    const html = renderToStaticMarkup(createElement(ErrorEventsView, {
      initialEvents: [event(), event({ id: 'ee-2', message: 'CONNECTION_RESET', resolvedAt: '2026-09-16T06:00:00.000Z', resolvedByPersonId: 'per-1' })],
    }))
    expect(html).toContain('QUEUE_UNAVAILABLE')
    expect(html).toContain('3')
    expect(html).toContain('ปิด (resolve)')
    expect(html).toContain('ปิดแล้ว')
  })

  it('states when nothing is active', () => {
    expect(renderToStaticMarkup(createElement(ErrorEventsView, { initialEvents: [] }))).toContain('ไม่มี error ที่ยัง active')
  })

  it('never renders the raw fingerprint, correlationId or route — only what an operator needs to triage', () => {
    const html = renderToStaticMarkup(createElement(ErrorEventsView, { initialEvents: [event()] }))
    for (const value of ['fp-1', 'corr-1', '/api/x']) expect(html).not.toContain(value)
  })
})
