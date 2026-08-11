import { handle } from '../../_helpers'
import { exportSnapshot } from '@/modules/project-manager/application/backup-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => exportSnapshot())
}
