import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// @req FR-089 — a Team is an organisational grouping and grants nothing.
// @spec BR-018, SEC-001,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/unit/fr089-br018-team-grants-nothing.test.js
//
// ADR-037 D1 asks for exactly this test, in exactly these words: "a test asserts
// the identity resolver's source files do not reference the Team models at all,
// because 'nobody consults it' is only true while nobody consults it."
//
// A negative invariant has no natural failure. Nothing breaks the day someone
// adds `include: { teams: true }` to `resolveViewer` and reads it in a guard —
// the suite stays green, the product still works, and BR-018 quietly stops being
// true. So the invariant is checked against the source text, which is the only
// artefact that changes when someone does it.
//
// The precision problem is real and is why this file is longer than a grep.
// `viewer-authority.js` already contains the sentence "a third copy was about to
// be written for FR-036 project teams" — a *comment*, about a different feature,
// which any naive search flags forever. So the scan strips comments, string
// literals and regex literals first and looks only at identifiers in executable
// code, and then proves it did so: the detector is run against fixtures that
// contain both a real violation and the innocent comment, and must tell them
// apart. Without that self-test, a detector that silently stopped detecting
// would look exactly like an invariant that was being honoured.

const IDENTITY_DIR = 'src/modules/identity'
const TEAM_SERVICE = 'src/modules/project-manager/application/team-service.js'

/**
 * Remove everything that is not executable code: line and block comments,
 * quoted strings, and regex literals. Template literals keep their `${…}`
 * interpolations — those are code — and drop their literal text.
 */
function stripNonCode(source) {
  // A `/` in these positions starts a regex literal rather than a division.
  const REGEX_PRECEDERS = ['', '=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']
  let out = ''
  let prev = ''
  let state = 'code'
  const interpolation = []
  let i = 0

  const emit = (ch) => {
    out += ch
    if (!/\s/.test(ch)) prev = ch
  }

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

    if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      i += 1
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1
        i += 1
      }
      i += 1
      out += ' '
      prev = '"'
      continue
    }
    if (c === '`') { state = 'template'; i += 1; continue }
    if (c === '/' && REGEX_PRECEDERS.includes(prev)) {
      i += 1
      while (i < source.length && source[i] !== '/') {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === '[') {
          while (i < source.length && source[i] !== ']') {
            if (source[i] === '\\') i += 1
            i += 1
          }
        }
        i += 1
      }
      i += 1
      out += ' '
      prev = '"'
      continue
    }
    if (interpolation.length) {
      if (c === '{') interpolation[interpolation.length - 1] += 1
      else if (c === '}') {
        if (interpolation[interpolation.length - 1] === 0) {
          interpolation.pop()
          state = 'template'
          i += 1
          continue
        }
        interpolation[interpolation.length - 1] -= 1
      }
    }
    emit(c)
    i += 1
  }
  return out
}

/**
 * Split an identifier into its words. Underscores first, then camel humps —
 * but never inside an all-caps run, or `PROJECT_TEAM` would shatter into single
 * letters and the constant naming the very models we are looking for would slip
 * through.
 */
function identifierWords(identifier) {
  return identifier
    .split(/_+/)
    .flatMap((part) => (/^[A-Z0-9]+$/.test(part) ? [part] : part.split(/(?=[A-Z])/)))
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

/**
 * Identifiers in executable code that name a Team model, relation or column.
 *
 * Word-level, not substring: `teamId`, `TeamMembership`, `projectTeams` and
 * `PROJECT_TEAM` all hit; `teammate` and `steam` do not, because neither has a
 * word that *is* "team".
 */
export function teamReferences(source) {
  const code = stripNonCode(source)
  const hits = new Set()
  for (const identifier of code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []) {
    const words = identifierWords(identifier)
    if (words.includes('team') || words.includes('teams')) hits.add(identifier)
  }
  // Closes the one evasion the identifier scan cannot see: a delegate reached by
  // computed access, `db['team']`, whose model name is a string and would have
  // been stripped above. Checked against the raw source on purpose.
  for (const match of source.match(/\[\s*['"`](team|teams|teamMembership|projectTeam)['"`]\s*\]/gi) || []) {
    hits.add(match.trim())
  }
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
  // If these ever fail, the guard below is not proving anything, whatever colour
  // it reports.
  it('flags a real consultation of a Team model', () => {
    expect(teamReferences('const rows = await db.team.findMany({ where: { businessId } })')).toContain('team')
    expect(teamReferences('const t = await prisma.teamMembership.findFirst({ where: { personId } })'))
      .toContain('teamMembership')
    expect(teamReferences('include: { teams: { include: { team: true } } }')).toContain('teams')
    expect(teamReferences('const TEAM_MODELS = [1]')).toContain('TEAM_MODELS')
    expect(teamReferences("const rows = await db['team'].findMany()")).not.toHaveLength(0)
  })

  it('does not flag the word "team" in a comment, a string or a regex', () => {
    // The exact sentence that lives in `viewer-authority.js` today.
    expect(teamReferences('// copy was about to be written for FR-036 project teams.')).toEqual([])
    expect(teamReferences('/* Team membership is never an input to authorization */')).toEqual([])
    expect(teamReferences("throw new Error('Project team is outside your owned scope')")).toEqual([])
    expect(teamReferences('const rx = /team|squad/i')).toEqual([])
    expect(teamReferences('const url = "https://example.test/team"')).toEqual([])
    expect(teamReferences('const label = `the team of ${project.code}`')).toEqual([])
  })

  it('still sees code inside a template interpolation', () => {
    expect(teamReferences('const msg = `count ${await db.team.count()}`')).toContain('team')
  })

  it('does not flag an unrelated word that merely contains the letters', () => {
    expect(teamReferences('const teammate = steam(upstream)')).toEqual([])
  })
})

describe('BR-018 — the identity module never reads a Team', () => {
  const files = jsFilesUnder(IDENTITY_DIR)

  it('is scanning the module it thinks it is', () => {
    // A guard that scans an empty list passes forever. If the module is renamed
    // or moved, this fails loudly instead of going quiet.
    expect(files.length).toBeGreaterThan(5)
    expect(files.map((f) => f.replace(/\\/g, '/'))).toContain(`${IDENTITY_DIR}/resolve-viewer.js`)
    expect(files.map((f) => f.replace(/\\/g, '/'))).toContain(`${IDENTITY_DIR}/viewer-authority.js`)
  })

  it.each(files)('%s references no Team model', (file) => {
    const hits = teamReferences(readFileSync(file, 'utf8'))
    expect(
      hits,
      `${file} references ${hits.join(', ')}.\n` +
      'BR-018 / ADR-037 D1: a Team is an organisational grouping and is never an input to an ' +
      'authorization decision. If a Team now has to answer something here, that is a change to ' +
      'the rule and needs the ADR revised first — not this test relaxed.',
    ).toEqual([])
  })
})

describe('BR-018 — the Team service never writes an authority record', () => {
  const source = readFileSync(TEAM_SERVICE, 'utf8')
  const code = stripNonCode(source)

  it('reads Membership but never creates, updates or deletes one', () => {
    // `addTeamMember` must *require* a Membership and never mint one. Asserted
    // against the source rather than behaviour because the failure being
    // prevented is someone adding the convenience branch ("the person isn't in
    // the business yet, so let's add them"), which is a passing feature and a
    // privilege escalation at the same time.
    const writes = code.match(/\bmembership\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/gi) || []
    expect(writes).toEqual([])
    // …and the read it does perform is still there, so this cannot pass by the
    // service simply forgetting to check.
    expect(code).toMatch(/\bmembership\s*\.\s*findFirst\b/)
  })
})
