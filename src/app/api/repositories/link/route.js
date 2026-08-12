import { handle } from '../../_helpers'
import { linkRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => linkRepository(await request.json()))
}
