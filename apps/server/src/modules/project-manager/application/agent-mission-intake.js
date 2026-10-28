import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createItem } from './work-service'
import { assertWorkstreamWritable } from './project-authorization'
import { withPipelineTransaction } from './pipeline-transaction'

// @req TASK-ZAI-012 / PM-MISSION-01 — create one ordinary, PLANNED WorkItem
// from a provenance-verified Agent mission submission. This service does not
// grant execution or release authority.

const zMissionInput = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  workstreamId: z.string().trim().min(1),
  containerId: z.string().trim().min(1).nullish(),
  title: z.string().trim().min(1).max(240),
  subtype: z.string().trim().min(1).max(80),
  weight: z.number().positive().finite().optional(),
  startAt: z.coerce.date().nullish(),
  targetAt: z.coerce.date().nullish(),
  // Opaque input is only evidence for the injected verifier. It is never
  // interpreted as identity, role, tier, scope, or approval authority here.
  sourceProof: z.unknown().refine(value => value !== undefined && value !== null, 'source proof is required'),
}).strict()

function refusal(code, status) {
  return Object.assign(new Error(code), { code, status })
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  }
  return value instanceof Date ? value.toISOString() : value
}

export function agentMissionRequestHash({ scope, item, sourceProof, submittedByPersonId }) {
  const canonical = JSON.stringify(stable({
    scope: { projectId: scope.projectId, workstreamId: scope.workstreamId, businessId: scope.businessId, tenantId: scope.tenantId },
    item,
    sourceProof,
    submittedByPersonId,
  }))
  return createHash('sha256').update(canonical).digest('hex')
}

async function resolveTargetScope(db, workstreamId) {
  const workstream = await db.workstream.findUnique({ where: { id: workstreamId } })
  if (!workstream || workstream.deletedAt) throw refusal('WORKSTREAM_NOT_FOUND', 404)
  const project = await db.project.findUnique({
    where: { id: workstream.projectId },
    include: { business: true, workspace: { include: { business: true } } },
  })
  if (!project || project.deletedAt) throw refusal('PROJECT_NOT_FOUND', 404)
  const business = project.business || project.workspace?.business
  const tenantId = business?.tenantId || project.workspace?.tenantId
  if (!business?.id || !tenantId) throw refusal('MISSION_SCOPE_UNAVAILABLE', 404)
  return {
    projectId: project.id,
    workstreamId: workstream.id,
    businessId: business.id,
    tenantId,
  }
}

function assertProvenancePort(port) {
  if (!port || typeof port.verify !== 'function' ||
      typeof port.findByIdempotencyKey !== 'function' || typeof port.record !== 'function') {
    throw refusal('MISSION_PROVENANCE_UNAVAILABLE', 503)
  }
}

/**
 * Create the PM-side mission intake service.
 *
 * `provenancePort` is an injected cross-domain boundary, deliberately separate
 * from Agent code and schema. It must verify the exact target and request hash,
 * load an existing idempotency binding, and record that binding in the caller's
 * database transaction. The runtime port stays unavailable until Integrator
 * wires the adopted provenance schema and Agent-owned verification adapter.
 */
export function createAgentMissionIntakeService({
  db = prisma,
  provenancePort = null,
  workItemWriter = createItem,
  authorizeWorkstream = assertWorkstreamWritable,
  resolveScope = resolveTargetScope,
  transaction = withPipelineTransaction,
} = {}) {
  return {
    async submit(input, { viewer } = {}) {
      const parsed = zMissionInput.safeParse(input)
      if (!parsed.success) throw refusal('MISSION_INPUT_INVALID', 400)
      const request = parsed.data
      const personId = viewer?.principal?.id
      if (!personId) throw refusal('UNAUTHENTICATED', 401)

      // Resolve/authenticate scope before asking the other domain to inspect
      // provenance, so the port cannot become a cross-Business oracle.
      await authorizeWorkstream(viewer, request.workstreamId, { db })
      const scope = await resolveScope(db, request.workstreamId)
      const requestHash = agentMissionRequestHash({
        scope,
        item: {
          containerId: request.containerId ?? null,
          title: request.title,
          subtype: request.subtype,
          weight: request.weight ?? 1,
          startAt: request.startAt ?? null,
          targetAt: request.targetAt ?? null,
        },
        sourceProof: request.sourceProof,
        submittedByPersonId: personId,
      })

      assertProvenancePort(provenancePort)
      const verifiedSource = await provenancePort.verify({
        sourceProof: request.sourceProof,
        target: scope,
        requestHash,
      })
      if (!verifiedSource || verifiedSource.verified !== true) {
        throw refusal('MISSION_PROVENANCE_INVALID', 403)
      }

      return transaction(db, async tx => {
        // Recheck PM authorization and derive scope again inside the transaction
        // before writing. A verifier response cannot carry target authority.
        await authorizeWorkstream(viewer, request.workstreamId, { db: tx })
        const currentScope = await resolveScope(tx, request.workstreamId)
        if (JSON.stringify(stable(currentScope)) !== JSON.stringify(stable(scope))) {
          throw refusal('MISSION_SCOPE_CHANGED', 409)
        }

        const existing = await provenancePort.findByIdempotencyKey({
          scope: currentScope,
          idempotencyKey: request.idempotencyKey,
        }, { db: tx })
        if (existing) {
          if (existing.requestHash !== requestHash) throw refusal('MISSION_IDEMPOTENCY_CONFLICT', 409)
          const workItem = await tx.workItem.findFirst({
            where: { id: existing.workItemId, workstreamId: currentScope.workstreamId, deletedAt: null },
          })
          if (!workItem) throw refusal('MISSION_BINDING_UNAVAILABLE', 409)
          return { workItem, provenance: existing, replayed: true }
        }

        const activeSubmitter = await tx.membership.findFirst({
          where: {
            tenantId: currentScope.tenantId,
            businessId: currentScope.businessId,
            personId,
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            suspendedAt: null,
            revokedAt: null,
          },
          select: { id: true },
        })
        if (!activeSubmitter) throw refusal('MISSION_SUBMITTER_NOT_IN_BUSINESS', 403)

        const workItem = await workItemWriter({
          workstreamId: currentScope.workstreamId,
          containerId: request.containerId ?? null,
          subtype: request.subtype,
          title: request.title,
          status: 'PLANNED',
          assigneeRef: personId,
          weight: request.weight ?? 1,
          startAt: request.startAt ?? null,
          targetAt: request.targetAt ?? null,
        }, { viewer, db: tx })

        const provenance = await provenancePort.record({
          scope: currentScope,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          workItemId: workItem.id,
          submittedByPersonId: personId,
          verifiedSource,
        }, { db: tx })
        return { workItem, provenance, replayed: false }
      })
    },
  }
}

// Safe default until the separately owned Agent verification port and the
// Integrator-owned provenance record are wired. The API therefore fails closed.
export const agentMissionIntakeService = createAgentMissionIntakeService()
