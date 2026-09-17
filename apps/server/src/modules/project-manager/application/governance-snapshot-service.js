import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import {
  createGovernanceEvidencePort,
  GovernanceSourceVerificationError,
  normalizeSourceManifest,
  toGovernanceSnapshotDto,
  verifyGovernanceSnapshotIntent,
  zCaptureSnapshotInput,
  zGovernanceSnapshot,
} from './governance-source-verifier'
import { runProjectFeatureMutation, zMutationReceipt } from './project-feature-service'
import { createProjectFeatureRepository } from './project-feature-repository'

// @req FR-252 — GovernanceSnapshot capture persists only a server-verified
// bound-commit result through the locked Project Feature mutation pipeline.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/integration/governance-snapshot-capture.test.js

const SNAPSHOT_OPERATION = 'CAPTURE_GOVERNANCE_SNAPSHOT'

export const zSnapshotCaptureResult = z.object({
  snapshot: zGovernanceSnapshot,
  receipt: zMutationReceipt,
}).strict().superRefine((value, ctx) => {
  if (value.receipt.operation !== SNAPSHOT_OPERATION) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['receipt', 'operation'], message: 'Snapshot capture requires its own receipt operation.' })
  }
  if (value.snapshot.id !== value.receipt.resourceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['receipt', 'resourceId'], message: 'Receipt must identify the returned snapshot.' })
  }
})

function sourceError(code, status, retryable, reason) {
  return new GovernanceSourceVerificationError(code, status, retryable, reason)
}

function invalid(reason) {
  return sourceError('SNAPSHOT_INVALID', 422, false, reason)
}

function unavailable(reason) {
  return sourceError('DATA_INTEGRITY_UNAVAILABLE', 503, true, reason)
}

function normalizeCaptureCommand(input) {
  const parsed = zCaptureSnapshotInput.safeParse(input)
  if (!parsed.success) throw invalid('capture-input-schema')
  const normalized = normalizeSourceManifest(parsed.data.sourceManifest, {
    manifestHash: parsed.data.manifestHash,
  })
  return {
    repositoryId: parsed.data.repositoryId,
    commitSha: parsed.data.commitSha,
    manifestHash: normalized.manifestHash,
    sourceManifest: normalized.manifest,
  }
}

async function findCaptureSource(tx, scope, command, projectId) {
  if (!tx?.repository?.findMany || !tx?.projectRepository?.findMany) throw unavailable('database-binding-unavailable')
  if (!scope?.project?.id || scope.project.id !== projectId) throw invalid('project-scope')
  const repositories = await tx.repository.findMany({
    where: {
      id: command.repositoryId,
      businessId: scope.businessId,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      businessId: true,
      status: true,
    },
  })
  const links = await tx.projectRepository.findMany({
    where: {
      projectId,
      repoId: command.repositoryId,
    },
    select: {
      id: true,
      projectId: true,
      repoId: true,
      role: true,
      repo: {
        select: {
          id: true,
          businessId: true,
          status: true,
        },
      },
    },
  })
  if (repositories.length !== 1 || links.length !== 1) throw invalid('project-repository-cardinality')
  const repository = repositories[0]
  const projectRepository = links[0]
  if (repository.id !== command.repositoryId
    || repository.businessId !== scope.businessId
    || repository.status !== 'ACTIVE'
    || projectRepository.id === undefined
    || projectRepository.projectId !== projectId
    || projectRepository.repoId !== command.repositoryId
    || projectRepository.repo?.id !== command.repositoryId
    || projectRepository.repo?.businessId !== scope.businessId
    || projectRepository.repo?.status !== 'ACTIVE') {
    throw invalid('project-repository-scope')
  }
  return { repository, projectRepository }
}

function snapshotEtag(snapshot) {
  return `"GOVERNANCE_SNAPSHOT/${snapshot.id}/${snapshot.manifestHash}"`
}

function snapshotData({ scope, source, verified, now }) {
  return {
    id: randomUUID(),
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    createdAt: now,
    repositoryId: source.repository.id,
    projectRepositoryId: source.projectRepository.id,
    checkoutBindingId: verified.checkoutBindingId,
    commitSha: verified.commitSha,
    manifestHash: verified.manifestHash,
    capturedAt: now,
    verifiedAt: new Date(verified.proof.verifiedAt),
    verifierId: verified.proof.verifierId,
    verifierVersion: verified.proof.verifierVersion,
    proofId: verified.proof.proofId,
    verificationProof: JSON.stringify(verified.proof),
    validationStatus: verified.validationStatus,
    sourceManifest: JSON.stringify(verified.manifest),
  }
}

