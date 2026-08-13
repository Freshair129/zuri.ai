// @req NFR-008 — the shared token contract exposes accessible defaults for changed V2 UI.
// @spec SDD-010, ADR-010 — semantic and component tokens shield primitives from implementation code.
// @tested tests/unit/design-system.test.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

describe('Zuri Heritage design system', () => {
  it('defines primitive, semantic, and component token layers', () => {
    expect(css).toContain('--primitive-amber-500')
    expect(css).toContain('--bg-canvas')
    expect(css).toContain('--button-primary-bg')
    expect(css).toContain('--input-border-focus')
  })

  it('keeps visible focus and reduced-motion fallbacks', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('outline: 2px solid var(--focus-ring)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('uses semantic state treatments instead of gradients and coloured side stripes', () => {
    expect(css).not.toContain('linear-gradient')
    expect(css).not.toContain('border-left:')
    expect(css).toContain('.gate-row.done { background: var(--status-success-bg)')
  })
})
