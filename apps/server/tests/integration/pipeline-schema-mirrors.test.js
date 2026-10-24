// @req FR-019, FR-084 — published mirrors accept the adopted adapters and reject forged fields.
// @spec ADR-035, SDD-046
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv/dist/2020'
import formats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
describe('C1 public schema mirrors',()=>{
 it('publishes strict delta and register structural variants',()=>{
  const input=delta();expect(zPlanDelta.safeParse(input).success).toBe(true);expect(validatePlan(input),JSON.stringify(validatePlan.errors)).toBe(true)
  const {projectId,...rest}=input,register={...rest,kind:'DEPENDENCY_REGISTER',projectIds:[projectId]};expect(zRegisterDelta.safeParse(register).success).toBe(true);expect(validateRegister(register)).toBe(true)
  for(const forged of [{...input,execute:'x'},{...input,commands:[{...input.commands[0],contract:{...contract,acceptance:{...contract.acceptance,actorPersonId:randomUUID()}}}]}]) {expect(zPlanDelta.safeParse(forged).success).toBe(false);expect(validatePlan(forged)).toBe(false)}
 })
 it('accepts Bundle1.1 with full nested plans and refuses nested deltas or missing handoffs',()=>{
  const input={kind:'EXECUTION_PLAN_BUNDLE',schemaVersion:'1.1',manifest:{code:'PKG',title:'Programme'},scope:{businessCode:'BUS'},projects:[{bundleProjectRef:'A',plan:{schemaVersion:'1.0',project:{code:'P-A',name:'A'},workstreams:[]}}],dependencies:[{sourceProjectRef:'A',targetProjectRef:'B',relation:'BLOCKS',contract}],trace:{correlationId:randomUUID(),idempotencyKey:randomUUID(),sourceType:'HUMAN'},expectedPreviewHash:null}
  expect(zExecutionPlanBundle.safeParse(input).success).toBe(true);expect(validateBundle(input),JSON.stringify(validateBundle.errors)).toBe(true)
  const nested={...input,projects:[{bundleProjectRef:'A',plan:delta()}]};expect(zExecutionPlanBundle.safeParse(nested).success).toBe(false);expect(validateBundle(nested)).toBe(false)
  const missing=structuredClone(input);delete missing.dependencies[0].contract;expect(zExecutionPlanBundle.safeParse(missing).success).toBe(false);expect(validateBundle(missing)).toBe(false)
 })
 it('documents both transports, typed failures and strict response/receipt shapes',()=>{
  const doc=buildOpenApiDocument()
  expect(doc.components.schemas.PlanEnvelope.anyOf).toHaveLength(2)
  for(const path of ['/api/import/commit','/api/import/dry-run','/api/dependencies','/api/import/bundle/commit','/api/import/bundle/dry-run']) for(const status of [400,401,404,409,413,422,503]) expect(doc.paths[path].post.responses[status],path+' '+status).toBeTruthy()
  expect(doc.components.schemas.DeltaCommit.additionalProperties).toBe(false)
  expect(doc.components.schemas.DeltaPreview.properties.preview.properties.releaseEffects.maxItems).toBe(2000)
 })
})
