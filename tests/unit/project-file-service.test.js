import { describe, expect, it, vi } from 'vitest'
import { createProjectFile } from '@/modules/project-manager/application/project-file-service'

function baseDb({ workItem = null } = {}) {
  return {
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-a', deletedAt: null }) },
    workItem: { findFirst: vi.fn().mockResolvedValue(workItem) },
    projectFile: { create: vi.fn().mockResolvedValue({ id: 'file-a', code: 'FIL-A', workItemId: null }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  }
}

describe('ProjectFile service', () => {
  it('requires a file reference', async () => {
    await expect(createProjectFile('project-a', { code: 'FIL-A', name: 'Brief', mime: 'application/pdf', size: 12 }, { db: baseDb() })).rejects.toThrow('url or blobRef')
  })

  it('rejects a WorkItem from another project', async () => {
    await expect(createProjectFile('project-a', {
      code: 'FIL-A', name: 'Brief', mime: 'application/pdf', size: 12, url: 'https://example.test/brief.pdf', workItemId: 'item-b',
    }, { db: baseDb() })).rejects.toThrow('Work item must belong')
  })

  it('persists a project reference and records an audit event', async () => {
    const db = baseDb()
    await createProjectFile('project-a', {
      code: 'FIL-A', name: 'Brief', mime: 'application/pdf', size: 12, blobRef: 'local:brief',
    }, { db })
    expect(db.projectFile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'project-a', code: 'FIL-A', blobRef: 'local:brief' }),
    }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CREATED' }) }))
  })
})
