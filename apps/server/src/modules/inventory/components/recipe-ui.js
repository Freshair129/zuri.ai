// @req FR-156, FR-177 — prepare the exact create, UPDATE, ARCHIVE and build payloads
//   accepted by inventory-recipe-service, and validate component lines first.
// @spec BR-002; SEC-001
// @tested tests/unit/inventory-recipe-ui.test.js

const textValue = (value) => String(value ?? '').trim()
const optionalText = (value) => textValue(value) || undefined

function recipeLinePayload(line) {
  const result = {
    componentProductId: textValue(line?.componentProductId),
    qty: Number(line?.qty),
    fixed: Boolean(line?.fixed),
  }
  const unit = optionalText(line?.unit)
  const note = optionalText(line?.note)
  if (unit !== undefined) result.unit = unit
  if (note !== undefined) result.note = note
  return result
}

export function buildRecipeCreatePayload({
  businessId,
  code,
  productId,
  name,
  batchSize,
  yieldQty,
  unit,
  notes,
  scrapAllowanceFactor,
  lines,
}) {
  const result = {
    businessId: textValue(businessId),
    code: textValue(code),
    productId: textValue(productId),
    name: textValue(name),
    batchSize: Number(batchSize),
    lines: (Array.isArray(lines) ? lines : []).map(recipeLinePayload),
  }
  if (yieldQty !== '' && yieldQty !== null && yieldQty !== undefined) result.yieldQty = Number(yieldQty)
  const outputUnit = optionalText(unit)
  const recipeNotes = optionalText(notes)
  if (outputUnit !== undefined) result.unit = outputUnit
  if (recipeNotes !== undefined) result.notes = recipeNotes
  if (scrapAllowanceFactor !== '' && scrapAllowanceFactor !== null && scrapAllowanceFactor !== undefined) {
    result.scrapAllowanceFactor = Number(scrapAllowanceFactor)
  }
  return result
}

export function buildRecipeUpdatePayload({ version, name, yieldQty, unit, notes, scrapAllowanceFactor, lines }) {
  return {
    action: 'UPDATE',
    version: Number(version),
    fields: {
      name: textValue(name),
      yieldQty: Number(yieldQty),
      unit: textValue(unit),
      notes: optionalText(notes) ?? null,
      scrapAllowanceFactor: Number(scrapAllowanceFactor),
      lines: (Array.isArray(lines) ? lines : []).map(recipeLinePayload),
    },
  }
}

export function buildRecipeArchivePayload(version) {
  return { action: 'ARCHIVE', version: Number(version) }
}

export function buildRecipeBuildPayload({ businessId, quantity, outputLotCode }) {
  const result = {
    businessId: textValue(businessId),
    quantity: Number(quantity),
  }
  const lotCode = optionalText(outputLotCode)
  if (lotCode !== undefined) result.outputLotCode = lotCode
  return result
}

export function validateRecipeLines(lines, outputProductId) {
  const rows = Array.isArray(lines) ? lines : []
  const issues = []
  if (rows.length === 0) return ['เพิ่มส่วนประกอบอย่างน้อย 1 รายการ']
  if (rows.length > 200) issues.push('สูตรมีส่วนประกอบได้ไม่เกิน 200 รายการ')

  const seen = new Set()
  rows.forEach((line, index) => {
    const number = index + 1
    const productId = textValue(line?.componentProductId)
    const quantity = Number(line?.qty)
    const unit = textValue(line?.unit)
    const note = textValue(line?.note)

    if (!productId) issues.push('กรุณาเลือก Product ของส่วนประกอบรายการที่ ' + number)
    if (productId && productId === textValue(outputProductId)) {
      issues.push('Product ผลลัพธ์ห้ามเป็นส่วนประกอบของสูตรเดียวกัน')
    }
    if (productId && seen.has(productId)) issues.push('เลือก Product ซ้ำในสูตรเดียวกันไม่ได้')
    if (productId) seen.add(productId)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push('จำนวนต่อ batch ของส่วนประกอบรายการที่ ' + number + ' ต้องมากกว่า 0')
    }
    if (unit.length > 20) issues.push('หน่วยของส่วนประกอบรายการที่ ' + number + ' ยาวได้ไม่เกิน 20 ตัวอักษร')
    if (note.length > 300) issues.push('หมายเหตุของส่วนประกอบรายการที่ ' + number + ' ยาวได้ไม่เกิน 300 ตัวอักษร')
  })

  return issues
}

export function resetRecipeDraft() {
  return {
    code: '',
    name: '',
    productId: '',
    batchSize: '',
    yieldQty: '',
    unit: '',
    notes: '',
    scrapAllowanceFactor: '0',
    lines: [{ componentProductId: '', qty: '', unit: '', fixed: false, note: '' }],
  }
}

