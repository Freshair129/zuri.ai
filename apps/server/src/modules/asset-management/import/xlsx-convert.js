// @req FR-139 — Asset workbook preview with sheet/row/column errors.
// @spec SDD-083, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js
import ExcelJS from 'exceljs'
import { ASSET_SHEETS } from './xlsx-template'
import { assetCellText, assetRowToEnvelope } from './asset-row-adapter'
import { validateAssetIntake } from '../domain/asset-intake'

const DATA_ROW = 3

function rowsFor(sheet, spec) {
  const rows = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < DATA_ROW) return
    const value = {}
    spec.columns.forEach(([key], index) => { value[key] = assetCellText(row.getCell(index + 1).value) })
    if (Object.values(value).some(Boolean)) rows.push({ rowNumber, value })
  })
  return rows
}

function validateHeader(sheet, spec, errors) {
  spec.columns.forEach(([key], index) => {
    const actual = assetCellText(sheet.getCell(2, index + 1).value).replace(/\*$/, '')
    if (actual !== key) errors.push(`ชีต ${spec.title} แถว 2 คอลัมน์ ${index + 1}: ต้องเป็น ${key}`)
  })
}

export async function assetWorkbookToEnvelopes(buffer, { businessId } = {}) {
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer) } catch { return { envelopes: [], validations: [], errors: ['ไฟล์ไม่ใช่ .xlsx ที่อ่านได้'] } }
  const errors = []
  const found = {}
  for (const [key, spec] of Object.entries(ASSET_SHEETS)) {
    const sheet = workbook.getWorksheet(spec.title)
    if (!sheet) { errors.push(`ไม่พบชีต ${spec.title}`); continue }
    found[key] = sheet
    validateHeader(sheet, spec, errors)
  }
  if (errors.length) return { envelopes: [], validations: [], errors }
  const assets = rowsFor(found.assets, ASSET_SHEETS.assets)
  if (assets.length > 500) errors.push('ชีต Assets มีได้ไม่เกิน 500 แถว')
  const evidence = rowsFor(found.evidence, ASSET_SHEETS.evidence)
  const refs = rowsFor(found.procurementRefs, ASSET_SHEETS.procurementRefs)
  const envelopes = []
  const validations = []
  for (const { rowNumber, value } of assets.slice(0, 500)) {
    const correlationId = value.correlationId
    const envelope = assetRowToEnvelope(value, {
      businessId, channel: 'EXCEL',
      evidenceRows: evidence.filter((item) => item.value.correlationId === correlationId).map((item) => item.value),
      procurementRows: refs.filter((item) => item.value.correlationId === correlationId).map((item) => item.value),
    })
    const validation = validateAssetIntake(envelope, { trustedTenantId: 'preview', trustedBusinessId: businessId })
    if (!validation.ok) {
      for (const issue of validation.issues) errors.push(`ชีต Assets แถว ${rowNumber} คอลัมน์ ${issue.path || '(row)'}: ${issue.code} ${issue.message}`)
    }
    envelopes.push(envelope)
    validations.push(validation)
  }
  return { envelopes, validations, errors }
}
