import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
// @req FR-144 — HTTP gates around the real pairing handlers.
// @spec SEC-025, SEC-008
const mocks=vi.hoisted(()=>({viewer:vi.fn(),start:vi.fn(),inspect:vi.fn(),decide:vi.fn(),poll:vi.fn()}))
vi.mock('@/modules/identity/request-viewer',()=>({resolveRequestViewer:mocks.viewer}))
vi.mock('@/modules/identity/edge-pairing-runtime',()=>({edgePairingService:()=>mocks}))
import { POST as start } from '@/app/api/edge/pairing/start/route'
import { POST as approve } from '@/app/api/edge/pairing/approve/route'
import { POST as poll } from '@/app/api/edge/pairing/poll/route'
function request(path,body,headers={}) {
  return new Request('https://zuri.example'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
}
beforeEach(()=>{
  vi.clearAllMocks(); vi.stubEnv('PUBLIC_BASE_URL','https://zuri.example')
  mocks.viewer.mockResolvedValue(makeViewer({visibleBusinessIds:['a'],ownedBusinessIds:['a']}))
  mocks.start.mockReturnValue({state:'PENDING'}); mocks.inspect.mockResolvedValue({state:'PENDING',businesses:[]})
  mocks.decide.mockResolvedValue({state:'APPROVED'}); mocks.poll.mockResolvedValue({state:'PENDING'})
})
describe('pairing HTTP boundaries',()=>{
  it('start cannot choose the public approval origin or inject authority',async()=>{
    const result=await start(request('/api/edge/pairing/start',{deviceId:'D',label:'Desktop',origin:'https://evil.example',businessId:'foreign'}))
    expect(result.status).toBe(200)
    expect(mocks.start).toHaveBeenCalledWith({deviceId:'D',label:'Desktop',origin:'https://zuri.example'})
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(mocks.viewer).not.toHaveBeenCalled()
  })
  it('approval requires a session and does not inspect requests when unauthenticated',async()=>{
    mocks.viewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'),{status:401}))
    expect((await approve(request('/api/edge/pairing/approve',{action:'inspect',code:'x'}))).status).toBe(401)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it.each([undefined,'https://evil.example','null'])('rejects approval Origin %s',async origin=>{
    const result=await approve(request('/api/edge/pairing/approve',{action:'approve',code:'x',businessId:'a'},origin?{origin}:{}))
    expect(result.status).toBe(403); expect(mocks.decide).not.toHaveBeenCalled()
  })
  it('passes only trusted viewer to approval',async()=>{
    await approve(request('/api/edge/pairing/approve',{action:'approve',code:'x',businessId:'a',viewer:{isPlatform:true}},{origin:'https://zuri.example'}))
    expect(mocks.decide.mock.calls[0][0].viewer.isPlatform).toBe(false)
  })
  it('takes the device polling secret only from Authorization',async()=>{
    await poll(request('/api/edge/pairing/poll',{requestId:'req',deviceSecret:'in-body'}, {authorization:'Bearer '+'d'.repeat(43)}))
    expect(mocks.poll).toHaveBeenCalledWith({requestId:'req',deviceSecret:'d'.repeat(43),cancel:false})
  })
  it('bounds request bytes and requires JSON',async()=>{
    expect((await start(request('/api/edge/pairing/start',{label:'x'.repeat(5000)}))).status).toBe(413)
    const result=await start(new Request('https://zuri.example/api/edge/pairing/start',{method:'POST',body:'x'}))
    expect(result.status).toBe(400); expect(mocks.start).not.toHaveBeenCalled()
  })
  it('never returns unexpected server exception details',async()=>{
    mocks.poll.mockRejectedValue(new Error('edgk_SECRET database password'))
    const result=await poll(request('/api/edge/pairing/poll',{}))
    expect(result.status).toBe(503); expect(await result.json()).toEqual({error:'PAIRING_UNAVAILABLE'})
  })
})
