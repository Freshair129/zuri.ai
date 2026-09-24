import { NextResponse } from 'next/server'

import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { handleMarketCoreRequest, readBoundedBody } from '@/modules/market-intelligence/application/market-core-facade'
import { listMarketLaneRawRecordCandidates } from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'

// @req FR-092 — core's private market-core.v1 façade for the separately running Market
//   Intelligence service (ADR-108 D4). DRAFT offered to the integrator: this route,
//   its OpenAPI inventory tuple and the counter bump are the lines Session 1 may
//   rewrite. Bearer MARKET_CORE_TOKEN only; never reachable with a browser session.
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested tests/unit/market-intelligence/market-core-facade.test.js
//
// One dynamic segment instead of five routes: GET health | execution-ownership,
// POST authorize | raw-candidates | audit. The composition root is here; every
// decision lives in market-core-facade.js.

export const dynamic = 'force-dynamic'

async function respond(request, params, method) {
  const { operation } = await params
  let body
  if (method === 'POST') {
    const read = await readBoundedBody(request)
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status })
    body = read.body
  }
  const result = await handleMarketCoreRequest(
    {
      method,
      operation,
      authorization: request.headers.get('authorization'),
      subject: request.headers.get('x-zuri-subject'),
      body,
    },
    { db: prisma, env: process.env, resolveRequestViewer, listCandidates: listMarketLaneRawRecordCandidates, recordAudit },
  )
  return NextResponse.json(result.body, { status: result.status, headers: { 'cache-control': 'no-store' } })
}

export async function GET(request, { params }) {
  return respond(request, params, 'GET')
}

export async function POST(request, { params }) {
  return respond(request, params, 'POST')
}
