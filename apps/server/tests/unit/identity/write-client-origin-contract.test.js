import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// @req FR-252 — browser writes use their page Origin; clients cannot suppress it with fetch options.
// @spec ADR-097
// @tested tests/unit/identity/write-client-origin-contract.test.js

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const sourceRoot = path.join(serverRoot, 'src'); const appRoot = path.join(sourceRoot, 'app')
const sourceExtensions = ['.js', '.jsx', '.mjs', '.ts', '.tsx']; const routeExtensions = new Set(['.js', '.jsx', '.mjs', '.ts'])
const writeMethod = /\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(target) : [target]
  })
}
function routePattern(file) {
  const segments = path.relative(appRoot, path.dirname(file)).split(path.sep).filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith('@') && !part.startsWith('_'))
  let pattern = '^'
  for (const part of segments) {
    if (/^\[\[\.\.\..+\]\]$/.test(part)) pattern += '(?:/[^/]+(?:/[^/]+)*)?'
    else if (/^\[\.\.\..+\]$/.test(part)) pattern += '/[^/]+(?:/[^/]+)*'
    else if (/^\[.*\]$/.test(part)) pattern += '/[^/]+'
    else pattern += `/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
  }
  return new RegExp(`${pattern}/?$`)
}
const files = walkFiles(sourceRoot).filter((file) => sourceExtensions.includes(path.extname(file)))
const sourceByFile = new Map(files.map((file) => [path.resolve(file), readFileSync(file, 'utf8')]))
const writeRoutes = walkFiles(appRoot)
  .filter((file) => path.basename(file).startsWith('route.') && routeExtensions.has(path.extname(file)))
  .filter((file) => /\bexport\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b|\bexport\s+(?:const|let|var)\s+(?:POST|PUT|PATCH|DELETE)\b|\bexport\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b[^}]*\}/s.test(sourceByFile.get(path.resolve(file)) ?? readFileSync(file, 'utf8')))
  .map(routePattern)
function callEnd(source, open) {
  let depth = 0
  let quote = ''
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = ''
    } else if (char === '/' && next === '/') {
      i = source.indexOf('\n', i)
      if (i < 0) return source.length
    } else if (char === '/' && next === '*') {
      i = source.indexOf('*/', i + 2)
      if (i < 0) return source.length
      i += 1
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return i
  }
  return source.length
}
function requestCalls(source) {
  return [...source.matchAll(/\b(?:fetch|new\s+Request)\s*\(/g)].map((match) => {
    return source.slice(match.index, callEnd(source, source.indexOf('(', match.index)) + 1)
  })
}
function importSpecifiers(source) {
  return [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1] || match[2] || match[3])
}
function resolveLocalImport(file, specifier) {
  const base = specifier.startsWith('@/') ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null
  if (!base) return null
  const candidates = path.extname(base) ? [base] : [
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
  ]
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => sourceByFile.has(candidate))
}
function clientReachableFiles() {
  const reachable = new Set()
  const pending = files.filter((file) => /^\s*['"]use client['"]\s*;?/.test(sourceByFile.get(path.resolve(file))))
  while (pending.length) {
    const file = path.resolve(pending.pop())
    if (reachable.has(file)) continue
    reachable.add(file)
    for (const specifier of importSpecifiers(sourceByFile.get(file))) {
      const dependency = resolveLocalImport(file, specifier)
      if (dependency && !reachable.has(dependency)) pending.push(dependency)
    }
  }
  return reachable
}
describe('browser write Origin contract', () => {
  it('keeps write options safe and client-reachable modules free of absolute write URLs', () => {
    const violations = []
    const browserFiles = clientReachableFiles()
    for (const [file, source] of sourceByFile) {
      const relativeFile = path.relative(serverRoot, file).replaceAll(path.sep, '/')
      for (const call of requestCalls(source)) {
        if (!writeMethod.test(call)) continue
        if (/\bmode\s*:\s*['"]no-cors['"]/i.test(call)) violations.push(`${relativeFile}: write uses no-cors`)
        if (/\breferrerPolicy\s*:\s*['"]no-referrer['"]/i.test(call)) violations.push(`${relativeFile}: write suppresses referrer`)
        if (/\bcredentials\s*:\s*['"]omit['"]/i.test(call) && /https?:\/\/[^\s'"`]+\/api\//i.test(call)) {
          violations.push(`${relativeFile}: absolute API write omits credentials`)
        }
      }
      if (!browserFiles.has(file)) continue
      for (const match of source.matchAll(/(['"`])(https?:\/\/[^'"`\s]+)\1/gi)) {
        if (match[2].includes('${')) continue
        try {
          const pathname = new URL(match[2]).pathname
          if (writeRoutes.some((pattern) => pattern.test(pathname))) violations.push(`${relativeFile}: absolute URL targets a write route`)
        } catch {
          // Ignore malformed URL literals.
        }
      }
    }
    expect(violations, `Browser write Origin contract violations:\n${violations.join('\n')}`).toEqual([])
  })
})
