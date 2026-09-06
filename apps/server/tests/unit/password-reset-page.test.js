import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PASSWORD_MIN_LENGTH,
  RESET_ERROR_PASSWORD,
  RESET_ERROR_TOKEN,
  resetErrorMessage,
} from '@/modules/identity/password-reset-copy'

// @req FR-104 — the consume leg's screen, and the copy that must not turn one
// deliberate generic failure back into an enumeration oracle.
// @req FR-046, FR-044 — the shared password field and the entry-surface boundary.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/unit/password-reset-page.test.js
//
// Source-text assertions follow this repo's UI-test idiom (see
// fr059-strategy-edit-ui.test.js): vitest runs with `environment: 'node'` and
// there is no React rendering harness, so a component's invariants are asserted
// against its source. The copy module's logic is a pure function and is
// exercised directly.

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const page = read('src/app/reset-password/page.jsx')
const field = read('src/components/forms/PasswordField.jsx')
const login = read('src/app/login/page.jsx')
const signup = read('src/app/signup/page.jsx')

describe('FR-104 reset copy keeps the route\'s single generic token failure', () => {
  it('names the password rule, because that is the caller\'s own typing', () => {
    expect(resetErrorMessage({ error: 'PASSWORD_INVALID' })).toBe(RESET_ERROR_PASSWORD)
    expect(RESET_ERROR_PASSWORD).toContain(String(PASSWORD_MIN_LENGTH))
  })

  it('collapses unknown, used and expired into one sentence', () => {
    // The route answers all three with one code by design. Three distinct
    // sentences here would hand back exactly the oracle it withheld: a guesser
    // could tell "no such token" from "that one was real but spent".
    const answers = [
      resetErrorMessage({ error: 'INVALID_OR_EXPIRED_TOKEN' }),
      resetErrorMessage({ error: 'TOKEN_ALREADY_USED' }),
      resetErrorMessage({ error: 'SOMETHING_NEW_NOBODY_MAPPED' }),
      resetErrorMessage({}),
      resetErrorMessage(undefined),
    ]
    expect(new Set(answers).size).toBe(1)
    expect(answers[0]).toBe(RESET_ERROR_TOKEN)
  })

  it('states the minimum the server actually enforces', () => {
    // auth-service.js `hashPassword` throws PASSWORD_INVALID below 8. A screen
    // advertising a different number would send people to a rejection.
    const authService = read('src/modules/identity/auth-service.js')
    expect(authService).toContain(`password.length < ${PASSWORD_MIN_LENGTH}`)
  })
})

describe('FR-104 redemption screen', () => {
  it('posts the token and the new password to the public consume route', () => {
    expect(page).toContain("'/api/auth/reset-password'")
    expect(page).toContain('newPassword')
  })

  it('accepts a token typed by hand, not only one carried in the URL', () => {
    // FR-104's handover is out of band — LINE or in person — so the common case
    // is a code read off a message, with no link to click.
    expect(page).toContain("searchParams.get('token')")
    expect(page).toContain('id="token"')
  })

  it('checks the confirmation match before spending the token', () => {
    // The token is single-use. A round trip that burned it to report a typo
    // would cost the person a second request to their owner.
    expect(page).toContain('RESET_ERROR_MISMATCH')
    expect(page.indexOf('RESET_ERROR_MISMATCH')).toBeLessThan(page.indexOf("fetch('/api/auth/reset-password'"))
  })

  it('stays an entry surface', () => {
    expect(page).toContain('<EntryShell')
    expect(page).not.toContain('useScope')
    expect(page).not.toContain('DomainBar')
    expect(page).not.toContain('Sidebar')
  })
})

describe('FR-046/FR-104 shared password field', () => {
  it('keeps the reveal toggle outside the label', () => {
    // A <button> nested inside a <label> forwards its click to the labelled
    // control, so the input steals focus and the toggle can do nothing at all.
    const labelBlock = field.slice(field.indexOf('<label'), field.indexOf('</label>'))
    expect(labelBlock).not.toContain('<button')
  })

  it('gives the toggle a name that changes with its state', () => {
    // A static "show password" announced while the password is already visible
    // tells a screen-reader user the opposite of the truth.
    expect(field).toContain('aria-pressed={revealed}')
    expect(field).toContain('aria-label={revealed ? `ซ่อน${revealSubject}` : `แสดง${revealSubject}`}')
    // The default is what keeps every single-field page reading exactly as it
    // did before the subject became a prop.
    expect(field).toContain("revealSubject = 'รหัสผ่าน'")
  })

  it('makes each toggle name its own field wherever a page has two', () => {
    // Two PasswordFields on one page rendered two buttons whose accessible
    // names were character-for-character identical, so a screen-reader user
    // heard "แสดงรหัสผ่าน" twice with nothing to distinguish them. This is a
    // source-level check and can only see a page it is told to look at, so the
    // behavioural assertion — that the names differ and each reveals only its
    // own input — lives in tests/e2e/fr120-signup.spec.js.
    for (const [name, source] of [['reset-password', page], ['signup', signup]]) {
      const subjects = [...source.matchAll(/revealSubject="([^"]+)"/g)].map((match) => match[1])
      const fields = (source.match(/<PasswordField/g) || []).length
      expect(subjects.length, `${name} leaves a PasswordField without a revealSubject`).toBe(fields)
      expect(new Set(subjects).size, `${name} reuses a revealSubject`).toBe(subjects.length)
    }
  })

  it('leaves autoComplete to the caller so both doors get the right one', () => {
    expect(field).toContain('autoComplete={autoComplete}')
    expect(login).toContain('autoComplete="current-password"')
    expect(page).toContain('autoComplete="new-password"')
  })

  it('never sends or stores the reveal state', () => {
    // It is a display state: if it reached a request, a cookie or storage it
    // would be telling something outside the browser tab a fact it has no
    // business knowing, and would outlive the moment it describes.
    //
    // Asserted as "this component performs no I/O at all", which is the shape
    // that is actually expressible here. An earlier version of this test looked
    // for the substring `revealed,` and matched the `const [revealed,
    // setRevealed]` declaration instead — a pattern that could not represent
    // the thing it was written to catch, and would have failed on correct code
    // forever while catching nothing.
    const executable = field.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sink of ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie']) {
      expect(executable).not.toContain(sink)
    }
  })
})
