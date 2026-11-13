// @req FR-019, FR-084 — published mirrors accept the adopted adapters and reject forged fields.
// @spec ADR-035, SDD-046
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv/dist/2020'
import formats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { zFullPlanEnvelope } from '@/modules/project-manager/import/plan-schema'
import { zPlanDelta, zRegisterDelta } from '@/modules/project-manager/import/plan-delta-schema'
import { zExecutionPlanBundle } from '@/modules/project-manager/import/bundle/bundle-schema'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'
const plan = JSON.parse(readFileSync('contracts/plan-envelope.schema.json'))
const bundle = JSON.parse(readFileSync('contracts/execution-plan-bundle.schema.json'))
const ajv = new Ajv({ strict:false, multipleOfPrecision:12 }); formats(ajv)
ajv.addSchema(plan,'https://zuri.ai/contracts/plan-envelope.schema.json')
const validatePlan = ajv.compile(plan), validateBundle = ajv.compile(bundle)
const validateRegister = ajv.compile({ $ref:plan.$id+'#/$defs/registerDelta' })
const contract = {version:1,deliverable:'Signed drawing',acceptance:{kind:'MANUAL',satisfied:false}}
const delta = () => ({schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId:randomUUID(),trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null,commands:[{op:'dependency.create',clientRef:'edge',source:{type:'WORK_ITEM',id:randomUUID()},target:{type:'WORK_ITEM',id:randomUUID()},dependencyType:'BLOCKS',contract}]})
const fullPlanV12 = (idempotencyKey) => ({
 schemaVersion:'1.2',generatedBy:'schema mirror test',scope:{workspaceCode:'WS-MIRROR'},
 project:{code:'PRJ-MIRROR',name:'Mirror plan',description:'Schema mirror fixture',type:'TRANSFORMATION',status:'ACTIVE'},
 trace:{correlationId:randomUUID(),idempotencyKey},
 domainBinding:{primaryDomainId:'DOM-DEVELOPMENT',supportingDomainIds:[],technicalOwnerDomainId:'TD-PROJECT-MANAGER'},identityRefs:{},
 workstreams:[{code:'WST-MIRROR',name:'Delivery',executionMode:'SOFTWARE_SPRINT',progressStrategy:'TASK_WEIGHT',progressWeight:1,
  executionModeId:'EXM-SOFTWARE-SPRINT',executionContractId:'EXC-SOFTWARE-SPRINT-V1',contractVersion:'1.0.0',containers:[],items:[],milestones:[],gates:[]}],
 repositories:[],dependencies:[],
})
describe('C1 public schema mirrors',()=>{
 it('refuses the reserved prefix for a full plan 1.2 caller key',()=>{
  const input=fullPlanV12(`zai-legacy-plan:v1:${'c'.repeat(64)}`)
  const result=zFullPlanEnvelope.safeParse(input)
  expect(result.success).toBe(false)
  expect(JSON.stringify(result.error.issues)).toContain('trace.idempotencyKey uses the reserved prefix zai-legacy-plan:')
  expect(validatePlan(input)).toBe(false)
 })
 it('publishes strict delta and register structural variants',()=>{
  const input=delta();expect(zPlanDelta.safeParse(input).success).toBe(true);expect(validatePlan(input),JSON.stringify(validatePlan.errors)).toBe(true)
  const reserved={...input,trace:{...input.trace,idempotencyKey:`zai-legacy-plan:v1:${'a'.repeat(64)}`}}
  const reservedResult=zPlanDelta.safeParse(reserved)
  expect(reservedResult.success).toBe(false)
  expect(JSON.stringify(reservedResult.error.issues)).toContain('trace.idempotencyKey uses the reserved prefix zai-legacy-plan:')
  expect(validatePlan(reserved)).toBe(false)
  const {projectId,...rest}=input,register={...rest,kind:'DEPENDENCY_REGISTER',projectIds:[projectId]};expect(zRegisterDelta.safeParse(register).success).toBe(true);expect(validateRegister(register)).toBe(true)
  for(const forged of [{...input,execute:'x'},{...input,commands:[{...input.commands[0],contract:{...contract,acceptance:{...contract.acceptance,actorPersonId:randomUUID()}}}]}]) {expect(zPlanDelta.safeParse(forged).success).toBe(false);expect(validatePlan(forged)).toBe(false)}
 })
 it('accepts Bundle1.1 with full nested plans and refuses nested deltas or missing handoffs',()=>{
  const input={kind:'EXECUTION_PLAN_BUNDLE',schemaVersion:'1.1',manifest:{code:'PKG',title:'Programme'},scope:{businessCode:'BUS'},projects:[{bundleProjectRef:'A',plan:{schemaVersion:'1.0',project:{code:'P-A',name:'A'},workstreams:[]}}],dependencies:[{sourceProjectRef:'A',targetProjectRef:'B',relation:'BLOCKS',contract}],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID(),sourceType:'HUMAN'},expectedPreviewHash:null}
  expect(zExecutionPlanBundle.safeParse(input).success).toBe(true);expect(validateBundle(input),JSON.stringify(validateBundle.errors)).toBe(true)
  const reserved={...input,trace:{...input.trace,idempotencyKey:`zai-legacy-plan:v1:${'b'.repeat(64)}`}}
  const reservedResult=zExecutionPlanBundle.safeParse(reserved)
  expect(reservedResult.success).toBe(false)
  expect(JSON.stringify(reservedResult.error.issues)).toContain('trace.idempotencyKey uses the reserved prefix zai-legacy-plan:')
  expect(validateBundle(reserved)).toBe(false)
  const nested={...input,projects:[{bundleProjectRef:'A',plan:delta()}]};expect(zExecutionPlanBundle.safeParse(nested).success).toBe(false);expect(validateBundle(nested)).toBe(false)
  const missing=structuredClone(input);delete missing.dependencies[0].contract;expect(zExecutionPlanBundle.safeParse(missing).success).toBe(false);expect(validateBundle(missing)).toBe(false)
 })
 it('documents both transports, typed failures and strict response/receipt shapes',()=>{
  const doc=buildOpenApiDocument()
  expect(doc.components.schemas.PlanEnvelope.anyOf).toHaveLength(2)
  for(const path of ['/api/import/commit','/api/import/dry-run','/api/dependencies','/api/import/bundle/commit','/api/import/bundle/dry-run']) for(const status of [400,401,404,409,413,422,503]) expect(doc.paths[path].post.responses[status],path+' '+status).toBeTruthy()
  expect(doc.components.schemas.DeltaCommit.additionalProperties).toBe(false)
  expect(doc.components.schemas.DeltaPreview.properties.preview.properties.releaseEffects.maxItems).toBe(2000)
  expect(doc.components.schemas.CommitResponse.properties.replay).toMatchObject({type:'boolean',description:'true when the same plan was already committed and nothing was re-applied'})
  expect(doc.components.schemas.CommitResponse.required ?? []).not.toContain('replay')
 })
})
