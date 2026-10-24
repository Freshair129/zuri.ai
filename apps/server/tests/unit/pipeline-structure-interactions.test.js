// @req FR-082 — both structure gestures produce the same bounded delta.
// @spec ADR-035, SDD-046, NFR-008
import { it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const load=async()=>{expect(existsSync('src/modules/project-manager/components/pipeline-structure-interactions.js')).toBe(true);return import('@/modules/project-manager/components/pipeline-structure-interactions')}
const p=randomUUID(),ws=randomUUID(),item=randomUUID()
const canvas=()=>({projectId:p,nodes:[{id:p,type:'PROJECT',hash:'a'.repeat(64)},{id:ws,type:'WORKSTREAM',hash:'b'.repeat(64)},{id:item,type:'WORK_ITEM',hash:'c'.repeat(64)}],move:{type:'WORK_ITEM',id:item},targets:[{type:'WORKSTREAM',id:ws}]})
it('creates a child using an authorized contained parent without adding layout fields',async()=>{
 const {createNodePlan}=await load();const plan=createNodePlan(canvas(),ws,'WORK_ITEM',{code:'NEW',title:'New work',subtype:'TASK'})
 expect(plan.commands).toEqual([{op:'node.create',clientRef:'node',type:'WORK_ITEM',parent:{type:'WORKSTREAM',id:ws},fields:{code:'NEW',title:'New work',subtype:'TASK'}}])
 expect(plan).toMatchObject({schemaVersion:'1.3',kind:'PROJECT_DELTA',projectId:p,expectedPreviewHash:null})
 expect(()=>createNodePlan(canvas(),randomUUID(),'WORK_ITEM',{})).toThrow()
})
it('moves only through the server-approved target set and binds both subtree hashes',async()=>{
 const {moveNodePlan}=await load();expect(moveNodePlan(canvas(),item,ws).commands).toEqual([{op:'node.move',type:'WORK_ITEM',id:item,parent:{type:'WORKSTREAM',id:ws},expectedEntityHash:'c'.repeat(64),expectedParentHash:'b'.repeat(64)}])
 expect(()=>moveNodePlan(canvas(),item,p)).toThrow()
 expect(()=>moveNodePlan({...canvas(),move:{type:'WORK_ITEM',id:randomUUID()}},item,ws)).toThrow()
})
