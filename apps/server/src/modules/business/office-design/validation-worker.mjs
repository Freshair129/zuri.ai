// @req FR-294 — trusted pinned verifier, never code from the imported archive.
// @tested tests/unit/office-design-package.test.js
import {parentPort,workerData} from 'node:worker_threads'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {readHandoffArchive} from '../../../../vendor/office-design/archive.mjs'
import {validateOfficeHandoff,verifyCustomAssetMeasurements,inspectGLBContainer} from '../../../../vendor/office-design/verifier.mjs'
import {assertOfficeGraphBudget} from './graph-budget.mjs'
// Pinned rig/animation bytes from the reviewed producer's factory catalog.
const ACTOR_SHA256='12963ec2f220812d2a88da8382a83d7da5671a7084fbd758b0dc82902ee58ac2'
const hash=b=>createHash('sha256').update(b).digest('hex')
const json=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b))
function actorContainer(bytes){
 const b=Buffer.from(bytes)
 if(b.length<28||b.readUInt32LE(0)!==0x46546c67||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)throw Error('GLB')
 let model,bin=false
 for(let at=12;at<b.length;){if(at+8>b.length)throw Error('GLB');const n=b.readUInt32LE(at),kind=b.readUInt32LE(at+4);if(n%4||at+8+n>b.length)throw Error('GLB');if(at===12&&kind===0x4e4f534a)model=json(b.subarray(at+8,at+8+n));else if(kind===0x004e4942&&!bin)bin=true;else throw Error('GLB');at+=8+n}
 if(model?.asset?.version!=='2.0'||!bin||(model.nodes?.length||0)>10000||(model.meshes?.length||0)>2048||(model.accessors?.length||0)>10000)throw Error('GLB')
 const walk=(value,depth=0)=>{if(depth>64)throw Error('GLB');if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){if(key==='uri')throw Error('External GLB resource');walk(v,depth+1)}};walk(model)
}
try{
 const bytes=Buffer.from(workerData.bytes),files=readHandoffArchive(bytes)
 const schema=json(await readFile(new URL('../../../../vendor/office-design/schema.json',import.meta.url)))
 if(!isDeepStrictEqual(json(files.get('schema.json')),schema))throw Error('Schema drift')
 const candidate=json(files.get('manifest.json'));assertOfficeGraphBudget(candidate)
 const manifest=await validateOfficeHandoff(candidate)
 const revisions=manifest.entities.filter(e=>e.type==='assetRevision')
 const expected=new Set(['manifest.json','schema.json','id-map.json','README.txt',...revisions.map(r=>r.data.uri)])
 if(files.size!==expected.size||[...expected].some(n=>!files.has(n)))throw Error('Inventory')
 const idMap=manifest.entities.map(e=>({externalSource:'visual-office-design',externalId:e.id,kind:e.type,key:e.key,zuriId:null}))
 if(!isDeepStrictEqual(json(files.get('id-map.json')),idMap)||!files.get('README.txt').toString('utf8').includes('Design registration proposal'))throw Error('Crosswalk')
 const byId=new Map(manifest.entities.map(e=>[e.id,e])),assets=new Map()
 for(const revision of revisions){
  const b=files.get(revision.data.uri)
  if(b.length!==revision.data.bytes||hash(b)!==revision.data.sha256)throw Error('Hash')
  const asset=byId.get(revision.refs.find(r=>r.relation==='asset').targetId)
  if(asset.key==='actor'){if(revision.data.sha256!==ACTOR_SHA256)throw Error('Unreviewed actor revision');actorContainer(b)}else inspectGLBContainer(new Uint8Array(b))
  assets.set(revision.data.sha256,{sha256:revision.data.sha256,byteLength:b.length,bytes:new Uint8Array(b)})
 }
 await verifyCustomAssetMeasurements(manifest.entities,uri=>files.get(uri))
 parentPort.postMessage({ok:true,result:{manifest,archiveSha256:hash(bytes),assets:[...assets.values()]}})
}catch{parentPort.postMessage({ok:false})}
