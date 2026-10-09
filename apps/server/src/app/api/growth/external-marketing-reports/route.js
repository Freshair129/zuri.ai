// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-281, FR-282 — dedicated report credential only; no session/Enterprise fallback.
import { NextResponse } from 'next/server'
import { reportCredentialHash, readMarketingReportRequest } from '@/modules/marketing/application/marketing-report-wire'
import { receiveMarketingReport } from '@/modules/marketing/application/marketing-report-receiver'
import { marketingReportDatabase } from '@/modules/marketing/infrastructure/marketing-report-database'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request) {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const authorization = request.headers.get('authorization')
    reportCredentialHash(authorization)
    const { canonicalEnvelope } = await readMarketingReportRequest(request)
    const result = await receiveMarketingReport({ db: marketingReportDatabase(), authorization, raw: canonicalEnvelope })
    return NextResponse.json(result.receipt, { status: result.status, headers })
  } catch (error) {
    // Remote callers receive only reviewed safe codes, never Prisma errors,
    // credential material, raw bodies or path/connection diagnostics.
    const status = [401, 404, 409, 413, 415, 422, 503].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: error?.status === status ? error.code : 'REPORT_RECEIVER_UNAVAILABLE' }, { status, headers })
  }
}
