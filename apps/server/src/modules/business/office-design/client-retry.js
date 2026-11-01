// @req FR-295 — preserve the exact command for an uncertain browser retry.
// @tested tests/unit/office-handoff-retry.test.js
const prefix='zuri:office-handoff:v1:'
const storageName=({principalId,workspaceId,archiveHash})=>prefix+encodeURIComponent(principalId)+':'+encodeURIComponent(workspaceId)+':'+archiveHash
const validate=r=>r&&Object.keys(r).sort().join(',')==='key,version'&&typeof r.key==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.key)&&Number.isSafeInteger(r.version)&&r.version>=0&&r.version<=1000000000
function parseStored(raw){let value;try{value=JSON.parse(raw)}catch{throw Error('ข้อมูล retry เสียหาย')}if(!validate(value))throw Error('ข้อมูล retry ไม่ถูกต้อง');return value}
export function handoffCommand(storage,{principalId,workspaceId,archiveHash,version},newKey){
 if(!storage||![principalId,workspaceId].every(v=>typeof v==='string'&&v.length>0&&v.length<=128)||!/^[a-f0-9]{64}$/.test(archiveHash)||!Number.isSafeInteger(version)||version<0||version>1000000000)throw Error('ข้อมูล retry ไม่ถูกต้อง')
 const name=storageName({principalId,workspaceId,archiveHash})
 const previous=storage.getItem(name)
 if(previous!==null)return parseStored(previous)
 let count=0;for(let i=0;i<storage.length;i++)if(storage.key(i)?.startsWith(prefix))count++
 if(count>=100)throw Error('พื้นที่เก็บ retry เต็ม กรุณาตรวจรายการเดิมก่อน')
 const value={key:newKey(),version};if(!validate(value))throw Error('ข้อมูล retry ไม่ถูกต้อง')
 const serialized=JSON.stringify(value);storage.setItem(name,serialized);if(storage.getItem(name)!==serialized)throw Error('บันทึกข้อมูล retry ไม่สำเร็จ')
 return value
}
export function replaceStaleCommand(storage,args,previous,currentVersion,newKey){
 const name=storageName(args),raw=storage.getItem(name);if(raw===null)throw Error('ไม่พบข้อมูล retry เดิม')
 const saved=parseStored(raw)
 if(saved.key!==previous.key||saved.version!==previous.version||!Number.isSafeInteger(currentVersion)||currentVersion<=previous.version||currentVersion>1000000000)throw Error('สถานะ retry เปลี่ยนแล้ว')
 const value={key:newKey(),version:currentVersion};if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.key))throw Error('ข้อมูล retry ไม่ถูกต้อง')
 const serialized=JSON.stringify(value);storage.setItem(name,serialized);if(storage.getItem(name)!==serialized)throw Error('บันทึกข้อมูล retry ไม่สำเร็จ')
 return value
}
