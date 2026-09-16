import { z } from 'zod'
import { consoleRequest, consoleParameters } from '@/modules/knowledge/knowledge-console-http'
import { readRouteParams } from '@/modules/knowledge/knowledge-http'
import { readConsoleCitationArtifact } from '@/modules/knowledge/knowledge-console-service'

// @req FR-253 — exact cited artifact reads and safe text attachment downloads.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/unit/fr253-knowledge-console-routes.test.js, tests/integration/fr253-citation-artifact.test.js
export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  return consoleRequest(request, async (options) => {
    const query = z.object({ kind: z.enum(['chunk', 'parsed', 'raw']).default('chunk'), download: z.enum(['true', 'false']).optional() }).strict().parse(consoleParameters(request))
    const result = await readConsoleCitationArtifact((await readRouteParams(context)).citationId, { kind: query.kind, download: query.download === 'true' }, options)
    if (query.download !== 'true') return result
    return new Response(result.content, { headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="knowledge-${query.kind}.txt"`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    } })
  })
}
