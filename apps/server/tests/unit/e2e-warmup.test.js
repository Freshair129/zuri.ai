import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DOMAINS } from '@/config/domains'

// @req NFR-008 — a module the e2e suite can reach must be compiled before a
// test asserts on it, or the suite reports compile latency as a failure.
// @tested tests/unit/e2e-warmup.test.js
//
// The warm-up lives in CommonJS Playwright files that cannot import the domain
// registry (lucide-react is ESM-only). This test is the seam that keeps the
// two honest, and — since 2026-09-07 — the proof that the list derived from
// `src/app` maps every page and route handler the way the App Router does.

const require = createRequire(import.meta.url)
const { ROUTES, discoverRoutes, warmupPlan, PLACEHOLDER } = require('../e2e/warmup-routes.js')

describe('the e2e warm-up covers the domain registry', () => {
  const listed = new Set(ROUTES)

  it('warms every domain base path and sub-domain path', () => {
    const registry = DOMAINS.flatMap((domain) => [domain.basePath, ...domain.sub.map((item) => item.path)]).filter(Boolean)
    const missing = [...new Set(registry)].filter((route) => !listed.has(route))
    expect(missing, `add to tests/e2e/warmup-routes.js: ${missing.join(', ')}`).toEqual([])
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
    // And a derived list the setup does not send warms nothing either.
    const setup = readFileSync('tests/e2e/warmup.setup.js', 'utf8')
    expect(setup).toContain("require('./warmup-routes')")
    expect(setup).toContain('warmupPlan()')
  })
})

describe('the warm-up derives every module under src/app', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'warmup-routes-'))
  afterAll(() => rmSync(fixture, { recursive: true, force: true }))
  const listedByHand = new Set(ROUTES)

  const file = (relative) => {
    const absolute = path.join(fixture, relative)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, '')
  }

  it('maps groups, dynamic segments, slots and private folders as the App Router does', () => {
    file('page.jsx')
    file('(pm)/projects/[projectId]/structure/page.jsx')
    file('(entry)/login/page.jsx')
    file('api/scope/route.js')
    file('api/projects/[id]/tree/route.js')
    file('api/files/[...segments]/route.js')
    file('api/docs/[[...slug]]/route.js')
    file('@modal/preview/page.jsx')
    file('_lib/helpers/page.jsx')
    file('api/notes/README.md')

    expect(discoverRoutes(fixture)).toEqual({
      pages: ['/', `/projects/${PLACEHOLDER}/structure`, '/login'].sort(),
      handlers: ['/api/scope', `/api/projects/${PLACEHOLDER}/tree`, `/api/files/${PLACEHOLDER}`, `/api/docs/${PLACEHOLDER}`].sort(),
    })
  })

  it('leaves no filesystem-only syntax in a URL it will request', () => {
    const { pages, handlers } = discoverRoutes()
    for (const url of [...pages, ...handlers]) {
      expect(url, url).toMatch(/^\/[A-Za-z0-9\-._~/]*$/)
    }
    // Sanity floor rather than an exact count: the point is that the real tree
    // was read, and a count pinned here would drift the way the prose count in
    // next.config.js did.
    expect(pages.length).toBeGreaterThan(50)
    expect(handlers.length).toBeGreaterThan(150)
  })

  it('sends the hand list as GET and every other handler as OPTIONS, once each', () => {
    const plan = warmupPlan()
    const urls = plan.map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
    for (const entry of plan) {
      const handListed = listedByHand.has(entry.url)
      const handler = entry.url.startsWith('/api/')
      expect(entry.method, entry.url).toBe(handListed || !handler ? 'GET' : 'OPTIONS')
    }
  })

  it('names the modules whose cold compile flaked on 2026-09-07 without anyone listing them', () => {
    const plan = new Map(warmupPlan().map((entry) => [entry.url, entry.method]))
    for (const url of [`/api/projects/${PLACEHOLDER}/tree`, '/api/inventory/categories', `/api/growth/campaigns/${PLACEHOLDER}`, '/api/dependencies']) {
      expect(plan.get(url), url).toBe('OPTIONS')
    }
  })
})
