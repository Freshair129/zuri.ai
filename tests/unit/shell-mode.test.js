import { describe, it, expect } from 'vitest'
import { deriveShell, visibleWorkspaces, SHELL_SINGLE, SHELL_MULTI } from '@/lib/shell-mode'

// @req FR-020 — the shell adapts to the data, never to a setting.

const BUS_A = { id: 'b1', code: 'BUS-001', name: 'ครัวคุณโอเวน', tenantId: 't1' }
const BUS_B = { id: 'b2', code: 'BUS-002', name: 'ครัวกลาง', tenantId: 't2' }
const WS_A1 = { id: 'w1', code: 'WS-A1', scopeType: 'BUSINESS', businessId: 'b1' }
const WS_A2 = { id: 'w2', code: 'WS-A2', scopeType: 'BUSINESS', businessId: 'b1' }
const WS_B1 = { id: 'w3', code: 'WS-B1', scopeType: 'BUSINESS', businessId: 'b2' }
const WS_GROUP = { id: 'w4', code: 'WS-PLATFORM', scopeType: 'PORTFOLIO', businessId: null }

describe('deriveShell — single business', () => {
  it('hides the switcher and scopes to the only business without any selection', () => {
    const shell = deriveShell({ businesses: [BUS_A], workspaces: [WS_A1, WS_GROUP], selection: {} })
    expect(shell.mode).toBe(SHELL_SINGLE)
    expect(shell.showBusinessSwitcher).toBe(false)
    expect(shell.activeBusinessId).toBe('b1')
    expect(shell.landing).toBe('BUSINESS')
  })

  it('hides the workspace selector when there is nothing to choose between', () => {
    expect(deriveShell({ businesses: [BUS_A], workspaces: [WS_A1], selection: {} }).showWorkspaceSelector).toBe(false)
    expect(deriveShell({ businesses: [BUS_A], workspaces: [WS_A1, WS_A2], selection: {} }).showWorkspaceSelector).toBe(true)
  })

  it('ignores a stale saved selection pointing at a business that no longer exists', () => {
    const shell = deriveShell({ businesses: [BUS_A], workspaces: [WS_A1], selection: { businessId: 'gone' } })
    expect(shell.activeBusinessId).toBe('b1')
  })

  it('offers a portfolio picker only to an owner who holds more than one group', () => {
    const one = deriveShell({ portfolios: [{ id: 'p1' }], businesses: [BUS_A], workspaces: [WS_A1], selection: {} })
    expect(one.showPortfolioSelector).toBe(false)
    const two = deriveShell({
      portfolios: [{ id: 'p1' }, { id: 'p2' }],
      businesses: [BUS_A, BUS_B],
      workspaces: [WS_A1, WS_B1],
      selection: {},
    })
    expect(two.showPortfolioSelector).toBe(true)
  })

  it('keeps Portfolio as a real selection level without changing the business isolation model', () => {
    const shell = deriveShell({
      portfolios: [{ id: 'p1' }, { id: 'p2' }],
      businesses: [BUS_A, BUS_B],
      workspaces: [WS_A1, WS_B1],
      selection: { portfolioId: 'p1', businessId: 'b1' },
    })
    expect(shell.activeBusinessId).toBe('b1')
    expect(shell.showPortfolioSelector).toBe(true)
  })

  it('survives an empty install with no businesses at all', () => {
    const shell = deriveShell({ businesses: [], workspaces: [], selection: {} })
    expect(shell.mode).toBe(SHELL_SINGLE)
    expect(shell.activeBusiness).toBeNull()
    expect(shell.landing).toBe('BUSINESS')
  })
})

describe('deriveShell — multi business', () => {
  it('shows the switcher and requires a Business before operational work', () => {
    const shell = deriveShell({ businesses: [BUS_A, BUS_B], workspaces: [WS_A1, WS_B1, WS_GROUP], selection: {} })
    expect(shell.mode).toBe(SHELL_MULTI)
    expect(shell.showBusinessSwitcher).toBe(true)
    expect(shell.activeBusinessId).toBeNull()
    expect(shell.landing).toBe('BUSINESS_REQUIRED')
    expect(shell.scopedWorkspaces).toHaveLength(3)
  })

  it('lands on business work once a business is picked, and narrows workspaces', () => {
    const shell = deriveShell({
      businesses: [BUS_A, BUS_B],
      workspaces: [WS_A1, WS_A2, WS_B1, WS_GROUP],
      selection: { businessId: 'b1' },
    })
    expect(shell.landing).toBe('BUSINESS')
    expect(shell.scopedWorkspaces.map((w) => w.code)).toEqual(['WS-A1', 'WS-A2', 'WS-PLATFORM'])
  })
})

describe('visibleWorkspaces', () => {
  it('keeps group-level workspaces visible from inside a business (B3)', () => {
    expect(visibleWorkspaces([WS_A1, WS_B1, WS_GROUP], BUS_A).map((w) => w.code)).toEqual(['WS-A1', 'WS-PLATFORM'])
  })

  it('never leaks another business workspace', () => {
    expect(visibleWorkspaces([WS_A1, WS_B1], BUS_B).map((w) => w.code)).toEqual(['WS-B1'])
  })
})
