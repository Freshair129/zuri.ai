import { NextResponse } from 'next/server'
import { workbookToEnvelope } from '@/modules/project-manager/import/xlsx-convert'
import { dryRunPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

// FR-018 — upload a filled template: convert (per-row errors) then dry-run.
// Commit still happens through the shared /api/import/commit endpoint with
// the returned envelope, keeping one pipeline for every surface.
export async function POST(request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ valid: false, errors: ['ไม่พบไฟล์ที่อัปโหลด'] }, { status: 400 })
    }
    // Project-scoped uploads fall back to that project's workspace server-side.
    const workspaceId = await resolveImportWorkspaceId({
      workspaceId: form.get('workspaceId') || undefined,
      projectId: form.get('projectId') || undefined,
    })
    const buffer = Buffer.from(await file.arrayBuffer())
    const { envelope, errors } = await workbookToEnvelope(buffer)
    if (errors.length > 0) {
      return NextResponse.json({ valid: false, errors, envelope: null })
    }
    const dry = await dryRunPlan(envelope, { workspaceId })
    return NextResponse.json({ ...dry, envelope })
  } catch (err) {
    return NextResponse.json({ valid: false, errors: [err?.message || 'อ่านไฟล์ไม่สำเร็จ'] }, { status: 500 })
  }
}
