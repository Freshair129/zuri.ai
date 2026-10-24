// @req FR-084 — strict handoff payload, persisted provenance and CAS fingerprints.
// @spec BR-017, ADR-035
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const load = async () => {
  expect(existsSync('src/modules/project-manager/application/handoff-contract.js'), 'C1 handoff implementation exists').toBe(true)
  return import('@/modules/project-manager/application/handoff-contract')
}
const client = () => ({ version: 1, deliverable: '  Signed drawing  ', acceptance: { kind: 'MANUAL', satisfied: false } })
describe('adopted HandoffContractV1', () => {
  it('loads the shared contract in the unbundled recovery CLI process', () => {
    const stdout = execFileSync(process.execPath, ['scripts/phase-b-protected-export.mjs', '--help'], { encoding: 'utf8', windowsHide: true })
    expect(stdout).toContain('Usage: node apps/server/scripts/phase-b-protected-export.mjs')
  })
  it('normalizes deliverable and refuses forged/unknown client fields', async () => {
    const { zHandoffContractV1 } = await load()
    expect(zHandoffContractV1.parse(client()).deliverable).toBe('Signed drawing')
    for (const input of [{...client(), script:'x'}, {...client(),acceptance:{...client().acceptance,actorPersonId:randomUUID()}}, {...client(),deliverable:' '}, {...client(),version:2}]) expect(zHandoffContractV1.safeParse(input).success).toBe(false)
  })
  it('SQL NULL alone is undeclared; malformed/JSON-null and missing provenance are INVALID', async () => {
    const { handoffContractState } = await load()
    expect(handoffContractState(null)).toBe('UNDECLARED')
    for(const value of ['null','{',JSON.stringify(client())]) expect(handoffContractState(value)).toBe('INVALID')
  })
  it('binds manual actor/time/audit, retaining provenance only on replay', async () => {
    const { persistHandoffContract, handoffContractState } = await load()
    const actorPersonId=randomUUID(),decisionAuditEventId=randomUUID(),decisionAt='2026-10-24T00:00:00.000Z'
    const stored=persistHandoffContract({...client(),acceptance:{kind:'MANUAL',satisfied:true}},{actorPersonId,decisionAuditEventId,decisionAt})
    expect(stored.acceptance).toEqual({kind:'MANUAL',satisfied:true,actorPersonId,decisionAt,decisionAuditEventId})
    const dependency={id:randomUUID(),sourceType:'WORK_ITEM',sourceId:randomUUID(),targetType:'WORK_ITEM',targetId:randomUUID(),dependencyType:'BLOCKS',contractJson:JSON.stringify(stored)}
    const audit={id:decisionAuditEventId,actorId:actorPersonId,action:'PLAN_DELTA_COMMITTED',tenantId:randomUUID(),businessId:randomUUID(),payloadJson:JSON.stringify({stateImages:[{type:'DEPENDENCY',id:dependency.id,after:dependency}]})}
    expect(handoffContractState(dependency.contractJson,{actor:{id:actorPersonId},audit,dependency})).toBe('SATISFIED')
    expect(handoffContractState(dependency.contractJson,{actor:{id:actorPersonId},audit:{...audit,payloadJson:'{}'},dependency})).toBe('INVALID')
    expect(handoffContractState(JSON.stringify(stored),{actor:{id:randomUUID()},audit:{id:decisionAuditEventId,actorId:actorPersonId}})).toBe('INVALID')
  })
  it('uses authoritative Gate status rather than required/progress', async () => {
    const { handoffContractState } = await load();const id=randomUUID(),input=JSON.stringify({version:1,deliverable:'Inspection',acceptance:{kind:'GATE',gateId:id}})
    for(const status of ['PASSED','WAIVED','OPEN','BLOCKED'])expect(handoffContractState(input,{gate:{id,status,required:false}})).toBe(['PASSED','WAIVED'].includes(status)?'SATISFIED':'DECLARED')
    expect(handoffContractState(input)).toBe('INVALID')
  })
  it('matches exact legacy and declared hash vectors without reformatting stored strings', async () => {
    const { dependencyHash } = await load();const {readFileSync}=await import('node:fs');const f=JSON.parse(readFileSync('../../docs/architecture/project-manager-system/contracts/pipeline-contract.examples.json'))
    for(const v of [f.hashVector,f.nonNullHashVector])expect(dependencyHash(v.row)).toBe(v.sha256)
    expect(dependencyHash({...f.nonNullHashVector.row,contractJson:JSON.stringify(JSON.parse(f.nonNullHashVector.row.contractJson),null,2)})).not.toBe(f.nonNullHashVector.sha256)
  })
})
