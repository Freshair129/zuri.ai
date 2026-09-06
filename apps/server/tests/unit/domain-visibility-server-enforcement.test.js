import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assertDomainVisible, VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { makeViewer, makeDevViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-061 — the per-Business domain grant, enforced on the server rather than only
// by the client route guard (D2-domain-identity-23).
// @spec SDD-034, SEC-001, SEC-008
// @tested tests/unit/domain-visibility-server-enforcement.test.js
//
// Two claims live here, and the second is the one that keeps holding after today.
//
//  1. `assertDomainVisible` answers exactly what `isDomainVisible` +
//     `domainsForBusiness` already answered, and refuses in the FR-072(a) shape.
//  2. Every `route.js` under the three governed API families *reaches* it. That is a
//     ratchet, in the manner of `api-path-reachability.test.js`: the failure this lane
//     exists to close is not a wrong predicate, it is a new endpoint written without
//     one, and a test that only exercised today's three services would stay green for
//     a fourth route added next month.
//
// Reachability follows the route's own imports one level, because one level is where
// the enforcement genuinely belongs. The CRM routes take their scope through
// `conversation-read-model`, which already applies BR-001; re-asking in the handler
// would be a second lookup with its own chance to disagree with the first.

const ROOT = process.cwd()
const SRC = resolve(ROOT, 'src')
const PREDICATE = 'assertDomainVisible'

// One entry per governed family: the API subtree, and the domain key its routes serve.
// Data rather than prose, because the ratchet below iterates it.
const GOVERNED_FAMILIES = [
  { dir: resolve(SRC, 'app', 'api', 'crm'), domainKey: 'customer' },
  { dir: resolve(SRC, 'app', 'api', 'market'), domainKey: 'market' },
  { dir: resolve(SRC, 'app', 'api', 'people'), domainKey: 'people' },
]

function routeFilesUnder(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) routeFilesUnder(full, out)
    else if (entry.name === 'route.js' || entry.name === 'route.ts') out.push(full)
  }
  return out
}

