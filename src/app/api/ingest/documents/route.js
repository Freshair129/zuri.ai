import { z } from 'zod'

import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listDocumentIntakeRecords,
  stageDocumentIntake,
} from '@/platform/integrations/core/cloud-sot-agent'
import { DOCUMENT_INTAKE_DOMAINS } from '@/platform/integrations/core/document-intake-contract'

// @req FR-071 — server-mediated SmartGift document staging and redacted monitor
// read model; neither method writes a canonical Product or Customer row.
// @spec BR-001, SEC-001, SEC-008
// @tested tests/unit/platform/cloud-sot-agent.test.js, tests/unit/document-intake-ui.test.js

export const dynamic = 'force-dynamic'

const postSchema = z.object({
  connectionId: z.string().min(1),
  contract: z.record(z.unknown()),
}).strict()

const getSchema = z.object({
  connectionId: z.string().min(1).optional(),
  businessId: z.string().min(1).optional(),
  rawRecordId: z.string().min(1).optional(),
  domain: z.enum(DOCUMENT_INTAKE_DOMAINS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine((value) => Boolean(value.connectionId || value.businessId), {
  message: 'connectionId or businessId is required',
  path: ['connectionId'],
})

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = postSchema.parse(await request.json())
    return stageDocumentIntake({ ...body, viewer })
  })
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = getSchema.parse(queryParams(request))
    return listDocumentIntakeRecords({ ...query, viewer })
  })
}
