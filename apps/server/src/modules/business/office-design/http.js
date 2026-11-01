// @req FR-294 — bounded same-origin ZIP ingress and private responses.
// @tested tests/integration/office-design-registration.test.js
import {handle} from '@/app/api/_helpers'
import {OFFICE_MAX_BYTES,officeError} from './verify'
import {createSessionPort} from '@/modules/identity/session-port'
import {assertApiWriteCsrfToken} from '@/modules/identity/api-write-csrf'
const intakeKey=Symbol.for('zuri.officeDesign.intake.v1')
const intake=globalThis[intakeKey]||(globalThis[intakeKey]={active:0})
export async function withOfficeUploadSlot(fn){if(intake.active>=2)throw officeError(503,'OFFICE_VERIFIER_BUSY');intake.active++;try{return await fn()}finally{intake.active--}}
export async function assertOfficeWriteRequest(request){const session=await createSessionPort().read(request);assertApiWriteCsrfToken({request,session,token:request.headers.get('x-csrf-token')})}
export async function privateHandle(fn){const response=await handle(fn);response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Content-Type-Options','nosniff');return response}
export function officeWorkspace(request){const id=new URL(request.url).searchParams.get('workspaceId');if(!id||id.length>128)throw officeError(404,'OFFICE_TARGET_NOT_FOUND');return id}
export function officeVersion(request){const value=new URL(request.url).searchParams.get('version');if(value===null)return undefined;if(!/^[1-9][0-9]{0,9}$/.test(value))throw officeError(400,'OFFICE_VERSION_INVALID');return Number(value)}
export function officeCommand(request){
 if(request.headers.get('sec-fetch-site')==='cross-site')throw officeError(403,'OFFICE_ORIGIN_DENIED')
 const match=request.headers.get('if-match')
 if(!match)throw officeError(428,'OFFICE_EXPECTED_VERSION_REQUIRED')
 if(!/^"(?:0|[1-9][0-9]{0,9})"$/.test(match))throw officeError(400,'OFFICE_COMMAND_INVALID')
 const expectedVersion=Number(match.slice(1,-1)),requestKey=request.headers.get('idempotency-key')||''
 if(expectedVersion>1000000000||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestKey))throw officeError(400,'OFFICE_COMMAND_INVALID')
 const dry=new URL(request.url).searchParams.get('dryRun');if(dry!==null&&dry!=='1')throw officeError(400,'OFFICE_COMMAND_INVALID')
 return{expectedVersion,requestKey,dryRun:dry==='1'}
}
export async function readOfficeBody(request){
 if(!['application/zip','application/octet-stream'].includes(request.headers.get('content-type')?.split(';')[0].trim()))throw officeError(415,'OFFICE_ZIP_REQUIRED')
 const length=request.headers.get('content-length');if(length&&(!/^[0-9]+$/.test(length)||Number(length)>OFFICE_MAX_BYTES))throw officeError(413,'OFFICE_PACKAGE_TOO_LARGE')
 const reader=request.body?.getReader();if(!reader)throw officeError(422,'OFFICE_PACKAGE_INVALID')
 const chunks=[];let total=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>OFFICE_MAX_BYTES){await reader.cancel();throw officeError(413,'OFFICE_PACKAGE_TOO_LARGE')}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
 return Buffer.concat(chunks,total)
}
