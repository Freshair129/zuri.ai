import { buildTemplateWorkbook } from '@/modules/project-manager/import/xlsx-template'

export const dynamic = 'force-dynamic'

// FR-018 — download the intake workbook (generated from Zod enums; no drift).
export async function GET() {
  const wb = buildTemplateWorkbook()
  const buffer = await wb.xlsx.writeBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="zuri-v2-plan-template.xlsx"',
    },
  })
}
