// @req FR-294 — real browser Office panel to scoped Zuri database readback.
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {chromium} from '@playwright/test'
import {it,expect} from 'vitest'
import prisma from '@/lib/db'
import {createPortfolio,createTenant,createBusiness,createWorkspace} from '../factories/scope'
import {makeViewer} from '../factories/viewer'
import {persistImportViewer} from '../helpers/persist-import-viewer'
import {generateSessionToken,hashSessionToken} from '@/modules/identity/auth-service'
const freePort=()=>new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const officeTest=process.env.OFFICE_UI_SOURCE?it:it.skip
officeTest('opens the real Office scene and recovers the original handoff after the popup closes',async()=>{
 const officeRoot=process.env.OFFICE_UI_SOURCE;if(!officeRoot)throw Error('OFFICE_UI_SOURCE must name the Office checkout under test')
 const suffix=randomUUID(),secret='office-ui-test-secret-'+suffix
 const portfolio=await createPortfolio({code:'PF-UI-'+suffix,name:'UI fixture'}),tenant=await createTenant({portfolioId:portfolio.id,code:'TN-UI-'+suffix,name:'UI fixture'}),business=await createBusiness({tenantId:tenant.id,code:'BU-UI-'+suffix,name:'UI fixture'}),workspace=await createWorkspace({businessId:business.id,scopeType:'BUSINESS',code:'WS-UI-'+suffix,name:'UI destination'})
 const viewer=await persistImportViewer(makeViewer({visibleBusinessIds:[business.id],ownedBusinessIds:[business.id]})),sid=randomUUID(),token=generateSessionToken(viewer.principal.id,{secret,sessionId:sid})
 await prisma.session.create({data:{id:sid,personId:viewer.principal.id,tokenHash:hashSessionToken(token),expiresAt:new Date(Date.now()+600000)}})
 const officePort=await freePort(),zuriPort=await freePort(),officeOrigin=`http://localhost:${officePort}`,zuriOrigin=`http://127.0.0.1:${zuriPort}`
 const office=spawn(process.execPath,['scripts/serve.mjs','--preview'],{cwd:officeRoot,env:{...process.env,PORT:String(officePort),OFFICE_HANDOFF_ZURI_ORIGIN:zuriOrigin},windowsHide:true,stdio:'ignore'})
 const env={...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',ZURI_SESSION_SECRET:secret,ZURI_KNOWLEDGE_ENABLED:'0',PUBLIC_BASE_URL:zuriOrigin,OFFICE_HANDOFF_ALLOWED_ORIGINS:officeOrigin}
 const zuri=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(zuriPort)],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']})
 let serverLog='';for(const stream of [zuri.stdout,zuri.stderr])stream.on('data',chunk=>{serverLog=(serverLog+String(chunk)).slice(-10000)})
 let browser
 try{
  for(const url of [officeOrigin,zuriOrigin+'/api/viewer']){let ready=false;for(let i=0;i<100;i++){try{await fetch(url,{signal:AbortSignal.timeout(1500)});ready=true;break}catch{await wait(300)}}expect(ready).toBe(true)}
  for(const path of ['/office-handoff','/api/office-design-targets','/api/auth/csrf',`/api/businesses/${business.id}/office-designs?workspaceId=${workspace.id}`]){
   const warm=await fetch(zuriOrigin+path,{signal:AbortSignal.timeout(120000)});expect([200,401]).toContain(warm.status)
  }
  browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({reducedMotion:'reduce',viewport:{width:800,height:600}});await context.addCookies([{name:'zuri_session',value:token,url:zuriOrigin}]);const page=await context.newPage();await page.goto(officeOrigin)
  await page.evaluate(`(async()=>{const {TycoonStore}=await import('/tycoon-state.js');const result=await new TycoonStore(localStorage).select('projects','tycoon3d');if(!result)throw Error('Could not select Tycoon')})()`)
  await page.goto(officeOrigin+'/#office/projects',{waitUntil:'domcontentloaded'})
  await page.locator('.tycoon-world:not([hidden]) .tycoon-stage canvas').waitFor({timeout:120000})
  await page.getByRole('button',{name:'ประหยัดภาพ 30 FPS'}).click()
  await page.getByText('ฉาก 3D พร้อมใช้งาน').waitFor({timeout:120000})
  console.log('handoff scene canvas mounted')
  await page.getByRole('button',{name:'ทีมและ Workflow',exact:true}).click()
  const zuriSelect=page.locator('.tycoon-sheet-body select');await zuriSelect.locator('option').filter({hasText:zuriOrigin}).waitFor({state:'attached'});await zuriSelect.selectOption(zuriOrigin)
  const popupPromise=context.waitForEvent('page',{timeout:45000});await page.getByRole('button',{name:'ส่ง handoff ไป Zuri'}).click();let popup;try{popup=await popupPromise}catch(error){throw Error(`Office: ${(await page.locator('.tycoon-sheet-body').innerText()).slice(-1000)}; ${error.message}`)}
  const trace=[];popup.on('request',request=>{const u=new URL(request.url());if(u.origin===zuriOrigin)trace.push(`${request.method()} ${u.pathname}`)});popup.on('response',response=>{const u=new URL(response.url());if(u.origin===zuriOrigin)trace.push(`${response.status()} ${u.pathname}`)})
  console.log('handoff popup opened')
  await popup.bringToFront();console.log('office visibility while popup is active:',await page.evaluate('document.visibilityState'))
  try{await popup.getByText('ได้รับแพ็กแล้ว เลือก Business และ Workspace ที่ต้องการ').waitFor({timeout:60000})}catch(error){throw Error(`Popup: ${(await popup.locator('body').innerText()).slice(0,1200)}; Office: ${(await page.locator('.tycoon-sheet-body').innerText()).slice(-800)}; ${error.message}`)}
  console.log('handoff package received')
  await popup.route(url=>url.pathname.endsWith('/office-designs')&&url.searchParams.has('workspaceId'),route=>route.request().method()==='GET'?route.fulfill({status:503,body:''}):route.continue())
  await popup.locator('select').selectOption(workspace.id);await popup.getByRole('button',{name:'ลงทะเบียนและอ่าน IDs กลับ'}).click()
  try{await popup.getByText('บันทึกแล้ว แต่อ่านข้อมูลกลับไม่ได้').waitFor({timeout:90000})}catch(error){throw Error(`Popup status: ${await popup.locator('[role=status]').innerText()}; registry count: ${await prisma.officeDesignRegistry.count({where:{workspaceId:workspace.id}})}; trace: ${trace.join(', ')}; server: ${serverLog.slice(-2500)}; ${error.message}`)}
  console.log('handoff committed and readback interrupted')
  const registry=await prisma.officeDesignRegistry.findUnique({where:{workspaceId_source_packageId:{workspaceId:workspace.id,source:'visual-office-design',packageId:'e0850743-9ce9-5857-b993-0143dca37bbf'}}});expect(registry?.version).toBe(1)
  await popup.close();await page.bringToFront();await page.getByText(/ปิดหน้าต่าง Zuri แล้ว/).waitFor({timeout:10000})
  const retryPopup=context.waitForEvent('page',{timeout:45000});await page.getByRole('button',{name:'ส่ง handoff ไป Zuri'}).click();const retry=await retryPopup
  await retry.bringToFront()
  console.log('handoff retry popup opened')
  await retry.getByText('ได้รับแพ็กแล้ว เลือก Business และ Workspace ที่ต้องการ').waitFor({timeout:120000});await retry.locator('select').selectOption(workspace.id);await retry.getByRole('button',{name:'ลงทะเบียนและอ่าน IDs กลับ'}).click()
  await retry.getByText(/อ่าน 1655 IDs จาก Zuri รุ่น 1 แล้ว/).waitFor({timeout:120000})
  await page.getByText(/ลงทะเบียนแบบออกแบบรุ่น 1 แล้ว · อ่าน 1655 IDs/).waitFor({timeout:10000})
  expect(await prisma.officeDesignIdentity.count({where:{registryId:registry.id}})).toBe(1655);expect(await prisma.officeDesignRevision.count({where:{registryId:registry.id}})).toBe(1)
 }finally{
  await browser?.close()
  for(const child of [office,zuri])if(child.exitCode===null){try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else child.kill('SIGTERM')}catch(error){try{process.kill(child.pid,0)}catch{continue}throw error}}
 }
},360000)
