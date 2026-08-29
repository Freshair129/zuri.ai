// @req FR-044 — the entry journey keeps Landing and Login outside the BusinessShell.
// @spec ADR-015, SDD-022 — EntryShell owns only the minimal pre-routing surfaces.
// @tested tests/unit/entry-surfaces.test.js

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const entryShellPath = resolve(root, 'src/components/layouts/EntryShell.jsx')
const landingPath = resolve(root, 'src/app/page.jsx')
const landingViewPath = resolve(root, 'src/components/landing/ZuriLanding.jsx')
const loginPath = resolve(root, 'src/app/login/page.jsx')

describe('FR-044 entry surfaces', () => {
  it('provides a reusable EntryShell without final BusinessShell chrome', () => {
    expect(existsSync(entryShellPath)).toBe(true)
    const entryShell = readFileSync(entryShellPath, 'utf8')
    expect(entryShell).toContain('data-shell="entry"')
    expect(entryShell).not.toContain("from './DomainBar'")
    expect(entryShell).not.toContain("from './Sidebar'")
  })

  it('keeps Landing minimal and sends its single CTA to Login', () => {
    const landing = readFileSync(landingPath, 'utf8')
    const landingView = readFileSync(landingViewPath, 'utf8')
    const landingSource = `${landing}\n${landingView}`
    expect(landing).toContain('<EntryShell')
    expect(landingSource).toContain('href="/login"')
    expect((landingSource.match(/href="\//g) || []).length).toBe(1)
    expect(landingSource).not.toContain('/api/viewer')
    expect(landingSource).not.toContain('useScope')
    expect(landingSource).not.toContain('DomainBar')
    expect(landingSource).not.toContain('Sidebar')
  })

  it('keeps Login outside the shell and submits real credentials to the auth route', () => {
    expect(existsSync(loginPath)).toBe(true)
    const login = readFileSync(loginPath, 'utf8')
    expect(login).toContain('<EntryShell')
    expect(login).toContain('action="/api/auth/login"')
    expect(login).toContain('method="post"')
    expect(login).toContain('name="username"')
    expect(login).toContain('name="password"')

    // This assertion used to read `.length).toBe(0)` — Login carried no internal
    // link at all. FR-104's redemption screen gave it a reason to carry one, and
    // raising 0 to 1 would have been the wrong repair, because the count was
    // never what mattered.
    //
    // What it protects is the FR-044/ADR-015 boundary: nothing reachable from
    // Login may enter the BusinessShell before a session exists. A count cannot
    // tell a link to a sibling entry surface apart from a link into the shell,
    // so it would have passed a link straight to `/overview` as readily as this
    // one. Naming the permitted destinations expresses the boundary itself, and
    // is strictly stronger than the count it replaces.
    const ENTRY_ROUTES = ['/', '/login', '/reset-password']
    const linked = [...login.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1])
    expect(linked.every((href) => ENTRY_ROUTES.includes(href))).toBe(true)
    const executableLogin = login.replace(/\/\/.*$/gm, '')
    expect(executableLogin).not.toContain('/api/viewer')
    expect(executableLogin).not.toContain('LOCAL_DEMO')
    expect(executableLogin).not.toContain('ZURI_LOCAL_DEMO_AUTH')
  })
})
