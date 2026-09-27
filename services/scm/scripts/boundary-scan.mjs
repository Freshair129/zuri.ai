import path from 'node:path'

// The package-boundary rules `npm run build` enforces (scripts/build.mjs). Kept
// importable so test/unit/build-boundary.test.js can prove each rule catches what
// it claims: since services/scm is an isolated service for scoped CI
// (scripts/ci-change-scope.mjs), an SCM-only pull request skips the apps/server
// suite, and this scan is what still stops SCM from reaching into the monolith.
//
// A module reference is refused when it:
//   - names Next.js, the apps/server `@/` alias, `apps/server`, or Prisma;
//   - is relative and resolves OUTSIDE this package (services/scm), whatever it
//     is called — the service may only import its own files;
//   - names a package that package.json does not declare;
//   - cannot be checked: a dynamic import() whose argument is not a plain string
//     literal (a variable, an expression or a template with ${…}).
// Forms scanned: `import … from '…'`, `export … from '…'`, `import '…'`,
// dynamic `import('…')`, and `require('…')`. `createRequire` (the only way an ES
// module gets a require) is refused outright, as is any `PrismaClient`.
// Not module references, so not flagged: the words "from '…'" inside a comment,
// `.require(…)` method calls, and `require(…) {` method definitions (the
// authority ladders in delegation.js).

const STATIC = /^\s*(?:import|export)\b[^'"`]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
// A dynamic import is `import(` not preceded by `.`, an identifier character or `$`.
const DYNAMIC = /(?<![\w$.])import\s*\(\s*([^)]*?)\s*\)/g
// The global require function: `require(` not preceded by `.`/identifier, and not a
// method definition (`require(scope, …) {` at the start of a line).
const REQUIRE = /(?<![\w$.])require\s*\(\s*(['"`])((?:(?!\1).)*)\1\s*\)/g
const LITERAL = /^(['"])((?:(?!\1).)*)\1$|^`([^`$]*)`$/
const FORBIDDEN = [
  [/^(?:next(?:\/|$)|@\/)/, 'imports Next.js or the apps/server `@/` alias'],
  [/(?:^|\/)apps\/server(?:\/|$)/, 'imports apps/server'],
  [/^@prisma\//, 'imports Prisma'],
]

/**
 * The source with every comment blanked (newlines kept, so line anchors still
 * hold). Strings, template literals and regex literals are skipped as units, so
 * `//` inside a URL string or a quote inside a /regex/ does not start or end
 * anything. A `/` opens a regex only where an expression may start.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  let last = '' // last significant (non-space, non-comment) character
  const blank = (text) => text.replace(/[^\n]/g, ' ')
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      out += blank(source.slice(i, stop)); i = stop; continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += blank(source.slice(i, stop)); i = stop; continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1
      out += source.slice(i, j + 1); i = j + 1; last = ch; continue
    }
    if (ch === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last))) {
      let j = i + 1
      let inClass = false
      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') { j += 2; continue }
        if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
        j += 1
      }
      out += source.slice(i, j + 1); i = j + 1; last = '/'; continue
    }
    out += ch
    if (!/\s/.test(ch)) last = ch
    i += 1
  }
  return out
}

/**
 * @param {{ file: string, root: string, source: string, declared: Set<string> }} input
 *   `file` absolute path, `root` the package root (services/scm), `declared`
 *   the package.json dependency names.
 * @returns {string[]} violation messages (empty when the file is within bounds)
 */
export function scanSource({ file, root, source: raw, declared }) {
  const relative = path.relative(root, file).split(path.sep).join('/')
  const violations = []
  const source = stripComments(raw)
  const refuse = (code, reason) => violations.push(`${code}:${relative}: ${reason}`)

  if (/\bPrismaClient\b/.test(source)) refuse('SERVICE_BOUNDARY_VIOLATION', 'uses Prisma')
  if (/\bcreateRequire\b/.test(source)) refuse('SERVICE_BOUNDARY_VIOLATION', 'uses createRequire')

  const specifiers = []
  for (const match of source.matchAll(STATIC)) specifiers.push(match[1] ?? match[2])
  for (const match of source.matchAll(DYNAMIC)) {
    const literal = LITERAL.exec(match[1])
    if (!literal) { refuse('SERVICE_BOUNDARY_VIOLATION', 'dynamic import() with a non-literal specifier cannot be checked'); continue }
    specifiers.push(literal[2] ?? literal[3])
  }
  for (const match of source.matchAll(REQUIRE)) {
    if (match[1] === '`' && match[2].includes('${')) { refuse('SERVICE_BOUNDARY_VIOLATION', 'require() with a non-literal specifier cannot be checked'); continue }
    specifiers.push(match[2])
  }

  for (const specifier of specifiers) {
    const forbidden = FORBIDDEN.find(([pattern]) => pattern.test(specifier))
    if (forbidden) { refuse('SERVICE_BOUNDARY_VIOLATION', forbidden[1]); continue }
    if (specifier.startsWith('node:')) continue
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(file), specifier)
      const inside = path.relative(root, target)
      if (inside.startsWith('..') || path.isAbsolute(inside)) refuse('SERVICE_BOUNDARY_VIOLATION', `imports outside services/scm (${specifier})`)
      continue
    }
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!declared.has(name)) refuse('SERVICE_UNDECLARED_DEPENDENCY', specifier)
  }
  return violations
}
