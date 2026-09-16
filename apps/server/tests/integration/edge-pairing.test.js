import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createEdgePairingService } from '@/modules/identity/edge-pairing'
import { mintEdgeDeviceCredential, resolveEdgeDeviceContext, listEdgeDeviceCredentials } from '@/modules/identity/edge-device-credential'
// @req FR-144 — pairing delivers a real usable scoped credential and stores/audits no raw key.
// @spec SEC-025, SEC-001
describe('browser approval to actual credential store',()=>{
  it('mints exactly one transactional key at device redemption',async()=>{
    const portfolio=await createPortfolio({code:'PF-PAIRING',name:'Pairing'})
    const tenant=await createTenant({portfolioId:portfolio.id,code:'TNT-PAIRING',name:'Pairing'})
    const business=await createBusiness({tenantId:tenant.id,code:'BUS-PAIRING',name:'Pairing'})
    const owner=makeViewer({visibleBusinessIds:[business.id],ownedBusinessIds:[business.id]})
    const service=createEdgePairingService({
      businesses:async()=>[{id:business.id,name:business.name}],
      refreshViewer:async()=>owner,
      mint:input=>prisma.$transaction(tx=>mintEdgeDeviceCredential({...input,db:tx})),
    })
    const start=service.start({deviceId:'EDGE-PAIRING-INTEGRATION',label:'Test Desktop',origin:'https://zuri.example'})
    await service.decide({code:new URL(start.approvalUrl).hash.slice(1),businessId:business.id,action:'approve',viewer:owner})
    expect(await prisma.edgeDeviceCredential.count({where:{deviceId:'EDGE-PAIRING-INTEGRATION'}})).toBe(0)
    const result=await service.poll({requestId:start.requestId,deviceSecret:start.deviceSecret})
    expect(result.state).toBe('PAIRED')
    const key=result.pairing.key
    const context=await resolveEdgeDeviceContext(new Request('https://zuri.example',{headers:{authorization:'Bearer '+key}}))
    expect(context.businessId).toBe(business.id)
    expect(context.deviceId).toBe('EDGE-PAIRING-INTEGRATION')
    const stored=await prisma.edgeDeviceCredential.findMany({where:{deviceId:context.deviceId}})
    expect(stored).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(JSON.stringify(await listEdgeDeviceCredentials({businessId:business.id,viewer:owner}))).not.toContain(key)
    const audits=await prisma.auditEvent.findMany({where:{entityId:stored[0].id}})
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits)).not.toContain(key)
    await expect(service.poll({requestId:start.requestId,deviceSecret:start.deviceSecret})).rejects.toMatchObject({status:410})
  })
})