/** Every module specifier a file imports, from `from '…'` and `import('…')`. */
export function importSpecifiers(source) {
  const specifiers = []
  const re = /(?:from\s*|import\s*\(\s*)(["'])([^"']+)\1/g
  let match
  while ((match = re.exec(source))) specifiers.push(match[2])
  return specifiers
}

/** Resolve one specifier to a readable file inside `src`, or null for a package. */
function resolveWithinSrc(specifier, fromFile) {
  let base
  if (specifier.startsWith('@/')) base = resolve(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js')]) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      // missing, or a directory — try the next candidate
    }
  }
  return null
}

/** The sources a route's enforcement could live in: the handler and what it imports. */
function enforcementSources(routeFile) {
  const source = readFileSync(routeFile, 'utf8')
  const sources = [source]
  for (const specifier of importSpecifiers(source)) {
    const target = resolveWithinSrc(specifier, routeFile)
    if (target) sources.push(readFileSync(target, 'utf8'))
  }
  return sources
}

/** The whole decision, pure, so the ratchet can be shown to fail as well as pass. */
export function reachesPredicate(sources) {
  return sources.some((source) => source.includes(PREDICATE))
}

describe('every governed API route reaches the domain-visibility predicate', () => {
  it('finds the routes it claims to guard (guard on the guard)', () => {
    // Without this, renaming a family would make the ratchet below pass vacuously.
    for (const family of GOVERNED_FAMILIES) {
      expect(routeFilesUnder(family.dir).length, `${relative(ROOT, family.dir)} has no route.js`)
        .toBeGreaterThan(0)
    }
    const total = GOVERNED_FAMILIES.reduce((sum, family) => sum + routeFilesUnder(family.dir).length, 0)
    expect(total).toBeGreaterThanOrEqual(5)
  })

  it('has no route under crm/, market/ or people/ that skips it', () => {
    const unguarded = []
    for (const family of GOVERNED_FAMILIES) {
      for (const routeFile of routeFilesUnder(family.dir)) {
        if (!reachesPredicate(enforcementSources(routeFile))) {
          unguarded.push(
            `${relative(ROOT, routeFile)} — neither the handler nor any module it imports ` +
            `calls ${PREDICATE}(viewer, businessId, '${family.domainKey}')`,
          )
        }
      }
    }
    expect(unguarded, unguarded.join('\n')).toEqual([])
  })

  it('is capable of failing, on the shape a new unguarded route would have', () => {
    // Rule 8: an assertion that cannot go red proves nothing. This is the source of a
    // plausible next route — thin handler, real service, no domain check anywhere.
    const newRoute = "import { handle } from '../../_helpers'\nexport const GET = () => handle(read)"
    const itsService = "export async function read({ viewer, businessId }) { return [] }"
    expect(reachesPredicate([newRoute, itsService])).toBe(false)
    expect(reachesPredicate([newRoute, `${itsService}\n${PREDICATE}(viewer, businessId, 'market')`])).toBe(true)
  })

  it('resolves a route through its imports rather than reading only the handler', () => {
    // The CRM list route carries no check of its own; the read model it delegates to
    // does. If import following ever broke, this is where it shows up as a fact
    // instead of as a silently permissive ratchet.
    const routeFile = resolve(SRC, 'app', 'api', 'crm', 'conversations', 'route.js')
    expect(readFileSync(routeFile, 'utf8')).not.toContain(PREDICATE)
    expect(reachesPredicate(enforcementSources(routeFile))).toBe(true)
  })
})

describe('importSpecifiers', () => {
  it('captures static imports and dynamic ones', () => {
    const source = [
      "import prisma from '@/lib/db'",
      'import { a } from "../thing"',
      "const m = await import('@/modules/x')",
    ].join('\n')
    expect(importSpecifiers(source)).toEqual(['@/lib/db', '../thing', '@/modules/x'])
  })
})

describe('assertDomainVisible', () => {
  const BUSINESS = 'b-1'

  it('passes a viewer granted the domain in this Business', () => {
    const viewer = makeViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: ['customer', 'projects'] })
    expect(() => assertDomainVisible(viewer, BUSINESS, 'customer')).not.toThrow()
  })

  it('refuses a MEMBER whose Membership lists another domain', () => {
    const viewer = makeViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: ['projects'] })
    expect(() => assertDomainVisible(viewer, BUSINESS, 'customer')).toThrow('Business not found')
  })

  it('refuses with the 404 shape an unknown Business already answers with', () => {
    // The FR-072(a) claim: the refusal must be the same object the readers throw for a
    // Business that does not exist, or the status code becomes an enumeration oracle.
    const viewer = makeViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: ['projects'] })
    let thrown
    try {
      assertDomainVisible(viewer, BUSINESS, 'market')
    } catch (error) {
      thrown = error
    }
    expect(thrown.status).toBe(404)
    expect(thrown.message).toBe('Business not found')
  })

  it('refuses a Business the viewer cannot see at all', () => {
    const viewer = makeViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: [...VIEWER_DOMAINS] })
    expect(() => assertDomainVisible(viewer, 'b-elsewhere', 'customer')).toThrow('Business not found')
  })

  it('honours the per-Business grant, not the union across Businesses', () => {
    // The FR-061 shape: every domain where they own, only `projects` where they do not.
    const viewer = ownsElsewhere({
      owns: 'b-owned',
      sees: BUSINESS,
      visibleDomains: [...VIEWER_DOMAINS],
      seesDomains: ['projects'],
    })
    expect(() => assertDomainVisible(viewer, 'b-owned', 'customer')).not.toThrow()
    expect(() => assertDomainVisible(viewer, BUSINESS, 'customer')).toThrow('Business not found')
  })

  it('lets an alwaysVisible slot through even for a viewer granted nothing', () => {
    const viewer = makeViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: [] })
    expect(() => assertDomainVisible(viewer, BUSINESS, 'business-home')).not.toThrow()
  })

  it('lets a platform DEV through, exactly as resolveViewer fills its map', () => {
    const viewer = makeDevViewer({ visibleBusinessIds: [BUSINESS], visibleDomains: [...VIEWER_DOMAINS] })
    for (const key of VIEWER_DOMAINS) {
      expect(() => assertDomainVisible(viewer, BUSINESS, key)).not.toThrow()
    }
  })

  it('keeps the old-fixture tolerance domainsForBusiness documents', () => {
    // A viewer with no map at all predates FR-061 and stays unrestricted, the same
    // tolerance the client guard has always had. Asserted rather than assumed: a
    // service that started failing closed here would break every hand-built fixture in
    // the suite at once, for a reason nobody would connect back to this file.
    expect(() => assertDomainVisible({ visibleBusinessIds: [BUSINESS] }, BUSINESS, 'customer')).not.toThrow()
  })

  it('fails closed for no viewer at all', () => {
    expect(() => assertDomainVisible(null, BUSINESS, 'customer')).toThrow('Business not found')
  })
})
