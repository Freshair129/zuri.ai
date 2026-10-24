// @req FR-082 — drag and Move to use the same hash-fenced structure command.
// @spec ADR-035, SDD-046, NFR-008
// @tested tests/unit/pipeline-structure-interactions.test.js
import { projectPlan } from './pipeline-edge-interactions'
const node=(canvas,id)=>{const found=canvas.nodes.find(row=>row.id===id);if(!found)throw new Error('Select work in this Project.');return found}
export function createNodePlan(canvas,parentId,type,fields){
  const parent=node(canvas,parentId)
  return projectPlan(canvas.projectId,[{op:'node.create',clientRef:'node',type,parent:{type:parent.type,id:parent.id},fields}])
}
export function moveNodePlan(canvas,id,parentId){
  const source=node(canvas,id),parent=node(canvas,parentId)
  if(canvas.move?.id!==id||canvas.move?.type!==source.type||!canvas.targets.some(target=>target.id===parent.id&&target.type===parent.type))throw new Error('Choose an available destination.')
  return projectPlan(canvas.projectId,[{op:'node.move',type:source.type,id:source.id,parent:{type:parent.type,id:parent.id},expectedEntityHash:source.hash,expectedParentHash:parent.hash}])
}
