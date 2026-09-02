// @req FR-139 — governed Asset Excel template and Google Sheets-ready export.
// @spec SDD-083, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js
import ExcelJS from 'exceljs'
import { ASSET_EVIDENCE_ROLES, ASSET_INTAKE_CHANNELS, ASSET_PROCUREMENT_REF_TYPES } from '@/lib/validation/enums'

export const ASSET_SHEETS = Object.freeze({
  assets: {
    title: 'Assets',
    note: 'หนึ่งแถวต่อ intake · correlationId ต้องไม่ซ้ำภายใน Business/source',
    columns: [
      ['correlationId', true, 24], ['origin', true, 26], ['name', true, 34], ['categoryCode', true, 20],
      ['quantity', true, 10], ['expiryControlled', true, 18], ['description', false, 36], ['brand', false, 18],
      ['model', false, 18], ['serialNumber', false, 22], ['lotId', false, 18], ['manufacturedOn', false, 16],
      ['expiresOn', false, 16], ['branchId', false, 22], ['locationCode', false, 18], ['locationName', false, 28],
      ['projectId', false, 24], ['workstreamId', false, 24], ['projectBusinessId', false, 24],
      ['acquisitionAmount', false, 18], ['residualValue', false, 16], ['usefulLifeMonths', false, 18],
      ['depreciationStartDate', false, 22], ['currency', false, 12],
    ],
  },
  evidence: {
    title: 'Evidence', note: 'อ้าง FileAsset ID ที่อัปโหลดแล้วเท่านั้น · ห้ามฝัง binary หรือ URL credential',
    columns: [['correlationId', true, 24], ['fileAssetId', true, 36], ['role', true, 22], ['paymentReference', false, 24]],
  },
  procurementRefs: {
    title: 'ProcurementRefs', note: 'PR/PO เป็น typed reference · Asset Management ไม่แก้ข้อมูล Procurement',
    columns: [['correlationId', true, 24], ['type', true, 18], ['system', true, 18], ['value', true, 24], ['lineValue', false, 16]],
  },
  lookups: { title: 'Lookups', note: 'รายการนี้สร้างจาก validation authority ของระบบ', columns: [['list', true, 28], ['value', true, 32]] },
})

const ORIGINS = ['PROCUREMENT_PURCHASE', 'DONATION', 'TRANSFER_IN', 'OPENING_BALANCE', 'OTHER']

