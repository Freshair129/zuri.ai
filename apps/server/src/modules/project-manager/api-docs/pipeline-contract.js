import { PIPELINE_CHANGE_TYPES } from '@/lib/validation/enums'
// @req FR-019, FR-084 — public request/response mirrors of the adopted adapters.
// @spec ADR-035, SDD-046
// @tested tests/integration/pipeline-schema-mirrors.test.js
import { z } from 'zod'
import { zRegisterDelta } from '../import/plan-delta-schema'
import { zExecutionPlanBundle } from '../import/bundle/bundle-schema'
export const zPipelineIssue = z.object({ code: z.string(), path: z.string(), message: z.string() }).strict()
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const change = z.object({ type: z.enum(PIPELINE_CHANGE_TYPES), id: z.string().uuid(), action: z.enum(['CREATE','UPDATE','DELETE']), beforeHash: hash.nullable(), afterHash: hash.nullable() }).strict()
const conflict = z.object({ code: z.string(), path: z.string(), expectedHash: hash.nullable(), actualHash: hash.nullable() }).strict()
const blocker = z.object({ dependencyId: z.string().uuid(), predecessor: z.object({type:z.string(),id:z.string().uuid(),label:z.string(),href:z.string()}), state:z.enum(['DECLARED','INVALID']),reason:z.enum(['UNSATISFIED','EVIDENCE_UNAVAILABLE']) })
const release = z.object({ held:z.boolean(),blockers:z.array(blocker).max(100),truncated:z.boolean(),restricted:z.boolean() }).strict()
export const zPipelineFailure = z.object({ committed: z.literal(false).optional(), valid: z.literal(false).optional(), errors:z.array(zPipelineIssue),conflicts:z.array(conflict),preview:z.null().optional(),previewHash:z.null().optional(),projectId:z.null().optional() }).strict()
export const zDeltaPreview = z.object({ valid:z.literal(true),errors:z.array(zPipelineIssue),conflicts:z.array(conflict),preview:z.object({ commands:z.array(z.unknown()),changes:z.array(change).max(2000),releaseEffects:z.array(z.object({workItemId:z.string().uuid(),before:release.nullable(),after:release})).max(2000) }),previewHash:hash,projectId:z.string().uuid() }).strict()
export const zDeltaCommit = z.object({ committed:z.literal(true),projectId:z.string().uuid(),executionRunId:z.string().uuid(),executionStepId:z.string().uuid(),attemptId:z.string().uuid(),stepKey:z.literal('plan.import.commit'),status:z.literal('SUCCEEDED'),auditEventId:z.string().uuid(),deltaReceipt:z.object({ version:z.literal(1),idempotencyKey:z.string().uuid(),payloadHash:hash,previewHash:hash,beforeHash:hash,afterHash:hash,changes:z.array(change).max(2000),undoable:z.boolean(),inverseOfAuditEventId:z.string().uuid().nullable() }),replay:z.boolean(),errors:z.array(zPipelineIssue),conflicts:z.array(conflict) }).strict()
export function registerPipelineAdapters(registry) {
  registry.register('RegisterDelta', zRegisterDelta)
  registry.register('ExecutionPlanBundle', zExecutionPlanBundle)
  registry.register('PipelineFailure', zPipelineFailure)
  registry.register('DeltaPreview', zDeltaPreview)
  registry.register('DeltaCommit', zDeltaCommit)
  for (const [path, method, schema] of [
    ['/api/dependencies','post',z.object({plan:zRegisterDelta}).strict()],
    ['/api/dependencies/{id}','delete',z.object({plan:zRegisterDelta}).strict()],
    ['/api/import/bundle/dry-run','post',z.object({bundle:zExecutionPlanBundle}).strict()],
    ['/api/import/bundle/commit','post',z.object({bundle:zExecutionPlanBundle}).strict()],
  ]) registry.registerPath({path,method,summary:'Adopted declared-handoff adapter',description:'Preview first with expectedPreviewHash:null; commit the returned hash. Legacy bare writes are refused after scope authorization.',request:{...(path.includes('{id}')?{params:z.object({id:z.string().uuid()})}:{}),body:{required:true,content:{'application/json':{schema}}}},responses:{200:{description:'Authorized preview or accepted receipt'},...Object.fromEntries([400,401,404,409,413,422,503].map(status=>[status,{description:'Typed refusal; no partial apply',content:{'application/json':{schema:zPipelineFailure}}}]))}})
}
