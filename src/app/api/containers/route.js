import { handle } from '../_helpers'
import { createContainer } from '@/modules/project-manager/application/work-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => createContainer(await request.json()))
}
