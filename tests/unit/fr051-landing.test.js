// @req FR-051 — the landing is Zuri-only, local-asset-backed, and keeps one Login action.
// @spec ADR-018, SDD-026 — entry identity and responsive motion are static-testable contracts.
// @tested tests/unit/fr051-landing.test.js

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const paths = {
  page: resolve(root, 'src/app/page.jsx'),
  landing: resolve(root, 'src/components/landing/ZuriLanding.jsx'),
  styles: resolve(root, 'src/components/landing/zuri-landing.module.css'),
  shell: resolve(root, 'src/components/layouts/EntryShell.jsx'),
  social: resolve(root, 'public/og.png'),
}

describe('FR-051 Zuri branded entry landing', () => {
  it('renders only Zuri product language with one route-bearing action', () => {
    const page = readFileSync(paths.page, 'utf8')
    const landing = readFileSync(paths.landing, 'utf8')
    const source = `${page}\n${landing}`

    expect(landing).toContain('ZURI')
    expect(landing).toContain('AI-NATIVE BUSINESS OPERATING SYSTEM')
    expect(landing).toContain('SEE THE')
    expect(landing).toContain('WHOLE BUSINESS.')
    expect(landing).toContain('MOVE WITH')
    expect(landing).toContain('CLARITY.')
    expect((source.match(/href="\//g) || []).length).toBe(1)
    expect(landing).toContain('href="/login"')

    for (const prohibited of ['LGPSM', 'FUTURE FORWARD FASHION', 'SHOP NOW', 'COLLECTIONS', 'JOURNAL', 'CHECKOUT', 'higgs.ai', 'Orbitron']) {
      expect(source).not.toContain(prohibited)
    }
  })

  it('uses a full landing variant without changing the compact entry surface', () => {
    const shell = readFileSync(paths.shell, 'utf8')
    expect(shell).toContain("variant = 'compact'")
    expect(shell).toContain("variant === 'landing'")
    expect(shell).toContain('data-entry-variant="landing"')
    expect(shell).toContain('data-entry-variant="compact"')
  })

  it('ships a local social asset and reduced-motion signal fallback', () => {
    const styles = readFileSync(paths.styles, 'utf8')
    expect(existsSync(paths.social)).toBe(true)
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('pointer-events: none')
    expect(styles).toContain('var(--action-primary)')
  })
})
