// @req FR-084 — strict validation errors retain bounded RFC6901 input paths.
// @spec ADR-035, SDD-046
import {it,expect} from 'vitest'
import {dryRunPlanDelta} from '@/modules/project-manager/import/plan-delta-service'
import {randomUUID} from 'node:crypto'
it('preserves safe command field paths and escaped unknown keys without echoing input values',async()=>{
 const input={schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId:randomUUID(),trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null,commands:[{op:'dependency.create',clientRef:'edge',source:{type:'PROJECT',id:randomUUID()},target:{type:'PROJECT',id:randomUUID()},dependencyType:'BLOCKS',contract:{version:1,deliverable:7,acceptance:{kind:'MANUAL',satisfied:false}}}], 'bad/key~':'never echo this'}
 const dry=await dryRunPlanDelta(input)
 expect(dry.valid).toBe(false);expect(dry.errors).toContainEqual({code:'INVALID_ENVELOPE',path:'/commands/0/contract/deliverable',message:'INVALID_ENVELOPE'})
 expect(dry.errors.some(error=>error.path==='/bad~1key~0')).toBe(true)
 expect(JSON.stringify(dry.errors)).not.toContain('never echo this');expect(dry.errors.length).toBeLessThanOrEqual(50)
})
