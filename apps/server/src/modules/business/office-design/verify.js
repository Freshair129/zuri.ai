// @req FR-294 — bounded off-thread package verification before persistence.
// @tested tests/unit/office-design-package.test.js
import {Worker} from 'node:worker_threads'
import path from 'node:path'
export const OFFICE_MAX_BYTES=100_000_000
let active=0
export function officeError(status,code){return Object.assign(new Error(code),{status,code})}
export async function verifyOfficeArchive(input){
 if(!(input instanceof Uint8Array)||input.length<22)throw officeError(422,'OFFICE_PACKAGE_INVALID')
 if(input.length>OFFICE_MAX_BYTES)throw officeError(413,'OFFICE_PACKAGE_TOO_LARGE')
 if(active>=2)throw officeError(503,'OFFICE_VERIFIER_BUSY')
 active++
 let worker
 try{
  // Keep this native worker outside webpack's worker rewriting. The standalone
  // tracing configuration explicitly ships its trusted source and pinned bundle.
  worker=new Worker(path.join(process.cwd(),'src/modules/business/office-design/validation-worker.mjs'),{workerData:{bytes:new Uint8Array(input)},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:64,stackSizeMb:8}})
  return await new Promise((resolve,reject)=>{
   let settled=false
   const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);callback(value)}
   const timer=setTimeout(()=>finish(reject,officeError(408,'OFFICE_VERIFIER_TIMEOUT')),30000)
   worker.once('message',m=>m?.ok===true?finish(resolve,m.result):finish(reject,officeError(422,'OFFICE_PACKAGE_INVALID')))
   worker.once('error',()=>finish(reject,officeError(422,'OFFICE_PACKAGE_INVALID')))
   worker.once('exit',()=>finish(reject,officeError(422,'OFFICE_PACKAGE_INVALID')))
  })
 }finally{if(worker)await worker.terminate();active--}
}
