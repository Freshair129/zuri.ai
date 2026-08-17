// @req FR-018 — Excel template generator, built from the Zod enum source of
// truth (src/lib/validation/enums.js) so the workbook can never drift from
// the app. Pattern carried over from Zuri v0.1 (import-data generators):
// per-entity sheets, colored required headers, dropdowns, note rows.
// @tested tests/integration/xlsx-intake.test.js

import ExcelJS from 'exceljs'
import {
  EXECUTION_MODES,
  PROGRESS_STRATEGIES,
  PROJECT_STATUSES,
  CONTAINER_STATUSES,
  WORK_STATUSES,
  MILESTONE_STATUSES,
  GATE_STATUSES,
  CONTAINER_SUBTYPES,
  ITEM_SUBTYPES,
  DEPENDENCY_TYPES,
} from '@/lib/validation/enums'

// Common metric columns so paper-copiers never have to write JSON.
// Non-empty values are folded into item.metrics on conversion.
export const METRIC_COLUMNS = [
  'recordsTotal', 'processed', 'validated', 'failed', 'reconciled',
  'leads', 'conversions', 'revenue', 'spend',
  'slaMet', 'slaTotal', 'incidents', 'backlog',
]

const HEADER_COLORS = {
  project: 'FF1F4E79',
  workstreams: 'FFB86A08',
  containers: 'FF4A148C',
  items: 'FF1B5E20',
  milestones: 'FF0F6E56',
  gates: 'FF854F0B',
  dependencies: 'FF3D7A9E',
  repositories: 'FF5F5E5A',
}

const REQUIRED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFDE7' } }

export const SHEETS = {
  project: {
    title: 'Project',
    note: 'กรอกแถวเดียว: โปรเจกต์ที่จะสร้าง/อัปเดต (code ซ้ำ = อัปเดต)',
    columns: [
      { key: 'code', required: true, width: 22, hint: 'เช่น PRJ-OPEN-CNX' },
      { key: 'name', required: true, width: 40 },
      { key: 'description', width: 46 },
      { key: 'type', width: 16 },
      { key: 'status', width: 14, list: PROJECT_STATUSES },
    ],
  },
  workstreams: {
    title: 'Workstreams',
    note: 'สายงานของโปรเจกต์ — executionMode เลือกจาก dropdown เท่านั้น',
    columns: [
      { key: 'code', required: true, width: 22, hint: 'เช่น WST-LEGAL' },
      { key: 'name', required: true, width: 36 },
      { key: 'executionMode', required: true, width: 24, list: EXECUTION_MODES },
      { key: 'progressStrategy', width: 24, list: PROGRESS_STRATEGIES, hint: 'เว้นว่าง = ค่า default ของโหมด' },
      { key: 'progressWeight', width: 15 },
    ],
  },
  containers: {
    title: 'Containers',
    note: 'กลุ่มงาน (sprint / stage / pipeline / wave / phase / period / site)',
    columns: [
      { key: 'code', required: true, width: 22 },
      { key: 'workstreamCode', required: true, width: 22, hint: 'ต้องตรงกับ code ในชีต Workstreams' },
      { key: 'parentCode', width: 20 },
      { key: 'subtype', required: true, width: 22, list: CONTAINER_SUBTYPES },
      { key: 'title', required: true, width: 36 },
      { key: 'status', width: 14, list: CONTAINER_STATUSES },
    ],
  },
  items: {
    title: 'Items',
    note: 'งานย่อย — คอลัมน์ metric กรอกเฉพาะที่เกี่ยวกับโหมดนั้น (เช่น dataset ใช้ recordsTotal/validated)',
    columns: [
      { key: 'code', required: true, width: 22 },
      { key: 'workstreamCode', required: true, width: 22 },
      { key: 'containerCode', width: 20 },
      { key: 'subtype', required: true, width: 20, list: ITEM_SUBTYPES },
      { key: 'title', required: true, width: 40 },
      { key: 'status', width: 16, list: WORK_STATUSES },
      { key: 'weight', width: 10 },
      { key: 'numericValue', width: 14, hint: 'เช่น มูลค่าดีล' },
      { key: 'probability', width: 12, hint: '0 ถึง 1' },
      ...METRIC_COLUMNS.map((key) => ({ key, width: 12, metric: true })),
    ],
  },
  milestones: {
    title: 'Milestones',
    note: 'หมุดหมายถ่วงน้ำหนักของแต่ละสายงาน',
    columns: [
      { key: 'code', required: true, width: 22 },
      { key: 'workstreamCode', required: true, width: 22 },
      { key: 'title', required: true, width: 40 },
      { key: 'status', width: 16, list: MILESTONE_STATUSES },
      { key: 'weight', width: 10 },
    ],
  },
  gates: {
    title: 'Gates',
    note: 'ด่านตรวจ/อนุมัติ — required=TRUE จะหน่วง progress จนกว่าจะผ่าน',
    columns: [
      { key: 'code', required: true, width: 22 },
      { key: 'workstreamCode', required: true, width: 22 },
      { key: 'title', required: true, width: 40 },
      { key: 'status', width: 14, list: GATE_STATUSES },
      { key: 'required', width: 12, list: ['TRUE', 'FALSE'] },
    ],
  },
  dependencies: {
    title: 'Dependencies',
    note: 'อ้างอิงด้วย code จากชีตอื่น (workstream/container/item/milestone/gate)',
    columns: [
      { key: 'sourceRef', required: true, width: 24 },
      { key: 'targetRef', required: true, width: 24 },
      { key: 'type', required: true, width: 18, list: DEPENDENCY_TYPES },
    ],
  },
  repositories: {
    title: 'Repositories',
    note: 'metadata ของ repo (ไม่บังคับ) — externalRepoId เป็น ID ภายนอก ไม่ใช่คีย์ภายใน',
    columns: [
      { key: 'code', required: true, width: 20 },
      { key: 'provider', required: true, width: 14 },
      { key: 'fullName', width: 28 },
      { key: 'url', width: 40 },
      { key: 'role', width: 14 },
      { key: 'pathScope', width: 18 },
    ],
  },
}

