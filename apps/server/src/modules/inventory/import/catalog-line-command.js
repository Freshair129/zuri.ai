import { CATALOG_INTAKE_MAX_ITEMS } from '../domain/catalog-intake'
import { isValidGtin } from '../domain/inventory-governance'

// @req FR-210 — the LINE converter of the catalogue intake (ADR-084 D4): a
//   deterministic `#sku` command, parsed without a model. `#sku` followed by
//   `key: value` lines (Thai or English keys, items separated by `---`) becomes
//   the same envelope items JSON and Excel produce; `#sku ยืนยัน <code>` and
//   `#sku ยกเลิก <code>` name a preview to commit or cancel. Like the Excel
//   reader it never judges a value — a misspelt policy or a GTIN with a wrong
//   check digit reaches the item schema and comes back as an INVALID item.
//   Unknown keys are the one thing it refuses itself, because silently
//   dropping a line a person typed would commit less than they meant.
//   The reply formatters are pure too, so the agent adapter only routes.
// @spec ADR-084 D1, D4; BR-009, BR-042; SDD-009, SDD-091
// @tested tests/unit/inventory-catalog-line-command.test.js

export const LINE_CATALOG_COMMAND = '#sku'
export const LINE_REPLY_MAX = 4800
const MAX_LISTED_ITEMS = 15

const KEY_ALIASES = Object.freeze({
  'sku.code': ['รหัส', 'รหัสsku', 'code', 'sku', 'skucode'],
  'sku.name': ['ชื่อ', 'ชื่อsku', 'name', 'skuname'],
  'master.code': ['สินค้าหลัก', 'รหัสสินค้าหลัก', 'master', 'mastercode'],
  'master.categoryCode': ['หมวด', 'หมวดหมู่', 'category', 'categorycode'],
  'master.names': ['ชื่อสินค้าหลัก', 'mastername'],
  'master.nameEn': ['ชื่อสินค้าหลักอังกฤษ', 'masternameen'],
  'master.nature': ['ประเภท', 'nature'],
  'master.variantAxes': ['แกน', 'แกนvariant', 'axes', 'variantaxes'],
  'sku.stockPolicy': ['นโยบาย', 'นโยบายสต๊อก', 'policy', 'stockpolicy'],
  'sku.trackingMode': ['ระบุหน่วย', 'การระบุหน่วย', 'tracking', 'trackingmode'],
  'sku.unit': ['หน่วย', 'หน่วยฐาน', 'unit'],
  'sku.color': ['สี', 'color'],
  'sku.material': ['วัสดุ', 'material'],
  'sku.variant': ['variant', 'ตัวเลือก'],
  'sku.safetyStock': ['safetystock', 'สต๊อกขั้นต่ำ', 'สต็อกขั้นต่ำ'],
  'sku.reorderPoint': ['จุดสั่งซื้อ', 'reorderpoint'],
  'sku.reorderQty': ['สั่งครั้งละ', 'reorderqty'],
  'sku.leadTimeDays': ['leadtime', 'leadtimedays', 'ระยะเวลาสั่ง'],
  'identifiers:BARCODE': ['บาร์โค้ด', 'barcode', 'gtin', 'ean'],
  'identifiers:SUPPLIER_CODE': ['รหัสซัพพลายเออร์', 'suppliercode', 'supplier'],
  'identifiers:MANUFACTURER_PART': ['รหัสผู้ผลิต', 'mpn', 'manufacturerpart'],
  unitConversions: ['หน่วยแปลง', 'conversion', 'conversions', 'unitconversions'],
  'sku.allowLookalike': ['อนุญาตซ้ำ', 'allowlookalike'],
})
const KEY_INDEX = new Map(Object.entries(KEY_ALIASES).flatMap(([path, aliases]) => aliases.map((alias) => [alias, path])))
const normalizeKey = (key) => key.normalize('NFC').toLowerCase().replace(/[\s_\-.()]/g, '')