export const RECIPE_ERROR_MESSAGES = Object.freeze({
  PRODUCT_RECIPE_CODE_TAKEN: 'รหัสสูตรนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น',
  PRODUCT_RECIPE_BATCH_TAKEN: 'มีสูตรของ Product นี้ที่ขนาด batch เดียวกันอยู่แล้ว',
  PRODUCT_RECIPE_SELF_REFERENCE: 'Product ผลลัพธ์ห้ามเป็นส่วนประกอบของสูตรเดียวกัน',
  PRODUCT_RECIPE_VERSION_CONFLICT: 'สูตรถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก',
  PRODUCT_RECIPE_ARCHIVED: 'สูตรนี้ถูกเก็บถาวรแล้ว จึงแก้ไขหรือ Build ไม่ได้',
  PRODUCT_NOT_FOUND: 'ไม่พบ Product ใน Business นี้',
  PRODUCT_ARCHIVED: 'Product ที่เลือกถูกเก็บถาวรแล้ว',
  INVENTORY_RECIPE_SHORTAGE: 'สต๊อกส่วนประกอบไม่พอสำหรับจำนวนที่ต้องการผลิต',
  INVENTORY_RECIPE_SERIAL_COMPONENT: 'Build ไม่รองรับส่วนประกอบที่ติดตามแบบ Serial',
  INVENTORY_RECIPE_SERIAL_OUTPUT: 'Build ไม่รองรับ Product ผลลัพธ์ที่ติดตามแบบ Serial',
  INVENTORY_LOT_REQUIRED: 'Product ผลลัพธ์ติดตามแบบ Lot กรุณาระบุรหัส Lot',
  INVENTORY_PRODUCT_NOT_FOUND: 'ไม่พบ Product ใน Business นี้',
  INVENTORY_PRODUCT_ARCHIVED: 'Product นี้ถูกเก็บถาวรแล้ว',
  INVENTORY_PRODUCT_PHASED_OUT: 'Product นี้เลิกขายแล้ว จึงบันทึกการเคลื่อนไหวไม่ได้',
  INVENTORY_INSUFFICIENT_STOCK: 'สต๊อกไม่พอสำหรับการจ่ายส่วนประกอบ',
  INVENTORY_LOT_INSUFFICIENT_STOCK: 'สต๊อกใน Lot ไม่พอสำหรับการจ่ายส่วนประกอบ',
  INVENTORY_LOT_STORAGE_EXPIRED: 'Lot ของส่วนประกอบเกินอายุจัดเก็บที่กำหนด',
  INVENTORY_LOT_NOT_TRACKED: 'Product นี้ไม่ได้ติดตามสต๊อกแบบ Lot',
  INVENTORY_LEDGER_FENCE_EXHAUSTED: 'ระบบ stock ledger กำลังมีรายการพร้อมกันมากเกินไป กรุณาลองใหม่',
  PRODUCT_LOT_CODE_TAKEN: 'รหัส Lot นี้ถูกใช้แล้ว กรุณาระบุรหัสอื่น',
  PRODUCT_LOT_NOT_FOUND: 'ไม่พบ Lot ของ Product นี้',
  PRODUCT_LOT_CLOSED: 'Lot นี้ปิดแล้วและรับของเข้าเพิ่มไม่ได้',
  INVENTORY_SERIAL_ALREADY_IN_STOCK: 'Serial นี้อยู่ในสต๊อกแล้ว',
  INVENTORY_SERIAL_NOT_IN_STOCK: 'ไม่พบ Serial นี้ในสต๊อก',
  INVENTORY_UNIT_UNKNOWN: 'หน่วยของส่วนประกอบนี้ยังไม่ได้กำหนด',
  FACTORY_NOT_FOUND: 'ไม่พบ Factory ที่ระบุ',
  'Business not found': 'ไม่พบรายการใน Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ',
  'Validation failed': 'ข้อมูลไม่ถูกต้อง กรุณาตรวจช่องที่ระบุ',
})

export function recipeErrorMessage(error) {
  const payload = error?.payload ?? error
  const code = typeof payload === 'string'
    ? payload
    : payload?.error ?? error?.message ?? ''
  const status = Number(error?.status ?? payload?.status)

  if (status === 404 || code === 'Business not found') {
    return 'ไม่พบสูตรหรือ Business นี้ หรือคุณไม่มีสิทธิ์ดำเนินการ'
  }
  if (RECIPE_ERROR_MESSAGES[code]) {
    if (code === 'Validation failed') {
      const issues = Array.isArray(payload?.issues) ? payload.issues : []
      return issues.length
        ? 'ข้อมูลไม่ถูกต้อง: ' + issues.join(' · ')
        : RECIPE_ERROR_MESSAGES[code]
    }
    return RECIPE_ERROR_MESSAGES[code]
  }
  return 'ดำเนินการกับสูตรไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่'
}
