import prisma from '@/lib/db'
import { handle } from '../../../_helpers'

// @req FR-017 — the work-breakdown tree (Project → Workstream → WorkContainer → WorkItem)
//   backing the Structure Plan (WBS) canvas.
// @tested tests/integration/project-core.test.js
export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  const { id: projectId } = params
  return handle(async () => {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        workspace: true,
        workstreams: {
          orderBy: { createdAt: 'asc' },
          include: {
            containers: {
              where: { parentId: null },
              orderBy: { createdAt: 'asc' },
              include: {
                items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
                children: {
                  orderBy: { createdAt: 'asc' },
                  include: { items: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
                },
              },
            },
            items: { where: { deletedAt: null, containerId: null }, orderBy: { createdAt: 'asc' } },
          },
        },
      },
    })
    if (!project) throw new Error('Project not found')
    return project
  })
}
