// @req FR-018 — upload filled template: convert with per-row error reporting, then dry-run
// @req FR-065 — the upload resolves a viewer and the resulting dry run authorizes
// its target; a third intake surface must not be the unguarded one.
// @spec SDD-037, SEC-001, SEC-008
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { workbookToEnvelope } from '@/modules/project-manager/import/xlsx-convert'
import { dryRunPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

// Commit still happens through the shared /api/import/commit endpoint with
// the returned envelope, keeping one pipeline for every surface.
export async function POST(request) {
  try {
    // Before the file is read: an unauthenticated upload is a 401, not a parse.
    const viewer = await resolveRequestViewer(request)
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
    const dry = await dryRunPlan(envelope, { workspaceId, viewer })
    return NextResponse.json({ ...dry, envelope })
  } catch (err) {
    // This handler's catch-all predates the viewer. `resolveRequestViewer`
    // signals 401/503 through `err.status`, and collapsing those into a blanket
    // 500 would report an authentication failure as a server fault — and hide it
    // from anything watching for auth errors.
    const status = Number(err?.status) || 500
    return NextResponse.json({ valid: false, errors: [err?.message || 'อ่านไฟล์ไม่สำเร็จ'] }, { status })
  }
}
