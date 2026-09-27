import { NextResponse } from 'next/server'

import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { fail, handleScmCoreRequest, readBoundedBody, tokenMatches } from '@/modules/inventory/application/scm-core-facade'

// @req FR-154, FR-164, FR-165, FR-166, FR-163, FR-183 — core's private scm-core.v1
//   façade for the separately running SCM service (ADR-111 D5, the ADR-108 D4
//   pattern): the viewer scope the legacy Inventory / Procurement / Commerce
//   ladders decide on, and the Branch / Customer / Conversation facts the legacy
//   POS and sales-order services validate against. Bearer SCM_CORE_TOKEN only;
//   never reachable with a browser session.
// @spec ADR-111, ADR-108, BR-001, SEC-001, SEC-017
// @tested tests/unit/scm-core-facade.test.js, tests/integration/scm-core-facade-http.test.js
//
// One dynamic segment instead of five routes: POST resolve-scope | branch |
// branches | customer | conversation. Only POST is exported, so any other method
// is Next's 405. The composition root is here; every decision lives in
// scm-core-facade.js. Nothing here logs the subject or the token.

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(request, { params }) {
  const { operation } = await params
  const authorization = request.headers.get('authorization')
  // Checked again inside the handler; here it stops an unauthenticated caller
  // before its body is read at all.
  if (!tokenMatches(authorization, process.env.SCM_CORE_TOKEN)) {
    const refusal = fail(401, 'SERVICE_TOKEN_INVALID')
    return NextResponse.json(refusal.body, { status: refusal.status, headers: NO_STORE })
  }
  try {
    const read = await readBoundedBody(request)
    const result = read.ok
      ? await handleScmCoreRequest(
        {
          method: 'POST',
          operation,
          authorization,
          subject: request.headers.get('x-zuri-subject'),
          body: read.body,
        },
        { db: prisma, env: process.env, resolveRequestViewer },
      )
      : fail(read.status, read.code)
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE })
  } catch {
    // A session store or database fault: retryable for the consumer, no details.
    return NextResponse.json({ error: { code: 'CORE_UNAVAILABLE' } }, { status: 503, headers: NO_STORE })
  }
}
