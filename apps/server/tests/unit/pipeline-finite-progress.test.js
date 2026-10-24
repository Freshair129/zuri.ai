// @req FR-084 — adopted delta bounds must also reject legacy arithmetic overflow.
import {describe,it,expect} from 'vitest'
import {calculateWorkstreamProgress} from '@/modules/project-manager/progress/strategies'
import {rollupProject} from '@/modules/project-manager/progress/rollup'
const huge=Number.MAX_VALUE
const cases={TASK_WEIGHT:{items:[{weight:huge,status:'DONE'},{weight:huge,status:'DONE'}]},RECORD_VALIDATION:{items:[{metrics:{recordsTotal:huge}},{metrics:{recordsTotal:huge}}]},WEIGHTED_PIPELINE:{items:[{subtype:'DEAL',numericValue:huge,status:'DONE'},{subtype:'DEAL',numericValue:huge,status:'DONE'}]},KPI_ATTAINMENT:{items:[{metrics:{cpa:huge}}],viewConfig:{kpis:[{key:'cpa',target:1e-308,direction:'down'}]}},MILESTONE_READINESS:{milestones:[{weight:huge,status:'DONE'},{weight:huge,status:'DONE'}]},SLA_SCORE:{items:[{metrics:{slaMet:huge,slaTotal:huge}},{metrics:{slaMet:huge,slaTotal:huge}}]},EXPANSION_READINESS:{items:[{weight:huge,status:'DONE'},{weight:huge,status:'DONE'}]}}
describe('strict arithmetic through existing owning calculators',()=>{for(const [strategy,bundle] of Object.entries(cases))it(strategy+' rejects nonfinite intermediates even when its legacy display would clamp',()=>{expect(()=>calculateWorkstreamProgress(strategy,bundle,{strictFinite:true})).toThrow('NUMERIC_OVERFLOW')})
it('rejects weighted rollup product overflow',()=>{expect(()=>rollupProject([{progressWeight:huge,percent:100}],{strictFinite:true})).toThrow('NUMERIC_OVERFLOW')})})
