import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

// @req NFR-008 — a route the e2e suite can navigate to must be compiled before
// a test asserts on it, or the suite reports compile latency as a failure.
// @tested tests/unit/e2e-warmup.test.js
//
// The warm-up list lives in a CommonJS Playwright file that cannot import the
// domain registry (lucide-react is ESM-only). This test is the seam that keeps
// the two honest: add a sub-domain and this fails, rather than the sub-domain
// quietly becoming whichever spec flakes next.

const source = readFileSync('tests/e2e/warmup.setup.js', 'utf8')
const listed = new Set([...source.matchAll(/'(\/[^']*)'/g)].map((match) => match[1]))

describe('the e2e warm-up covers the domain registry', () => {
  it('warms every domain base path and sub-domain path', () => {
    const registry = DOMAINS.flatMap((domain) => [domain.basePath, ...domain.sub.map((item) => item.path)]).filter(Boolean)
    const missing = [...new Set(registry)].filter((route) => !listed.has(route))
    expect(missing, `add to tests/e2e/warmup.setup.js: ${missing.join(', ')}`).toEqual([])
  })

  it('warms the entry routes, which sit outside the domain registry', () => {
    for (const route of ['/', '/login', '/businesses', '/overview', '/profile']) {
      expect(listed.has(route), `warm-up is missing ${route}`).toBe(true)
    }
  })

  it('is wired as a dependency of the spec project, not merely present', () => {
    // A warm-up file that nothing depends on warms nothing.
    const config = readFileSync('playwright.config.js', 'utf8')
    expect(config).toContain("testMatch: /warmup\\.setup\\.js/")
    expect(config).toContain("dependencies: ['warmup']")
  })
})
