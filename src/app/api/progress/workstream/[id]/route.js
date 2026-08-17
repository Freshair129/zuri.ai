// @req FR-010 — compute strategy-based progress with evidence and warnings
import { handle } from '../../../_helpers'
import { computeWorkstreamProgress } from '@/modules/project-manager/application/progress-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(() => computeWorkstreamProgress(params.id))
}
