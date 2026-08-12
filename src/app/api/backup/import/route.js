import { handle } from '../../_helpers'
import { previewImport, importSnapshot } from '@/modules/project-manager/application/backup-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const body = await request.json()
    if (body.confirm === true) {
      return importSnapshot(body.snapshot, { confirm: true })
    }
    return previewImport(body.snapshot)
  })
}
