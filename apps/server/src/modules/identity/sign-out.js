// @req FR-046, FR-095 — every signed-in shell offers one sign-out control that
// revokes the live Session and clears its cookie (`POST /api/auth/logout`),
// then leaves the person on `/login`. Before this file, the route existed and
// worked but nothing in the UI called it (grep for "logout" under
// src/components and src/app found no caller) — a signed-in person had no way
// to sign out except waiting for expiry or clearing cookies by hand. Four
// shells need the same behaviour, so it is one pure, testable module instead
// of four hand-written fetch-then-redirect copies.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out.test.js

/** The one request every sign-out control makes. Pure — no fetch, no router. */
export function buildSignOutRequest() {
  return { path: '/api/auth/logout', method: 'POST' }
}

// The route's own contract (src/app/api/auth/logout/route.js): even its 503
// path — session store unavailable, revoke failed — still clears the browser
// cookie. So the redirect to /login is unconditional; what varies is whether
// the person is told their server-side session might still be live elsewhere.
export const SIGN_OUT_REDIRECT_PATH = '/login'

export const SIGN_OUT_SESSION_WARNING_TH =
  'ออกจากระบบในเบราว์เซอร์นี้เรียบร้อยแล้ว แต่ระบบไม่สามารถยกเลิกเซสชันฝั่งเซิร์ฟเวอร์ได้ในขณะนี้ เซสชันนี้อาจยังใช้งานได้จากอุปกรณ์อื่น'

/**
 * Decide where a completed sign-out attempt sends the person, and whether
 * they need to be told the server-side revoke did not confirm. Pure — takes
 * only the outcome of the request, never performs it.
 *
 * @param {{ ok: boolean }} result
 * @returns {{ path: string, warning: string | null }}
 */
export function resolveSignOutRedirect(result) {
  const ok = Boolean(result && result.ok === true)
  return { path: SIGN_OUT_REDIRECT_PATH, warning: ok ? null : SIGN_OUT_SESSION_WARNING_TH }
}

/**
 * Perform the one sign-out request and resolve the redirect decision. Never
 * throws — a network failure, a non-JSON body, or the route's own 503 all
 * resolve to `{ path: '/login', warning: SIGN_OUT_SESSION_WARNING_TH }` rather
 * than leaving the caller to invent its own failure handling, which is the
 * duplication this module exists to remove. The caller still owns surfacing
 * `warning` (this repo's convention for a swallowed-failure guard is a caught,
 * shown rejection, not a silent one) and calling its own router.
 *
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ path: string, warning: string | null }>}
 */
export async function performSignOut(fetchImpl = fetch) {
  const { path, method } = buildSignOutRequest()
  let ok = false
  try {
    const response = await fetchImpl(path, { method })
    const data = await response.json().catch(() => null)
    ok = response.ok === true && data?.success === true
  } catch {
    ok = false
  }
  return resolveSignOutRedirect({ ok })
}
