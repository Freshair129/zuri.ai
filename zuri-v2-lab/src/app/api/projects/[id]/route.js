import { handle } from '../../_helpers'
import { getProject, updateProject, archiveProject } from '@/modules/project-manager/application/project-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const project = await getProject(params.id)
    if (!project) throw new Error('Project not found')
    return project
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => updateProject(params.id, await request.json()))
}

export async function DELETE(request, { params }) {
  return handle(() => archiveProject(params.id))
}
