import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
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
const { appendServerTimingsPreload, createHostCleanupRecord, diagnosticsEnabled } = require('../e2e/server-timings.cjs')

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

describe('the CI e2e server mode', () => {
  it('records opt-in server lifecycle and event-loop diagnostics with a closed schema', () => {
    const preload = path.resolve('tests/e2e/server-timings.cjs')
    const directory = mkdtempSync(path.join(tmpdir(), 'e2e-server-timing-'))
    const entrypoint = path.join(directory, 'next')
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      E2E_SERVER_MODE: 'production',
      E2E_EXTERNAL_SERVER: 'true',
      ZURI_E2E_SERVER_DIAGNOSTICS: '1',
      DATABASE_URL: 'file:./e2e-diagnostics.db',
      ZURI_E2E_SENTINEL: 'must-not-be-logged',
    }
    try {
      expect(diagnosticsEnabled(env)).toBe(true)
      expect(diagnosticsEnabled({ ...env, NODE_ENV: 'production' })).toBe(false)
      expect(diagnosticsEnabled({ ...env, E2E_EXTERNAL_SERVER: 'false' })).toBe(false)
      expect(diagnosticsEnabled({ ...env, DATABASE_URL: 'postgresql://sentinel' })).toBe(false)
      expect(appendServerTimingsPreload('--trace-warnings')).toBe('--trace-warnings --require ./tests/e2e/server-timings.cjs')
      expect(appendServerTimingsPreload(appendServerTimingsPreload('--trace-warnings')))
        .toBe('--trace-warnings --require ./tests/e2e/server-timings.cjs')
      const cleanup = createHostCleanupRecord({
        pid: 123,
        outcome: 'terminated',
        at: '2026-10-31T00:00:00.000Z',
        token: 'must-not-be-logged',
        url: 'https://sentinel.invalid',
      })
      expect(cleanup).toEqual({
        kind: 'E2E_SERVER_DIAGNOSTIC',
        event: 'host-cleanup',
        at: '2026-10-31T00:00:00.000Z',
        pid: 123,
        outcome: 'terminated',
      })
      expect(JSON.stringify(cleanup)).not.toContain('must-not-be-logged')
      expect(JSON.stringify(cleanup)).not.toContain('sentinel.invalid')
      const cleanupCli = spawnSync(process.execPath, ['tests/e2e/server-cleanup-record.cjs', '123', 'terminated'], {
        encoding: 'utf8', timeout: 5000,
      })
      expect(cleanupCli.error).toBeUndefined()
      expect(cleanupCli.status, cleanupCli.stderr).toBe(0)
      expect(JSON.parse(cleanupCli.stdout)).toEqual({
        kind: 'E2E_SERVER_DIAGNOSTIC',
        event: 'host-cleanup',
        at: expect.any(String),
        pid: 123,
        outcome: 'terminated',
      })

      writeFileSync(entrypoint, `
      setTimeout(() => {
        const until = performance.now() + 250
        while (performance.now() < until) {}
      }, 100)
      setTimeout(() => {}, 1250)
    `)
      const workflowOptions = spawnSync(process.execPath, ['tests/e2e/prepare-server-timings-options.cjs'], {
        encoding: 'utf8', timeout: 5000, env: { ...env, NODE_OPTIONS: '--trace-warnings' },
      })
      expect(workflowOptions.error).toBeUndefined()
      expect(workflowOptions.status, workflowOptions.stderr).toBe(0)
      const child = spawnSync(process.execPath, [entrypoint, 'start'], {
        encoding: 'utf8', timeout: 5000, env: { ...env, NODE_OPTIONS: workflowOptions.stdout },
      })
      expect(child.error).toBeUndefined()
      expect(child.status, child.stderr).toBe(0)
      const samples = child.stderr.trim().split('\n').map(line => JSON.parse(line))
      expect(samples.map(sample => sample.event)).toEqual(expect.arrayContaining(['started', 'heartbeat', 'exit']))
      expect(samples.at(-1).event).toBe('exit')
      expect(samples.some(sample => sample.eventLoopMaxMs >= 200)).toBe(true)
      const allowedKeys = new Set([
        'at', 'cpuSystemMs', 'cpuUserMs', 'event', 'eventLoopMaxMs', 'kind', 'parentPid',
        'pid', 'sequence', 'startedAt', 'uptimeMs', 'windowMs',
      ])
      for (const sample of samples) {
        expect(Object.keys(sample).every(key => allowedKeys.has(key))).toBe(true)
        expect(sample).toHaveProperty('at')
        expect(sample).toHaveProperty('pid')
        expect(sample).toHaveProperty('parentPid')
        expect(sample).toHaveProperty('sequence')
        expect(sample).toHaveProperty('uptimeMs')
        expect(sample.kind).toBe('E2E_SERVER_DIAGNOSTIC')
        expect(['started', 'heartbeat', 'exit']).toContain(sample.event)
        expect(Number.isInteger(sample.pid) && sample.pid > 0).toBe(true)
        expect(Number.isInteger(sample.parentPid) && sample.parentPid > 0).toBe(true)
        expect(Number.isInteger(sample.sequence) && sample.sequence >= 0).toBe(true)
        expect(Number.isFinite(sample.uptimeMs) && sample.uptimeMs >= 0).toBe(true)
        expect(Number.isFinite(Date.parse(sample.at))).toBe(true)
        if (sample.event === 'started') {
          expect(Number.isFinite(Date.parse(sample.startedAt))).toBe(true)
          expect(sample).not.toHaveProperty('windowMs')
        }
        if (sample.event === 'heartbeat') {
          for (const key of ['windowMs', 'cpuUserMs', 'cpuSystemMs']) {
            expect(Number.isFinite(sample[key])).toBe(true)
            expect(sample[key]).toBeGreaterThanOrEqual(0)
          }
        }
        if (typeof sample.eventLoopMaxMs === 'number') {
          expect(Number.isFinite(sample.eventLoopMaxMs)).toBe(true)
          expect(sample.eventLoopMaxMs).toBeGreaterThanOrEqual(0)
        }
      }
      expect(child.stderr).not.toContain('must-not-be-logged')
      expect(child.stderr).not.toContain('postgresql://')

      // Exercise the actual Playwright webServer.env object, then launch the
      // same guarded Next-shaped child without an explicit --require argument.
      const configPath = require.resolve('../../playwright.config.js')
      const e2eEnvKeys = [
        'NODE_ENV', 'E2E_SERVER_MODE', 'E2E_EXTERNAL_SERVER', 'ZURI_E2E_SERVER_DIAGNOSTICS',
        'DATABASE_URL', 'NODE_OPTIONS', 'E2E_PORT',
      ]
      const previousEnv = Object.fromEntries(e2eEnvKeys.map(key => [key, process.env[key]]))
      let fallbackEnv
      try {
        Object.assign(process.env, {
          NODE_ENV: 'test',
          E2E_SERVER_MODE: 'production',
          E2E_EXTERNAL_SERVER: 'true',
          ZURI_E2E_SERVER_DIAGNOSTICS: '1',
          DATABASE_URL: 'file:./e2e-diagnostics.db',
          NODE_OPTIONS: '--trace-warnings',
          E2E_PORT: '3100',
        })
        delete require.cache[configPath]
        const configured = require(configPath)
        fallbackEnv = configured.webServer.env
      } finally {
        delete require.cache[configPath]
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
      expect(fallbackEnv.NODE_OPTIONS).toBe(workflowOptions.stdout)
      const fallback = spawnSync(process.execPath, [entrypoint, 'start'], {
        encoding: 'utf8', timeout: 5000, env: fallbackEnv,
      })
      expect(fallback.error).toBeUndefined()
      expect(fallback.status, fallback.stderr).toBe(0)
      expect(fallback.stderr.trim().split('\n').map(line => JSON.parse(line).event))
        .toEqual(expect.arrayContaining(['started', 'heartbeat', 'exit']))

      // An unref'ed observer alone must not hold the Node process open.
      writeFileSync(entrypoint, '')
      const idle = spawnSync(process.execPath, ['--require', preload, entrypoint, 'start'], {
        encoding: 'utf8', timeout: 5000, env,
      })
      expect(idle.error).toBeUndefined()
      expect(idle.status, idle.stderr).toBe(0)
      expect(idle.stderr.trim().split('\n').map(line => JSON.parse(line).event)).toEqual(['started', 'exit'])
      // Inherited NODE_OPTIONS must not monitor unrelated child entrypoints.
      const other = spawnSync(process.execPath, ['--require', preload, '-e', 'setTimeout(() => {}, 1250)'], {
        encoding: 'utf8', timeout: 5000, env,
      })
      expect(other.error).toBeUndefined()
      expect(other.status, other.stderr).toBe(0)
      expect(other.stderr).toBe('')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('builds and selects the production server without the dev warm-up', () => {
    const config = readFileSync('playwright.config.js', 'utf8')
    const workflow = readFileSync('../../.github/workflows/governance.yml', 'utf8')

    expect(config).toContain("process.env.E2E_SERVER_MODE === 'production'")
    expect(config).toContain('node node_modules/next/dist/bin/next start -p ${target.port}')
    expect(config).toContain("...(useProductionServer ? { NODE_ENV: 'test' } : {})")
    expect(config).toContain('projects: useProductionServer')
    expect(config).toContain('reuseExistingServer: useProductionServer')
    expect(workflow).toContain('Production build for e2e server')
    expect(workflow).toContain('run: npm run build')
    expect(workflow).toContain('Prepare production e2e database')
    expect(workflow).toContain('Start production e2e server')
    expect(workflow).toContain('Stop production e2e server')
    expect(workflow).toContain("E2E_PORT: '3100'")
    expect(workflow).toContain("E2E_EXTERNAL_SERVER: 'true'")
    expect(workflow.match(/ZURI_E2E_SERVER_DIAGNOSTICS: '1'/g)).toHaveLength(2)
    expect(workflow).toContain('E2E_SERVER_MODE: production')
    expect(workflow).toContain('node ./tests/e2e/prepare-server-timings-options.cjs')
    expect(workflow).toContain('node ./tests/e2e/server-cleanup-record.cjs')
    expect(workflow).toContain('$env:NODE_OPTIONS = node ./tests/e2e/prepare-server-timings-options.cjs')
    expect(workflow).toContain("Add-Content -Path 'node_modules/.cache/zuri-test-proof/e2e-server/stderr.log'")
    expect(config).toContain('appendServerTimingsPreload(process.env.NODE_OPTIONS)')
    expect(config).toContain("process.env.ZURI_E2E_SERVER_DIAGNOSTICS === '1'")
  })

  it('builds the real document graph in the E2E job before starting its server', () => {
    const workflow = readFileSync('../../.github/workflows/governance.yml', 'utf8')
    const e2eJob = workflow.slice(workflow.indexOf('\n  e2e:'))
    const graphStep = e2eJob.indexOf('Build the document graph for Knowledge Studio')
    expect(graphStep).toBeGreaterThan(0)
    expect(graphStep).toBeLessThan(e2eJob.indexOf('Start production e2e server'))
    expect(e2eJob.slice(graphStep, e2eJob.indexOf('Production build for e2e server'))).toContain('run: npm run docs:graph')
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
    const discoveredHandlers = new Set(discoverRoutes().handlers)
    for (const entry of plan) {
      const handListed = listedByHand.has(entry.url)
      const handler = discoveredHandlers.has(entry.url)
      expect(entry.method, entry.url).toBe(handListed || !handler ? 'GET' : 'OPTIONS')
    }
  })

  it('warms a synthetic non-API handler as OPTIONS and keeps a hand-listed handler as GET', () => {
    const synthetic = mkdtempSync(path.join(tmpdir(), 'warmup-handler-method-'))
    try {
      for (const relative of ['access-denied/route.js', 'api/scope/route.js']) {
        const absolute = path.join(synthetic, relative)
        mkdirSync(path.dirname(absolute), { recursive: true })
        writeFileSync(absolute, '')
      }

      const handlers = new Set(discoverRoutes(synthetic).handlers)
      const plan = new Map(warmupPlan(synthetic).map((entry) => [entry.url, entry.method]))

      expect(handlers.has('/access-denied')).toBe(true)
      expect(plan.get('/access-denied')).toBe('OPTIONS')
      expect(handlers.has('/api/scope')).toBe(true)
      expect(plan.get('/api/scope')).toBe('GET')
    } finally {
      rmSync(synthetic, { recursive: true, force: true })
    }
  })

  it('names the modules whose cold compile flaked on 2026-09-07 without anyone listing them', () => {
    const plan = new Map(warmupPlan().map((entry) => [entry.url, entry.method]))
    for (const url of [`/api/projects/${PLACEHOLDER}/tree`, '/api/inventory/categories', `/api/growth/campaigns/${PLACEHOLDER}`, '/api/dependencies']) {
      expect(plan.get(url), url).toBe('OPTIONS')
    }
  })
})
