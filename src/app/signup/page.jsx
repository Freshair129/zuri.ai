'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// @req FR-044 — signup renders before any session exists, so it is an entry
// surface and stays outside the BusinessShell.
// @spec ADR-015, SDD-022 — EntryShell owns the pre-routing surfaces.
// @tested tests/unit/entry-surfaces.test.js
import EntryShell from '@/components/layouts/EntryShell'
// @req FR-120 — the public door. Creating an account grants nothing: the new
// Person continues into FR-066 at its PROFILE step and holds no scope,
// capability or membership until they create a Workspace or are invited.
// @spec BR-002, SEC-008
// @tested tests/unit/fr120-signup-page.test.js, tests/e2e/fr120-signup.spec.js
import {
  PASSWORD_MIN_LENGTH,
  SIGNUP_ERROR_MISMATCH,
  SIGNUP_ERROR_UNAVAILABLE,
  signupErrorMessage,
} from '@/modules/identity/signup-copy'
import PasswordField from '@/components/forms/PasswordField'

export default function SignupPage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')

    // Checked here as well as on the server because a mismatch is a typing slip
    // rather than a policy decision, and there is no reason to spend a round
    // trip — or create the account — to report one.
    if (password !== confirmation) {
      setError(SIGNUP_ERROR_MISMATCH)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName, email, password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(signupErrorMessage(result))
        return
      }
      // The account exists whether or not a session was minted, so the server
      // says where to go and this follows it: /onboarding/profile when signed
      // in, /login when the session could not be issued.
      router.replace(result.redirect || '/login')
      router.refresh()
    } catch {
      setError(SIGNUP_ERROR_UNAVAILABLE)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <EntryShell backdrop>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Zuri">
          <span className="text-lg font-bold tracking-[0.24em]">ZURI</span>
          <span className="h-2 w-2" style={{ background: 'var(--action-primary)' }} aria-hidden="true" />
        </div>
        <span className="rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] px-2 py-1 text-[10px] font-bold tracking-[0.14em]" style={{ color: 'var(--action-primary-active)' }}>
          ETOHGROUP
        </span>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--action-primary)' }}>
          Create Account
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">สมัครสมาชิก</h1>
        {/* Said plainly on the screen, not only in the requirement: somebody who
            signs up expecting to find their team's work here should learn on
            this page that an invitation is the step that does that. */}
        <p className="mt-2 text-sm leading-6 text-muted">
          สร้างบัญชีของคุณเองเพื่อเริ่มต้นใช้งาน การสมัครจะสร้างโปรไฟล์ให้เท่านั้น —
          การเข้าร่วมทีมที่มีอยู่แล้วต้องรอคำเชิญจากเจ้าของทีม
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-xs font-semibold" htmlFor="displayName">
          ชื่อที่ใช้แสดง
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
          />
        </label>

        {/* The hint sits OUTSIDE the label and is attached with
            aria-describedby. Inside it, the whole sentence would become part of
            the input's accessible name, so a screen reader would announce the
            field as "อีเมล ใช้เป็นชื่อผู้ใช้…ระบบไม่ส่งอีเมลยืนยัน" — a label is
            what the field is called, a description is what it explains. */}
        <div>
          <label className="block text-xs font-semibold" htmlFor="email">
            อีเมล
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby="email-hint"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 text-sm font-normal outline-none focus:border-[var(--action-primary)]"
          />
          {/* FR-120: email is an identifier here, not a channel. This
              installation has no mail transport, so nothing is ever sent to it
              and it must never be treated as proof of contact. */}
          <p id="email-hint" className="mt-1 text-[11px] text-muted">
            ใช้เป็นชื่อผู้ใช้สำหรับเข้าสู่ระบบ ระบบไม่ส่งอีเมลยืนยัน
          </p>
        </div>

        <PasswordField
          id="password"
          name="password"
          label={`รหัสผ่าน (อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร)`}
          autoComplete="new-password"
          revealSubject="รหัสผ่าน"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={setPassword}
        />
        <PasswordField
          id="confirmation"
          name="confirmation"
          label="ยืนยันรหัสผ่าน"
          autoComplete="new-password"
          revealSubject="การยืนยันรหัสผ่าน"
          minLength={PASSWORD_MIN_LENGTH}
          value={confirmation}
          onChange={setConfirmation}
        />

        {error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : null}

        <button type="submit" disabled={submitting} className="btn btn-primary inline-flex min-h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-60">
          {submitting ? 'กำลังสมัคร…' : 'สมัครสมาชิก'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-muted">
        มีบัญชีอยู่แล้ว?{' '}
        <Link href="/login" className="font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--action-primary-active)' }}>
          เข้าสู่ระบบ
        </Link>
      </p>
    </EntryShell>
  )
}
