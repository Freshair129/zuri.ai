// @req FR-294 — real producer packages and rehashed hostile variants.
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {describe,it,expect} from 'vitest'
import {verifyOfficeArchive} from '@/modules/business/office-design/verify'
import {readHandoffArchive} from '../../vendor/office-design/archive.mjs'
import {handoffZip,canonicalJSON,sha256,buildOfficeHandoff,validateOfficeHandoff} from '../../vendor/office-design/verifier.mjs'
const fixture=name=>gunzipSync(readFileSync(new URL(`../fixtures/office-design/${name}.zip.gz`,import.meta.url)))
const repack=async(bytes,mutate)=>{const files=readHandoffArchive(bytes),manifest=JSON.parse(files.get('manifest.json')),schema=JSON.parse(files.get('schema.json'));await mutate(manifest,files,schema);const {contentHash,...body}=manifest;manifest.contentHash=await sha256(canonicalJSON(body));return handoffZip(manifest,new Map([...files].filter(([name])=>name.startsWith('assets/'))),schema)}
describe('Office pinned package verification',()=>{
 it('verifies the actual merged producer export and pinned custom-chair export',async()=>{
  const stock=await verifyOfficeArchive(fixture('stock'))
  expect(stock.manifest.entities).toHaveLength(1655)
  expect(stock.assets).toHaveLength(17)
  const custom=await verifyOfficeArchive(fixture('custom'))
  expect(custom.manifest.entities.some(e=>e.type==='placement'&&e.data.object.kind==='custom')).toBe(true)
 },60000)
 it('rejects rehashed forged identity, binding, cross-floor refs, scene data and runtime Agent claims',async()=>{
  const edits=[m=>m.entities[0].id='00000000-0000-5000-8000-000000000000',m=>m.bindingContext.businessId='from-body',m=>m.entities.find(e=>e.type==='agentDesign').data.agentInstanceId='fake',m=>m.entities.find(e=>e.type==='placement').data.object.x+=.4,m=>{const e=m.entities.find(e=>e.type==='agentDesign');e.refs.find(r=>r.relation==='floor').targetId=m.entities.find(f=>f.type==='floor'&&f.id!==e.refs.find(r=>r.relation==='floor').targetId).id}]
  for(const edit of edits)await expect(verifyOfficeArchive(await repack(fixture('stock'),edit))).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },60000)
 it('remeasures custom GLB instead of trusting consistent forged snapshot/placement origin',async()=>{
  const files=readHandoffArchive(fixture('custom')),m=JSON.parse(files.get('manifest.json')),rooms=Object.fromEntries(m.entities.filter(e=>e.type==='scene').map(e=>[e.key.split('/')[0],e.data.snapshot])),assets={}
  for(const r of m.entities.filter(e=>e.type==='assetRevision')){const a=m.entities.find(e=>e.id===r.refs.find(f=>f.relation==='asset').targetId);assets[a.key]=r.data}
  rooms.lobby.objects.find(o=>o.kind==='custom').asset.origin[0]+=.25
  const forged=await buildOfficeHandoff({rooms,assets});expect(await validateOfficeHandoff(forged)).toEqual(forged)
  const bytes=handoffZip(forged,new Map([...files].filter(([name])=>name.startsWith('assets/'))),JSON.parse(files.get('schema.json')))
  await expect(verifyOfficeArchive(bytes)).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
 },60000)
 it('rejects schema drift, binary mismatch, truncated ZIP, unsafe local paths and limits',async()=>{
  await expect(verifyOfficeArchive(await repack(fixture('stock'),(m,f,s)=>s.title='supplied schema'))).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
  await expect(verifyOfficeArchive(await repack(fixture('stock'),(m,f)=>{const [name,bin]=[...f].find(([n])=>n.startsWith('assets/'));bin[bin.length-1]^=1;f.set(name,bin)}))).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
  await expect(verifyOfficeArchive(fixture('stock').subarray(0,500))).rejects.toMatchObject({code:'OFFICE_PACKAGE_INVALID'})
  await expect(verifyOfficeArchive(Buffer.alloc(100000001))).rejects.toMatchObject({code:'OFFICE_PACKAGE_TOO_LARGE'})
 },60000)
 it('refuses a rehashed actor replacement even when the pinned semantic graph accepts the revision',async()=>{
  const files=readHandoffArchive(fixture('stock')),m=JSON.parse(files.get('manifest.json')),rooms=Object.fromEntries(m.entities.filter(e=>e.type==='scene').map(e=>[e.key.split('/')[0],e.data.snapshot])),assets={}
  for(const r of m.entities.filter(e=>e.type==='assetRevision')){const a=m.entities.find(e=>e.id===r.refs.find(f=>f.relation==='asset').targetId);assets[a.key]=r.data}
  const changed=Buffer.from(files.get(assets.actor.uri));changed[changed.length-1]^=1;const digest=await sha256(changed),oldUri=assets.actor.uri;assets.actor={sha256:digest,uri:`assets/${digest}.glb`,bytes:changed.length}
  const forged=await buildOfficeHandoff({rooms,assets});expect(await validateOfficeHandoff(forged)).toEqual(forged)
  const blobs=new Map([...files].filter(([name])=>name.startsWith('assets/')&&name!==oldUri));blobs.set(assets.actor.uri,changed)
  let code=null;try{await verifyOfficeArchive(handoffZip(forged,blobs,JSON.parse(files.get('schema.json'))))}catch(error){code=error.code}
  expect(code).toBe('OFFICE_PACKAGE_INVALID')
 },60000)
})
