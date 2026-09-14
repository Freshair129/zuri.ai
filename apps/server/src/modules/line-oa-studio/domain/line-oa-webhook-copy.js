// @req FR-227 — a pure mapping from the account's stored webhook health
//   (`webhookStateJson`, written by the REGISTER_WEBHOOK action) to the Thai
//   copy and manual-card hint the design's error table names, so a UI can
//   render it without holding any English error vocabulary of its own.
// @req FR-228 — the matching mapping for the `LINE_LEGACY_TRANSPORT_ACTIVE`
//   refusal ENABLE_SERVER raises when derived quiescence fails.
// @spec ADR-089 D7, D8; design §5.3, §5.4
// @tested tests/unit/line-oa-webhook-copy.test.js

/**
 * `showManualCard` means: show the endpoint URL with a copy button for the
 * owner to paste into the LINE Developers Console themselves. `nextStep` is a
 * machine-readable hint a UI switches on — never rendered itself.
 */
const REASONS = Object.freeze({
  // `classifyWebhookTest` (line-channel-admin-port.js) reports success as
  // `code: 'LINE_OK'` — the same code this module stores in `lastTestReason`.
  LINE_OK: {
    message: (ctx) => `LINE เรียก Webhook สำเร็จ (HTTP ${ctx?.lastTestStatusCode ?? '-'})`,
    showManualCard: false,
    nextStep: null,
  },
  LINE_WEBHOOK_INACTIVE: {
    message: 'LINE ยังไม่เปิดใช้ Webhook — เปิดสวิตช์ "Use webhook" ในแท็บ Messaging API แล้วกดทดสอบอีกครั้ง',
    showManualCard: true,
    nextStep: 'RECHECK',
  },
  LINE_WEBHOOK_SET_FAILED: {
    message: 'LINE ไม่ยอมรับ URL Webhook — ตรวจสอบ URL แล้วลองใหม่ หรือวาง URL นี้ในคอนโซลด้วยตนเอง',
    showManualCard: true,
    nextStep: 'MANUAL_PASTE',
  },
  'LINE_WEBHOOK_TEST_FAILED:COULD_NOT_CONNECT': {
    message: 'LINE เชื่อมต่อมาที่เซิร์ฟเวอร์ไม่ได้ (ตรวจ ngrok/โดเมน)',
    showManualCard: true,
    nextStep: 'RETEST',
  },
  'LINE_WEBHOOK_TEST_FAILED:ERROR_STATUS_CODE': {
    message: (ctx) => `เซิร์ฟเวอร์ตอบ HTTP ${ctx?.lastTestStatusCode ?? '-'}`,
    showManualCard: true,
    nextStep: 'RETEST',
  },
  'LINE_WEBHOOK_TEST_FAILED:REQUEST_TIMEOUT': {
    message: 'เซิร์ฟเวอร์ตอบช้าเกินไป',
    showManualCard: true,
    nextStep: 'RETEST',
  },
  'LINE_WEBHOOK_TEST_FAILED:UNCLASSIFIED': {
    message: 'ไม่ทราบสาเหตุ',
    showManualCard: true,
    nextStep: 'RETEST',
  },
  // @req FR-227 — a signature the webhook test could not verify means the
  // vault holds a secret that is not this channel's. Reported plainly, never
  // conflated with an ordinary connectivity failure, and never an automatic
  // revocation of the stored credential — only a link to rotate it.
  LINE_WEBHOOK_SIGNATURE_INVALID: {
    message: 'ลายเซ็น Webhook ไม่ตรง — Channel secret ที่บันทึกไม่ใช่ของช่องนี้',
    showManualCard: false,
    nextStep: 'ROTATE',
  },
  PUBLIC_BASE_URL_NOT_CONFIGURED: {
    message: 'ระบบยังไม่ทราบ URL สาธารณะของเซิร์ฟเวอร์ ผู้ดูแลระบบต้องตั้งค่า PUBLIC_BASE_URL',
    showManualCard: false,
    nextStep: 'CONTACT_OPERATOR',
  },
})

const FALLBACK = Object.freeze({
  message: 'เกิดข้อผิดพลาดขณะตั้งค่า Webhook กรุณาลองใหม่อีกครั้ง',
  showManualCard: true,
  nextStep: 'RETEST',
})

/**
 * @param {{endpoint?: string|null, active?: boolean, lastTestAt?: string|null,
 *   lastTestReason?: string|null, lastTestStatusCode?: number|null}|null} webhookState
 * @returns {{code: string, message: string, showManualCard: boolean, manualCardUrl: string|null, nextStep: string|null}}
 */
export function describeLineOaWebhookHealth(webhookState) {
  const state = webhookState && typeof webhookState === 'object' ? webhookState : {}
  const code = typeof state.lastTestReason === 'string' && state.lastTestReason ? state.lastTestReason : null
  if (!code) {
    return { code: 'NOT_REGISTERED', message: 'ยังไม่ได้ตั้งค่า Webhook', showManualCard: false, manualCardUrl: null, nextStep: 'REGISTER' }
  }
  const entry = REASONS[code] ?? FALLBACK
  const message = typeof entry.message === 'function' ? entry.message(state) : entry.message
  return {
    code,
    message,
    showManualCard: entry.showManualCard,
    manualCardUrl: entry.showManualCard ? (state.endpoint ?? null) : null,
    nextStep: entry.nextStep,
  }
}

export const LINE_OA_WEBHOOK_REASON_CODES = Object.freeze(Object.keys(REASONS))

/**
 * @req FR-228 — the Thai copy for a derived-quiescence refusal.
 * @param {{lastLegacyReceiptAt?: string|null}} [ctx]
 */
export function describeLineOaLegacyTransportActive({ lastLegacyReceiptAt } = {}) {
  const ago = typeof lastLegacyReceiptAt === 'string' && lastLegacyReceiptAt ? lastLegacyReceiptAt : 'ไม่ทราบเวลา'
  return {
    code: 'LINE_LEGACY_TRANSPORT_ACTIVE',
    message: `ยังมี transport เดิมรับข้อความอยู่ (ล่าสุด ${ago}) — หยุด Edge/CLI เดิมก่อน หรือกด "ตั้งค่า Webhook" อีกครั้ง`,
    nextStep: 'STOP_LEGACY_OR_RETEST',
  }
}
