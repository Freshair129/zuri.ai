import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-020 — the application shell must not assert a runtime fact it does
//   not hold. Found live on the production deployment 2026-09-04: every page
//   footer read "● local   SQLite · offline-first" while the container served
//   Supabase Postgres, and Settings offered `npm run db:reset` under a caption
//   promising it dropped "local data".
// @spec SEC-009 — `GET /api/health` reports states and counts with no provider
//   name on purpose. A footer badge naming the datastore would disclose in
//   every page exactly what that route is careful to withhold, so the fix is to
//   remove the claim rather than to make it accurate.
// @tested this file
//
// This project's client components run under a node test environment with no
// DOM (see audit-page.test.js, repositories-page-ui-contract.test.js), so the
// shipped source is the checkable surface.

const src = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

/** JSX minus comments: the history is quoted in comments on purpose, and a
 *  comment must never be able to fail — or satisfy — a check about what ships. */
const shipped = (source) => source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '')

function jsxFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) jsxFiles(full, out)
    else if (entry.endsWith('.jsx')) out.push(full)
  }
  return out
}

describe('the shell footer states nothing it cannot know', () => {
  const shell = shipped(src('src/components/layouts/AppShell.jsx'))

  it('no longer claims the datastore engine or an offline-first posture', () => {
    expect(shell).not.toMatch(/SQLite/i)
    expect(shell).not.toMatch(/offline-first/i)
  })

  it('carries no hardcoded status dot', () => {
    // A green ● reads as a check that passed. Nothing here checked anything.
    expect(shell).not.toContain('●')
    expect(shell).not.toContain("var(--success)")
  })

  it('keeps the product mark, which asserts nothing', () => {
    expect(shell).toContain('zuri-ai')
  })

  it('does not replace the badge with an accurate one either (SEC-009)', () => {
    // Naming the provider truthfully would still put it in front of every
    // visitor, which is the disclosure /api/health declines to make.
    expect(shell).not.toMatch(/Postgres/i)
    expect(shell).not.toMatch(/Supabase/i)
  })
})

describe('developer database commands do not ship to production', () => {
  const settings = src('src/app/(pm)/settings/page.jsx')

  it('gates the data-utilities card on the build, not on a runtime guess', () => {
    // NODE_ENV is replaced at build time in the client bundle, so the
    // production image does not carry the card at all.
    expect(settings).toMatch(/process\.env\.NODE_ENV === 'production'\)\s*return null/)
  })

  it('still offers the commands, so the development affordance survives', () => {
    expect(settings).toContain('npm run db:seed')
    expect(settings).toContain('npm run db:reset')
  })

  it('no longer promises the reset is local, or names the engine', () => {
    const card = shipped(settings)
    const start = card.indexOf('function DataUtilitiesCard')
    const body = card.slice(start, card.indexOf('\n}', start))
    expect(body).not.toMatch(/SQLite/i)
    expect(body).not.toMatch(/local data/i)
    // It must still say what the command actually does.
    expect(body).toMatch(/drops every row/i)
  })
})

describe('no shipped screen asserts which datastore is running', () => {
  it('sweeps every page and component, not just the two that were wrong', () => {
    const roots = ['src/app', 'src/components', 'src/modules']
    const offenders = []
    for (const root of roots) {
      for (const file of jsxFiles(resolve(process.cwd(), root))) {
        const body = shipped(readFileSync(file, 'utf8'))
        // Inside JSX text or a caption/label string — not an import path.
        if (/SQLite|offline-first/i.test(body)) {
          offenders.push(relative(process.cwd(), file).split(sep).join('/'))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
