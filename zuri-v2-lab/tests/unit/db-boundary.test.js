import { describe, it, expect } from 'vitest'
import { normalizeStore, assertDistinctStores, assertDbBoundary } from '@/lib/db-boundary'

// @req FR-030 — Zuri DB ≠ MSP DB (ADR-007 P4).

describe('db boundary (FR-030)', () => {
  it('normalizes sqlite file: refs and postgres urls', () => {
    expect(normalizeStore('file:./dev.db')).toBe('./dev.db')
    expect(normalizeStore('postgresql://user:pw@host:5432/zuri?schema=public&x=1')).toBe('pg://host:5432/zuri?schema=public')
  })

  it('refuses the same store for Zuri and MSP', () => {
    expect(() => assertDistinctStores('postgresql://u:p@h:5432/app?schema=public', 'postgresql://other:pw@h:5432/app')).toThrow(/DB boundary violated/)
  })

  it('allows different databases on the same instance', () => {
    expect(() => assertDistinctStores('postgresql://u:p@h:5432/zuri', 'postgresql://u:p@h:5432/msp')).not.toThrow()
  })

  it('allows different schemas on the same database', () => {
    expect(() => assertDistinctStores('postgresql://u:p@h:5432/app?schema=zuri', 'postgresql://u:p@h:5432/app?schema=msp')).not.toThrow()
  })

  it('is a no-op when MSP is unconfigured (stdio MSP absent)', () => {
    expect(() => assertDbBoundary({ DATABASE_URL: 'file:./dev.db' })).not.toThrow()
  })

  it('bites via env when both point at the same file', () => {
    expect(() => assertDbBoundary({ DATABASE_URL: 'file:./shared.db', MSP_DB_PATH: './shared.db' })).toThrow(/DB boundary violated/)
  })
})