const WORDS = Object.freeze({
  nature: { สินค้า: 'GOOD', good: 'GOOD', บริการ: 'SERVICE', service: 'SERVICE' },
  policy: { นับสต๊อก: 'TRACKED', นับสต็อก: 'TRACKED', นับ: 'TRACKED', tracked: 'TRACKED', ไม่นับสต๊อก: 'UNTRACKED', ไม่นับสต็อก: 'UNTRACKED', ไม่นับ: 'UNTRACKED', untracked: 'UNTRACKED', บริการ: 'SERVICE', service: 'SERVICE' },
  tracking: { รวม: 'NONE', none: 'NONE', ล็อต: 'LOT', lot: 'LOT', serial: 'SERIAL', ซีเรียล: 'SERIAL' },
})
const word = (table, value) => table[normalizeKey(value)] ?? value.toUpperCase()
const numberish = (value) => (/^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value)
const list = (value) => value.split(/[,;，]/).map((part) => part.trim()).filter(Boolean)

/**
 * Parse a LINE message. Returns null when the message is not a `#sku` command
 * (it then belongs to the normal answer), otherwise one of
 * `{ kind: 'HELP' }`, `{ kind: 'CONFIRM' | 'CANCEL', code }`, or
 * `{ kind: 'PREVIEW', items, unknownKeys }`.
 */
