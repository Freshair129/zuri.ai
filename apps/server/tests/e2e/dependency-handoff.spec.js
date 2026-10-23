// @req FR-084 — declared handoff register: read-only preview, cancellation and actual commit.
// @spec ADR-035, NFR-008
const {test,expect}=require('@playwright/test')
const {loginAsOwner}=require('./e2e-auth')
async function arrange(page){await loginAsOwner(page);await page.getByRole('button',{name:/Open Business Business 01/}).click();await page.goto('/dependencies');await expect(page.getByRole('heading',{name:'Dependencies',exact:true})).toBeVisible()}
async function fill(page){await page.getByRole('button',{name:'New dependency',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New dependency'});await dialog.getByLabel('Source type',{exact:true}).selectOption('GATE');await dialog.getByLabel('Source code',{exact:true}).fill('GATE-DATA-ID');await dialog.getByLabel('Target type',{exact:true}).selectOption('GATE');await dialog.getByLabel('Target code',{exact:true}).fill('GATE-REL-12');await dialog.getByLabel('Source Project code').fill('PRJ-B01-TRANSFORM');await dialog.getByLabel('Target Project code').fill('PRJ-B01-TRANSFORM');await dialog.getByLabel('Relation',{exact:true}).selectOption('RELATES_TO');await dialog.getByLabel('Deliverable',{exact:true}).fill('Browser qualification handoff');return dialog}
test('mandatory handoff preview cancels without writing, then confirms and survives reload',async({page})=>{await arrange(page);const initialProject=await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json();const beforeCancel=await (await page.request.get('/api/dependencies?projectId='+initialProject.id)).json();const first=await fill(page);await first.getByRole('button',{name:'Preview handoff',exact:true}).click();await expect(first.getByRole('button',{name:'Confirm handoff',exact:true})).toBeVisible();await first.getByRole('button',{name:'Cancel',exact:true}).click();expect(await (await page.request.get('/api/dependencies?projectId='+initialProject.id)).json()).toEqual(beforeCancel);const second=await fill(page);await second.getByRole('button',{name:'Preview handoff',exact:true}).click();const response=page.waitForResponse(r=>r.url().includes('/api/dependencies')&&r.request().method()==='POST'&&r.request().postDataJSON()?.plan?.expectedPreviewHash!==null);await second.getByRole('button',{name:'Confirm handoff',exact:true}).click();const committed=await response;expect(committed.status()).toBe(200);expect((await committed.json()).committed).toBe(true);await expect(second).toBeHidden();await page.reload();await expect(page.getByText('Declared handoff contract',{exact:true}).first()).toBeVisible();const project=await (await page.request.get('/api/resolve?type=PROJECT&code=PRJ-B01-TRANSFORM')).json();const rows=await (await page.request.get('/api/dependencies?projectId='+project.id)).json();expect(rows.some(row=>row.source.code==='GATE-DATA-ID'&&row.target.code==='GATE-REL-12'&&row.dependencyType==='RELATES_TO'&&row.contractState==='DECLARED')).toBe(true);expect(rows.every(row=>!Object.hasOwn(row,'contractJson'))).toBe(true)
 // Existing edges derive their Project scopes; no hidden Project-code fields.
 await page.getByRole('button',{name:'Edit contract',exact:true}).last().click()
 const edit=page.getByRole('dialog',{name:'Edit handoff contract'})
 await expect(edit.getByLabel('Source Project code')).toHaveCount(0)
 await edit.getByLabel('Deliverable',{exact:true}).fill('Gate-qualified replacement')
 await edit.getByLabel('Acceptance',{exact:true}).selectOption('GATE')
 await edit.getByLabel('Acceptance Gate code').fill('GATE-DATA-ID')
 await edit.getByRole('button',{name:'Preview handoff',exact:true}).click()
 await expect(edit.getByRole('button',{name:'Confirm handoff',exact:true})).toBeVisible()
 await edit.getByRole('button',{name:'Confirm handoff',exact:true}).click()
 await expect(edit).toBeHidden()
 const changed=(await (await page.request.get('/api/dependencies?projectId='+project.id)).json()).find(row=>row.source.code==='GATE-DATA-ID'&&row.target.code==='GATE-REL-12'&&row.dependencyType==='RELATES_TO')
 expect(changed.contractState).toBe('DECLARED')
 // A concurrent accepted edit invalidates the UI's current CAS preview.
 await page.getByRole('button',{name:'Edit contract',exact:true}).last().click()
 const stale=page.getByRole('dialog',{name:'Edit handoff contract'})
 await stale.getByLabel('Deliverable',{exact:true}).fill('Stale UI proposal')
 await stale.getByRole('button',{name:'Preview handoff',exact:true}).click()
 await expect(stale.getByRole('button',{name:'Confirm handoff',exact:true})).toBeVisible()
 const plan={schemaVersion:'1.3',kind:'DEPENDENCY_REGISTER',projectIds:[project.id],trace:{correlationId:require('node:crypto').randomUUID(),idempotencyKey:require('node:crypto').randomUUID()},expectedPreviewHash:null,commands:[{op:'dependency.contract',id:changed.id,expectedDependencyHash:changed.expectedDependencyHash,contract:{version:1,deliverable:'Concurrent edit',acceptance:{kind:'MANUAL',satisfied:false}}}]}
 const dry=await page.request.post('/api/dependencies',{data:{plan}});expect(dry.status()).toBe(200)
 plan.expectedPreviewHash=(await dry.json()).previewHash
 const winner=await page.request.post('/api/dependencies',{data:{plan}});expect((await winner.json()).committed).toBe(true)
 await stale.getByRole('button',{name:'Confirm handoff',exact:true}).click()
 await expect(stale.getByRole('alert')).toContainText(/changed|out of date/)
 await stale.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.reload()
 await page.getByRole('button',{name:'Delete dependency',exact:true}).last().click()
 const removal=page.getByRole('dialog',{name:'Remove dependency'})
 await expect(removal.getByLabel('Source Project code')).toHaveCount(0)
 await removal.getByRole('button',{name:'Preview removal',exact:true}).click()
 await expect(removal.getByRole('button',{name:'Confirm removal',exact:true})).toBeVisible()
 await removal.getByRole('button',{name:'Confirm removal',exact:true}).click()
 await expect(removal).toBeHidden()
 expect((await (await page.request.get('/api/dependencies?projectId='+project.id)).json()).some(row=>row.id===changed.id)).toBe(false)
})
