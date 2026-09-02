// @req FR-046 — a session-store outage (503 SESSION_UNAVAILABLE) is a
// server-state failure, not a login failure (401 AUTH_REQUIRED), and must
// read as one everywhere a guard or pre-shell page reacts to a failed viewer
// resolution — not only on the login route's own error surface
// (login-error-copy.js), which already made this split.
// @req FR-123 — plugin-consent-view.js made the same split by hand
// (`Number(error?.status) === 401 ? 'AUTH_REQUIRED' : 'SESSION_UNAVAILABLE'`);
// this file is that logic pulled out once so every other guard/page can share
// it instead of re-deriving it — or forgetting to.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/viewer-failure.test.js

const KNOWN_CODES = new Set(['AUTH_REQUIRED', 'SESSION_UNAVAILABLE', 'FORBIDDEN'])

function codeFromBody(body) {
  if (typeof body === 'string') return body
  if (body && typeof body === 'object' && typeof body.error === 'string') return body.error
  return null
}

/**
 * Classify a failed viewer resolution into the one signal every guard/page
 * needs in order to react correctly, instead of each call site re-deriving
 * the 401-vs-503 split by hand (or, as every guard but plugin-consent-view.js
 * did, not deriving it at all).
 *
 * Accepts whichever shape the caller actually has on hand:
 *  - a server-side failure from `resolveRequestViewer`, which throws an
 *    `Error` carrying `.status` and `.message` (the body's `error` field):
 *    `classifyViewerFailure({ status: error.status, body: error.message })`
 *  - a client-side `useFetch()` error, which is already the server's
 *    `body.error` string (e.g. 'SESSION_UNAVAILABLE') with no status
 *    attached to the hook's state: `classifyViewerFailure({ body: entry.error })`
 *  - the raw JSON body of a fetch response: `classifyViewerFailure({ status, body })`
 *    where `body` is `{ error: 'SESSION_UNAVAILABLE' }`
 *
 * A recognized code in `body` always wins over `status`, because it is the
 * more specific signal and the one every call site above already has. `status`
 * is the fallback for a caller that only has a bare HTTP status to hand.
 *
 * @param {{ status?: number|string|null, body?: string|{error?: string}|null }} [input]
 * @returns {'AUTH_REQUIRED'|'SESSION_UNAVAILABLE'|'FORBIDDEN'|'UNKNOWN'}
 */
export function classifyViewerFailure({ status, body } = {}) {
  const code = codeFromBody(body)
  if (code && KNOWN_CODES.has(code)) return code

  const numericStatus = Number(status)
  if (numericStatus === 503) return 'SESSION_UNAVAILABLE'
  if (numericStatus === 401) return 'AUTH_REQUIRED'
  if (numericStatus === 403) return 'FORBIDDEN'
  return 'UNKNOWN'
}

// Shared Thai copy so the "session store outage, not a login failure" message
// reads identically wherever a guard/page renders it, instead of each site
// wording its own variant.
export const SESSION_UNAVAILABLE_TITLE_TH = 'ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว'
export const SESSION_UNAVAILABLE_DETAIL_TH = 'ไม่ใช่ปัญหาการเข้าสู่ระบบของคุณ กรุณาลองใหม่อีกครั้งในอีกสักครู่'
