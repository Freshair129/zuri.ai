// Marketing Insights — shared GET handler for the /api/insights routes: authenticate, check
// that a reporting source exists, re-authorize every binding through InsightScopeAuthority,
// and keep the typed Insights error code in the response so the page can explain it.
//
// @req FR-275 — reads never call a provider; they go through the query service only.
// @spec SEC-001, SEC-008
// @tested tests/unit/marketing/insights/insights-routes.test.js

import { NextResponse } from 'next/server'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { InsightsError } from '@/modules/marketing/insights/ports/insights-ports'
import { InsightScopeError } from '@/modules/marketing/insights/domain/brand-scope'
import { viewerCanReadBinding } from '@/modules/marketing/insights/application/insight-scope-authority'
import { getInsightsQueryService } from '@/modules/marketing/insights/application/insights-runtime'

export const INSIGHTS_NOT_CONFIGURED = 'INSIGHTS_NOT_CONFIGURED'

export function insightsGet(read, { getService = getInsightsQueryService, resolveViewer = resolveRequestViewer } = {}) {
  return async function GET(request, context) {
    try {
      const viewer = await resolveViewer(request)
      const service = getService()
      if (!service) {
        return NextResponse.json(
          { error: 'Marketing Insights has no reporting data source in this release', code: INSIGHTS_NOT_CONFIGURED },
          { status: 503 },
        )
      }
      const params = (await context?.params) ?? {}
      const result = await read({ service, query: queryParams(request), canRead: viewerCanReadBinding(viewer), params })
      return result instanceof Response ? result : NextResponse.json(result)
    } catch (error) {
      if (error instanceof InsightsError || error instanceof InsightScopeError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
      }
      return handle(() => { throw error })
    }
  }
}

export function csvResponse({ body, contentType, filename }) {
  const safeName = String(filename).replace(/[^A-Za-z0-9._-]/g, '') || 'insights.csv'
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${safeName}"`,
      'cache-control': 'no-store',
    },
  })
}
