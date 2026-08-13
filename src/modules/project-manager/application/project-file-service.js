// @req FR-037 — ProjectFile metadata references, optional WorkItem link, and audited mutation.
// @spec SDD-016, BR-002, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zProjectFileInput } from '@/lib/validation/entities'
import { recordAudit } from './audit'

const codeExists = async (code) => Boolean(await prisma.projectFile.findUnique({ where: { code } }))

async function assertProject(db, projectId) {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  return project
}

export async function listProjectFiles(projectId, { db = prisma } = {}) {
  await assertProject(db, projectId)
  return db.projectFile.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: { workItem: { select: { id: true, code: true, title: true } } },
  })
}

export async function createProjectFile(projectId, input, { db = prisma } = {}) {
  const data = zProjectFileInput.parse(input)
  await assertProject(db, projectId)
  if (data.workItemId) {
    const workItem = await db.workItem.findFirst({ where: { id: data.workItemId, deletedAt: null, workstream: { projectId } } })
    if (!workItem) throw new Error('Work item must belong to the project')
  }
  const code = data.code || (await uniqueHumanCode('FIL', data.name, codeExists))
  const file = await db.projectFile.create({
    data: {
      code,
      projectId,
      workItemId: data.workItemId ?? null,
      name: data.name,
      mime: data.mime,
      size: data.size,
      url: data.url ?? null,
      blobRef: data.blobRef ?? null,
      uploadedBy: data.uploadedBy ?? null,
    },
    include: { workItem: { select: { id: true, code: true, title: true } } },
  })
  await recordAudit(db, { entityType: 'PROJECT_FILE', entityId: file.id, action: 'CREATED', payload: { projectId, code, workItemId: file.workItemId } })
  return file
}

export async function deleteProjectFile(projectId, fileId, { db = prisma } = {}) {
  await assertProject(db, projectId)
  const file = await db.projectFile.findFirst({ where: { id: fileId, projectId } })
  if (!file) throw new Error('Project file not found')
  await db.projectFile.delete({ where: { id: fileId } })
  await recordAudit(db, { entityType: 'PROJECT_FILE', entityId: fileId, action: 'DELETED', payload: { projectId, code: file.code } })
  return { id: fileId }
}
