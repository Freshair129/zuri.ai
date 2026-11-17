import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { config } from '@/middleware.js'
import {
  CROSS_ORIGIN_WRITE_ALLOWLIST,
  evaluateSameOriginWrite,
  matchesCrossOriginWriteAllowlist,
  validateAllowlist,
} from '@/modules/identity/same-origin-write'

// @req FR-252 — newly added API write routes inherit the Origin guard by default.
// @spec ADR-097
// @tested tests/unit/identity/write-route-coverage.test.js

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const appRoot = path.join(serverRoot, 'src', 'app')
const routeExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx'])
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx'])
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function walkFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(target))
    else files.push(target)
  }
  return files
}

function exportedWriteMethods(source) {
  const methods = new Set()
  const declaration = /\bexport\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|\bexport\s+(?:const|let|var)\s+(POST|PUT|PATCH|DELETE)\b/g
  for (const match of source.matchAll(declaration)) methods.add(match[1] || match[2])

  const exportList = /\bexport\s*\{([^}]+)\}/gs
  for (const match of source.matchAll(exportList)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+as\s+/i)
      const exportedName = parts.at(-1)?.trim()
      if (writeMethods.has(exportedName)) methods.add(exportedName)
    }
  }
  return [...methods]
}

function routePath(routeFile) {
  const relativeDirectory = path.relative(appRoot, path.dirname(routeFile))
  const segments = relativeDirectory.split(path.sep)
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@') && !segment.startsWith('_'))
    .map((segment) => /^\[.*\]$/.test(segment) ? 'x' : segment)
  return `/${segments.join('/')}`
}

function matcherCoversPath(pathname) {
  const matchers = Array.isArray(config.matcher) ? config.matcher : [config.matcher]
  return matchers.some((matcher) => {
    if (typeof matcher !== 'string') return false
    const suffix = '/:path*'
    if (matcher.endsWith(suffix)) {
      const prefix = matcher.slice(0, -suffix.length)
      return pathname === prefix || pathname.startsWith(`${prefix}/`)
    }
    return pathname === matcher
  })
}

function allowlistEntryMatches(entry, pathname) {
  if (entry.pattern instanceof RegExp) {
    entry.pattern.lastIndex = 0
    const matches = entry.pattern.test(pathname)
    entry.pattern.lastIndex = 0
    return matches
  }
  return pathname.startsWith(entry.pattern)
}

const allAppFiles = walkFiles(appRoot)
const appSourceFiles = allAppFiles.filter((file) => sourceExtensions.has(path.extname(file)))
const writeRoutes = allAppFiles
  .filter((file) => path.basename(file).startsWith('route.') && routeExtensions.has(path.extname(file)))
  .map((file) => ({ file, pathname: routePath(file), methods: exportedWriteMethods(readFileSync(file, 'utf8')) }))
  .filter((route) => route.methods.length > 0)

describe('API write route guard coverage', () => {
  it('covers the /api root route with the middleware matcher', () => {
    expect(matcherCoversPath('/api')).toBe(true)
  })

  it('enumerates every write route under /api and refuses a cross-origin Origin unless allowlisted', () => {
    const failures = []
    for (const route of writeRoutes) {
      const relativeFile = path.relative(serverRoot, route.file).replaceAll(path.sep, '/')
      if (route.pathname !== '/api' && !route.pathname.startsWith('/api/')) {
        failures.push(`${relativeFile} -> ${route.pathname}: move it under /api or extend the middleware matcher and this test`)
      }
      if (!matcherCoversPath(route.pathname)) {
        failures.push(`${relativeFile} -> ${route.pathname}: middleware matcher does not cover this write route`)
      }

      const allowedByList = matchesCrossOriginWriteAllowlist(route.pathname)
      const decision = evaluateSameOriginWrite({
        method: route.methods[0],
        pathname: route.pathname,
        headers: new Headers({ origin: 'https://attacker.invalid', host: 'zuri.example' }),
        env: { PUBLIC_BASE_URL: 'https://zuri.example' },
      })
      if (allowedByList ? decision.allowed !== true : decision.allowed !== false || decision.status !== 403) {
        failures.push(`${relativeFile} -> ${route.pathname}: cross-origin decision disagrees with the allowlist`)
      }
    }

    expect(writeRoutes.length, `Expected over 200 enumerated write routes; enumerated ${writeRoutes.length}`)
      .toBeGreaterThan(200)
    expect(failures, `Guard coverage gaps among ${writeRoutes.length} enumerated write routes:\n${failures.join('\n')}`)
      .toEqual([])
  })

  it('keeps the allowlist valid, non-stale, and empty for the current route tree', () => {
    const failures = []
    try {
      validateAllowlist(CROSS_ORIGIN_WRITE_ALLOWLIST)
    } catch (error) {
      failures.push(`invalid allowlist: ${error.message}`)
    }
    for (const entry of CROSS_ORIGIN_WRITE_ALLOWLIST) {
      if (!writeRoutes.some((route) => allowlistEntryMatches(entry, route.pathname))) {
        failures.push(`stale allowlist entry: ${String(entry.pattern)}`)
      }
    }
    if (CROSS_ORIGIN_WRITE_ALLOWLIST.length !== 0) {
      failures.push(`the current browser cross-origin allowlist must remain empty; found ${CROSS_ORIGIN_WRITE_ALLOWLIST.length}`)
    }

    expect(failures, `Allowlist issues across ${writeRoutes.length} enumerated write routes:\n${failures.join('\n')}`)
      .toEqual([])
  })

  it('contains no Server Action directive that would require separate guard treatment', () => {
    const directives = appSourceFiles.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return /^\s*['"]use server['"]\s*;?/m.test(source)
    }).map((file) => path.relative(serverRoot, file).replaceAll(path.sep, '/'))

    expect(directives, `Server Action directive(s) found while enumerating ${writeRoutes.length} write routes: ${directives.join(', ')}`)
      .toEqual([])
  })
})
