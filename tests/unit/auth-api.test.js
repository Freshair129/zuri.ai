// @req FR-082 — Production Auth & Password Reset API Route Tests.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-api.test.js
import { describe, expect, it } from 'vitest'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as logoutHandler } from '@/app/api/auth/logout/route'
import { POST as forgotPasswordHandler } from '@/app/api/auth/forgot-password/route'
import { POST as resetPasswordHandler } from '@/app/api/auth/reset-password/route'

describe('FR-081 Auth API Endpoints', () => {
  it('handles logout by clearing session cookies', async () => {
    const res = await logoutHandler()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    const cookieHeader = res.headers.get('set-cookie') || ''
    expect(cookieHeader).toContain('zuri_session=')
  })

  it('validates forgot password request parameters', async () => {
    const reqNoEmail = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const resNoEmail = await forgotPasswordHandler(reqNoEmail)
    expect(resNoEmail.status).toBe(400)
    expect(await resNoEmail.json()).toEqual({ error: 'EMAIL_REQUIRED' })

    const reqValid = new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'unknown@user.com' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const resValid = await forgotPasswordHandler(reqValid)
    expect(resValid.status).toBe(200)
    expect((await resValid.json()).success).toBe(true)
  })

  it('validates reset password request parameters', async () => {
    const reqMissing = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'abc' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const resMissing = await resetPasswordHandler(reqMissing)
    expect(resMissing.status).toBe(400)
    expect(await resMissing.json()).toEqual({ error: 'TOKEN_AND_PASSWORD_REQUIRED' })

    const reqInvalidToken = new Request('http://localhost/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'invalid-token-123', newPassword: 'NewPassword123!' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const resInvalidToken = await resetPasswordHandler(reqInvalidToken)
    expect(resInvalidToken.status).toBe(400)
    expect(await resInvalidToken.json()).toEqual({ error: 'INVALID_OR_EXPIRED_TOKEN' })
  })

  it('validates login request parameters', async () => {
    const reqInvalid = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'nonexistent', password: 'wrong' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const resInvalid = await loginHandler(reqInvalid)
    expect(resInvalid.status).toBe(401)
    expect(await resInvalid.json()).toEqual({ error: 'INVALID_CREDENTIALS' })
  })
})
