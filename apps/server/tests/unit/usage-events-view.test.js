// @req FR-248, FR-249 — the operator usage breakdown view renders total,
//   recent and per-person counts for both page views and actions.
// @spec ADR-095 D2
// @tested tests/unit/usage-events-view.test.js
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import UsageBreakdownView from '@/modules/platform-control/components/UsageBreakdownView'

globalThis.React = React

const row = (over) => ({
  target: '/control/roadmap', recentCount: 3, rolledUpCount: 40, totalCount: 43,
  byPerson: [{ personId: 'per-1', label: 'Ploy', count: 2 }, { personId: 'per-2', label: 'Nok', count: 1 }],
  ...over,
})

describe('FR-248, FR-249 usage breakdown view', () => {
  it('renders route and action tables with totals, recent counts and the per-person split', () => {
    const html = renderToStaticMarkup(createElement(UsageBreakdownView, {
      initialBreakdown: { pageViews: [row()], actions: [row({ target: 'platform_control.sign_out', byPerson: [] })] },
    }))
    expect(html).toContain('/control/roadmap')
    expect(html).toContain('43')
    expect(html).toContain('Ploy')
    expect(html).toContain('Nok')
    expect(html).toContain('platform_control.sign_out')
    expect(html).toContain('เกิน 90 วัน')
  })

  it('states when a table has nothing yet', () => {
    const html = renderToStaticMarkup(createElement(UsageBreakdownView, { initialBreakdown: { pageViews: [], actions: [] } }))
    expect(html).toContain('ยังไม่มีข้อมูล')
  })
})
