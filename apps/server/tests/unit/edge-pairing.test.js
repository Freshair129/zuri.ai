import { describe, it, expect, vi } from 'vitest'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createEdgePairingService, PAIRING_TTL_MS } from '@/modules/identity/edge-pairing'
import { loginDestination } from '@/modules/identity/login-destination'
// @req FR-144 — approval/expiry/one-time handover and Business authority.
// @spec SEC-025, SEC-001, SEC-008
const owner = makeViewer({ visibleBusinessIds:['business-a'], ownedBusinessIds:['business-a'] })
const member = makeViewer({ visibleBusinessIds:['business-a'], ownedBusinessIds:[] })
function fixture(options = {}) {
  let clock = 1_000_000, currentViewer = owner
  const mint = vi.fn(async () => ({ key:'edgk_SYNTHETIC_ONLY_not_a_real_key' }))
  const service = createEdgePairingService({
    now:() => clock, mint,
    refreshViewer:async () => currentViewer,
    businesses:async viewer => viewer.ownedBusinessIds.map(id => ({ id, name:'Test Business' })),
    ...options,
  })
  const start = () => service.start({ deviceId:'EDGE-TEST', label:'Test Desktop', origin:'https://zuri.example' })
  const row = start(), code = new URL(row.approvalUrl).hash.slice(1)
  const credentials = { requestId:row.requestId, deviceSecret:row.deviceSecret }
  const approve = (viewer = owner) => service.decide({ code, businessId:'business-a', action:'approve', viewer })
  return { service,row,code,credentials,mint,start,approve,advance:ms => { clock+=ms }, viewer:value => { currentViewer=value } }
}
describe('Desktop browser pairing', () => {
  it('puts no device secret/key in the QR; browser approval returns no key and mints nothing', async () => {
    const f=fixture()
    expect(f.row.approvalUrl).not.toContain(f.row.deviceSecret)
    expect(f.row.approvalUrl).not.toContain('edgk_')
    const inspection=await f.service.inspect({code:f.code,viewer:owner})
    expect(inspection.checkCode).toBe(f.row.checkCode)
    expect(inspection.businesses).toEqual([{id:'business-a',name:'Test Business'}])
    const result=await f.approve()
    expect(result.state).toBe('APPROVED')
    expect(JSON.stringify(result)).not.toContain('key')
    expect(f.mint).not.toHaveBeenCalled()
  })
  it('waits for approval, then delivers once and uses apiBaseUrl', async () => {
    const f=fixture()
    expect(await f.service.poll(f.credentials)).toMatchObject({state:'PENDING'})
    await f.approve()
    const result=await f.service.poll(f.credentials)
    expect(result).toMatchObject({state:'PAIRED',pairing:{apiBaseUrl:'https://zuri.example',deviceId:'EDGE-TEST',businessId:'business-a'}})
    await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:410})
    expect(f.mint).toHaveBeenCalledTimes(1)
  })
  it('cannot redeem with the browser token or a different device secret', async () => {
    const f=fixture(); await f.approve()
    for(const wrong of [f.code, 'x'.repeat(43), undefined]) {
      await expect(f.service.poll({...f.credentials,deviceSecret:wrong})).rejects.toMatchObject({status:410})
    }
    expect(f.mint).not.toHaveBeenCalled()
  })
  it('refuses members and owners elsewhere; never widens Business scope', async () => {
    const f=fixture()
    for (const viewer of [member, ownsElsewhere({owns:'business-b',sees:'business-a'})]) {
      await expect(f.approve(viewer)).rejects.toMatchObject({status:404})
    }
    await expect(f.service.inspect({code:f.code})).rejects.toMatchObject({status:401})
    expect(f.mint).not.toHaveBeenCalled()
  })
  it('rechecks authority at redemption', async () => {
    const f=fixture(); await f.approve(); f.viewer(member)
    await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:403})
    expect(f.mint).not.toHaveBeenCalled()
  })
  it.each(['deny','cancel','expire'])('does not mint after %s', async reason => {
    const f=fixture()
    if(reason==='deny') await f.service.decide({code:f.code,action:'deny',viewer:owner})
    if(reason==='cancel') await f.service.poll({...f.credentials,cancel:true})
    if(reason==='expire') f.advance(PAIRING_TTL_MS)
    if(reason==='expire') await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:410})
    else { f.advance(2000); expect((await f.service.poll(f.credentials)).state).toBe(reason==='deny'?'DENIED':'CANCELLED') }
    expect(f.mint).not.toHaveBeenCalled()
  })
  it('reserves a redemption before awaiting the issuer, preventing concurrent mint', async () => {
    let release
    const mint=vi.fn(() => new Promise(resolve => { release=resolve }))
    const f=fixture({mint}); await f.approve()
    const first=f.service.poll(f.credentials)
    await Promise.resolve()
    expect(await f.service.poll(f.credentials)).toEqual({state:'REDEEMING'})
    release({key:'edgk_SYNTHETIC_ONLY'})
    expect((await first).state).toBe('PAIRED')
    expect(mint).toHaveBeenCalledTimes(1)
  })
  it('refuses a second approval even when concurrent scoped queries yield', async () => {
    const f=fixture()
    const results=await Promise.allSettled([f.approve(),f.approve()])
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
    expect(results.find(result=>result.status==='rejected').reason.status).toBe(409)
  })
  it('redacts issuer failures and makes ambiguous failures terminal', async () => {
    const f=fixture({mint:vi.fn(async()=>{throw new Error('edgk_SECRET internal database details')})})
    await f.approve()
    await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:503,message:'PAIRING_REDEMPTION_FAILED'})
    await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:410})
  })
  it('bounds unauthenticated starts and request capacity without trusting IP headers', () => {
    const f=fixture({capacity:1})
    expect(()=>f.start()).toThrow('PAIRING_BUSY_TRY_LATER')
    f.advance(PAIRING_TTL_MS)
    expect(f.start().state).toBe('PENDING')
    const g=fixture()
    for(let i=0;i<29;i++) g.start()
    expect(()=>g.start()).toThrow('PAIRING_BUSY_TRY_LATER')
  })
  it('bounds polling and rejects malformed identifiers', async () => {
    const f=fixture()
    await f.service.poll(f.credentials)
    await expect(f.service.poll(f.credentials)).rejects.toMatchObject({status:429})
    await expect(f.service.inspect({code:'bad',viewer:owner})).rejects.toMatchObject({status:410})
    expect(()=>f.service.start({deviceId:'',label:'x',origin:'https://zuri.example'})).toThrow('PAIRING_DEVICE_REQUIRED')
  })
  it('login resumes only the fixed pairing surface', () => {
    expect(loginDestination('?next=/edge/pair')).toBe('/edge/pair')
    for(const next of ['https://evil.example','//evil.example','/edge/pair?redirect=https://evil.example','/ops']) {
      expect(loginDestination('?next='+encodeURIComponent(next))).toBe('/businesses')
    }
  })
})