export function parseLineCatalogCommand(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.normalize('NFC').trim()
  if (!/^#sku(?=\s|$)/i.test(trimmed)) return null
  const rest = trimmed.slice(LINE_CATALOG_COMMAND.length).trim()
  if (!rest || /^(help|ช่วย|วิธีใช้)$/i.test(rest)) return { kind: 'HELP' }
  const action = rest.match(/^(ยืนยัน|confirm|ยกเลิก|cancel)\s+(CIT-[0-9A-F]{8})\s*$/i)
  if (action) return { kind: /^(ยืนยัน|confirm)$/i.test(action[1]) ? 'CONFIRM' : 'CANCEL', code: action[2].toUpperCase() }
  if (/^(ยืนยัน|confirm|ยกเลิก|cancel)(\s|$)/i.test(rest)) return { kind: 'HELP', reason: 'CODE_REQUIRED' }

  const items = []
  const unknownKeys = []
  let current = null
  // Line numbers are counted from the top of the message a person typed, so
  // "line 3" in a reply is the third line they see — the `#sku` line is line 1.
  const lines = trimmed.split(/\r?\n/)
  lines[0] = lines[0].replace(/^#sku/i, '')
  lines.forEach((line, lineIndex) => {
    const content = line.trim()
    if (!content) return
    if (/^-{3,}$/.test(content)) { current = null; return }
    const at = content.search(/[:：]/)
    if (at <= 0) { unknownKeys.push({ line: lineIndex + 1, key: content.slice(0, 40) }); return }
    const key = content.slice(0, at)
    const value = content.slice(at + 1).trim()
    const path = KEY_INDEX.get(normalizeKey(key))
    if (!path) { unknownKeys.push({ line: lineIndex + 1, key: key.trim().slice(0, 40) }); return }
    if (!current) { current = { ref: `รายการ ${items.length + 1}`, sku: {}, master: {} }; items.push(current) }
    if (!value) return
    if (path === 'master.names') { current.master.nameTh = value; current.master.nameEn = current.master.nameEn ?? value; return }
    if (path === 'master.nameEn') { current.master.nameEn = value; return }
    if (path === 'master.nature') { current.master.nature = word(WORDS.nature, value); return }
    if (path === 'master.variantAxes') { current.master.variantAxes = list(value); return }
    if (path === 'sku.stockPolicy') { current.sku.stockPolicy = word(WORDS.policy, value); return }
    if (path === 'sku.trackingMode') { current.sku.trackingMode = word(WORDS.tracking, value); return }
    if (['sku.safetyStock', 'sku.reorderPoint', 'sku.reorderQty', 'sku.leadTimeDays'].includes(path)) { current.sku[path.slice(4)] = numberish(value); return }
    if (path === 'sku.allowLookalike') { current.sku.allowLookalike = /^(ใช่|yes|true|y)$/i.test(value) ? true : /^(ไม่|no|false|n)$/i.test(value) ? false : value; return }
    if (path === 'sku.variant') {
      current.sku.variant = Object.fromEntries(list(value).map((piece) => {
        const eq = piece.indexOf('=')
        return eq < 0 ? [piece, ''] : [piece.slice(0, eq).trim(), piece.slice(eq + 1).trim()]
      }))
      return
    }
    if (path === 'unitConversions') {
      current.unitConversions = [...(current.unitConversions ?? []), ...list(value).map((piece) => {
        const eq = piece.indexOf('=')
        if (eq < 0) return { unit: piece }
        const factor = piece.slice(eq + 1).trim()
        return { unit: piece.slice(0, eq).trim(), factor: /^\d+$/.test(factor) ? Number(factor) : factor }
      })]
      return
    }
    if (path.startsWith('identifiers:')) {
      const kind = path.slice('identifiers:'.length)
      current.identifiers = [...(current.identifiers ?? []), ...list(value).map((code) => ({
        // A run of 8, 12, 13 or 14 digits is declared a GTIN so its check digit is verified — a typo is refused, not stored.
        kind: kind === 'BARCODE' && /^\d{8}$|^\d{12,14}$/.test(code) ? 'GTIN' : kind,
        value: code,
      }))]
      return
    }
    const [head, tail] = path.split('.')
    current[head][tail] = value
  })
  return { kind: 'PREVIEW', items: items.slice(0, CATALOG_INTAKE_MAX_ITEMS + 1), unknownKeys }
}

export const LINE_CATALOG_HELP = [
  'คำสั่งนำเข้าสินค้า (#sku)',
  'ส่งแบบนี้ ระบบจะค้นหา SKU เดิมจากบาร์โค้ด/รหัสก่อนเสมอ แล้วตอบผลตรวจกลับมา ยังไม่บันทึกจนกว่าจะยืนยัน',
  '',
  '#sku',
  'รหัส: TMB-BLK',
  'ชื่อ: แก้วเก็บความเย็น สีดำ',
  'สินค้าหลัก: PM-TUMBLER',
  'สี: ดำ',
  'บาร์โค้ด: 8850123456786',
  'หน่วยแปลง: BOX12=12',
  '---',
  'รหัส: TMB-RED',
  '...',
  '',
  'สินค้าหลักใหม่: เพิ่ม หมวด: <รหัสหมวด> และ ชื่อสินค้าหลัก: <ชื่อ>',
  'หัวข้ออื่น: วัสดุ, หน่วย, variant (size=M), นโยบาย (นับสต๊อก/ไม่นับสต๊อก), ประเภท (สินค้า/บริการ), แกน, รหัสซัพพลายเออร์, จุดสั่งซื้อ, อนุญาตซ้ำ',
  'ยืนยัน: #sku ยืนยัน CIT-XXXXXXXX · ยกเลิก: #sku ยกเลิก CIT-XXXXXXXX',
].join('\n')

const DECISION_WORD = Object.freeze({ CREATE: 'สร้างใหม่', MATCH: 'พบของเดิม', UNCHANGED: 'มีอยู่แล้ว', CONFLICT: 'ติดปัญหา', INVALID: 'ข้อมูลผิด' })

function additionsText(actions) {
  const identifiers = actions.filter((a) => a.type === 'ADD_IDENTIFIER').map((a) => a.payload.value)
  const conversions = actions.filter((a) => a.type === 'ADD_UNIT_CONVERSION').map((a) => `${a.payload.unit}=${a.payload.factor}`)
  return [identifiers.length ? `บาร์โค้ด/รหัส ${identifiers.join(', ')}` : '', conversions.length ? `หน่วย ${conversions.join(', ')}` : ''].filter(Boolean).join(' · ')
}

function itemLine(item, index) {
  const code = item.code ?? '(ไม่มีรหัส)'
  if (item.decision === 'CREATE') {
    const extra = additionsText(item.actions)
    return `${index}) ${code} — สร้าง SKU ใหม่ใต้ ${item.master?.code ?? '-'}${item.master?.created ? ' (สินค้าหลักใหม่)' : ''}${extra ? ` + ${extra}` : ''}`
  }
  if (item.decision === 'MATCH' || item.decision === 'UNCHANGED') {
    const by = item.matchedBy === 'IDENTIFIER' ? 'ตรงบาร์โค้ด/รหัสคู่ค้า' : 'ตรงรหัส SKU'
    const extra = additionsText(item.actions)
    return `${index}) ${code} — พบ SKU เดิม ${item.product?.code} (${by})${extra ? ` · เพิ่ม ${extra}` : ' · ไม่มีอะไรต้องเพิ่ม'}`
  }
  const first = item.issues[0]
  return `${index}) ${code} — ${DECISION_WORD[item.decision]}: ${first?.message ?? first?.code ?? ''}${item.issues.length > 1 ? ` (+${item.issues.length - 1})` : ''}`
}

const clip = (text) => (text.length <= LINE_REPLY_MAX ? text : `${text.slice(0, LINE_REPLY_MAX - 20)}\n…(ตัดข้อความ)`)
const MAX_ITEM_LINE = 240
const clipLine = (text) => (text.length <= MAX_ITEM_LINE ? text : `${text.slice(0, MAX_ITEM_LINE - 1)}…`)

/**
 * Header, item lines, footer — with the footer always kept. Item lines are
 * added while they fit; whatever does not fit is counted in one "and N more"
 * line, so the instruction to confirm or fix is never the thing cut off.
 */
function withBudget(header, itemLines, footer, totalItems) {
  const fixed = [...header, '', '', ...footer].join('\n').length + 80
  const kept = []
  let used = fixed
  for (const line of itemLines.slice(0, MAX_LISTED_ITEMS)) {
    if (used + line.length + 1 > LINE_REPLY_MAX) break
    kept.push(line)
    used += line.length + 1
  }
  const hidden = totalItems - kept.length
  const more = hidden > 0 ? [`…และอีก ${hidden} รายการ ดูทั้งหมดได้ในแท็บ Import ของคลังสินค้า`] : []
  return clip([...header, '', ...kept, ...more, '', ...footer].join('\n'))
}

/** The reply to a preview: counts, one line per item, then how to confirm — or why it cannot be. */
export function formatLineCatalogPreview(intake, { expiresInMinutes = 30 } = {}) {
  const plan = intake.plan
  const counts = plan.counts
  const header = [
    `ผลตรวจรายการสินค้า ${intake.code} (${counts.total} รายการ)`,
    `สร้างใหม่ ${counts.create} · พบของเดิม ${counts.match + counts.unchanged} · ติดปัญหา ${counts.conflict + counts.invalid}`,
  ]
  const footer = intake.status === 'COMMITTED' ? ['รายการนี้บันทึกไปแล้ว']
    : intake.status === 'CANCELLED' ? ['รายการนี้ถูกยกเลิกแล้ว']
      : plan.committable ? [`พิมพ์ "#sku ยืนยัน ${intake.code}" ภายใน ${expiresInMinutes} นาทีเพื่อบันทึก หรือ "#sku ยกเลิก ${intake.code}"`]
        : ['ยังบันทึกไม่ได้ — แก้รายการที่ติดปัญหาแล้วส่ง #sku ใหม่ทั้งชุด (บันทึกทั้งชุดหรือไม่บันทึกเลย)']
  return withBudget(header, plan.items.map((item, i) => clipLine(itemLine(item, i + 1))), footer, plan.items.length)
}

/** The reply after a commit. */
export function formatLineCatalogResult(intake) {
  const result = intake.result ?? { created: [], matched: [], unchanged: [], mastersCreated: [] }
  const lines = [
    `บันทึกแล้ว ${intake.code}`,
    `สร้าง SKU ใหม่ ${result.created.length}${result.mastersCreated.length ? ` (สินค้าหลักใหม่ ${result.mastersCreated.length})` : ''} · เพิ่มข้อมูลให้ SKU เดิม ${result.matched.length} · ไม่เปลี่ยน ${result.unchanged.length}`,
    ...result.created.slice(0, MAX_LISTED_ITEMS).map((row) => `+ ${row.code}`),
    ...result.matched.slice(0, MAX_LISTED_ITEMS).map((row) => `= ${row.productCode} (${row.additions} รายการที่เพิ่ม)`),
  ]
  return clip(lines.join('\n'))
}

/** The reply when the message named keys the command does not know. */
export function formatLineCatalogUnknownKeys(unknownKeys) {
  return clip([
    'ยังไม่ได้ตรวจ — มีหัวข้อที่ระบบไม่รู้จัก:',
    ...unknownKeys.slice(0, 10).map((entry) => `บรรทัด ${entry.line}: "${entry.key}"`),
    '',
    'พิมพ์ #sku เพื่อดูหัวข้อที่ใช้ได้',
  ].join('\n'))
}

const ERROR_REPLY = Object.freeze({
  INVENTORY_CATALOG_INTAKE_PLAN_STALE: 'แคตตาล็อกเปลี่ยนไปหลังตรวจ — ส่ง #sku ชุดเดิมอีกครั้งเพื่อตรวจใหม่',
  INVENTORY_CATALOG_INTAKE_NOT_COMMITTABLE: 'ยังบันทึกไม่ได้ เพราะมีรายการที่ติดปัญหา — แก้แล้วส่ง #sku ใหม่',
  INVENTORY_CATALOG_INTAKE_EXPIRED: 'ผลตรวจหมดอายุแล้ว — ส่ง #sku ชุดเดิมอีกครั้ง',
  INVENTORY_CATALOG_INTAKE_CANCELLED: 'รายการนี้ถูกยกเลิกไปแล้ว',
  INVENTORY_CATALOG_INTAKE_ALREADY_COMMITTED: 'รายการนี้บันทึกไปแล้ว ยกเลิกไม่ได้',
  INVENTORY_CATALOG_INTAKE_CORRELATION_REUSED: 'ข้อความนี้เคยถูกตรวจด้วยข้อมูลอื่นแล้ว — ส่ง #sku เป็นข้อความใหม่',
  INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT: 'มีการเปลี่ยนแปลงพร้อมกัน — ลองอีกครั้ง',
})

/** A refusal as a reply; a 404 says only that the code is not one this person can act on. */
export function formatLineCatalogError(error) {
  if (Number(error?.status) === 404) return 'ไม่พบรายการนี้ หรือรายการนี้ไม่ได้ตรวจโดยคุณ'
  if (ERROR_REPLY[error?.message]) return ERROR_REPLY[error.message]
  if (Array.isArray(error?.issues)) return `ข้อความยาวหรือรูปแบบไม่ถูกต้อง (${error.issues.length} จุด) — ส่งได้ครั้งละไม่เกิน ${CATALOG_INTAKE_MAX_ITEMS} รายการ`
  return 'ดำเนินการไม่สำเร็จ — ลองใหม่อีกครั้ง หรือทำผ่านหน้าคลังสินค้า'
}

/** Whether a value looks like a GTIN — exposed for the help text and tests. */
export const looksLikeGtin = (value) => typeof value === 'string' && /^\d{8}$|^\d{12,14}$/.test(value) && isValidGtin(value)
