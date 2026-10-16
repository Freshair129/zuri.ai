#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preflightTask } from './preflight.mjs';

const CAMPAIGN_SCHEMA = 'roadmap-intake-campaign/v1';
const RESULT_SCHEMA = 'roadmap-intake-result/v1';
const TASK_ID = /^TASK-ZAI-[0-9]{3}$/;
const ROADMAP_HEADERS = ['task_id','sprint','task','status','proof_scope','implementation_state','depends_on','authority','evidence'];
const PROGRAM_HEADERS = ['id','parent id','type','title','priority','owner','status','dependencies','source section'];
const CAMPAIGN_KEYS = new Set(['schemaVersion','campaignId','repositoryRoot','baseRef','objective','sourceRef','authorizedEffects','prohibitions','allowedTaskIds','taskPlans']);
const PLAN_KEYS = new Set(['objective','acceptance','writeScope','checks','mandateReference','domainOrFeatureKey']);

class IntakeError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const norm = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : value;
const stable = (value) => Array.isArray(value) ? value.map(stable) : isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])])) : norm(value);
const json = (value) => JSON.stringify(value);
const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(stable(value))).digest('hex');
const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
function inside(root, candidate) { const rel=path.relative(pathKey(root),pathKey(candidate)); return rel==='' || (rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)); }
function git(cwd,args) {
  try { return execFileSync('git',args,{cwd,shell:false,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024}).trimEnd(); }
  catch(error) { throw new IntakeError('HOLD_ENVIRONMENT','GIT_COMMAND_FAILED',error.stderr?.toString?.().trim()||error.message); }
}
function repoContext(repoRoot) {
  let root; try { root=fs.realpathSync.native(path.resolve(repoRoot)); } catch { throw new IntakeError('HOLD_REPOSITORY','REPOSITORY_UNAVAILABLE','The campaign repository path is unavailable.'); }
  const top=fs.realpathSync.native(git(root,['rev-parse','--show-toplevel']));
  if(pathKey(top)!==pathKey(root)) throw new IntakeError('HOLD_REPOSITORY','REPOSITORY_ROOT_MISMATCH','repoRoot must name the Git repository root.');
  return {repoRoot:top,commonDir:fs.realpathSync.native(git(top,['rev-parse','--path-format=absolute','--git-common-dir']))};
}
function campaignFilePath(commonDir,file) {
  const dir=path.join(commonDir,'zuri-delivery-control','campaigns');
  let realDir,stat,realFile;
  try { realDir=fs.realpathSync.native(dir); stat=fs.lstatSync(path.resolve(file)); realFile=fs.realpathSync.native(path.resolve(file)); }
  catch { throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_FILE_MISSING','Root campaign directory and file must exist.'); }
  if(!stat.isFile()||stat.isSymbolicLink()||!inside(path.join(commonDir,'zuri-delivery-control'),realDir)||!inside(realDir,realFile)||path.extname(realFile).toLowerCase()!=='.json')
    throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_OUTSIDE_PRIVATE_ROOT','Campaign must be a regular JSON file under the Git-private campaigns directory.');
  return realFile;
}
function list(value,label) { if(!Array.isArray(value)||!value.length||value.some((item)=>!text(item))) throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_FIELD_INVALID',label+' must be a nonempty string list.'); return value.map(norm); }
function validateCampaign(raw,repoRoot) {
  if(!isRecord(raw)||Object.keys(raw).some((key)=>!CAMPAIGN_KEYS.has(key))||raw.schemaVersion!==CAMPAIGN_SCHEMA) throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_SCHEMA_INVALID','Campaign schema or fields are invalid.');
  let boundRoot; try { boundRoot=fs.realpathSync.native(path.resolve(raw.repositoryRoot)); } catch { boundRoot=''; }
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(raw.campaignId??'')||pathKey(boundRoot)!==pathKey(repoRoot)||!text(raw.baseRef)||raw.baseRef.startsWith('-')||!text(raw.objective)||!text(raw.sourceRef))
    throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_BINDING_INVALID','Campaign id, repository, base, objective, or provenance is invalid.');
  if(!Array.isArray(raw.allowedTaskIds)||!raw.allowedTaskIds.length||raw.allowedTaskIds.some((id)=>!TASK_ID.test(id))||new Set(raw.allowedTaskIds).size!==raw.allowedTaskIds.length||!isRecord(raw.taskPlans))
    throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_TASK_ALLOWLIST_INVALID','Campaign must explicitly allow unique task IDs and provide per-task plans.');
  if(Object.keys(raw.taskPlans).some((id)=>!raw.allowedTaskIds.includes(id))) throw new IntakeError('HOLD_CAMPAIGN','UNEXPECTED_TASK_PLAN','Task plan is outside the explicit allowlist.');
  let baseCommit; try { baseCommit=git(repoRoot,['rev-parse','--verify',raw.baseRef+'^{commit}']); } catch { throw new IntakeError('HOLD_BASE','CAMPAIGN_BASE_UNAVAILABLE','Campaign base does not resolve to a commit.'); }
  return {...raw,repositoryRoot:repoRoot,baseCommit,objective:norm(raw.objective),sourceRef:norm(raw.sourceRef),authorizedEffects:list(raw.authorizedEffects,'authorizedEffects'),prohibitions:list(raw.prohibitions,'prohibitions'),campaignDigest:hash(raw)};
}
function loadCampaign({repoRoot,campaignFile}) {
  const context=repoContext(repoRoot), file=campaignFilePath(context.commonDir,campaignFile);
  let before; try { before=fs.readFileSync(file,'utf8'); } catch { throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_READ_FAILED','Campaign could not be read.'); }
  let raw; try { raw=JSON.parse(before.replace(/^\uFEFF/,'')); } catch { throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_JSON_INVALID','Campaign JSON is malformed.'); }
  if(fs.readFileSync(file,'utf8')!==before) throw new IntakeError('HOLD_CAMPAIGN','CAMPAIGN_CHANGED_DURING_READ','Campaign changed during read.');
  return {...context,campaignFile:file,campaign:validateCampaign(raw,context.repoRoot)};
}

function cells(line) { const s=line.trim(); return s.startsWith('|')&&s.endsWith('|')?s.slice(1,-1).split('|').map((x)=>x.trim()):null; }
function readTable(markdown,headers,label) {
  const lines=markdown.split(/\r?\n/), blocks=[];
  for(let i=0;i<lines.length;i++) {
    const header=cells(lines[i]); if(!header||header.map((x)=>x.toLowerCase()).join('\0')!==headers.join('\0')) continue;
    const rows=[];
    for(let j=i+1;j<lines.length&&lines[j].trim().startsWith('|');j++) {
      const row=cells(lines[j]); if(!row||row.every((x)=>/^:?-{2,}:?$/.test(x))) continue;
      rows.push(row.length===headers.length?row:null);
    }
    blocks.push(rows);
  }
  if(blocks.length!==1) return {error:label+' table header count is '+blocks.length+'.',rows:[]};
  return {rows:blocks[0]};
}
function deps(value) { const s=norm(value??''); return !s||s==='—'||s==='-'||s.toLowerCase()==='none'?[]:s.split(/[;,]/).map((x)=>x.trim()).filter(Boolean); }
function rowsById(markdown,headers,label,mapRow) {
  const table=readTable(markdown,headers,label), map=new Map(), issues=[]; if(table.error) return {map,issues:[table.error]};
  for(const row of table.rows) {
    if(!row) { issues.push(label+' has a malformed table row.'); continue; }
    const item=mapRow(row); if(!TASK_ID.test(item.taskId)) continue;
    if(map.has(item.taskId)) issues.push(label+' duplicates '+item.taskId+'.'); else map.set(item.taskId,item);
  }
  return {map,issues};
}
function taskContainers(markdown) {
  const headings=[...markdown.matchAll(/^###\s+TC-(TASK-ZAI-[0-9]{3})\s*$/gm)], map=new Map(), issues=[];
  for(let i=0;i<headings.length;i++) {
    const h=headings[i], start=h.index+h[0].length, end=i+1<headings.length?headings[i+1].index:markdown.length, block=markdown.slice(start,end);
    const yaml=block.match(/```yaml\s*\r?\n([\s\S]*?)\r?\n```/i)?.[1], id=yaml?.match(/^task_id:\s*(\S+)\s*$/m)?.[1];
    if(!yaml||id!==h[1]) { issues.push('TC-'+h[1]+' YAML or task_id is missing/mismatched.'); continue; }
    const criteria=[...yaml.matchAll(/^\s*-\s*criterion:\s*(.*?)\s*$/gm)].map((m)=>m[1].trim().replace(/^("|')(.*)\1$/,'$2')).filter(text).map(norm);
    if(map.has(id)) issues.push('Duplicate container TC-'+id+'.'); else map.set(id,{taskId:id,criteria});
  }
  return {map,issues};
}
export function parseRoadmapTasks({roadmapMarkdown,programmeMarkdown}={}) {
  if(!text(roadmapMarkdown)||!text(programmeMarkdown)) return {tasks:new Map(),issues:['Both canonical roadmap documents are required.']};
  const primary=rowsById(roadmapMarkdown,ROADMAP_HEADERS,'ROADMAP.md',(c)=>({taskId:c[0],canonicalTitle:c[2],status:c[3].toLowerCase(),proofScope:c[4],implementationState:c[5],dependencies:deps(c[6]),evidence:c[8]}));
  const program=rowsById(programmeMarkdown,PROGRAM_HEADERS,'programme backlog',(c)=>({taskId:c[0],programmeTitle:c[3],priority:c[4],dependencies:deps(c[7])}));
  const containers=taskContainers(programmeMarkdown), issues=[...primary.issues,...program.issues,...containers.issues], tasks=new Map();
  for(const id of new Set([...primary.map.keys(),...program.map.keys()])) {
    const a=primary.map.get(id), b=program.map.get(id), c=containers.map.get(id), local=[];
    if(!a) local.push('Canonical ROADMAP row missing.'); if(!b) local.push('Programme backlog row missing.'); if(!c) local.push('Task container missing.');
    if(a&&b&&json([...a.dependencies].sort())!==json([...b.dependencies].sort())) local.push('Canonical and programme dependencies disagree.');
    if(b&&!/^P[0-9]$/.test(b.priority)) local.push('Priority missing or invalid.');
    if(c&&!c.criteria.length) local.push('Task container has no acceptance criteria.');
    tasks.set(id,{...(a??{}),...(b??{}),taskId:id,criteria:c?.criteria??[],issues:local});
  }
  const visiting=new Set(),visited=new Set(),cyclic=new Set();
  function visit(id,stack) { if(visiting.has(id)){const start=stack.indexOf(id);for(const member of stack.slice(start))cyclic.add(member);return;} if(visited.has(id))return; visiting.add(id);for(const dep of tasks.get(id)?.dependencies??[])if(tasks.has(dep))visit(dep,[...stack,id]);visiting.delete(id);visited.add(id); }
  for(const id of tasks.keys())visit(id,[id]); for(const id of cyclic)tasks.get(id).issues.push('Dependency cycle detected.');
  return {tasks,issues,sourceDigest:hash(roadmapMarkdown+'\0'+programmeMarkdown)};
}
function validatePlan(plan,id) {
  if(!isRecord(plan)||Object.keys(plan).some((key)=>!PLAN_KEYS.has(key))) return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_SHAPE_INVALID',taskId:id};
  if(plan.domainOrFeatureKey===undefined||plan.domainOrFeatureKey===null||(typeof plan.domainOrFeatureKey==='string'&&!plan.domainOrFeatureKey.trim()))
    return {status:'HOLD_TRUSTED_BINDING',code:'ROOT_DOMAIN_OR_FEATURE_KEY_MISSING',taskId:id};
  if(typeof plan.domainOrFeatureKey!=='string') return {status:'HOLD_TRUSTED_BINDING',code:'ROOT_DOMAIN_OR_FEATURE_KEY_INVALID',taskId:id};
  const normalizedDomainOrFeatureKey=plan.domainOrFeatureKey.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'-');
  if(plan.domainOrFeatureKey!==normalizedDomainOrFeatureKey)
    return {status:'HOLD_TRUSTED_BINDING',code:'ROOT_DOMAIN_OR_FEATURE_KEY_NOT_NORMALIZED',taskId:id};
  if(normalizedDomainOrFeatureKey.length>160||!/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(normalizedDomainOrFeatureKey))
    return {status:'HOLD_TRUSTED_BINDING',code:'ROOT_DOMAIN_OR_FEATURE_KEY_INVALID',taskId:id};
  if(!text(plan.objective)||!Array.isArray(plan.acceptance)||!plan.acceptance.length||plan.acceptance.some((x)=>!text(x))||!Array.isArray(plan.writeScope)||!plan.writeScope.length||!Array.isArray(plan.checks)||!plan.checks.length||!text(plan.mandateReference))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_FIELDS_MISSING',taskId:id};
  for(const scope of plan.writeScope) if(typeof scope!=='string'||!scope||scope.includes('\\')||scope.startsWith('/')||/^[A-Za-z]:/.test(scope)||scope.split('/').some((x,i,a)=>!x&&!(i===a.length-1&&scope.endsWith('/'))||x==='.'||x==='..'))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_SCOPE_INVALID',taskId:id};
  for(const check of plan.checks) if(!isRecord(check)||check.shell!==false||!text(check.executable)||!Array.isArray(check.argv)||check.argv.some((x)=>typeof x!=='string')||!text(check.cwd))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_CHECK_INVALID',taskId:id};
  return {plan:{objective:norm(plan.objective),acceptance:plan.acceptance.map(norm),writeScope:[...plan.writeScope],checks:plan.checks.map((c)=>({shell:false,executable:c.executable,argv:[...c.argv],cwd:c.cwd})),mandateReference:norm(plan.mandateReference),domainOrFeatureKey:normalizedDomainOrFeatureKey}};
}
function assess(id,campaign,tasks) {
  const task=tasks.get(id); if(!task) return {taskId:id,status:'HOLD_AMBIGUOUS_ROADMAP',code:'TASK_NOT_IN_CANONICAL_SOURCES'};
  const checked=validatePlan(campaign.taskPlans[id],id); if(checked.status) return checked;
  if(task.issues.length) return {taskId:id,status:'HOLD_AMBIGUOUS_ROADMAP',code:'TASK_SOURCE_AMBIGUOUS',reasons:task.issues};
  const accepted=new Set(checked.plan.acceptance.map((x)=>norm(x).toLowerCase())), missing=task.criteria.filter((x)=>!accepted.has(norm(x).toLowerCase()));
  if(missing.length) return {taskId:id,status:'HOLD_REVIEW_REQUIRED',code:'CANONICAL_ACCEPTANCE_NOT_BOUND',missingCriteria:missing};
  if(task.status==='done') return {taskId:id,status:'ALREADY_COMPLETE',code:'ROADMAP_DONE',evidence:task.evidence};
  if(task.status!=='planned') return {taskId:id,status:'HOLD_TASK_STATUS',code:'TASK_NOT_PLANNED',roadmapStatus:task.status};
  const blockers=task.dependencies.flatMap((depId)=>{const dep=tasks.get(depId);return !dep?[{taskId:depId,status:'MISSING'}]:dep.status!=='done'?[{taskId:depId,status:dep.status}]:!text(dep.evidence)?[{taskId:depId,status:'DONE_EVIDENCE_UNAVAILABLE'}]:[];});
  if(blockers.length) return {taskId:id,status:'HOLD_DEPENDENCY',code:'DEPENDENCIES_UNACCEPTED',blockers};
  return {taskId:id,status:'READY_CANDIDATE',priority:task.priority,taskRecord:{schemaVersion:'task-readiness/v1',taskId:id,objective:checked.plan.objective,acceptance:checked.plan.acceptance,writeScope:checked.plan.writeScope,checks:checked.plan.checks,dependencies:task.dependencies.map((taskId)=>({taskId})),mandateReference:checked.plan.mandateReference}};
}
function normalizeExcludedTaskIds(value,campaign) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.some((id)=>typeof id!=='string'||!TASK_ID.test(id))||new Set(value).size!==value.length)
    throw new IntakeError('HOLD_NOT_ALLOWED','EXCLUDE_TASK_IDS_INVALID','excludeTaskIds must be a unique list of canonical task IDs.');
  const outside=value.filter((id)=>!campaign.allowedTaskIds.includes(id));
  if(outside.length)throw new IntakeError('HOLD_NOT_ALLOWED','EXCLUDE_TASK_ID_NOT_ALLOWED','Excluded task IDs must be inside the root campaign allowlist.');
  return [...value].sort();
}
function lockConflict(locks,taskId,scopes) {
  for(const row of locks)if(row.task_id!==taskId)for(const request of scopes){const a=pathKey(row.scope_path.replace(/\/$/,'')),b=pathKey(request.replace(/\/$/,''));if(a===b||(row.scope_path.endsWith('/')&&b.startsWith(a+'/'))||(request.endsWith('/')&&a.startsWith(b+'/')))return {taskId:row.task_id,scope:row.scope_path,requested:request};}
  return null;
}
function withScopeLockState(candidate,taskId,locks) {
  if(candidate.status!=='READY_CANDIDATE')return candidate;
  const conflict=lockConflict(locks.rows,taskId,candidate.taskRecord.writeScope);
  return conflict?{...candidate,status:'HOLD_SCOPE_CONFLICT',code:'ACTIVE_WRITE_SCOPE_CONFLICT',scopeConflict:conflict,lockFingerprint:locks.fingerprint}:candidate;
}
function taskInputDigest(campaign,sourceDigest,taskId) { return hash({campaignDigest:campaign.campaignDigest,sourceDigest:sourceDigest??null,taskId}); }
function withPriorReceipt(candidate,row,campaign,sourceDigest,locks) {
  if(candidate.status==='HOLD_TRUSTED_BINDING')return candidate;
  if(!row)return candidate;
  const inputDigest=taskInputDigest(campaign,sourceDigest,candidate.taskId);
  if(candidate.status==='READY_CANDIDATE'&&shouldRetryScopeConflict(row,inputDigest,locks.fingerprint,campaign.campaignDigest,sourceDigest,campaign.baseCommit))return candidate;
  const prior=priorReceipt(row,inputDigest,{campaignDigest:campaign.campaignDigest,sourceDigest,baseCommit:campaign.baseCommit});
  if(row.state==='READY'&&prior.status==='READY')return candidate;
  return {...prior,taskId:candidate.taskId,...(candidate.priority?{priority:candidate.priority}:{}),durableReceipt:true};
}
function selectTask(campaign,tasks,requested,excludeTaskIds=[],locks={rows:[],fingerprint:null},sourceDigest=null,priorReceipts=new Map()) {
  if(requested&&!campaign.allowedTaskIds.includes(requested)) return {status:'HOLD_NOT_ALLOWED',code:'TASK_NOT_IN_ROOT_ALLOWLIST',candidates:[]};
  const candidates=(requested?[requested]:campaign.allowedTaskIds.filter((id)=>!excludeTaskIds.includes(id))).map((id)=>withPriorReceipt(withScopeLockState(assess(id,campaign,tasks),id,locks),priorReceipts.get(id),campaign,sourceDigest,locks));
  const ready=candidates.filter((x)=>x.status==='READY_CANDIDATE').sort((a,b)=>Number(a.priority.slice(1))-Number(b.priority.slice(1))||a.taskId.localeCompare(b.taskId));
  if(ready.length) return {status:'READY_CANDIDATE',selected:ready[0],candidates};
  const status=['HOLD_TRUSTED_BINDING','HOLD_REVIEW_REQUIRED','HOLD_AMBIGUOUS_ROADMAP','HOLD_DEPENDENCY','HOLD_TASK_STATUS','HOLD_SCOPE_CONFLICT','HOLD_PREFLIGHT','HOLD_RECONCILE','HOLD_REASSESSMENT_REQUIRED','HOLD_INTAKE_IN_PROGRESS','HOLD_COLLISION'].find((s)=>candidates.some((x)=>x.status===s))??'HOLD_NO_READY_TASK';
  return {status,code:candidates.find((candidate)=>candidate.status===status)?.code??candidates[0]?.code??(excludeTaskIds.length?'NO_UNEXCLUDED_READY_TASK':'NO_ALLOWED_READY_TASK'),candidates};
}
function readSources(repo,base) {
  try { const roadmap=git(repo,['show',base+':docs/roadmap/ROADMAP.md']),programme=git(repo,['show',base+':docs/roadmap/ROADMAP-zuri-ai-24w-program.md']);return parseRoadmapTasks({roadmapMarkdown:roadmap,programmeMarkdown:programme}); }
  catch(error) { throw new IntakeError('HOLD_ROADMAP','CANONICAL_ROADMAP_UNAVAILABLE',error.message); }
}
function planLoaded(loaded,requested,excludeTaskIds=[],locks={rows:[],fingerprint:null},priorReceipts=new Map()) {
  const {campaign,repoRoot}=loaded, parsed=readSources(repoRoot,campaign.baseCommit);
  if(parsed.issues.length) return {result:{schemaVersion:RESULT_SCHEMA,status:'HOLD_AMBIGUOUS_ROADMAP',code:'ROADMAP_TABLE_AMBIGUOUS',issues:parsed.issues,sourceDigest:parsed.sourceDigest,campaignId:campaign.campaignId,authorityGrant:false,dispatchAllowed:false,checksExecuted:false}};
  const choice=selectTask(campaign,parsed.tasks,requested,excludeTaskIds,locks,parsed.sourceDigest,priorReceipts), result={schemaVersion:RESULT_SCHEMA,status:choice.status,code:choice.code??null,campaignId:campaign.campaignId,requestedTaskId:requested??null,excludedTaskIds:excludeTaskIds,selectedTaskId:choice.selected?.taskId??null,candidates:choice.candidates,sourceDigest:parsed.sourceDigest,campaignDigest:campaign.campaignDigest,baseCommit:campaign.baseCommit,lockFingerprint:locks.fingerprint,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  if(choice.selected)result.taskRecord=choice.selected.taskRecord; return {result,loaded,choice};
}
function errorResult(error) { return {schemaVersion:RESULT_SCHEMA,status:error instanceof IntakeError?error.status:'HOLD_RECONCILE',code:error.code??'INTAKE_ERROR',message:error.message,authorityGrant:false,dispatchAllowed:false,checksExecuted:false}; }
export function planRoadmapIntake(input={}) { try { const loaded=loadCampaign(input),excluded=normalizeExcludedTaskIds(input.excludeTaskIds,loaded.campaign),locks=readLockSnapshot(loaded.commonDir),priorReceipts=readReceiptSnapshot(loaded.commonDir),output=planLoaded(loaded,input.taskId,excluded,locks,priorReceipts);return output.result; } catch(error){return errorResult(error);} }

function statePaths(common) { const root=path.join(common,'zuri-delivery-control','roadmap-intake-v1');return {root,database:path.join(root,'intake.sqlite'),tasks:path.join(root,'tasks'),locks:path.join(root,'locks')}; }
function openDb(file) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec("CREATE TABLE IF NOT EXISTS intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS intake_receipt_history(task_id TEXT NOT NULL,sequence INTEGER NOT NULL,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,archived_at TEXT NOT NULL,transition_reason TEXT NOT NULL,observed_lock_fingerprint TEXT NOT NULL,PRIMARY KEY(task_id,sequence)) STRICT; CREATE TABLE IF NOT EXISTS intake_evaluations(input_digest TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;");return db;
}
function readReceiptRows(db) { return new Map(db.prepare('SELECT * FROM intake_receipts ORDER BY task_id').all().map((row)=>[row.task_id,row])); }
function readReceiptSnapshot(common) {
  const file=statePaths(common).database;if(!fs.existsSync(file))return new Map();let db;
  try { db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=5000;');if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='intake_receipts'").get())return new Map();return readReceiptRows(db); }
  catch(error) { throw new IntakeError('HOLD_RECONCILE','INTAKE_RECEIPTS_UNREADABLE',error.message); }
  finally { db?.close(); }
}
function atomicWrite(file,content) { fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,content,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file); }
function now() { return new Date().toISOString(); }
function controllerDbPath(common) { return path.join(common,'zuri-delivery-control','controller-v1.sqlite'); }
function readLockSnapshot(common) {
  const file=controllerDbPath(common);let rows=[];
  if(fs.existsSync(file)){let db;try{db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA busy_timeout=5000;');if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_write_locks'").get())rows=db.prepare('SELECT task_id,scope_path FROM delivery_write_locks ORDER BY task_id,scope_path').all();}
    catch(error){throw new IntakeError('HOLD_CONTROLLER_STATE','CONTROLLER_STATE_UNREADABLE',error.message);}finally{db?.close();}}
  return {rows,fingerprint:hash(rows)};
}
function shouldRetryScopeConflict(row,inputDigest,lockFingerprint,campaignDigest,sourceDigest,baseCommit) {
  if(row.state!=='HOLD_SCOPE_CONFLICT'||row.input_digest!==inputDigest||row.campaign_digest!==campaignDigest||row.source_digest!==sourceDigest)return false;
  let receipt;try { receipt=JSON.parse(row.receipt_json); } catch { return false; }
  return isRecord(receipt)&&receipt.status==='HOLD_SCOPE_CONFLICT'&&receipt.status===row.state&&(!receipt.baseCommit||receipt.baseCommit===baseCommit)&&typeof receipt.lockFingerprint==='string'&&receipt.lockFingerprint!==lockFingerprint;
}
function priorReceipt(row,inputDigest,{campaignDigest,sourceDigest,baseCommit}={}) {
  let result;try { result=JSON.parse(row.receipt_json); } catch { result=null; }
  const changed=[];
  if(row.input_digest!==inputDigest)changed.push('inputDigest');
  if(campaignDigest!==undefined&&row.campaign_digest!==campaignDigest)changed.push('campaignDigest');
  if(sourceDigest!==undefined&&row.source_digest!==sourceDigest)changed.push('sourceDigest');
  if(result?.baseCommit&&baseCommit&&result.baseCommit!==baseCommit)changed.push('baseCommit');
  if(changed.length)return {schemaVersion:RESULT_SCHEMA,status:'HOLD_REASSESSMENT_REQUIRED',code:'ROOT_RECONCILIATION_REQUIRED',taskId:row.task_id,priorState:row.state,priorCampaignId:row.campaign_id,changedBindings:changed,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  if(!isRecord(result)||typeof result.status!=='string')return {schemaVersion:RESULT_SCHEMA,status:'HOLD_RECONCILE',code:'DURABLE_RECEIPT_RECONCILIATION_REQUIRED',taskId:row.task_id,priorState:row.state,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  if(row.state==='INTAKE_PREPARING'||result.status==='INTAKE_PREPARING')return {...result,status:'HOLD_RECONCILE',code:'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED'};
  if(row.state!==result.status)return {schemaVersion:RESULT_SCHEMA,status:'HOLD_RECONCILE',code:'DURABLE_RECEIPT_STATE_MISMATCH_RECONCILIATION_REQUIRED',taskId:row.task_id,priorState:row.state,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  return result;
}
function createTaskWorktree({loaded,selected,sourceDigest,lockFingerprint,db,inputDigest,priorRow=null}) {
  const {campaign,repoRoot,commonDir}=loaded,taskId=selected.taskId,taskRecord=selected.taskRecord,paths=statePaths(commonDir);
  const checkedPlan=validatePlan(campaign.taskPlans[taskId],taskId);
  if(checkedPlan.status)throw new IntakeError(checkedPlan.status,checkedPlan.code,'The root-private task plan has no usable trusted binding key.');
  const domainOrFeatureKey=checkedPlan.plan.domainOrFeatureKey;
  const taskFile=path.join(paths.tasks,taskId+'.json'),bindingFile=path.join(paths.tasks,taskId+'.controller.json'),branch='codex/roadmap-intake/'+taskId.toLowerCase(),workspace=path.dirname(repoRoot),parent=path.join(workspace,'.worktrees','roadmap-intake-v1'),worktreeRoot=path.join(parent,taskId.toLowerCase());
  const taskDigest=hash(taskRecord),stamp=now();
  const initial={schemaVersion:RESULT_SCHEMA,status:'INTAKE_PREPARING',code:'INTAKE_CLAIMED',receiptId:priorRow?randomUUID():hash(campaign.campaignId+'\0'+taskId+'\0'+inputDigest).slice(0,32),campaignId:campaign.campaignId,taskId,priority:selected.priority,branch,worktreeRoot,taskFile,bindingFile,taskDigest,sourceDigest,baseCommit:campaign.baseCommit,lockFingerprint,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  db.exec('BEGIN IMMEDIATE;');
  try {
    const current=db.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(taskId);
    if(priorRow){
      if(!current||current.input_digest!==priorRow.input_digest||current.state!=='HOLD_SCOPE_CONFLICT'||!shouldRetryScopeConflict(current,inputDigest,lockFingerprint,campaign.campaignDigest,sourceDigest,campaign.baseCommit))throw new IntakeError('HOLD_REASSESSMENT_REQUIRED','SCOPE_HOLD_CHANGED_DURING_REASSESSMENT','Scope hold changed before retry; reconcile the durable receipt.');
      const sequence=(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM intake_receipt_history WHERE task_id=?').get(taskId)?.next??1);
      db.prepare('INSERT INTO intake_receipt_history(task_id,sequence,campaign_id,input_digest,state,receipt_json,archived_at,transition_reason,observed_lock_fingerprint) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(taskId,sequence,current.campaign_id,current.input_digest,current.state,current.receipt_json,stamp,'LOCK_STATE_CHANGED',lockFingerprint);
      db.prepare('UPDATE intake_receipts SET input_digest=?,campaign_digest=?,source_digest=?,task_digest=?,state=?,receipt_json=?,updated_at=? WHERE task_id=?')
        .run(inputDigest,campaign.campaignDigest,sourceDigest,taskDigest,'INTAKE_PREPARING',json(initial),stamp,taskId);
    } else {
      if(current)throw new IntakeError('HOLD_REASSESSMENT_REQUIRED','TASK_ALREADY_HAS_INTAKE_RECEIPT','Existing task receipt requires reconciliation.');
      db.prepare('INSERT INTO intake_receipts(task_id,campaign_id,input_digest,campaign_digest,source_digest,task_digest,state,receipt_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(taskId,campaign.campaignId,inputDigest,campaign.campaignDigest,sourceDigest,taskDigest,'INTAKE_PREPARING',json(initial),stamp,stamp);
    }
    db.exec('COMMIT;');
  } catch(error) {try{db.exec('ROLLBACK;');}catch{}throw error;}
  const lock=path.join(paths.locks,taskId+'.lock');fs.mkdirSync(paths.locks,{recursive:true});let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(error){const hold={...initial,status:'HOLD_INTAKE_IN_PROGRESS',code:error.code==='EEXIST'?'INTAKE_LOCK_EXISTS':'INTAKE_LOCK_FAILED'};db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(hold.status,json(hold),now(),taskId);return hold;}
  let added=false;
  try {
    const currentLocks=readLockSnapshot(commonDir),conflict=lockConflict(currentLocks.rows,taskId,taskRecord.writeScope);
    if(conflict){const hold={...initial,status:'HOLD_SCOPE_CONFLICT',code:'ACTIVE_WRITE_SCOPE_CONFLICT',message:'Scope conflicts with active controller task '+conflict.taskId+'.',scopeConflict:conflict,lockFingerprint:currentLocks.fingerprint};db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(hold.status,json(hold),now(),taskId);return hold;}
    const cdb=controllerDbPath(commonDir);if(fs.existsSync(cdb)){const check=new DatabaseSync(cdb,{readOnly:true});try{if(check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_runs'").get()&&check.prepare('SELECT 1 FROM delivery_runs WHERE task_id=?').get(taskId))throw new IntakeError('HOLD_CONTROLLER_STATE','TASK_ALREADY_REGISTERED','Task already exists in durable delivery controller.');}finally{check.close();}}
    fs.mkdirSync(parent,{recursive:true});if(!inside(workspace,fs.realpathSync.native(parent)))throw new IntakeError('HOLD_SCOPE','WORKTREE_PARENT_ESCAPE','Worktree parent resolves outside workspace.');
    if(fs.existsSync(worktreeRoot)||git(repoRoot,['branch','--list',branch]).trim())throw new IntakeError('HOLD_COLLISION','WORKTREE_OR_BRANCH_EXISTS','Worktree path or deterministic branch exists without this receipt.');
    git(repoRoot,['worktree','add','-b',branch,worktreeRoot,campaign.baseCommit]);added=true;
    if(git(worktreeRoot,['rev-parse','--verify','HEAD^{commit}'])!==campaign.baseCommit||git(worktreeRoot,['branch','--show-current'])!==branch||git(worktreeRoot,['status','--porcelain=v1','--untracked-files=all']))throw new IntakeError('HOLD_RECONCILE','WORKTREE_BASELINE_MISMATCH','Worktree is not a clean checkout of the exact accepted base.');
    atomicWrite(taskFile,json(taskRecord,null,2)+'\n');
    const preflightResult=preflightTask({repo:worktreeRoot,taskFile,base:campaign.baseCommit,includeChanged:true});
    if(preflightResult.status!=='READY'){
      const hold={...initial,status:'HOLD_PREFLIGHT',code:'AUTOMATIC_PREFLIGHT_BLOCKED',preflightResult,worktreeCreated:true,taskRecord};db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(hold.status,json(hold),now(),taskId);return hold;
    }
    const trustedMandateBinding={resolvedBy:'root',taskId,sourceRef:campaign.sourceRef,repositoryRoot:repoRoot,objective:taskRecord.objective,domainOrFeatureKey,writeScope:[...taskRecord.writeScope],authorizedEffects:[...campaign.authorizedEffects],prohibitions:[...campaign.prohibitions]};
    const controllerBinding={taskId,taskFile,worktree:worktreeRoot,base:campaign.baseCommit,trustedMandateBinding};atomicWrite(bindingFile,json(controllerBinding,null,2)+'\n');
    const ready={...initial,status:'READY',code:'TASK_INTAKE_READY',taskRecord,preflightResult,controllerBinding,controllerBindingFile:bindingFile,worktreeCreated:true,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
    db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(ready.status,json(ready),now(),taskId);return ready;
  } catch(error) {
    const hold={...initial,status:error instanceof IntakeError?error.status:'HOLD_RECONCILE',code:error.code??'INTAKE_EFFECT_REASSESSMENT',message:error.message,worktreeCreated:added,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
    db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(hold.status,json(hold),now(),taskId);return hold;
  } finally { try{fs.closeSync(fd);}catch{} try{fs.unlinkSync(lock);}catch{} }
}
export function runRoadmapIntake(input={}) {
  let db;try {
    const loaded=loadCampaign(input),excluded=normalizeExcludedTaskIds(input.excludeTaskIds,loaded.campaign),locks=readLockSnapshot(loaded.commonDir),priorReceipts=readReceiptSnapshot(loaded.commonDir),planned=planLoaded(loaded,input.taskId,excluded,locks,priorReceipts),result=planned.result??planned;
    if(result.status==='HOLD_TRUSTED_BINDING')return result;
    const dbPaths=statePaths(loaded.commonDir);db=openDb(dbPaths.database);
    const receiptFingerprint=hash([...priorReceipts.values()].map((row)=>[row.task_id,row.state,row.input_digest,row.campaign_digest,row.source_digest,row.receipt_json,row.created_at,row.updated_at]));
    const evaluationDigest=hash({campaignDigest:loaded.campaign.campaignDigest,baseCommit:loaded.campaign.baseCommit,sourceDigest:result.sourceDigest??null,taskId:input.taskId??null,excludeTaskIds:input.taskId?[]:excluded,lockFingerprint:locks.fingerprint,receiptFingerprint});
    if(!planned.choice?.selected){const previous=db.prepare('SELECT result_json FROM intake_evaluations WHERE input_digest=?').get(evaluationDigest);if(previous)return JSON.parse(previous.result_json);const output={...result,receiptId:hash(evaluationDigest).slice(0,32),receiptCreated:true};db.prepare('INSERT INTO intake_evaluations(input_digest,campaign_id,result_json,created_at) VALUES(?,?,?,?)').run(evaluationDigest,loaded.campaign.campaignId,json(output),now());return output;}
    const selected=planned.choice.selected,inputDigest=taskInputDigest(loaded.campaign,result.sourceDigest,selected.taskId),prior=db.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(selected.taskId);
    if(prior&&!shouldRetryScopeConflict(prior,inputDigest,locks.fingerprint,loaded.campaign.campaignDigest,result.sourceDigest,loaded.campaign.baseCommit))return priorReceipt(prior,inputDigest,{campaignDigest:loaded.campaign.campaignDigest,sourceDigest:result.sourceDigest,baseCommit:loaded.campaign.baseCommit});
    const admitted=createTaskWorktree({loaded,selected,sourceDigest:result.sourceDigest,lockFingerprint:locks.fingerprint,db,inputDigest,priorRow:prior??null});
    return {...admitted,candidates:planned.choice.candidates};
  }catch(error){return errorResult(error);}finally{db?.close();}
}
function parseArgs(argv) {
  const command=argv[0];if(!['plan','intake'].includes(command))throw new IntakeError('HOLD_USAGE','USAGE','Usage: roadmap-intake.mjs plan|intake --campaign <private-json> [--repo <path>] [--task-id <TASK-ZAI-NNN>] [--exclude-task-id <TASK-ZAI-NNN> ...].');
  const args={};for(let i=1;i<argv.length;i++){const key=argv[i],name=key==='--campaign'?'campaignFile':key==='--repo'?'repoRoot':key==='--task-id'?'taskId':key==='--exclude-task-id'?'excludeTaskIds':null;if(!name||!argv[i+1]||argv[i+1].startsWith('--'))throw new IntakeError('HOLD_USAGE','USAGE','Invalid or incomplete option.');const value=argv[++i];if(name==='excludeTaskIds')(args[name]??=[]).push(value);else{if(args[name])throw new IntakeError('HOLD_USAGE','USAGE','Duplicate option.');args[name]=value;}}
  if(!args.campaignFile)throw new IntakeError('HOLD_USAGE','USAGE','--campaign is required.');return {command,args};
}
export function main(argv=process.argv.slice(2)) {
  try{const parsed=parseArgs(argv),result=parsed.command==='plan'?planRoadmapIntake(parsed.args):runRoadmapIntake(parsed.args);process.stdout.write(json(result)+'\n');if(!['READY','READY_CANDIDATE'].includes(result.status)&&!result.status?.startsWith('ALREADY_'))process.exitCode=2;return result;}
  catch(error){const result=errorResult(error);process.stderr.write(json(result)+'\n');process.exitCode=2;return result;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
