import { beforeEach, describe, expect, it, vi } from 'vitest'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

globalThis.React = React

// @req FR-185 — render verified Commerce revenue from the owner DTO without changing its baht units.
// @spec ADR-065, FR-163

const { useFetch } = vi.hoisted(() => ({ useFetch: vi.fn() }))

vi.mock('@/components/ui', () => ({
  Card: ({ children }) => children,
  EmptyState: ({ title, hint }) => `${title} ${hint}`,
  PageHeader: () => null,
  SectionTitle: () => null,
  StatusPill: () => null,
}))
vi.mock('@/modules/project-manager/components/useApi', () => ({ useFetch }))
vi.mock('@/modules/marketing/components/MarketingState', () => ({
  MarketingDataState: ({ children }) => children,
  ScopeNotice: () => null,
  SourceNote: ({ children }) => children,
}))

const { default: PaidMediaWorkspace } = await import('@/modules/marketing/components/paid-media/PaidMediaWorkspace')

function renderPaidMedia(verifiedRevenue, { includeRevenue = true } = {}) {
  const data = { state: 'PARTIAL', metrics: [], sources: [] }
  if (includeRevenue) data.verifiedRevenue = verifiedRevenue
  useFetch.mockReturnValue({ data, loading: false, error: null, reload: vi.fn() })
  return renderToStaticMarkup(createElement(PaidMediaWorkspace, { businessId: 'business-1' }))
}

function ownerRevenue(verifiedNet) {
  return {
    businessId: 'business-1',
    from: '2026-10-01',
    to: '2026-10-07',
    verifiedNet,
    refunded: 0,
    byOrigin: {},
    byDay: [],
    pending: { count: 0, amount: 0 },
    orders: { open: 0, completed: 0 },
  }
}

describe('Paid Media verified Commerce revenue rendering contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    [50, '50.00 THB'],
    [0, '0.00 THB'],
    [0.5, '0.50 THB'],
    [50.05, '50.05 THB'],
    [-50.05, '-50.05 THB'],
  ])('renders owner DTO baht value %s as %s', (verifiedNet, expected) => {
    const html = renderPaidMedia(ownerRevenue(verifiedNet))

    expect(html).toContain(`Verified Commerce revenue: ${expected}`)
    if (verifiedNet === 50) expect(html).not.toContain('Verified Commerce revenue: 0.50 THB')
  })

  it('keeps an absent owner revenue projection unavailable', () => {
    const html = renderPaidMedia(undefined, { includeRevenue: false })

    expect(html).toContain('Verified Commerce revenue is unavailable in this scope.')
    expect(html).not.toContain('Verified Commerce revenue: 0.00 THB')
  })

  it('keeps a revenue DTO with a missing verifiedNet unavailable', () => {
    const html = renderPaidMedia({ businessId: 'business-1', from: null, to: null })

    expect(html).toContain('Verified Commerce revenue: UNAVAILABLE')
  })

  it.each([
    ['null', null],
    ['empty string', ''],
    ['non-numeric string', 'not-a-number'],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['boolean', false],
  ])('keeps invalid %s verifiedNet unavailable', (_label, verifiedNet) => {
    const html = renderPaidMedia(ownerRevenue(verifiedNet))

    expect(html).toContain('Verified Commerce revenue: UNAVAILABLE')
    expect(html).not.toContain('Verified Commerce revenue: 0.00 THB')
  })
})
