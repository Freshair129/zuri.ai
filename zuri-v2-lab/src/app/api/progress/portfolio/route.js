import { handle } from '../../_helpers'
import { computePortfolioProgress } from '@/modules/project-manager/application/progress-service'

export const dynamic = 'force-dynamic'

// @req FR-020 — group landing data: one health card per business + group-level work.
export async function GET() {
  return handle(() => computePortfolioProgress())
}
