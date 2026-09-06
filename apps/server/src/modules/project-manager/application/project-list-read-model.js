import { z } from 'zod'
import { zProjectStatus, zWorkspaceScopeType } from '@/lib/validation/enums'

// @req FR-003, FR-043 — the Project list has a stable response DTO and keeps
// direct Business ownership separate from secondary Space context.
// @spec ADR-014, BR-001, BR-004, SDD-021, SEC-001, SEC-008
// @tested tests/unit/project-list-contract.test.js, tests/integration/project-list-contract.test.js

export const PROJECT_LIST_LIMIT = 500

const optionalTrimmed = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed || undefined
  },
  z.string().min(1).optional()
)

const optionalStatus = z.preprocess(
  (value) => value === '' ? undefined : value,
  zProjectStatus.optional()
)

const optionalLimit = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().positive().transform((value) => Math.min(value, PROJECT_LIST_LIMIT)).optional()
)

export const zProjectListQuery = z.object({
  workspaceId: optionalTrimmed,
  businessId: optionalTrimmed,
  tenantId: optionalTrimmed,
  status: optionalStatus,
  q: optionalTrimmed,
  limit: optionalLimit,
  view: z.enum(['list', 'overview', 'timeline', 'workspace']).default('list'),
}).strict()

export function parseProjectListQuery(query = {}) {
  const parsed = zProjectListQuery.parse(query)
  return { ...parsed, limit: parsed.limit ?? PROJECT_LIST_LIMIT }
}

const nullableIsoDate = z.string().datetime().nullable()

export const zProjectListItem = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  type: z.string().min(1),
  status: zProjectStatus,
  businessId: z.string().nullable(),
  workspaceId: z.string().min(1),
  workspace: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    scopeType: zWorkspaceScopeType,
  }).strict(),
  startAt: nullableIsoDate,
  targetAt: nullableIsoDate,
  workstreamCount: z.number().int().nonnegative(),
}).strict()

export const zProjectListResponse = z.object({
  items: z.array(zProjectListItem),
  limit: z.number().int().positive(),
  truncated: z.boolean(),
}).strict()

function isoDate(value) {
  return value == null ? null : new Date(value).toISOString()
}

export function serializeProjectListItem(project) {
  return zProjectListItem.parse({
    id: project.id,
    code: project.code,
    name: project.name,
    description: project.description ?? null,
    type: project.type,
    status: project.status,
    businessId: project.businessId ?? null,
    workspaceId: project.workspaceId,
    workspace: {
      code: project.workspace.code,
      name: project.workspace.name,
      scopeType: project.workspace.scopeType,
    },
    startAt: isoDate(project.startAt),
    targetAt: isoDate(project.targetAt),
    workstreamCount: Array.isArray(project.workstreams)
      ? project.workstreams.length
      : Number(project._count?.workstreams || 0),
  })
}
