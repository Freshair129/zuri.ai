import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// @req FR-193 — Employment is an HR assignment record and grants nothing.
// @spec ADR-078 D1, BR-034, docs/decisions/ADR-078-ORG-EMPLOYMENT-LEGAL-ENTITY.md
// @tested tests/unit/fr193-employment-not-authorization.test.js
//
// Same discipline ADR-037 D1 already enforces for `TeamMembership`
// (tests/unit/fr089-br018-team-grants-nothing.test.js), applied to the new
// model this ADR adds: `resolveViewer` and the rest of the identity module
// never read `Employment`, because "who works here" is an HR fact and "who
// may log in here" is Membership's question alone (the exact conflation
// FR-193's defect was built from — people-service.js used to read Membership
// directly to answer both).
//
// A negative invariant has no natural failure — nothing breaks the day
// someone adds `include: { employments: true }` to a viewer-shaping function.
// So this is checked against source text, stripped of comments/strings/regex
// literals so an explanatory comment (like this file's own prose) cannot
// trip it and cannot hide a real reference either.

const IDENTITY_DIR = 'src/modules/identity'

/** Remove comments, quoted strings and regex literals; keep template `${…}` code. */
function stripNonCode(source) {
  const REGEX_PRECEDERS = ['', '=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']
  let out = ''
  let prev = ''
  let state = 'code'
  const interpolation = []
  let i = 0
  const emit = (ch) => { out += ch; if (!/\s/.test(ch)) prev = ch }

  while (i < source.length) {
    const c = source[i]
    const n = source[i + 1]
    if (state === 'template') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { state = 'code'; out += ' '; prev = '"'; i += 1; continue }
      if (c === '$' && n === '{') { state = 'code'; interpolation.push(0); out += ' '; prev = '('; i += 2; continue }
      i += 1
      continue
    }
    if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
    if (c === '/' && n === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1; i += 2; continue }
    if (c === '"' || c === "'") {
      const quote = c
      i += 1
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i += 1; i += 1 }
      i += 1
      out += ' '; prev = '"'
      continue
    }
    if (c === '`') { state = 'template'; i += 1; continue }
    if (c === '/' && REGEX_PRECEDERS.includes(prev)) {
      i += 1
      while (i < source.length && source[i] !== '/') {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === '[') { while (i < source.length && source[i] !== ']') { if (source[i] === '\\') i += 1; i += 1 } }
        i += 1
      }
      i += 1
      out += ' '; prev = '"'
      continue
    }
    if (interpolation.length) {
      if (c === '{') interpolation[interpolation.length - 1] += 1
      else if (c === '}') {
        if (interpolation[interpolation.length - 1] === 0) { interpolation.pop(); state = 'template'; i += 1; continue }
        interpolation[interpolation.length - 1] -= 1
      }
    }
    emit(c)
    i += 1
  }
  return out
}

/** Split an identifier into lowercase words, keeping all-caps runs intact. */
function identifierWords(identifier) {
  return identifier
    .split(/_+/)
    .flatMap((part) => (/^[A-Z0-9]+$/.test(part) ? [part] : part.split(/(?=[A-Z])/)))
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/** Identifiers in executable code that name the Employment model or column. */
export function employmentReferences(source) {
  const code = stripNonCode(source)
  const hits = new Set()
  for (const identifier of code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) {
    const words = identifierWords(identifier)
    if (words.includes('employment') || words.includes('employments')) hits.add(identifier)
  }
  for (const match of source.match(/\[\s*['"`](employment|employments)['"`]\s*\]/gi) || []) hits.add(match.trim())
  return [...hits]
}

function jsFilesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return jsFilesUnder(path)
    return /\.(js|jsx|mjs)$/.test(entry) ? [path] : []
  })
}

describe('the detector this guard depends on', () => {
  it('flags a real consultation of Employment', () => {
    expect(employmentReferences('const rows = await db.employment.findMany({ where: { businessId } })')).toContain('employment')
    expect(employmentReferences('include: { employments: true }')).toContain('employments')
    expect(employmentReferences("const rows = await db['employment'].findMany()")).not.toHaveLength(0)
  })

  it('does not flag the word "employment" in a comment or a string', () => {
    expect(employmentReferences('// Employment is an HR record, distinct from Membership')).toEqual([])
    expect(employmentReferences("throw new Error('not an employment grant')")).toEqual([])
    expect(employmentReferences('const label = `employment of ${person.code}`')).toEqual([])
  })
})

describe('ADR-078 D1 — the identity module never reads Employment', () => {
  const files = jsFilesUnder(IDENTITY_DIR)

  it('is scanning the module it thinks it is', () => {
    expect(files.length).toBeGreaterThan(5)
    expect(files.map((f) => f.replace(/\\/g, '/'))).toContain(`${IDENTITY_DIR}/resolve-viewer.js`)
    expect(files.map((f) => f.replace(/\\/g, '/'))).toContain(`${IDENTITY_DIR}/viewer-authority.js`)
  })

  it.each(files)('%s references no Employment model', (file) => {
    const hits = employmentReferences(readFileSync(file, 'utf8'))
    expect(
      hits,
      `${file} references ${hits.join(', ')}.\n` +
      'ADR-078 D1: Employment is an HR assignment and is never an input to an authorization ' +
      'decision — the same conflation FR-193 fixes in people-service.js. If Employment now has ' +
      'to answer something here, that is a change to the rule and needs the ADR revised first — ' +
      'not this test relaxed.',
    ).toEqual([])
  })
})
