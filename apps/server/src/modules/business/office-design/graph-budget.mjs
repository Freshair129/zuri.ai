// @req FR-294 — reject excess fixed-catalog work before quadratic producer traversals.
// @tested tests/unit/office-design-http.test.js
export function assertOfficeGraphBudget(manifest){
 if(!Array.isArray(manifest?.entities)||manifest.entities.length>20000)throw Error('OFFICE_GRAPH_BUDGET')
 let workflows=0,steps=0
 for(const entity of manifest.entities){if(entity?.type==='workflow')workflows++;if(entity?.type==='workflowStep')steps++;if(workflows>15||steps>63)throw Error('OFFICE_GRAPH_BUDGET')}
}