/**
 * Build the intake workbook. Returns an ExcelJS workbook (caller streams it).
 */
export function buildTemplateWorkbook() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'zuri-v2-lab'
  wb.created = new Date()

  const readme = wb.addWorksheet('อ่านก่อน (Read Me)')
  readme.columns = [{ width: 100 }]
  const lines = [
    'Zuri v2 — แบบฟอร์มนำเข้าแผนงาน (สร้างอัตโนมัติจาก schema ของระบบ — อย่าแก้ชื่อชีต/หัวตาราง)',
    '',
    '1. กรอกชีต Project หนึ่งแถว แล้วกรอก Workstreams อย่างน้อยหนึ่งแถว',
    '2. ชีตอื่นอ้างถึงสายงานผ่านคอลัมน์ workstreamCode (ต้องตรงกับ code ในชีต Workstreams)',
    '3. ช่องหัวตารางพื้นเหลือง = จำเป็นต้องกรอก · ช่องที่มี dropdown ให้เลือกจากรายการเท่านั้น',
    '4. code ใช้ตัวอักษร/ตัวเลข/ขีดกลาง เช่น WST-LEGAL — ถ้า code ซ้ำกับของเดิมในระบบ = อัปเดตรายการนั้น',
    '5. อัปโหลดที่หน้า Import — ระบบตรวจรายแถวก่อน (บอกชีต+เลขแถวที่ผิด) แล้วให้พรีวิวก่อนยืนยันเสมอ',
  ]
  for (const [i, text] of lines.entries()) {
    const cell = readme.getCell(i + 1, 1)
    cell.value = text
    if (i === 0) cell.font = { bold: true, size: 12 }
  }

  for (const [sheetKey, spec] of Object.entries(SHEETS)) {
    const ws = wb.addWorksheet(spec.title)
    ws.columns = spec.columns.map((c) => ({ key: c.key, width: c.width || 16 }))

    // Note row (row 1), header row (row 2), data from row 3.
    ws.mergeCells(1, 1, 1, spec.columns.length)
    const note = ws.getCell(1, 1)
    note.value = spec.note
    note.font = { italic: true, size: 9, color: { argb: 'FF5D4037' } }
    note.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8F0' } }

    spec.columns.forEach((col, idx) => {
      const cell = ws.getCell(2, idx + 1)
      cell.value = col.required ? `${col.key}*` : col.key
      cell.font = { bold: true, color: { argb: col.required ? 'FF555500' : 'FFFFFFFF' } }
      cell.fill = col.required
        ? REQUIRED_FILL
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLORS[sheetKey] } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      if (col.hint) cell.note = col.hint

      // Enum dropdowns straight from the Zod source of truth.
      if (col.list) {
        ws.dataValidations.add(`${colLetter(idx + 1)}3:${colLetter(idx + 1)}500`, {
          type: 'list',
          allowBlank: true,
          formulae: [`"${col.list.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'ค่าไม่อยู่ในรายการ',
          error: 'เลือกจาก dropdown เท่านั้น',
        })
      }
    })
    ws.getRow(2).height = 24
    ws.views = [{ state: 'frozen', ySplit: 2 }]
  }
  return wb
}

function colLetter(n) {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
