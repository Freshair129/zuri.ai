'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// @req FR-046, FR-104 — one password input for both doors: sign-in and reset.
// @spec SEC-008 — the reveal is a client-side display state and never leaves the
//   browser; nothing about it reaches a request, a log or the session token.
// @tested tests/unit/password-reset-page.test.js

/**
 * A password input with a reveal toggle.
 *
 * Three details that are easy to get wrong and are the reason this is shared
 * rather than written twice:
 *
 * 1. The toggle sits OUTSIDE the `<label>`. A button nested inside a label
 *    forwards its click to the labelled control, so the input would steal focus
 *    and — in some browsers — the click would toggle nothing at all.
 * 2. The accessible name states the ACTION, and it changes with state. A static
 *    "show password" read out while the password is already visible tells a
 *    screen-reader user the opposite of the truth, so `aria-pressed` carries the
 *    state and the name carries what pressing it will do.
 * 3. `autoComplete` is the caller's decision. `current-password` on a sign-in
 *    form and `new-password` on a reset form are what let a password manager
 *    offer to fill one and to save the other; a single hard-coded value here
 *    would break whichever screen it did not match.
 * 4. `revealSubject` names WHICH password the toggle reveals. A page with two
 *    of these — signup, and reset-password's redeem form — otherwise renders
 *    two buttons whose accessible names are identical, so a screen-reader user
 *    hears "แสดงรหัสผ่าน" twice and cannot tell which field each one controls.
 *    `aria-controls` points at the right input but does not enter the name, and
 *    support for it is thin. The default keeps every single-field page reading
 *    exactly as it did; a second field on a page is what obliges the caller to
 *    say which is which.
 */
export default function PasswordField({
  id,
  name,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required = true,
  describedBy,
  revealSubject = 'รหัสผ่าน',
}) {
  const [revealed, setRevealed] = useState(false)
  const fallbackId = useId()
  const inputId = id || fallbackId

  return (
    <div>
      <label className="block text-xs font-semibold" htmlFor={inputId}>
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={inputId}
          name={name}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] pl-3 pr-11 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
        />
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-controls={inputId}
          aria-label={revealed ? `ซ่อน${revealSubject}` : `แสดง${revealSubject}`}
          title={revealed ? `ซ่อน${revealSubject}` : `แสดง${revealSubject}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-sm)] text-[var(--text-secondary)] outline-none hover:text-[var(--text-primary)] focus-visible:text-[var(--text-primary)]"
        >
          {revealed ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
