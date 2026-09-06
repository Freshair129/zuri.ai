// @req FR-120 — the signup surface's copy, and the one place that decides how
//   much a refusal is allowed to say.
// @spec SEC-008
// @tested tests/unit/fr120-signup-page.test.js

// Kept apart from password-reset-copy.js on purpose, and the reason is the
// opposite of the one that separated that file from login-error-copy.js. There,
// two modules had to stay apart because one may name the failure and the other
// may not. Here the split is that FR-120 *may* say "this email is taken" and
// FR-104 may never say "that token was real" — putting a rule beside its
// opposite invites a later edit to apply the wrong one.

/** Minimum accepted by `hashPassword` in auth-service.js — FR-046's policy. */
export const PASSWORD_MIN_LENGTH = 8

export const SIGNUP_ERROR_EMAIL_TAKEN = 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ หรือใช้อีเมลอื่น'
export const SIGNUP_ERROR_EMAIL_INVALID = 'รูปแบบอีเมลไม่ถูกต้อง'
export const SIGNUP_ERROR_NAME_REQUIRED = 'กรุณากรอกชื่อที่ใช้แสดง'
export const SIGNUP_ERROR_PASSWORD = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`
export const SIGNUP_ERROR_MISMATCH = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
export const SIGNUP_ERROR_RATE_LIMITED = 'มีการสมัครจากที่นี่บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
export const SIGNUP_ERROR_UNAVAILABLE = 'ไม่สามารถสมัครสมาชิกได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'

/**
 * Every code the route can return maps to a sentence naming what the caller can
 * change about it.
 *
 * **`EMAIL_TAKEN` is deliberately distinguishable**, and that is a decision
 * FR-120 makes in the open rather than a leak. This installation has no mail
 * transport — the stated reason FR-104 has no public forgot-password — so there
 * is no "check your inbox" response to hide a taken address behind, and the
 * only alternative is a signup that appears to succeed and silently does
 * nothing. The account the answer reveals holds no scope, no capability and no
 * membership until its owner creates a Workspace or somebody invites them, so
 * what a guesser learns from it buys them nothing.
 *
 * The unmapped default is the *server-state* sentence, never the taken-email
 * one: an unrecognized code means something went wrong that the caller cannot
 * fix by editing a field, and telling them to try a different email would send
 * them somewhere the problem is not.
 */
export function signupErrorMessage(result) {
  switch (result?.error) {
    case 'EMAIL_TAKEN':
      return SIGNUP_ERROR_EMAIL_TAKEN
    case 'EMAIL_INVALID':
      return SIGNUP_ERROR_EMAIL_INVALID
    case 'DISPLAY_NAME_REQUIRED':
      return SIGNUP_ERROR_NAME_REQUIRED
    case 'PASSWORD_INVALID':
      return SIGNUP_ERROR_PASSWORD
    case 'RATE_LIMITED':
      return SIGNUP_ERROR_RATE_LIMITED
    default:
      return SIGNUP_ERROR_UNAVAILABLE
  }
}
