// @req FR-085 — exact protected-entry truth table; identical status is not entry.
// @spec ADR-035
import {it,expect} from 'vitest'
import {existsSync} from 'node:fs'
it('protects only entry into start/review/done, including new items and membership changes',async()=>{
 expect(existsSync('src/modules/project-manager/application/work-release-policy.js')).toBe(true)
 const {requiresWorkRelease}=await import('@/modules/project-manager/application/work-release-policy')
 for(const status of ['PLANNED','READY','IN_PROGRESS','REVIEW','BLOCKED','DONE','CANCELLED']) {
  const next={status,workstreamId:'ws',containerId:null}
  expect(requiresWorkRelease(null,next)).toBe(['IN_PROGRESS','REVIEW','DONE'].includes(status))
  expect(requiresWorkRelease({...next},next)).toBe(false)
  for(const oldStatus of ['PLANNED','READY','IN_PROGRESS','REVIEW','BLOCKED','DONE','CANCELLED'])
   expect(requiresWorkRelease({...next,status:oldStatus},next)).toBe(oldStatus!==status && ['IN_PROGRESS','REVIEW','DONE'].includes(status))
  expect(requiresWorkRelease({...next,containerId:'old'},next)).toBe(['IN_PROGRESS','REVIEW','DONE'].includes(status))
 }
})

import {randomUUID} from 'node:crypto'
import {pipelineReleaseState,pipelineKey,buildPipelineReleaseIndex} from '@/modules/project-manager/application/pipeline-state'
it('covers every adopted endpoint/type/start-finish combination and legacy/Gate states',async()=>{
 for(const endpoint of ['PROJECT','WORKSTREAM','WORK_CONTAINER','WORK_ITEM','MILESTONE','GATE'])
 for(const type of ['BLOCKS','REQUIRES','START_AFTER','FINISH_BEFORE','RELATES_TO','SUPERSEDES','DERIVES_FROM'])
 for(const gateStatus of ['OPEN','BLOCKED','PASSED','WAIVED','MISSING','LEGACY'])
 for(const status of ['IN_PROGRESS','REVIEW','DONE']) {
  const state=new Map(),add=(type,row)=>{state.set(pipelineKey(type,row.id),{type,id:row.id,row});return row}
  const project=add('PROJECT',{id:randomUUID(),businessId:'biz'}),ws=add('WORKSTREAM',{id:randomUUID(),projectId:project.id})
  const container=add('WORK_CONTAINER',{id:randomUUID(),workstreamId:ws.id,parentId:null})
  const child=add('WORK_CONTAINER',{id:randomUUID(),workstreamId:ws.id,parentId:container.id})
  const item=add('WORK_ITEM',{id:randomUUID(),workstreamId:ws.id,containerId:child.id})
  const predProject=add('PROJECT',{id:randomUUID(),name:'Predecessor Project'}),predWs=add('WORKSTREAM',{id:randomUUID(),projectId:predProject.id})
  const predecessor=add('WORK_ITEM',{id:randomUUID(),title:'Predecessor',workstreamId:predWs.id,containerId:null})
  let successor=endpoint==='PROJECT'?project:endpoint==='WORKSTREAM'?ws:endpoint==='WORK_CONTAINER'?container:item
  if(['MILESTONE','GATE'].includes(endpoint))successor=add(endpoint,{id:randomUUID(),projectId:project.id,workstreamId:ws.id})
  const gateId=randomUUID()
  if(gateStatus!=='MISSING')add('GATE',{id:gateId,projectId:predProject.id,workstreamId:predWs.id,status:gateStatus})
  const source=type==='REQUIRES'?{type:endpoint,id:successor.id}:{type:'WORK_ITEM',id:predecessor.id}
  const target=type==='REQUIRES'?{type:'WORK_ITEM',id:predecessor.id}:{type:endpoint,id:successor.id}
  add('DEPENDENCY',{id:randomUUID(),sourceType:source.type,sourceId:source.id,targetType:target.type,targetId:target.id,dependencyType:type,contractJson:gateStatus==='LEGACY'?null:JSON.stringify({version:1,deliverable:'Drawing',acceptance:{kind:'GATE',gateId}})})
  const result=await pipelineReleaseState(state,item.id,{tx:{},allowedProjectIds:[project.id,predProject.id],protectedStatus:status})
  const indexed=await pipelineReleaseState(state,item.id,{tx:{},allowedProjectIds:[project.id,predProject.id],protectedStatus:status,releaseIndex:buildPipelineReleaseIndex(state)})
  expect(indexed).toEqual(result)
  const expected=['BLOCKS','REQUIRES','START_AFTER','FINISH_BEFORE'].includes(type) && !['PASSED','WAIVED','LEGACY'].includes(gateStatus) && (type!=='FINISH_BEFORE'||status==='DONE')
  expect(result.held,JSON.stringify({endpoint,type,gateStatus,status})).toBe(expected)
  expect(Object.keys(result).sort()).toEqual(['blockers','held','restricted','truncated'])
 }
})

it('sorts and caps blockers at100; one opaque scope redacts the entire list',async()=>{
 const state=new Map(),add=(type,row)=>{state.set(pipelineKey(type,row.id),{type,id:row.id,row});return row}
 const project=add('PROJECT',{id:randomUUID(),name:'Owned'}),ws=add('WORKSTREAM',{id:randomUUID(),projectId:project.id}),item=add('WORK_ITEM',{id:randomUUID(),workstreamId:ws.id})
 const gate=add('GATE',{id:randomUUID(),projectId:project.id,workstreamId:ws.id,status:'OPEN'})
 const edges=[]
 for(let index=0;index<101;index++) {
  const pred=add('WORK_ITEM',{id:randomUUID(),title:'Predecessor '+index,workstreamId:ws.id})
  edges.push(add('DEPENDENCY',{id:randomUUID(),sourceType:'WORK_ITEM',sourceId:pred.id,targetType:'WORK_ITEM',targetId:item.id,dependencyType:'BLOCKS',contractJson:JSON.stringify({version:1,deliverable:'Drawing',acceptance:{kind:'GATE',gateId:gate.id}})}))
 }
 const result=await pipelineReleaseState(state,item.id,{tx:{},allowedProjectIds:[project.id]})
 expect(result).toMatchObject({held:true,truncated:true,restricted:false});expect(result.blockers).toHaveLength(100)
 expect(result.blockers.map(row=>row.dependencyId)).toEqual(edges.map(row=>row.id).sort().slice(0,100))
 edges[0].sourceId=randomUUID()
 expect(await pipelineReleaseState(state,item.id,{tx:{},allowedProjectIds:[project.id]})).toEqual({held:true,blockers:[],truncated:false,restricted:true})
})

it('indexed evaluation never rescans graph values for each listed item',async()=>{
 const state=new Map(),project={id:randomUUID()},ws={id:randomUUID(),projectId:project.id},items=[]
 const add=(type,row)=>state.set(pipelineKey(type,row.id),{type,id:row.id,row})
 add('PROJECT',project);add('WORKSTREAM',ws)
 for(let i=0;i<50;i++){const row={id:randomUUID(),workstreamId:ws.id};items.push(row);add('WORK_ITEM',row)}
 let scans=0;const original=state.values.bind(state);state.values=()=>{scans++;return original()}
 const index=buildPipelineReleaseIndex(state);const afterIndex=scans
 for(const item of items)expect((await pipelineReleaseState(state,item.id,{tx:{},allowedProjectIds:[project.id],releaseIndex:index})).held).toBe(false)
 expect(scans).toBe(afterIndex)
})
