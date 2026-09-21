// @req FR-225, FR-266 — no credential field in LINE OA Studio can be filled with a
//   saved login by a browser or a password manager.
// @spec SEC-030
// @tested tests/unit/line-oa-credential-input-props.test.js
//
// On 2026-09-21 an owner found their e-mail in "Channel ID" and a saved password in
// "Channel secret": Chrome read the pair as a login form. The fields carried
// `autoComplete="off"`, which Chrome ignores on password inputs by design.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SECRET_INPUT_PROPS, identifierInputProps } from '@/modules/line-oa-studio/ui/credential-input-props'
import LineOaConnectWizard from '@/modules/line-oa-studio/ui/LineOaConnectWizard'

globalThis.React = React

vi.mock('@/context/ScopeContext', async () => {
  const { createScopeContextDouble } = await import('../factories/scope-context')
  return createScopeContextDouble()
})

const UI_DIR = resolve(process.cwd(), 'src/modules/line-oa-studio/ui')
const inputsIn = (html) => html.match(/<input[^>]*>/g) ?? []

describe('credential input props', () => {
  it('marks a secret as a new password, which browsers honour, never as "off", which Chrome ignores', () => {
    expect(SECRET_INPUT_PROPS.type).toBe('password')
    expect(SECRET_INPUT_PROPS.autoComplete).toBe('new-password')
    expect(SECRET_INPUT_PROPS['data-1p-ignore']).toBe('true')
    expect(SECRET_INPUT_PROPS['data-lpignore']).toBe('true')
    expect(SECRET_INPUT_PROPS.spellCheck).toBe(false)
  })

  it('names the identifier beside a secret so it is not picked as the login username', () => {
    const props = identifierInputProps('line-channel-id')
    expect(props.name).toBe('line-channel-id')
    expect(props.autoComplete).toBe('off')
    expect(props['data-1p-ignore']).toBe('true')
    // Never shaped like a login field.
    expect(props.autoComplete).not.toMatch(/username|email/)
  })

  it('renders the connect wizard with no field a saved login could be filled into', () => {
    const html = renderToStaticMarkup(createElement(LineOaConnectWizard, { businessId: 'biz-1', onConnected: () => {} }))
    const passwords = inputsIn(html).filter((tag) => tag.includes('type="password"'))
    expect(passwords.length).toBeGreaterThan(0)
    for (const tag of passwords) {
      expect(tag).toMatch(/autoComplete="new-password"/i)
      expect(tag).not.toMatch(/autoComplete="off"/i)
    }
    const channelId = inputsIn(html).find((tag) => tag.includes('name="line-channel-id"'))
    expect(channelId, 'the Channel ID field carries an explicit non-login name').toBeTruthy()
    expect(channelId).toMatch(/autoComplete="off"/i)
    expect(channelId).not.toMatch(/autoComplete="(username|email)"/i)
  })

  it('leaves no hand-written password input anywhere in the LINE OA Studio UI', () => {
    // The render test covers the forms that render by default; this covers the
    // ones behind a toggle, and every form added later. Each password input must
    // come from SECRET_INPUT_PROPS, so a literal `type="password"` is the way a
    // new field would quietly skip it.
    const offenders = []
    for (const file of readdirSync(UI_DIR).filter((name) => /\.jsx?$/.test(name))) {
      if (file === 'credential-input-props.js') continue
      const source = readFileSync(join(UI_DIR, file), 'utf8')
      if (/type=\{?["']password["']\}?/.test(source)) offenders.push(file)
      if (/autoComplete=["']off["'][^>]*type=["']password["']|type=["']password["'][^>]*autoComplete=["']off["']/.test(source)) offenders.push(`${file} (off on a password)`)
    }
    expect(offenders).toEqual([])
  })
})