async function findSnapshotForReplay({ db, repository, projectId, viewer, resourceId }) {
  const scopedRepository = repository || createProjectFeatureRepository({ db })
  if (!scopedRepository || typeof scopedRepository.withProjectTransaction !== 'function') throw unavailable('replay-read-unavailable')
  const row = await scopedRepository.withProjectTransaction(
    { projectId, viewer, mode: 'read' },
    async (tx, scope) => tx.governanceSnapshot.findFirst({
      where: {
        id: resourceId,
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        validationStatus: 'VALID',
      },
    }).then(async (row) => {
      if (!row) return row
      if (typeof tx.projectRepository?.findMany !== 'function') throw unavailable('replayed-snapshot-binding-unavailable')
      const links = await tx.projectRepository.findMany({
        where: { id: row.projectRepositoryId, projectId: scope.project.id, repoId: row.repositoryId },
        select: { id: true, projectId: true, repoId: true },
      })
      if (links.length !== 1 || links[0].id !== row.projectRepositoryId) throw unavailable('replayed-snapshot-binding-unavailable')
      return row
    }),
  )
  if (!row) throw unavailable('replayed-snapshot-unavailable')
  return toGovernanceSnapshotDto(row)
}

export async function captureGovernanceSnapshot(
  projectId,
  input,
  {
    db = prisma,
    repository = null,
    viewer,
    requestId,
    sessionId = null,
    session = null,
    idempotencyKey,
    evidencePort = null,
    env = process.env,
    gitRunner = null,
  } = {},
) {
  const port = evidencePort || createGovernanceEvidencePort({ env, gitRunner })
  let capturedSnapshot = null
  const result = await runProjectFeatureMutation({
    db,
    repository,
    projectId,
    viewer,
    operation: SNAPSHOT_OPERATION,
    httpMethod: 'POST',
    targetType: 'PROJECT',
    targetId: projectId,
    resourceType: 'GOVERNANCE_SNAPSHOT',
    command: input,
    normalize: normalizeCaptureCommand,
    requestId,
    sessionId,
    session,
    idempotencyKey,
    evidencePort: port,
    callback: async (tx, scope, context) => {
      const command = context.command
      const source = await findCaptureSource(tx, scope, command, projectId)
      const verified = await verifyGovernanceSnapshotIntent({
        projectId,
        scope,
        repository: source.repository,
        projectRepository: source.projectRepository,
        input: command,
        env,
        gitRunner,
        now: context.now,
      })
      const row = await tx.governanceSnapshot.create({
        data: snapshotData({ scope, source, verified, now: context.now }),
      })
      capturedSnapshot = toGovernanceSnapshotDto(row)
      return {
        resourceId: row.id,
        version: null,
        etag: snapshotEtag(row),
        auditEntityId: row.id,
        after: capturedSnapshot,
        snapshot: capturedSnapshot,
      }
    },
  })

  // A transaction retry may return another call's committed receipt after
  // our own effect was rolled back. Only that receipt's resource may escape.
  let snapshot = capturedSnapshot?.id === result.receipt?.resourceId ? capturedSnapshot : null
  if (!snapshot && result.receipt?.resourceId) {
    snapshot = await findSnapshotForReplay({
      db,
      repository,
      projectId,
      viewer,
      resourceId: result.receipt.resourceId,
    })
  }
  if (!snapshot) throw unavailable('capture-result-unavailable')
  const response = zSnapshotCaptureResult.parse({ snapshot, receipt: result.receipt })
  return {
    ...response,
    httpStatus: result.replayed ? 200 : 201,
    replayed: result.replayed,
  }
}

export function toPublicGovernanceSnapshotError(error) {
  if (error?.code === 'SNAPSHOT_INVALID') {
    return { status: 422, code: 'SNAPSHOT_INVALID', message: 'Snapshot evidence is invalid.', retryable: false }
  }
  if (error?.code === 'DATA_INTEGRITY_UNAVAILABLE') {
    return { status: 503, code: 'DATA_INTEGRITY_UNAVAILABLE', message: 'Snapshot evidence is unavailable.', retryable: true }
  }
  return null
}
