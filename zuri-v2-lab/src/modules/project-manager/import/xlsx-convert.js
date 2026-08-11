// @req FR-018 — xlsx → PlanEnvelope converter with per-row errors.
// Output feeds the SAME validate → dry-run → commit pipeline as every other
// intake surface (BR-009). The converter never touches the database.
// @tested tests/integration/xlsx-intake.test.js

import ExcelJS from 'exceljs'
import { SHEETS, METRIC_COLUMNS } from './xlsx-template'
import { MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'

const DATA_START_ROW = 3 // row 1 = note, row 2 = header

function cellText(cell) {
  if (cell == null) return ''
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'object') {
    // ExcelJS rich values: formulas, rich text, hyperlinks.
    if (v.richText) return v.richText.map((r) => r.text).join('')
    if (v.text) return String(v.text)
    if (v.result != null) return String(v.result)
    return String(cell.text ?? '')
  }
  return String(v)
}

function rowValues(sheetSpec, row) {
  const values = {}
  sheetSpec.columns.forEach((col, idx) => {
    values[col.key] = cellText(row.getCell(idx + 1)).trim()
  })
  return values
}

function num(value) {
  if (value === '' || value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Parse an uploaded workbook buffer into { envelope, errors }.
 * errors: array of "ชีต X แถว N: message" strings. Empty errors = usable envelope.
 */
export async function workbookToEnvelope(buffer) {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(buffer)
  } catch {
    return { envelope: null, errors: ['ไฟล์นี้ไม่ใช่ .xlsx ที่อ่านได้ — ใช้แบบฟอร์มที่ดาวน์โหลดจากระบบ'] }
  }

  const errors = []
  const err = (sheet, rowNo, message) => errors.push(`ชีต ${sheet} แถว ${rowNo}: ${message}`)

  const readRows = (sheetKey) => {
    const spec = SHEETS[sheetKey]
    const ws = wb.getWorksheet(spec.title)
    if (!ws) return { spec, rows: [], missing: true }
    const rows = []
    ws.eachRow((row, rowNumber) => {
      if (rowNumber < DATA_START_ROW) return
      const values = rowValues(spec, row)
      if (Object.values(values).every((v) => v === '')) return // blank row
      rows.push({ rowNumber, values })
    })
    return { spec, rows, missing: false }
  }

  const requireFields = (sheetTitle, spec, rows) => {
    for (const { rowNumber, values } of rows) {
      for (const col of spec.columns) {
        if (col.required && values[col.key] === '') {
          err(sheetTitle, rowNumber, `คอลัมน์ ${col.key} จำเป็นต้องกรอก`)
        }
      }
    }
  }

  // ---- Project (exactly one row) -------------------------------------------
  const projectSheet = readRows('project')
  if (projectSheet.missing) {
    return { envelope: null, errors: ['ไม่พบชีต Project — ใช้แบบฟอร์มที่ดาวน์โหลดจากระบบ'] }
  }
  if (projectSheet.rows.length === 0) errors.push('ชีต Project: ต้องกรอกอย่างน้อย 1 แถว')
  if (projectSheet.rows.length > 1) errors.push('ชีต Project: กรอกได้แถวเดียว')
  requireFields('Project', projectSheet.spec, projectSheet.rows)
  const p = projectSheet.rows[0]?.values || {}

  // ---- Workstreams ---------------------------------------------------------
  const wsSheet = readRows('workstreams')
  requireFields('Workstreams', wsSheet.spec, wsSheet.rows)
  if (!wsSheet.missing && wsSheet.rows.length === 0) {
    errors.push('ชีต Workstreams: ต้องมีอย่างน้อย 1 สายงาน')
  }
  const workstreamByCode = new Map()
  for (const { rowNumber, values } of wsSheet.rows) {
    if (workstreamByCode.has(values.code)) {
      err('Workstreams', rowNumber, `code "${values.code}" ซ้ำในไฟล์`)
      continue
    }
    const weight = num(values.progressWeight)
    if (Number.isNaN(weight)) err('Workstreams', rowNumber, 'progressWeight ต้องเป็นตัวเลข')
    workstreamByCode.set(values.code, {
      code: values.code,
      name: values.name,
      executionMode: values.executionMode,
      // Envelope schema requires a strategy — blank cell falls back to the
      // mode's canonical default (same table the wizard uses).
      progressStrategy: values.progressStrategy || MODE_DEFAULT_STRATEGY[values.executionMode],
      progressWeight: weight === undefined || Number.isNaN(weight) ? undefined : weight,
      containers: [],
      items: [],
      milestones: [],
      gates: [],
      _row: rowNumber,
    })
  }

  const attach = (sheetTitle, values, rowNumber, kind, record) => {
    const target = workstreamByCode.get(values.workstreamCode)
    if (!target) {
      err(sheetTitle, rowNumber, `workstreamCode "${values.workstreamCode}" ไม่มีในชีต Workstreams`)
      return
    }
    target[kind].push(record)
  }

  // ---- Containers ----------------------------------------------------------
  const contSheet = readRows('containers')
  requireFields('Containers', contSheet.spec, contSheet.rows)
  for (const { rowNumber, values } of contSheet.rows) {
    attach('Containers', values, rowNumber, 'containers', {
      code: values.code,
      parentCode: values.parentCode || undefined,
      subtype: values.subtype,
      title: values.title,
      status: values.status || undefined,
    })
  }

  // ---- Items ---------------------------------------------------------------
  const itemSheet = readRows('items')
  requireFields('Items', itemSheet.spec, itemSheet.rows)
  for (const { rowNumber, values } of itemSheet.rows) {
    const metrics = {}
    for (const key of METRIC_COLUMNS) {
      const v = num(values[key])
      if (v === undefined) continue
      if (Number.isNaN(v)) err('Items', rowNumber, `${key} ต้องเป็นตัวเลข`)
      else metrics[key] = v
    }
    const weight = num(values.weight)
    const numericValue = num(values.numericValue)
    const probability = num(values.probability)
    if (Number.isNaN(weight)) err('Items', rowNumber, 'weight ต้องเป็นตัวเลข')
    if (Number.isNaN(numericValue)) err('Items', rowNumber, 'numericValue ต้องเป็นตัวเลข')
    if (Number.isNaN(probability)) err('Items', rowNumber, 'probability ต้องเป็นตัวเลข 0 ถึง 1')
    attach('Items', values, rowNumber, 'items', {
      code: values.code,
      containerCode: values.containerCode || undefined,
      subtype: values.subtype,
      title: values.title,
      status: values.status || undefined,
      weight: Number.isNaN(weight) ? undefined : weight,
      numericValue: Number.isNaN(numericValue) ? undefined : numericValue,
      probability: Number.isNaN(probability) ? undefined : probability,
      metrics: Object.keys(metrics).length ? metrics : undefined,
    })
  }

  // ---- Milestones / Gates --------------------------------------------------
  const msSheet = readRows('milestones')
  requireFields('Milestones', msSheet.spec, msSheet.rows)
  for (const { rowNumber, values } of msSheet.rows) {
    const weight = num(values.weight)
    if (Number.isNaN(weight)) err('Milestones', rowNumber, 'weight ต้องเป็นตัวเลข')
    attach('Milestones', values, rowNumber, 'milestones', {
      code: values.code,
      title: values.title,
      status: values.status || undefined,
      weight: Number.isNaN(weight) ? undefined : weight,
    })
  }

  const gateSheet = readRows('gates')
  requireFields('Gates', gateSheet.spec, gateSheet.rows)
  for (const { rowNumber, values } of gateSheet.rows) {
    let required
    if (values.required !== '') {
      const flag = values.required.toUpperCase()
      if (flag !== 'TRUE' && flag !== 'FALSE') err('Gates', rowNumber, 'required ต้องเป็น TRUE หรือ FALSE')
      else required = flag === 'TRUE'
    }
    attach('Gates', values, rowNumber, 'gates', {
      code: values.code,
      title: values.title,
      status: values.status || undefined,
      required,
    })
  }

  // ---- Dependencies / Repositories -----------------------------------------
  const depSheet = readRows('dependencies')
  requireFields('Dependencies', depSheet.spec, depSheet.rows)
  const dependencies = depSheet.rows.map(({ values }) => ({
    sourceRef: values.sourceRef,
    targetRef: values.targetRef,
    type: values.type,
  }))

  const repoSheet = readRows('repositories')
  requireFields('Repositories', repoSheet.spec, repoSheet.rows)
  const repositories = repoSheet.rows.map(({ values }) => ({
    code: values.code,
    provider: values.provider,
    fullName: values.fullName || undefined,
    url: values.url || undefined,
    role: values.role || undefined,
    pathScope: values.pathScope || undefined,
  }))

  if (errors.length > 0) return { envelope: null, errors }

  const envelope = {
    schemaVersion: '1.0',
    generatedBy: 'zuri-v2 xlsx template',
    project: {
      code: p.code,
      name: p.name,
      description: p.description || undefined,
      type: p.type || undefined,
      status: p.status || undefined,
    },
    workstreams: [...workstreamByCode.values()].map(({ _row, ...ws }) => ws),
    ...(repositories.length ? { repositories } : {}),
    ...(dependencies.length ? { dependencies } : {}),
  }
  return { envelope, errors: [] }
}
