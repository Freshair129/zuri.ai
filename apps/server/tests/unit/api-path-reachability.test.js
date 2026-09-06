import { readdirSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, relative, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-012, FR-046 — a mounted component that fetches an `/api/...` path
// with no `route.js` behind it fails 100% of the time in the browser and
// nothing before this test caught it: D3-pm-plan-intake-01 shipped a plan
// import UI that POSTed to `/api/import/plan` (never existed — only
// bundle/commit/dry-run/template/xlsx do), and D3-pm-plan-intake-05 shipped
// four components reading `/api/businesses` and `/api/workspaces` (list) —
// neither route exists, only `/api/workspaces/{id}`. Both defect classes are
// exactly "static analysis text lives in the component, no route answers it",
// which this test enumerates and closes permanently.
// @spec BR-009, SDD-009 — the same intake contract this guard protects.
// @tested tests/unit/api-path-reachability.test.js

const ROOT = process.cwd()
const API_DIR = resolve(ROOT, 'src', 'app', 'api')
const SRC_DIR = resolve(ROOT, 'src')

// Paths that are legitimately absent from the real Next.js route tree —
// never a path this test (or a prior lane) just fixed. Each entry states why.
const ALLOWLIST = new Set([
  // src/app/(pm)/customer/page.jsx — a design-rationale code comment arguing
  // AGAINST building this endpoint (every figure on the page already comes
  // from GET /api/crm/conversations); the string only ever appears inside a
  // `//` comment, never in an executable fetch.
  '/api/crm/summary',
])

/**
 * Build a tree of the real `src/app/api` directory: one node per path
 * segment, `hasRoute: true` when that exact directory carries a `route.js`,
 * and `dynamicChild` pointing at the `[param]` child a directory may have
 * (Next.js route resolution prefers a literal sibling over the dynamic one,
 * which `matchApiPath` below mirrors).
 */
export function buildApiRouteTree(apiDir = API_DIR) {
  const root = { children: new Map(), dynamicChild: null, hasRoute: false }
  const walk = (dir, node) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      const child = { children: new Map(), dynamicChild: null, hasRoute: false }
      child.hasRoute = existsSync(join(full, 'route.js')) || existsSync(join(full, 'route.ts'))
      if (/^\[.+\]$/.test(entry.name)) node.dynamicChild = child
      else node.children.set(entry.name, child)
      walk(full, child)
    }
  }
  walk(apiDir, root)
  return root
}

/**
 * Extract every `/api/...` string literal referenced in a source file: plain
 * quoted strings in full, and template literals truncated at the first `${`
 * (`dynamic: true`) since nothing after that point is known statically.
 * Pure — no filesystem access — so it is unit-tested directly below with
 * synthetic source text.
 */
export function extractApiPathReferences(source) {
  const refs = []
  let re = /`(\/api\/[^`$]*)/g
  let m
  while ((m = re.exec(source))) {
    const dynamic = source[m.index + m[0].length] === '$'
    refs.push({ raw: m[1], dynamic })
  }
  re = /(["'])(\/api\/[^"']*)\1/g
  while ((m = re.exec(source))) {
    refs.push({ raw: m[2], dynamic: false })
  }
  return refs
}

function normalizeSegments(raw) {
  let p = raw.split('?')[0]
  if (p.endsWith('/')) p = p.slice(0, -1)
  return p.split('/').filter(Boolean)
}

/**
 * Decide whether one extracted reference resolves to a real route.
 *
 * A `{param}`-style segment (the REST convention `docs`/openapi.js uses) and
 * an unresolved `[id]`-style Next.js segment both act as a wildcard: the
 * literal text at that position is not checked against it, only that a
 * dynamic route actually exists there.
 *
 * `dynamic: true` (a template literal truncated at its first `${…}`) means
 * the real path continues past what this function can see, so it only
 * requires the known prefix to resolve to a live subtree (a route at this
 * node, a further static child, or a dynamic child) — never that a route.js
 * sits at this exact directory.
 */
export function matchApiPath(tree, ref) {
  const segments = normalizeSegments(ref.raw)
  if (segments[0] !== 'api') return { ok: false, reason: 'not an /api/ path' }
  let node = tree
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    if (/^\{.*\}$/.test(seg)) {
      if (node.dynamicChild) { node = node.dynamicChild; continue }
      return { ok: false, reason: `"${seg}" has no dynamic route beneath ${segments.slice(0, i).join('/')}` }
    }
    if (node.children.has(seg)) { node = node.children.get(seg); continue }
    if (node.dynamicChild) { node = node.dynamicChild; continue }
    return { ok: false, reason: `no route matches segment "${seg}" (from "${ref.raw}")` }
  }
  if (ref.dynamic) {
    if (node.hasRoute || node.dynamicChild || node.children.size > 0) return { ok: true }
    return { ok: false, reason: `"${ref.raw}" leads nowhere — no route.js and nothing beneath it` }
  }
  if (node.hasRoute) return { ok: true }
  return { ok: false, reason: `no route.js at the exact path "${ref.raw}"` }
}

function walkSrcFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkSrcFiles(full, out)
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('every /api/ path referenced from src resolves to a real route', () => {
  it('finds source files to scan (guard on the guard)', () => {
    expect(walkSrcFiles(SRC_DIR, []).length).toBeGreaterThan(100)
  })

  it('has no unreachable /api/ reference outside the allowlist', async () => {
    const tree = buildApiRouteTree()
    const files = walkSrcFiles(SRC_DIR, [])
    const failures = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const ref of extractApiPathReferences(source)) {
        if (ALLOWLIST.has(ref.raw)) continue
        const result = matchApiPath(tree, ref)
        if (!result.ok) {
          failures.push(`${relative(ROOT, file)} — "${ref.raw}": ${result.reason}`)
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})

describe('extractApiPathReferences', () => {
  it('captures a plain quoted string in full', () => {
    expect(extractApiPathReferences(`const x = '/api/foo/bar'`)).toEqual([
      { raw: '/api/foo/bar', dynamic: false },
    ])
  })

  it('truncates a template literal at the first ${ and flags it dynamic', () => {
    expect(extractApiPathReferences('fetch(`/api/foo/${id}/bar`)')).toEqual([
      { raw: '/api/foo/', dynamic: true },
    ])
  })

  it('captures a fully static template literal as non-dynamic', () => {
    expect(extractApiPathReferences('fetch(`/api/foo/bar`)')).toEqual([
      { raw: '/api/foo/bar', dynamic: false },
    ])
  })

  it('does not choke on a nested template literal after the first ${', () => {
    // The exact shape that broke a naive "match to the next backtick" scan:
    // the literal prefix is still all that matters, so this must resolve
    // identically to the plain dynamic case above.
    const src = "fetch(`/api/agent/heartbeat${x ? `?d=${x}` : ''}`)"
    expect(extractApiPathReferences(src)).toEqual([
      { raw: '/api/agent/heartbeat', dynamic: true },
    ])
  })
})

describe('matchApiPath', () => {
  const tree = {
    children: new Map([
      ['foo', { children: new Map(), dynamicChild: null, hasRoute: true }],
      [
        'bar',
        {
          hasRoute: true,
          dynamicChild: { children: new Map(), dynamicChild: null, hasRoute: true },
          children: new Map(),
        },
      ],
    ]),
    dynamicChild: null,
    hasRoute: false,
  }

  it('accepts a fully static path with a route.js at that exact directory', () => {
    expect(matchApiPath(tree, { raw: '/api/foo', dynamic: false }).ok).toBe(true)
  })

  // This is the exact shape of D3-pm-plan-intake-01 / D3-pm-plan-intake-05:
  // a directory that simply is not there.
  it('rejects a static path with no matching directory at all', () => {
    const result = matchApiPath(tree, { raw: '/api/businesses', dynamic: false })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no route matches segment "businesses"/)
  })

  it('rejects a static path one level short of the dynamic route it needed', () => {
    // Mirrors `/api/workspaces` (list) when only `/api/workspaces/{id}` exists.
    const noListRoute = {
      children: new Map(),
      dynamicChild: null,
      hasRoute: false,
    }
    const rootWithOnlyDynamicChild = {
      children: new Map([['workspaces', { ...noListRoute, dynamicChild: { children: new Map(), dynamicChild: null, hasRoute: true } }]]),
      dynamicChild: null,
      hasRoute: false,
    }
    const result = matchApiPath(rootWithOnlyDynamicChild, { raw: '/api/workspaces', dynamic: false })
    expect(result.ok).toBe(false)
  })

  it('accepts a literal segment that falls through to a dynamic sibling route', () => {
    expect(matchApiPath(tree, { raw: '/api/bar/anything-at-all', dynamic: false }).ok).toBe(true)
  })

  it('accepts a {param}-style REST doc segment when a dynamic route exists', () => {
    expect(matchApiPath(tree, { raw: '/api/bar/{id}', dynamic: false }).ok).toBe(true)
  })

  it('rejects a {param}-style segment with no dynamic route beneath it', () => {
    expect(matchApiPath(tree, { raw: '/api/foo/{id}', dynamic: false }).ok).toBe(false)
  })

  it('accepts a dynamic-tail reference whose known prefix has a live route', () => {
    // `/api/foo/${id}` — everything past the prefix is unknown by design.
    expect(matchApiPath(tree, { raw: '/api/foo', dynamic: true }).ok).toBe(true)
  })

  it('rejects a dynamic-tail reference whose known prefix is a dead end', () => {
    const deadEnd = { children: new Map(), dynamicChild: null, hasRoute: false }
    const root = { children: new Map([['nowhere', deadEnd]]), dynamicChild: null, hasRoute: false }
    expect(matchApiPath(root, { raw: '/api/nowhere', dynamic: true }).ok).toBe(false)
  })
})
