import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  SIGNUP_ERROR_EMAIL_TAKEN,
  SIGNUP_ERROR_PASSWORD,
  SIGNUP_ERROR_UNAVAILABLE,
  signupErrorMessage,
} from '@/modules/identity/signup-copy'

// @req FR-120 — the signup screen and the copy that decides how much a refusal
// is allowed to say.
// @req FR-044 — signup is an entry surface and stays outside the shell.
// @spec BR-002, SEC-008
// @tested tests/unit/fr120-signup-page.test.js
//
// Source-text assertions follow this repo's UI-test idiom: vitest runs with
// `environment: 'node'` and there is no React rendering harness, so a
// component's invariants are asserted against its source and the copy module's
// pure function is exercised directly. What source text CANNOT show — that a
// link arrives somewhere, that a real account is created and usable — is
// covered by tests/e2e/fr120-signup.spec.js instead.

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const page = read('src/app/signup/page.jsx')
const login = read('src/app/login/page.jsx')

describe('FR-120 signup copy', () => {
  it('names the taken address, which FR-120 decides in the open', () => {
    // Not a leak this test is blessing: with no mail transport there is no
    // "check your inbox" to hide behind, and the alternative is a signup that
    // appears to succeed and does nothing.
    expect(signupErrorMessage({ error: 'EMAIL_TAKEN' })).toBe(SIGNUP_ERROR_EMAIL_TAKEN)
  })

  it('states the minimum the server actually enforces', () => {
    const authService = read('src/modules/identity/auth-service.js')
    expect(authService).toContain(`password.length < ${PASSWORD_MIN_LENGTH}`)
    expect(SIGNUP_ERROR_PASSWORD).toContain(String(PASSWORD_MIN_LENGTH))
    expect(signupErrorMessage({ error: 'PASSWORD_INVALID' })).toBe(SIGNUP_ERROR_PASSWORD)
  })

  it('sends an unrecognized code to the server-state sentence, not the email one', () => {
    // The direction of the default matters. Falling back to "try another email"
    // would send someone editing a field on a failure no field can fix.
    for (const result of [{ error: 'SOMETHING_NOBODY_MAPPED' }, {}, undefined]) {
      expect(signupErrorMessage(result)).toBe(SIGNUP_ERROR_UNAVAILABLE)
    }
  })

  it('gives every code the route can return its own sentence', () => {
    // Read from the route's source rather than listed by hand: a code added
    // there and not mapped here would otherwise surface as the generic
    // "unavailable" sentence and look like a server fault to the caller.
    const route = read('src/app/api/auth/signup/route.js')
    const service = read('src/modules/identity/signup-service.js')
    const declared = new Set([
      ...[...route.matchAll(/error: '([A-Z_]+)'/g)].map((match) => match[1]),
      ...[...service.matchAll(/failure\(\d{3}, '([A-Z_]+)'\)/g)].map((match) => match[1]),
    ])
    // SIGNUP_UNAVAILABLE is the one deliberate exception: it IS the default.
    declared.delete('SIGNUP_UNAVAILABLE')

    expect(declared.size).toBeGreaterThan(0)
    for (const code of declared) {
      expect(signupErrorMessage({ error: code }), `${code} has no sentence of its own`)
        .not.toBe(SIGNUP_ERROR_UNAVAILABLE)
    }
  })
})

describe('FR-120 signup screen', () => {
  it('posts to the public signup route', () => {
    expect(page).toContain("'/api/auth/signup'")
  })

  it('checks the confirmation match before posting', () => {
    expect(page).toContain('SIGNUP_ERROR_MISMATCH')
    expect(page.indexOf('SIGNUP_ERROR_MISMATCH')).toBeLessThan(page.indexOf("fetch('/api/auth/signup'"))
  })

  it('follows the server\'s redirect rather than deciding where to go itself', () => {
    // The account exists whether or not a session was minted, and only the
    // server knows which happened.
    expect(page).toContain('result.redirect')
  })

  it('asks a password manager to save rather than to fill', () => {
    expect(page).toContain('autoComplete="new-password"')
    expect(page).not.toContain('autoComplete="current-password"')
  })

  it('stays an entry surface', () => {
    expect(page).toContain('<EntryShell')
    expect(page).not.toContain('useScope')
    expect(page).not.toContain('DomainBar')
    expect(page).not.toContain('Sidebar')
  })

  it('says on the page that signup alone does not join a team', () => {
    // FR-120's central claim, and the one a person is most likely to get wrong:
    // an account grants nothing until they create a Workspace or are invited.
    expect(page).toContain('รอคำเชิญ')
  })

  it('says that no mail is sent, because none can be', () => {
    // Email is an identifier here, not a channel. A screen that stayed silent
    // would leave people waiting for a verification message that has no
    // transport to arrive on.
    expect(page).toContain('ไม่ส่งอีเมลยืนยัน')
  })
})

describe('FR-120 reaches the signup screen from Login', () => {
  it('links Login to signup', () => {
    // Until FR-120 there was nowhere for a person without an account to go:
    // the only credential writers were the seed and FR-107's bootstrap.
    expect(login).toContain('href="/signup"')
  })
})