function setupSheet(workbook, spec, color) {
  const sheet = workbook.addWorksheet(spec.title)
  sheet.columns = spec.columns.map(([key, , width]) => ({ key, width }))
  sheet.mergeCells(1, 1, 1, spec.columns.length)
  sheet.getCell(1, 1).value = spec.note
  sheet.getCell(1, 1).font = { italic: true, color: { argb: 'FF5D4037' } }
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F0' } }
  spec.columns.forEach(([key, required], index) => {
    const cell = sheet.getCell(2, index + 1)
    cell.value = required ? `${key}*` : key
    cell.font = { bold: true, color: { argb: required ? 'FF555500' : 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFFFFDE7' : color } }
  })
  sheet.views = [{ state: 'frozen', ySplit: 2 }]
  return sheet
}

function addList(sheet, columnName, values) {
  const index = sheet.columns.findIndex((column) => column.key === columnName) + 1
  if (!index) return
  const letter = String.fromCharCode(64 + index)
  sheet.dataValidations.add(`${letter}3:${letter}502`, {
    type: 'list', allowBlank: false, formulae: [`"${values.join(',')}"`],
    showErrorMessage: true, errorTitle: 'ค่าไม่อยู่ในรายการ', error: 'เลือกจาก dropdown เท่านั้น',
  })
}

function populateExample(worksheets, rows) {
  for (const row of rows || []) {
    const { paymentFileAssetId, paymentReference, prSystem, prValue, prLineValue, poSystem, poValue, poLineValue, ...asset } = row
    worksheets.assets.addRow(asset)
    if (paymentFileAssetId) worksheets.evidence.addRow({ correlationId: row.correlationId, fileAssetId: paymentFileAssetId, role: 'PAYMENT_PROOF', paymentReference })
    if (prValue) worksheets.procurementRefs.addRow({ correlationId: row.correlationId, type: 'PR', system: prSystem || 'ERP', value: prValue, lineValue: prLineValue })
    if (poValue) worksheets.procurementRefs.addRow({ correlationId: row.correlationId, type: 'PO', system: poSystem || 'ERP', value: poValue, lineValue: poLineValue })
  }
}

export function buildAssetTemplateWorkbook({ exampleRows = [] } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'zuri-ai Asset Management'
  workbook.created = new Date()
  const readme = workbook.addWorksheet('อ่านก่อน (Read Me)')
  readme.columns = [{ width: 110 }]
  ;[
    'Zuri Asset Intake 1.0 — zuri-ai เป็น source of truth; Excel/Google Sheets เป็น snapshot สำหรับ preview',
    '1. กรอก Assets หนึ่งแถวต่อ correlationId แล้วผูก Evidence และ ProcurementRefs ด้วย correlationId เดียวกัน',
    '2. PROCUREMENT_PURCHASE ต้องมี PAYMENT_PROOF, PR และ PO; สินค้าควบคุมอายุต้องมี lotId และ expiresOn',
    '3. FileAsset ID ต้องอัปโหลดผ่านระบบก่อน — ห้ามใส่ URL, token, secret หรือ binary ใน workbook',
    '4. Import รายงานชีต/แถว/คอลัมน์และไม่บันทึกข้อมูลโดยอัตโนมัติ',
  ].forEach((value, index) => { readme.getCell(index + 1, 1).value = value })
  readme.getCell(1, 1).font = { bold: true, size: 12 }

  const worksheets = {
    assets: setupSheet(workbook, ASSET_SHEETS.assets, 'FF1F4E79'),
    evidence: setupSheet(workbook, ASSET_SHEETS.evidence, 'FF0F6E56'),
    procurementRefs: setupSheet(workbook, ASSET_SHEETS.procurementRefs, 'FF854F0B'),
    lookups: setupSheet(workbook, ASSET_SHEETS.lookups, 'FF5F5E5A'),
  }
  addList(worksheets.assets, 'origin', ORIGINS)
  addList(worksheets.assets, 'expiryControlled', ['TRUE', 'FALSE'])
  addList(worksheets.evidence, 'role', ASSET_EVIDENCE_ROLES)
  addList(worksheets.procurementRefs, 'type', ASSET_PROCUREMENT_REF_TYPES)
  for (const value of ORIGINS) worksheets.lookups.addRow({ list: 'origin', value })
  for (const value of ASSET_EVIDENCE_ROLES) worksheets.lookups.addRow({ list: 'evidenceRole', value })
  for (const value of ASSET_PROCUREMENT_REF_TYPES) worksheets.lookups.addRow({ list: 'procurementRefType', value })
  for (const value of ASSET_INTAKE_CHANNELS) worksheets.lookups.addRow({ list: 'sourceChannel', value })
  populateExample(worksheets, exampleRows)
  return workbook
}

export function buildAssetExportWorkbook(intakes = []) {
  const rows = intakes.map((intake) => {
    let envelope = {}
    try { envelope = JSON.parse(intake.normalizedEnvelopeJson || '{}') } catch {}
    return {
      correlationId: envelope.source?.correlationId || intake.sourceCorrelationId,
      origin: envelope.origin || intake.origin,
      name: envelope.item?.name || '', categoryCode: envelope.item?.categoryCode || '',
      quantity: envelope.item?.quantity || '', expiryControlled: envelope.item?.expiryControlled ? 'TRUE' : 'FALSE',
      description: envelope.item?.description || '', brand: envelope.item?.brand || '', model: envelope.item?.model || '',
      serialNumber: envelope.item?.serialNumber || '', lotId: envelope.lot?.lotId || '', manufacturedOn: envelope.lot?.manufacturedOn || '',
      expiresOn: envelope.lot?.expiresOn || '', branchId: envelope.location?.branchId || '',
      locationCode: envelope.location?.locationCode || '', locationName: envelope.location?.locationName || '',
      projectId: envelope.projectAllocation?.projectId || '', workstreamId: envelope.projectAllocation?.workstreamId || '',
      projectBusinessId: envelope.projectAllocation?.projectBusinessId || '', acquisitionAmount: envelope.depreciation?.acquisitionAmount || '',
      residualValue: envelope.depreciation?.residualValue || '', usefulLifeMonths: envelope.depreciation?.usefulLifeMonths || '',
      depreciationStartDate: envelope.depreciation?.startDate || '', currency: envelope.depreciation?.currency || '',
    }
  })
  const workbook = buildAssetTemplateWorkbook({ exampleRows: rows })
  workbook.getWorksheet('อ่านก่อน (Read Me)').getCell(7, 1).value = `Export snapshot · authority=zuri-ai · schema=1.0 · exportedAt=${new Date().toISOString()}`
  const evidenceSheet = workbook.getWorksheet('Evidence')
  const referencesSheet = workbook.getWorksheet('ProcurementRefs')
  for (const intake of intakes) {
    let envelope = {}
    try { envelope = JSON.parse(intake.normalizedEnvelopeJson || '{}') } catch {}
    const correlationId = envelope.source?.correlationId || intake.sourceCorrelationId
    for (const evidence of intake.evidence || []) {
      evidenceSheet.addRow({
        correlationId,
        fileAssetId: evidence.fileAssetId,
        role: evidence.role,
        paymentReference: evidence.paymentReference || '',
      })
    }
    for (const reference of intake.procurementRefs || []) {
      referencesSheet.addRow({
        correlationId,
        type: reference.type,
        system: reference.system,
        value: reference.value,
        lineValue: reference.lineValue || '',
      })
    }
  }
  return workbook
}
