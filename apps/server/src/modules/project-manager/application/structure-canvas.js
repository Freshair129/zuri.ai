// @req FR-082 — read-only contained structure and prospective valid move parents.
// @spec ADR-035, SDD-046, SEC-001
// @tested tests/integration/plan-delta-moves.test.js, tests/postgres/pipeline-structure-moves.test.js
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { PIPELINE_NODE_TYPES } from '@/lib/validation/enums'
import { withPipelineTransaction, resolvePipelineAuthority, pipelineError } from './pipeline-transaction'
import { bindPostgresScope } from './project-feature-repository'
import { readPipelineState, pipelineProjectId, pipelineSubtreeHash } from './pipeline-state'
import { preparePlanDelta, readPlanDeltaSnapshot } from '../import/plan-delta-service'

export function nestStructureContainers(rows) {
  const nodes=new Map(rows.map(row=>[row.id,{...row,children:[]}]))
  for(const row of nodes.values())if(row.parentId&&row.parentId!==row.id)nodes.get(row.parentId)?.children.push(row)
  return [...nodes.values()].filter(row=>!row.parentId)
}

export async function readStructureCanvas(projectId,{viewer,db=prisma,move=null}={}) {
  return withPipelineTransaction(db,async(tx,{postgres})=>{
    const authority=await resolvePipelineAuthority(tx,[projectId],viewer,{postgres,write:false})
    if(postgres)await bindPostgresScope(tx,{tenantId:authority.scopes[0].tenant.id,businessId:authority.scopes[0].business.id})
    const plan={schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId,trace:{correlationId:randomUUID(),idempotencyKey:randomUUID()},expectedPreviewHash:null,commands:[]}
    const snapshot=move?await readPlanDeltaSnapshot(tx,plan,authority,[projectId]):null
    const state=snapshot?.before||await readPipelineState(tx,{gateProjectIds:[projectId]})
    const contained=[...state.values()].filter(entry=>{
      if(!['PROJECT',...PIPELINE_NODE_TYPES].includes(entry.type))return false
      try{return pipelineProjectId(state,entry)===projectId}catch{return false}
    })
    if(contained.length>2000)throw pipelineError('GRAPH_LIMIT')
    const nodes=contained.map(({type,id,row})=>({type,id,label:row.title||row.name||row.code,code:row.code,
      parentId:type==='PROJECT'?null:type==='WORKSTREAM'?projectId:row.containerId||row.parentId||row.workstreamId,
      executionMode:row.executionMode||null,subtype:row.subtype||null,hash:pipelineSubtreeHash(state,{type,id})}))
    const targets=[]
    if(move){
      const source=nodes.find(node=>node.id===move.id&&node.type===move.type)
      if(!source||!PIPELINE_NODE_TYPES.includes(source.type))throw pipelineError('SCOPE_UNAVAILABLE',404)
      for(const parent of nodes.filter(node=>source.type==='WORKSTREAM'?node.type==='PROJECT':['WORKSTREAM','WORK_CONTAINER'].includes(node.type))){
        if(parent.id===source.parentId)continue
        plan.commands=[{op:'node.move',type:source.type,id:source.id,expectedEntityHash:source.hash,parent:{type:parent.type,id:parent.id},expectedParentHash:parent.hash}]
        try{
          await preparePlanDelta(tx,plan,authority,[projectId],{snapshot,validationOnly:true})
          targets.push({type:parent.type,id:parent.id})
        }catch(error){if(error.name!=='PipelineError'&&error.name!=='ProgressNumericError')throw error}
      }
    }
    return {projectId,nodes,move,targets}
  },{write:false})
}
