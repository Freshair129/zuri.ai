// @req FR-008 — repository records and many-to-many project links: list and create
import { handle } from '../_helpers'
import { listRepositories, createRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => listRepositories())
}

export async function POST(request) {
  return handle(async () => createRepository(await request.json()))
}
