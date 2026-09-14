// @req FR-225 — the Thai wizard's error vocabulary: one pure mapping from an API
//   refusal (`{ code, details, retryAfterSeconds }`) to the copy and next-step hint
//   the design's error table names, so the wizard component stays free of Thai
//   strings and is testable without rendering anything.
// @spec ADR-089 D2, D7; design §5.3, §5.4
// @tested tests/unit/line-oa-connect-wizard-copy.test.js

/**
 * `nextStep` is a machine-readable hint the wizard switches on — never rendered
 * itself. `retryable` says whether the same fields may be resubmitted as-is
 * (true for a transient failure) or must change first (false: wrong input, a
 * claim conflict, or a step-up/enrolment interruption that needs a different
 * action before resubmitting).
 */
const CODES = Object.freeze({
  ASSURANCE_LEVEL_INSUFFICIENT: {
    message: 'ต้องยืนยันตัวตนสองขั้นตอนอีกครั้ง',
    nextStep: 'STEP_UP',
    retryable: false,
  },
  MFA_FACTOR_REQUIRED: {
    message: 'ยังไม่ได้ตั้งค่าการยืนยันตัวตนสองขั้นตอน — ตั้งค่าก่อนจึงจะเชื่อมต่อบัญชี LINE ได้',
    nextStep: 'MFA_ENROL',
    retryable: false,
  },
  CREDENTIAL_RATE_LIMITED: {
    message: (ctx) => `ลองมากเกินไป กรุณารอ ${ctx?.retryAfterSeconds ?? '—'} วินาที`,
    nextStep: 'WAIT',
    retryable: false,
  },
  LINE_CREDENTIALS_REJECTED: {
    message: 'Channel ID หรือ Channel secret ไม่ถูกต้อง ตรวจสอบจาก LINE Developers Console',
    nextStep: 'EDIT_FIELDS',
    retryable: true,
  },
  LINE_TOKEN_REJECTED: {
    message: 'Channel access token ไม่ถูกต้อง (Channel ID/secret ถูกต้องแล้ว) — ลบ token แล้วให้ระบบขอเอง หรือใส่ token ใหม่',
    nextStep: 'EDIT_TOKEN',
    retryable: true,
  },
  LINE_UNAVAILABLE: {
    message: 'LINE ตอบไม่สำเร็จชั่วคราว ลองใหม่ภายหลัง',
    nextStep: 'RETRY',
    retryable: true,
  },
  LINE_CHANNEL_ALREADY_CONNECTED: {
    // The server's own Thai sentence (channel-account-claim.js) is preferred when
    // present; this is only the fallback for a response that lacks `details`.
    message: 'บัญชี LINE นี้เชื่อมต่อกับธุรกิจในพื้นที่ทำงานนี้แล้ว',
    nextStep: 'VIEW_SIBLING',
    retryable: false,
  },
  LINE_CHANNEL_CLAIMED_ELSEWHERE: {
    message: 'บัญชี LINE นี้เชื่อมต่ออยู่กับพื้นที่ทำงานอื่นแล้ว หากคุณเป็นเจ้าของ กรุณาติดต่อผู้ดูแลระบบเพื่อโอนย้าย',
    nextStep: 'CONTACT_OPERATOR',
    retryable: false,
  },
  CHANNEL_SECRET_STORE_UNAVAILABLE: {
    message: 'ระบบเก็บข้อมูลรับรองไม่พร้อม (ผู้ดูแลระบบได้รับแจ้งแล้ว)',
    nextStep: 'RETRY',
    retryable: true,
  },
  CREDENTIAL_ORPHAN_PURGED: {
    message: 'บันทึกไม่สำเร็จ ระบบได้ลบข้อมูลที่บันทึกไปแล้ว กรุณาลองใหม่',
    nextStep: 'RETRY',
    retryable: true,
  },
  LINE_CHANNEL_MISMATCH: {
    message: 'Channel ID/secret นี้เป็นของบัญชี LINE คนละบัญชี ไม่ตรงกับบัญชีที่กำลังย้ายข้อมูลรับรอง',
    nextStep: 'EDIT_FIELDS',
    retryable: true,
  },
  CREDENTIAL_INPUT_INVALID: {
    message: 'รูปแบบ Channel ID หรือ Channel secret ไม่ถูกต้อง ตรวจสอบตัวเลขและตัวอักษรอีกครั้ง',
    nextStep: 'EDIT_FIELDS',
    retryable: true,
  },
  CREDENTIAL_INPUT_TOO_LARGE: {
    message: 'ข้อมูลที่ส่งมีขนาดใหญ่เกินไป',
    nextStep: 'EDIT_FIELDS',
    retryable: true,
  },
})

const FALLBACK = Object.freeze({
  message: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
  nextStep: 'RETRY',
  retryable: true,
})

/**
 * @param {string} code            the API's `error` field (a refusal code)
 * @param {object} [ctx]
 * @param {Array}  [ctx.details]   the response's `details` array, when present
 * @param {number} [ctx.retryAfterSeconds]
 * @returns {{code: string, message: string, nextStep: string, retryable: boolean}}
 */
export function describeLineOaConnectError(code, ctx = {}) {
  const entry = CODES[code] ?? FALLBACK
  const detailMessage = Array.isArray(ctx.details) && typeof ctx.details[0]?.message === 'string'
    ? ctx.details[0].message
    : null
  const message = detailMessage ?? (typeof entry.message === 'function' ? entry.message(ctx) : entry.message)
  return {
    code: CODES[code] ? code : (code || 'UNKNOWN'),
    message,
    nextStep: entry.nextStep,
    retryable: entry.retryable,
  }
}

export const LINE_OA_CONNECT_ERROR_CODES = Object.freeze(Object.keys(CODES))
