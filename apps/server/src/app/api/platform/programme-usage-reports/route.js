import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'
import { bearerMatches, recordProgrammeUsageReport } from '@/modules/platform-control/application/programme-usage-reports'
import { authenticateHarnessCredential, looksLikeHarnessCredential } from '@/modules/identity/harness-credential'

// @req FR-218 — an agent reports one session's usage for programme work. The
//   credential is checked before the body is read, and no browser viewer is
//   resolved: a harness or an automation job has no session by construction.
// @req FR-221 — a paired harness credential (FR-220) attributes the report to its
//   person and installation; the deployment bearer is for unattended automation
//   and carries no person. A pending device is told so; any other failure is 401.
// @spec ADR-086 D5; ADR-087 D3-D6; SEC-001
// @tested tests/unit/programme-usage-reports.test.js

export const dynamic = 'force-dynamic'

const KNOWN_TASK_CODES = new Set(PROGRAMME_TASKS.map(([id]) => id))

async function resolveReporter(authorization) {
  if (looksLikeHarnessCredential(authorization)) {
    const credential = await authenticateHarnessCredential({ authorization, db: prisma })
    if (!credential) return { refusal: [401, 'HARNESS_CREDENTIAL_REQUIRED'] }
    if (credential.status !== 'ACTIVE') return { refusal: [403, 'HARNESS_NOT_ACTIVATED'] }
    return { reporter: { kind: 'harness', personId: credential.personId, installationId: credential.installationId } }
  }
  if (bearerMatches(authorization, process.env.ZURI_PROGRAMME_USAGE_TOKEN)) return { reporter: { kind: 'deployment' } }
  return { refusal: [401, 'USAGE_REPORT_CREDENTIAL_REQUIRED'] }
}

export async function POST(request) {
  try {
    const { reporter, refusal } = await resolveReporter(request.headers.get('authorization'))
    if (refusal) return NextResponse.json({ error: refusal[1] }, { status: refusal[0] })
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'USAGE_REPORT_INVALID', issues: [{ path: '', message: 'body must be a JSON object' }] }, { status: 400 })
    }
    const { status, body: result } = await recordProgrammeUsageReport(prisma, body, { knownTaskCodes: KNOWN_TASK_CODES, reporter })
    return NextResponse.json(result, { status })
  } catch {
    return NextResponse.json({ error: 'USAGE_REPORT_UNAVAILABLE' }, { status: 503 })
  }
}
