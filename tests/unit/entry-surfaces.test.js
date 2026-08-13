// @req FR-044 — the entry journey keeps Landing and demo Login outside the BusinessShell.
// @spec ADR-015, SDD-022 — EntryShell owns only the minimal pre-routing surfaces.
// @tested tests/unit/entry-surfaces.test.js

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const entryShellPath = resolve(root, 'src/components/layouts/EntryShell.jsx')
const landingPath = resolve(root, 'src/app/page.jsx')
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
    expect(landing).toContain('<EntryShell>')
    expect(landing).toContain('href="/login"')
    expect((landing.match(/href="\//g) || []).length).toBe(1)
    expect(landing).not.toContain('/api/viewer')
    expect(landing).not.toContain('useScope')
    expect(landing).not.toContain('DomainBar')
    expect(landing).not.toContain('Sidebar')
  })

  it('keeps Login credential-free and sends its single demo CTA to Business Routing', () => {
    expect(existsSync(loginPath)).toBe(true)
    const login = readFileSync(loginPath, 'utf8')
    expect(login).toContain('<EntryShell>')
    expect(login).toContain('href="/businesses"')
    expect((login.match(/href="\//g) || []).length).toBe(1)
    expect(login).toContain('demo')
    const executableLogin = login.replace(/\/\/.*$/gm, '')
    expect(executableLogin).not.toContain('/api/viewer')
    expect(executableLogin).not.toContain('password')
    expect(executableLogin).not.toContain('token')
  })
})
