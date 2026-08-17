// @req FR-006 — create a weighted gate with required flag and evidence
import { handle } from '../_helpers'
import { createGate } from '@/modules/project-manager/application/milestone-gate-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => createGate(await request.json()))
}
