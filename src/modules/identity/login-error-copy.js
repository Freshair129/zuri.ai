// @req FR-046 — the login surface says why sign-in failed; only a 401 is allowed
// to blame the credentials. A 503 AUTH_UNAVAILABLE (missing ZURI_SESSION_SECRET,
// or session persistence down) is a server-state failure and must read as one.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-auth-route.test.js

export const LOGIN_ERROR_CREDENTIALS = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
export const LOGIN_ERROR_UNAVAILABLE = 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
export const LOGIN_ERROR_NETWORK = 'ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'

// The code is surfaced on purpose: a masked AUTH_UNAVAILABLE cost a long
// diagnosis on 2026-08-27 because the screen only ever said "wrong password".
// It carries no credential information — it names server state, not the account.
export function loginFailureCode(status, result) {
  const declared = typeof result?.error === 'string' ? result.error.trim() : ''
  if (declared) return declared
  return `HTTP ${Number.isFinite(status) ? status : 0}`
}

export function loginErrorMessage(status, result) {
  if (status === 401) return LOGIN_ERROR_CREDENTIALS
  return `${LOGIN_ERROR_UNAVAILABLE} (รหัส: ${loginFailureCode(status, result)})`
}
