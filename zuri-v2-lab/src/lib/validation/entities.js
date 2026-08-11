import { z } from 'zod'
import {
  zExecutionMode,
  zProgressStrategy,
  zDependencyType,
  zDependencyEndpointType,
  zProjectStatus,
  zWorkstreamStatus,
  zWorkStatus,
  zMilestoneStatus,
  zGateStatus,
  zWorkspaceScopeType,
} from './enums'

const zDate = z.coerce.date()
const zOptionalDate = z.coerce.date().nullish()
const zJsonObject = z.record(z.any())

export const zPortfolioInput = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
})

export const zTenantInput = z.object({
  code: z.string().min(1).optional(),
  portfolioId: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
})

export const zLegalEntityInput = z.object({
  code: z.string().min(1).optional(),
  portfolioId: z.string().min(1),
  legalName: z.string().min(1),
  identifiers: z
    .array(
      z.object({
        country: z.string().default('TH'),
        type: z.string().min(1),
        value: z.string().min(1),
      })
    )
    .optional(),
})

export const zBusinessInput = z.object({
  code: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  legalEntityId: z.string().nullish(),
  name: z.string().min(1),
  status: z.string().optional(),
})

// FR-020 — add a business to the group: tenant + starter workspace are implied.
export const zBusinessInGroupInput = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  portfolioId: z.string().min(1).optional(),
  workspaceName: z.string().min(1).optional(),
})

export const zBranchInput = z.object({
  code: z.string().min(1).optional(),
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  name: z.string().min(1),
})

export const zWorkspaceInput = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  scopeType: zWorkspaceScopeType,
  portfolioId: z.string().nullish(),
  tenantId: z.string().nullish(),
  businessId: z.string().nullish(),
})

export const zProjectInput = z.object({
  code: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  type: z.string().default('GENERAL'),
  status: zProjectStatus.default('PLANNED'),
  startAt: zOptionalDate,
  targetAt: zOptionalDate,
})

export const zProjectUpdate = zProjectInput.partial().extend({
  version: z.number().int().optional(),
})

export const zWorkstreamInput = z.object({
  code: z.string().min(1).optional(),
  projectId: z.string().min(1),
  name: z.string().min(1),
  executionMode: zExecutionMode,
  progressStrategy: zProgressStrategy.optional(),
  progressWeight: z.number().positive().default(1),
  status: zWorkstreamStatus.default('PLANNED'),
  viewConfig: zJsonObject.optional(),
})

export const zWorkstreamUpdate = zWorkstreamInput.partial()

export const zWorkContainerInput = z.object({
  code: z.string().min(1).optional(),
  workstreamId: z.string().min(1),
  parentId: z.string().nullish(),
  subtype: z.string().min(1),
  title: z.string().min(1),
  status: z.string().default('PLANNED'),
  startAt: zOptionalDate,
  targetAt: zOptionalDate,
  metadata: zJsonObject.optional(),
})

export const zWorkItemInput = z.object({
  code: z.string().min(1).optional(),
  workstreamId: z.string().min(1),
  containerId: z.string().nullish(),
  subtype: z.string().min(1),
  title: z.string().min(1),
  status: zWorkStatus.default('PLANNED'),
  assigneeRef: z.string().nullish(),
  weight: z.number().default(1),
  numericValue: z.number().nullish(),
  probability: z.number().min(0).max(1).nullish(),
  metrics: zJsonObject.optional(),
  metadata: zJsonObject.optional(),
  startAt: zOptionalDate,
  targetAt: zOptionalDate,
})

export const zWorkItemUpdate = zWorkItemInput.partial()

export const zMilestoneInput = z.object({
  code: z.string().min(1).optional(),
  projectId: z.string().min(1),
  workstreamId: z.string().nullish(),
  title: z.string().min(1),
  status: zMilestoneStatus.default('PLANNED'),
  weight: z.number().positive().default(1),
  targetAt: zOptionalDate,
  completedAt: zOptionalDate,
})

export const zGateInput = z.object({
  code: z.string().min(1).optional(),
  projectId: z.string().min(1),
  workstreamId: z.string().nullish(),
  title: z.string().min(1),
  status: zGateStatus.default('OPEN'),
  required: z.boolean().default(true),
  evidence: zJsonObject.optional(),
  targetAt: zOptionalDate,
})

export const zDependencyInput = z.object({
  sourceType: zDependencyEndpointType,
  sourceId: z.string().min(1),
  targetType: zDependencyEndpointType,
  targetId: z.string().min(1),
  dependencyType: zDependencyType,
})

export const zRepositoryInput = z.object({
  code: z.string().min(1).optional(),
  provider: z.string().min(1),
  externalRepoId: z.string().nullish(),
  ownerName: z.string().nullish(),
  repoName: z.string().nullish(),
  fullName: z.string().nullish(),
  url: z.string().nullish(),
  defaultBranch: z.string().nullish(),
  status: z.string().default('ACTIVE'),
})

export const zProjectRepositoryInput = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
  role: z.string().min(1).default('PRIMARY'),
  pathScope: z.string().nullish(),
  branch: z.string().nullish(),
})
