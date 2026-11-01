'use client'
import {useEffect,useState} from 'react'
import {handoffCommand,replaceStaleCommand} from '@/modules/business/office-design/client-retry'

export default function OfficeHandoff({allowedOrigins}) {
 const [message,setMessage]=useState('กำลังตรวจ session และต้นทาง…'),[targets,setTargets]=useState([]),[selected,setSelected]=useState(''),[bytes,setBytes]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[connection,setConnection]=useState(null),[canRenew,setCanRenew]=useState(false)
 useEffect(()=>{
  const params=new URLSearchParams(location.hash.slice(1)),origin=params.get('origin'),nonce=params.get('nonce'),opener=window.opener
  if(window.top!==window.self||!opener||!nonce||!/^[a-f0-9-]{36}$/i.test(nonce)||!allowedOrigins.includes(origin)){setMessage('ต้นทาง Office ไม่ได้รับอนุญาตให้เชื่อมต่อ');return}
  let active=true,timer,received=false
  const receive=event=>{if(received||event.origin!==origin||event.source!==opener||event.data?.type!=='office-package'||event.data?.nonce!==nonce)return;const value=event.data.bytes;if(!(value instanceof Uint8Array)||value.byteLength>100000000){setMessage('ขนาดแพ็กไม่ถูกต้อง');return}received=true;clearInterval(timer);setBytes(value);setMessage('ได้รับแพ็กแล้ว เลือก Business และ Workspace ที่ต้องการ')}
  window.addEventListener('message',receive)
  fetch('/api/office-design-targets',{cache:'no-store'}).then(async response=>{if(!response.ok)throw Error('กรุณาเข้าสู่ระบบ Zuri และตรวจสิทธิ์');const data=await response.json();if(!Array.isArray(data.targets))throw Error('อ่านเป้าหมายไม่ได้');if(!active)return;setTargets(data.targets);setConnection({origin,nonce,opener});setMessage('กำลังรับแพ็กจาก Office…');const ready=()=>opener.postMessage({type:'office-ready',nonce},origin);ready();timer=setInterval(ready,1000)}).catch(error=>{if(active)setMessage(error.message)})
  return()=>{active=false;clearInterval(timer);window.removeEventListener('message',receive)}
 },[allowedOrigins])
 async function submit(renew=false){
  const target=targets.find(t=>t.workspaceId===selected);if(!target||!bytes||!connection||busy)return
  setBusy(true);setMessage('กำลังตรวจและบันทึกแพ็ก…')
  try{
   if(!navigator.locks?.request||!crypto.subtle)throw Error('เบราว์เซอร์นี้ไม่รองรับการเก็บ retry อย่างปลอดภัย')
   const archiveHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('')
   const stored=await navigator.locks.request('zuri-office-handoff-retry-v1',{mode:'exclusive'},async()=>{
    const viewerResponse=await fetch('/api/viewer',{cache:'no-store'});if(!viewerResponse.ok)throw Error('session ไม่พร้อม')
    const viewer=await viewerResponse.json();if(!viewer.principal?.id)throw Error('ไม่พบตัวตน session')
    const csrf=await fetch('/api/auth/csrf',{cache:'no-store'});if(!csrf.ok)throw Error('session หรือ CSRF ไม่พร้อม')
    const {token}=await csrf.json(),url=`/api/businesses/${encodeURIComponent(target.businessId)}/office-designs?workspaceId=${encodeURIComponent(target.workspaceId)}`
    const args={principalId:viewer.principal.id,workspaceId:target.workspaceId,archiveHash,version:target.version}
    let pending=handoffCommand(localStorage,args,()=>crypto.randomUUID())
    const post=async command=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/zip','x-csrf-token':token,'if-match':`"${command.version}"`,'idempotency-key':command.key},body:bytes});return{response,body:await response.json()}}
    let outcome=await post(pending)
    if(outcome.response.status===409&&outcome.body.error==='OFFICE_VERSION_OR_REPLAY_CONFLICT'){
     const freshResponse=await fetch('/api/office-design-targets',{cache:'no-store'});if(!freshResponse.ok)throw Error('ตรวจสิทธิ์และรุ่นล่าสุดไม่ได้')
     const fresh=await freshResponse.json(),current=fresh.targets?.find(t=>t.workspaceId===target.workspaceId&&t.businessId===target.businessId)
     if(!current||!Number.isSafeInteger(current.version)||current.version<=pending.version)throw Error('ผลยังไม่แน่ชัด กรุณาลอง key เดิมอีกครั้ง')
     outcome=await post(pending)
     if(outcome.response.status===409&&outcome.body.error==='OFFICE_VERSION_OR_REPLAY_CONFLICT'){
      if(!renew){setCanRenew(true);throw Error('รุ่นเดิมล้าสมัย ตรวจพบรุ่นใหม่ เลือกเริ่มคำสั่งใหม่บนรุ่นล่าสุดได้')}
      pending=replaceStaleCommand(localStorage,args,pending,current.version,()=>crypto.randomUUID());setCanRenew(false);outcome=await post(pending)
     }
    }
    const {response:write,body:receipt}=outcome;if(!write.ok)throw Error(`Zuri ปฏิเสธ (${write.status}): ${receipt.error||receipt.message||'ตรวจสิทธิ์และรุ่นอีกครั้ง'}`)
    if(!Number.isSafeInteger(receipt.version)||receipt.version<1)throw Error('Zuri ตอบกลับโดยไม่มีรุ่นที่ตรวจสอบได้')
    const read=await fetch(`${url}&version=${receipt.version}`,{cache:'no-store'});if(!read.ok)throw Error('บันทึกแล้ว แต่อ่านข้อมูลกลับไม่ได้');const result=await read.json();if(!result.registered||result.revisionId!==receipt.revisionId||result.contentHash!==receipt.contentHash||!Array.isArray(result.mapping))throw Error('บันทึกแล้ว แต่ผลอ่านกลับไม่ตรงกัน')
    return result
   })
   setResult(stored);setMessage(`อ่าน ${stored.mapping.length} IDs จาก Zuri รุ่น ${stored.version} แล้ว`);connection.opener.postMessage({type:'office-complete',nonce:connection.nonce,version:stored.version,count:stored.mapping.length},connection.origin)
  }catch(error){setMessage(error.message);connection.opener.postMessage({type:'office-progress',nonce:connection.nonce,message:error.message},connection.origin)}finally{setBusy(false)}
 }
 return <main style={{maxWidth:900,margin:'3rem auto',padding:'1rem',fontFamily:'sans-serif'}}><h1>ส่งแบบ Visual Office</h1><p>เลือก Business และ Workspace ที่คุณเป็นเจ้าของ แบบที่บันทึกเป็นข้อมูลออกแบบ ไม่สร้าง Agent หรือสิทธิ์</p><p role="status">{message}</p><label>Business / Workspace <select value={selected} onChange={e=>{setSelected(e.target.value);setCanRenew(false)}}><option value="">เลือก Workspace</option>{targets.map(t=><option key={t.workspaceId} value={t.workspaceId}>{t.businessName} ({t.businessCode}) / {t.workspaceName} ({t.workspaceCode}) · รุ่น {t.version}</option>)}</select></label><p><button type="button" disabled={!selected||!bytes||busy||!!result} onClick={()=>submit(false)}>ลงทะเบียนและอ่าน IDs กลับ</button>{canRenew&&<button type="button" disabled={busy} onClick={()=>submit(true)}>เริ่มคำสั่งใหม่บนรุ่นล่าสุด</button>}</p>{result&&<><p>Revision: {result.revisionId}</p><details><summary>IDs ที่อ่านกลับ ({result.mapping.length})</summary><ul>{result.mapping.map(m=><li key={m.externalId}>{m.kind} · {m.key} · {m.externalId} → {m.zuriId}</li>)}</ul></details></>}</main>
}
