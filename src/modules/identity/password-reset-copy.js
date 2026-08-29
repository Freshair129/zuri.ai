// @req FR-104 — the consume leg's user-facing copy. The route answers with one
// generic failure for unknown, used and expired tokens on purpose, and this
// module must not undo that by translating them into three different sentences.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/unit/password-reset-page.test.js

// Kept apart from login-error-copy.js deliberately. That module serves FR-046
// and may say "wrong password"; this one serves FR-104 and may never say which
// half of a guess was right. Sharing a file would put one rule next to its
// opposite and invite a future edit to apply the wrong one.

/** Minimum accepted by `hashPassword` in auth-service.js. */
export const PASSWORD_MIN_LENGTH = 8

export const RESET_ERROR_TOKEN = 'รหัสรีเซ็ตไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากเจ้าของทีมหรือผู้ดูแลระบบ'
export const RESET_ERROR_PASSWORD = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`
export const RESET_ERROR_MISMATCH = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'
export const RESET_ERROR_NETWORK = 'ไม่สามารถตั้งรหัสผ่านใหม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'
export const RESET_SUCCESS = 'ตั้งรหัสผ่านใหม่เรียบร้อย ทุกอุปกรณ์ที่เข้าสู่ระบบค้างไว้ถูกออกจากระบบแล้ว'

/**
 * One sentence per *cause the caller can act on*, not one per server code.
 *
 * `PASSWORD_INVALID` is about what the person just typed, so naming it helps
 * them. Everything else concerns the token, and the three token failures are
 * collapsed back into a single sentence — the route already refuses to
 * distinguish them, and a screen that distinguished them would hand back the
 * oracle the route withheld.
 */
export function resetErrorMessage(result) {
  return result?.error === 'PASSWORD_INVALID' ? RESET_ERROR_PASSWORD : RESET_ERROR_TOKEN
}
