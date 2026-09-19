// @req FR-190 — the console surface of transport reachability: turn the read
//   model's states into one Thai chip a shop owner can act on. Pure, so the
//   wording is testable without rendering anything.
// @spec ADR-061, SEC-009 — states only; the chip never names the other
//   endpoint, and never carries a credential.
// @tested tests/unit/fr190-transport-health-presentation.test.js

/** Tones the console maps to colour. `bad` means someone must act now. */
export const TRANSPORT_HEALTH_TONES = Object.freeze(['ok', 'warn', 'bad', 'muted'])

const EXCLUSION_LABELS = Object.freeze({
  PAUSED: 'พักการรับข้อความอยู่',
  NOT_SERVER_ENABLED: 'ยังไม่เปิดรับผ่าน Server',
  NOT_CONNECTED: 'ยังไม่เชื่อมต่อ',
  ARCHIVED: 'เก็บเข้าคลังแล้ว',
  NOT_FOUND: 'ไม่พบบัญชี',
})

const ENDPOINT_PROBLEMS = Object.freeze({
  MISMATCHED: { tone: 'bad', label: 'LINE ส่งไปที่อื่น', detail: 'ปลายทางใน LINE Developers Console ไม่ใช่ระบบนี้ — ข้อความจะไม่เข้ามาจนกว่าจะแก้ URL' },
  DISABLED: { tone: 'bad', label: 'ปิด webhook ใน LINE', detail: 'สวิตช์ Use webhook ในคอนโซลปิดอยู่ ระบบจึงไม่ได้รับข้อความ' },
})

const UNKNOWN_REASONS = Object.freeze({
  TRANSPORT_DISABLED: { tone: 'bad', label: 'Server ปิดรับ LINE', detail: 'deployment นี้ไม่ได้เปิด transport ของ LINE — ทุกข้อความจะถูกปฏิเสธ' },
  CREDENTIAL_UNAVAILABLE: { tone: 'warn', label: 'ตรวจปลายทางไม่ได้', detail: 'อ่านกุญแจของ channel ไม่ได้ จึงถาม LINE ไม่ได้ว่าตั้งปลายทางไว้ที่ใด' },
  PROVIDER_UNREACHABLE: { tone: 'warn', label: 'ตรวจปลายทางไม่ได้', detail: 'ติดต่อ LINE ไม่สำเร็จตอนตรวจ ครั้งถัดไปจะลองใหม่' },
})

/**
 * One chip per account.
 *
 * Order matters, and it is the lesson of 2026-09-11/12: an endpoint that points
 * somewhere else outranks any silence reading, because silence is the symptom
 * and the endpoint is the cause. A quiet shop and a misrouted channel look
 * identical until this line separates them.
 */
export function describeTransportHealth(health) {
  if (!health) return { tone: 'muted', label: 'ยังไม่ได้ตรวจ', detail: '' }
  if (health.monitored === false) {
    return { tone: 'muted', label: EXCLUSION_LABELS[health.reason] || 'ไม่ได้เฝ้าดู', detail: '' }
  }

  const endpointState = health.endpoint?.state
  const problem = ENDPOINT_PROBLEMS[endpointState]
  if (problem) return { ...problem }

  if (endpointState === 'UNKNOWN') {
    const reason = UNKNOWN_REASONS[health.endpoint?.reason]
    if (reason) return { ...reason }
    const provider = /^PROVIDER_\d+$/.test(health.endpoint?.reason || '') ? health.endpoint.reason.slice('PROVIDER_'.length) : null
    return {
      tone: 'warn',
      label: 'ตรวจปลายทางไม่ได้',
      detail: provider ? `LINE ตอบรหัส ${provider} ตอนถามว่าตั้งปลายทางไว้ที่ใด` : 'ยังไม่ทราบว่า LINE ตั้งปลายทางไว้ที่ใด',
    }
  }

  const silence = health.silence?.state
  const hours = health.silence?.ageMinutes == null ? null : Math.floor(health.silence.ageMinutes / 60)
  if (silence === 'SILENT') {
    return {
      tone: 'bad',
      label: hours == null ? 'ไม่มีข้อความเข้ามานาน' : `ไม่มีข้อความเข้า ${hours} ชม.`,
      detail: 'ปลายทางถูกต้อง แต่ไม่มีข้อความเข้ามาเกินเกณฑ์ — ลองส่งข้อความทดสอบเพื่อยืนยัน',
    }
  }
  if (silence === 'QUIET') {
    return {
      tone: 'warn',
      label: hours == null ? 'เงียบอยู่' : `เงียบ ${hours} ชม.`,
      detail: 'ปลายทางถูกต้อง ยังไม่ถึงเกณฑ์เตือน — อาจเป็นแค่ช่วงที่ไม่มีลูกค้าทัก',
    }
  }
  return { tone: 'ok', label: 'รับข้อความปกติ', detail: 'ปลายทางตรงกับระบบนี้ และเพิ่งมีข้อความเข้ามา' }
}
