// @req FR-018 — download intake template workbook (generated from Zod enums)
// @spec SEC-001, SEC-008 — a template is a protected application read surface;
// identity is resolved from the trusted request session before generation.
// @tested tests/unit/public-read-route-auth.test.js
import { NextResponse } from 'next/server'
import { buildTemplateWorkbook } from '@/modules/project-manager/import/xlsx-template'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    await resolveRequestViewer(request)
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'AUTH_REQUIRED' },
      { status: Number(error?.status) || 500 },
    )
  }
  const wb = buildTemplateWorkbook()
  const buffer = await wb.xlsx.writeBuffer()
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="zuri-ai-plan-template.xlsx"',
    },
  })
}
