import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { buildTemplateWorkbook, SHEETS } from '@/modules/project-manager/import/xlsx-template'
import { workbookToEnvelope } from '@/modules/project-manager/import/xlsx-convert'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'

// @req FR-065 — the pipeline authorizes its target, so it takes a viewer. This
// suite is about the workbook → envelope conversion; it runs as the owner of the
// Business it creates.
let viewer
const dryRun = (plan, opts = {}) => dryRunPlan(plan, { viewer, ...opts })
const runCommit = (plan, opts = {}) => commitPlan(plan, { viewer, ...opts })

// Helper: load the generated template and fill rows by sheet title.
async function filledTemplate(fill) {
  const template = buildTemplateWorkbook()
  const buffer = await template.xlsx.writeBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  for (const [sheetKey, rows] of Object.entries(fill)) {
    const spec = SHEETS[sheetKey]
    const ws = wb.getWorksheet(spec.title)
    rows.forEach((row, i) => {
      spec.columns.forEach((col, c) => {
        if (row[col.key] !== undefined) {
          ws.getCell(3 + i, c + 1).value = row[col.key]
        }
      })
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

const GOOD_FILL = {
  project: [{ code: 'PRJ-XLSX', name: 'Excel Imported Project', description: 'จากแบบฟอร์ม' }],
  workstreams: [
    { code: 'WST-XLSX-MIG', name: 'ย้ายข้อมูลลูกค้า', executionMode: 'DATA_MIGRATION' },
    { code: 'WST-XLSX-EXP', name: 'เปิดสาขา', executionMode: 'BUSINESS_EXPANSION', progressWeight: 2 },
  ],
  containers: [
    { code: 'WC-XLSX-STG', workstreamCode: 'WST-XLSX-MIG', subtype: 'MIGRATION_STAGE', title: 'Validate' },
  ],
  items: [
    {
      code: 'WI-XLSX-DS', workstreamCode: 'WST-XLSX-MIG', containerCode: 'WC-XLSX-STG',
      subtype: 'DATASET', title: 'ลูกค้า', status: 'IN_PROGRESS', recordsTotal: 100, validated: 40,
    },
    {
      code: 'WI-XLSX-LEASE', workstreamCode: 'WST-XLSX-EXP', subtype: 'SETUP_ACTION',
      title: 'เซ็นสัญญาเช่า', status: 'DONE', weight: 2,
    },
  ],
  milestones: [{ code: 'MS-XLSX-1', workstreamCode: 'WST-XLSX-EXP', title: 'เปิดร้าน', weight: 1 }],
  gates: [{ code: 'GATE-XLSX-1', workstreamCode: 'WST-XLSX-MIG', title: 'ข้อมูลพร้อม', required: 'TRUE' }],
  dependencies: [{ sourceRef: 'GATE-XLSX-1', targetRef: 'WST-XLSX-EXP', type: 'RELATES_TO' }],
}

describe('FR-018 xlsx intake', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Xlsx Group', code: 'PF-XLSX' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Xlsx Tenant', code: 'TNT-XLSX' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Xlsx Business', code: 'BUS-XLSX' })
    await createWorkspace({ name: 'Xlsx WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-XLSX' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('template workbook contains every entity sheet with enum dropdowns', async () => {
    const wb = buildTemplateWorkbook()
    for (const spec of Object.values(SHEETS)) {
      expect(wb.getWorksheet(spec.title), spec.title).toBeTruthy()
    }
    const wsSheet = wb.getWorksheet('Workstreams')
    // executionMode header + dropdown present (generated from Zod enums).
    expect(String(wsSheet.getCell(2, 3).value)).toContain('executionMode')
    const validations = wsSheet.dataValidations.model
    const hasModeList = Object.values(validations).some(
      (v) => v.type === 'list' && String(v.formulae[0]).includes('SOFTWARE_SPRINT')
    )
    expect(hasModeList).toBe(true)
  })

  it('round trip: filled template converts to a valid envelope and dry-runs clean', async () => {
    const buffer = await filledTemplate(GOOD_FILL)
    const { envelope, errors } = await workbookToEnvelope(buffer)
    expect(errors).toEqual([])
    expect(envelope.schemaVersion).toBe('1.0')
    expect(envelope.workstreams.length).toBe(2)
    // Blank strategy fell back to the mode default.
    expect(envelope.workstreams[0].progressStrategy).toBe('RECORD_VALIDATION')
    const item = envelope.workstreams[0].items[0]
    expect(item.metrics).toEqual({ recordsTotal: 100, validated: 40 })
    expect(envelope.workstreams[1].gates).toEqual([])
    expect(envelope.workstreams[0].gates[0].required).toBe(true)

    const dry = await dryRun(envelope, {
      workspaceId: (await prisma.workspace.findUnique({ where: { code: 'WS-XLSX' } })).id,
    })
    expect(dry.valid).toBe(true)
    expect(dry.preview.summary.conflictCount).toBe(0)
  })

  it('commit from xlsx envelope creates the full graph', async () => {
    const buffer = await filledTemplate(GOOD_FILL)
    const { envelope } = await workbookToEnvelope(buffer)
    const workspace = await prisma.workspace.findUnique({ where: { code: 'WS-XLSX' } })
    const result = await runCommit(envelope, { workspaceId: workspace.id })
    expect(result.committed).toBe(true)
    const project = await prisma.project.findUnique({
      where: { code: 'PRJ-XLSX' },
      include: { workstreams: true, milestones: true, gates: true },
    })
    expect(project.workstreams.length).toBe(2)
    expect(project.milestones.length).toBe(1)
    expect(project.gates.length).toBe(1)
  })

  it('reports per-row errors with sheet and row numbers', async () => {
    const buffer = await filledTemplate({
      project: [{ code: 'PRJ-XLSX-BAD', name: 'Bad' }],
      workstreams: [{ code: 'WST-OK', name: 'ok', executionMode: 'OPERATIONS' }],
      items: [
        // Row 3: unknown workstream; row 4: missing title + bad number.
        { code: 'WI-BAD-1', workstreamCode: 'WST-GHOST', subtype: 'TASK', title: 'x' },
        { code: 'WI-BAD-2', workstreamCode: 'WST-OK', subtype: 'TASK', title: '', weight: 'มาก' },
      ],
    })
    const { envelope, errors } = await workbookToEnvelope(buffer)
    expect(envelope).toBeNull()
    expect(errors.some((e) => e.includes('Items แถว 3') && e.includes('WST-GHOST'))).toBe(true)
    expect(errors.some((e) => e.includes('Items แถว 4') && e.includes('title'))).toBe(true)
    expect(errors.some((e) => e.includes('Items แถว 4') && e.includes('weight'))).toBe(true)
  })

  it('duplicate workstream codes in the file are rejected', async () => {
    const buffer = await filledTemplate({
      project: [{ code: 'PRJ-XLSX-DUP', name: 'Dup' }],
      workstreams: [
        { code: 'WST-DUP', name: 'a', executionMode: 'OPERATIONS' },
        { code: 'WST-DUP', name: 'b', executionMode: 'OPERATIONS' },
      ],
    })
    const { errors } = await workbookToEnvelope(buffer)
    expect(errors.some((e) => e.includes('ซ้ำในไฟล์'))).toBe(true)
  })

  it('rejects a non-xlsx buffer with a friendly error', async () => {
    const { envelope, errors } = await workbookToEnvelope(Buffer.from('not a workbook'))
    expect(envelope).toBeNull()
    expect(errors[0]).toContain('.xlsx')
  })

  it('missing Project sheet rejected (wrong file)', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Random')
    const { errors } = await workbookToEnvelope(Buffer.from(await wb.xlsx.writeBuffer()))
    expect(errors[0]).toContain('ไม่พบชีต Project')
  })
})
