'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// @req FR-044 — token redemption is an entry surface: it renders before any
// session exists and must stay outside the BusinessShell.
// @spec ADR-015, SDD-022 — EntryShell owns the pre-routing surfaces.
// @tested tests/unit/entry-surfaces.test.js
import EntryShell from '@/components/layouts/EntryShell'
// @req FR-104 — the consume leg had a route and no screen. An owner could mint
// a token and hand it over, and the person holding it had nowhere to type it.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/unit/password-reset-page.test.js
import {
  PASSWORD_MIN_LENGTH,
  RESET_ERROR_MISMATCH,
  RESET_ERROR_NETWORK,
  RESET_SUCCESS,
  resetErrorMessage,
} from '@/modules/identity/password-reset-copy'
import PasswordField from '@/components/forms/PasswordField'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Prefilled when the owner hands over a link, typed when they hand over the
  // code itself — FR-104 says the handover is out of band (LINE, in person),
  // so the field stays visible and editable either way.
  const [token, setToken] = useState(searchParams.get('token') || '')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')

    // Checked here as well as on the server because the mismatch is a typing
    // slip, not a policy decision, and a round trip that spends the token to
    // report one would burn a single-use token on a typo.
    if (password !== confirmation) {
      setError(RESET_ERROR_MISMATCH)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword: password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(resetErrorMessage(result))
        return
      }
      setDone(true)
    } catch {
      setError(RESET_ERROR_NETWORK)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">ตั้งรหัสผ่านใหม่แล้ว</h1>
        <p role="status" className="mt-2 text-sm leading-6 text-muted">{RESET_SUCCESS}</p>
        <button
          type="button"
          onClick={() => router.replace('/login')}
          className="btn btn-primary mt-6 inline-flex min-h-11 w-full justify-center"
        >
          ไปหน้าเข้าสู่ระบบ
        </button>
      </>
    )
  }

  return (
    <>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--action-primary)' }}>
          Password Reset
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">ตั้งรหัสผ่านใหม่</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          ใช้รหัสรีเซ็ตที่ได้รับจากเจ้าของทีมหรือผู้ดูแลระบบ รหัสใช้ได้ครั้งเดียวและมีอายุ 1 ชั่วโมง
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold" htmlFor="token">
          รหัสรีเซ็ต
          <input
            id="token"
            name="token"
            type="text"
            autoComplete="off"
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
          />
        </label>

        <PasswordField
          id="new-password"
          name="newPassword"
          label="รหัสผ่านใหม่"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          describedBy="password-rule"
          minLength={PASSWORD_MIN_LENGTH}
        />
        <p id="password-rule" className="-mt-2 text-xs text-muted">
          อย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร
        </p>

        <PasswordField
          id="confirm-password"
          name="confirmPassword"
          label="ยืนยันรหัสผ่านใหม่"
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
          minLength={PASSWORD_MIN_LENGTH}
        />

        {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary inline-flex min-h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'กำลังตั้งรหัสผ่าน…' : 'ตั้งรหัสผ่านใหม่'}
        </button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <EntryShell backdrop label="ตั้งรหัสผ่านใหม่">
      {/* useSearchParams needs a Suspense boundary or the whole route opts out
          of static rendering at build time. */}
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </EntryShell>
  )
}
