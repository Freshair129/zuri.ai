// @req FR-225, FR-266 — the attributes every credential field in LINE OA Studio
//   carries so a browser or password manager never fills a saved login into it.
// @spec SEC-030
// @tested tests/unit/line-oa-credential-input-props.test.js
//
// On 2026-09-21 an owner opened the connect form and found their own e-mail in
// "Channel ID" and a saved password in "Channel secret". Chrome saw a text field
// followed by `type="password"` and treated the pair as a login form. Nothing was
// stored — both values fail the field patterns, in the browser and on the server —
// but a form that offers to send the owner's personal password to a vault is one
// validation rule away from doing it.
//
// Why these values and not `autoComplete="off"`:
// - Chrome deliberately ignores `off` on password fields, because sites used it to
//   block password managers on real logins. `new-password` is the value browsers
//   honour: it means "this is not a credential you have saved", so nothing is
//   filled. (Chrome may offer to *generate* one instead; that cannot match a
//   channel secret's 32-hex pattern or a provider key's, so it is refused if taken.)
// - The identifier beside a secret gets `off` and an explicit non-login name, so it
//   is not picked as the "username" half of the pair.
// - `data-1p-ignore` and `data-lpignore` are the opt-outs 1Password and LastPass
//   document; browsers ignore them, extensions honour them.
//
// Every credential input in this lane spreads one of these. A new field that
// forgets to is the regression this file exists to prevent, and the test beside it
// renders each form and fails on any password input without `new-password`.

const PASSWORD_MANAGER_OPT_OUT = Object.freeze({ 'data-1p-ignore': 'true', 'data-lpignore': 'true' })

/** For the secret itself: a channel secret, a channel access token, a model API key. */
export const SECRET_INPUT_PROPS = Object.freeze({
  type: 'password',
  autoComplete: 'new-password',
  spellCheck: false,
  autoCapitalize: 'off',
  autoCorrect: 'off',
  ...PASSWORD_MANAGER_OPT_OUT,
})

/**
 * For the non-secret identifier that sits beside a secret (a Channel ID). Without
 * this it is the field a browser picks as the username of the pair.
 */
export function identifierInputProps(name) {
  return Object.freeze({
    name,
    autoComplete: 'off',
    spellCheck: false,
    autoCapitalize: 'off',
    autoCorrect: 'off',
    ...PASSWORD_MANAGER_OPT_OUT,
  })
}
