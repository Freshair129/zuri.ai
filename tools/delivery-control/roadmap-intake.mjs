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
const PLAN_KEYS = new Set(['objective','acceptance','writeScope','checks','mandateReference']);

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
  if(!text(plan.objective)||!Array.isArray(plan.acceptance)||!plan.acceptance.length||plan.acceptance.some((x)=>!text(x))||!Array.isArray(plan.writeScope)||!plan.writeScope.length||!Array.isArray(plan.checks)||!plan.checks.length||!text(plan.mandateReference))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_FIELDS_MISSING',taskId:id};
  for(const scope of plan.writeScope) if(typeof scope!=='string'||!scope||scope.includes('\\')||scope.startsWith('/')||/^[A-Za-z]:/.test(scope)||scope.split('/').some((x,i,a)=>!x&&!(i===a.length-1&&scope.endsWith('/'))||x==='.'||x==='..'))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_SCOPE_INVALID',taskId:id};
  for(const check of plan.checks) if(!isRecord(check)||check.shell!==false||!text(check.executable)||!Array.isArray(check.argv)||check.argv.some((x)=>typeof x!=='string')||!text(check.cwd))
    return {status:'HOLD_REVIEW_REQUIRED',code:'TASK_PLAN_CHECK_INVALID',taskId:id};
  return {plan:{objective:norm(plan.objective),acceptance:plan.acceptance.map(norm),writeScope:[...plan.writeScope],checks:plan.checks.map((c)=>({shell:false,executable:c.executable,argv:[...c.argv],cwd:c.cwd})),mandateReference:norm(plan.mandateReference)}};
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
function selectTask(campaign,tasks,requested,excludeTaskIds=[]) {
  if(requested&&!campaign.allowedTaskIds.includes(requested)) return {status:'HOLD_NOT_ALLOWED',code:'TASK_NOT_IN_ROOT_ALLOWLIST',candidates:[]};
  const candidates=(requested?[requested]:campaign.allowedTaskIds.filter((id)=>!excludeTaskIds.includes(id))).map((id)=>assess(id,campaign,tasks));
  const ready=candidates.filter((x)=>x.status==='READY_CANDIDATE').sort((a,b)=>Number(a.priority.slice(1))-Number(b.priority.slice(1))||a.taskId.localeCompare(b.taskId));
  if(ready.length) return {status:'READY_CANDIDATE',selected:ready[0],candidates};
  const status=['HOLD_REVIEW_REQUIRED','HOLD_AMBIGUOUS_ROADMAP','HOLD_DEPENDENCY','HOLD_TASK_STATUS'].find((s)=>candidates.some((x)=>x.status===s))??'HOLD_NO_READY_TASK';
  return {status,code:candidates[0]?.code??(excludeTaskIds.length?'NO_UNEXCLUDED_READY_TASK':'NO_ALLOWED_READY_TASK'),candidates};
}
function readSources(repo,base) {
  try { const roadmap=git(repo,['show',base+':docs/roadmap/ROADMAP.md']),programme=git(repo,['show',base+':docs/roadmap/ROADMAP-zuri-ai-24w-program.md']);return parseRoadmapTasks({roadmapMarkdown:roadmap,programmeMarkdown:programme}); }
  catch(error) { throw new IntakeError('HOLD_ROADMAP','CANONICAL_ROADMAP_UNAVAILABLE',error.message); }
}
function planLoaded(loaded,requested,excludeTaskIds=[]) {
  const {campaign,repoRoot}=loaded, parsed=readSources(repoRoot,campaign.baseCommit);
  if(parsed.issues.length) return {result:{schemaVersion:RESULT_SCHEMA,status:'HOLD_AMBIGUOUS_ROADMAP',code:'ROADMAP_TABLE_AMBIGUOUS',issues:parsed.issues,sourceDigest:parsed.sourceDigest,campaignId:campaign.campaignId,authorityGrant:false,dispatchAllowed:false,checksExecuted:false}};
  const choice=selectTask(campaign,parsed.tasks,requested,excludeTaskIds), result={schemaVersion:RESULT_SCHEMA,status:choice.status,code:choice.code??null,campaignId:campaign.campaignId,requestedTaskId:requested??null,excludedTaskIds:excludeTaskIds,selectedTaskId:choice.selected?.taskId??null,candidates:choice.candidates,sourceDigest:parsed.sourceDigest,campaignDigest:campaign.campaignDigest,baseCommit:campaign.baseCommit,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  if(choice.selected)result.taskRecord=choice.selected.taskRecord; return {result,loaded,choice};
}
function errorResult(error) { return {schemaVersion:RESULT_SCHEMA,status:error instanceof IntakeError?error.status:'HOLD_RECONCILE',code:error.code??'INTAKE_ERROR',message:error.message,authorityGrant:false,dispatchAllowed:false,checksExecuted:false}; }
export function planRoadmapIntake(input={}) { try { const loaded=loadCampaign(input),excluded=normalizeExcludedTaskIds(input.excludeTaskIds,loaded.campaign),output=planLoaded(loaded,input.taskId,excluded);return output.result; } catch(error){return errorResult(error);} }

function statePaths(common) { const root=path.join(common,'zuri-delivery-control','roadmap-intake-v1');return {root,database:path.join(root,'intake.sqlite'),tasks:path.join(root,'tasks'),locks:path.join(root,'locks')}; }
function openDb(file) {
  fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec("CREATE TABLE IF NOT EXISTS intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS intake_evaluations(input_digest TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;");return db;
}
function atomicWrite(file,content) { fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,content,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file); }
function now() { return new Date().toISOString(); }
function controllerDbPath(common) { return path.join(common,'zuri-delivery-control','controller-v1.sqlite'); }
function scopeConflict(common,taskId,scopes) {
  const file=controllerDbPath(common);if(!fs.existsSync(file))return null;let db;
  try { db=new DatabaseSync(file,{readOnly:true});if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_write_locks'").get())return null;
    for(const row of db.prepare('SELECT task_id,scope_path FROM delivery_write_locks WHERE task_id<>?').all(taskId))for(const request of scopes){const a=pathKey(row.scope_path.replace(/\/$/,'')),b=pathKey(request.replace(/\/$/,''));if(a===b||(row.scope_path.endsWith('/')&&b.startsWith(a+'/'))||(request.endsWith('/')&&a.startsWith(b+'/')))return {taskId:row.task_id,scope:row.scope_path};}return null;
  } catch(error){throw new IntakeError('HOLD_CONTROLLER_STATE','CONTROLLER_STATE_UNREADABLE',error.message);}finally{db?.close();}
}
function priorReceipt(row,inputDigest) {
  if(row.input_digest===inputDigest){const result=JSON.parse(row.receipt_json);if(result.status==='INTAKE_PREPARING')return {...result,status:'HOLD_RECONCILE',code:'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED'};return result;}
  return {schemaVersion:RESULT_SCHEMA,status:'HOLD_REASSESSMENT_REQUIRED',code:'TASK_ALREADY_HAS_INTAKE_RECEIPT',taskId:row.task_id,priorState:row.state,priorCampaignId:row.campaign_id,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
}
function createTaskWorktree({loaded,selected,sourceDigest,db,inputDigest}) {
  const {campaign,repoRoot,commonDir}=loaded,taskId=selected.taskId,taskRecord=selected.taskRecord,paths=statePaths(commonDir);
  const taskFile=path.join(paths.tasks,taskId+'.json'),bindingFile=path.join(paths.tasks,taskId+'.controller.json'),branch='codex/roadmap-intake/'+taskId.toLowerCase(),workspace=path.dirname(repoRoot),parent=path.join(workspace,'.worktrees','roadmap-intake-v1'),worktreeRoot=path.join(parent,taskId.toLowerCase());
  const taskDigest=hash(taskRecord),receiptId=hash(campaign.campaignId+'\0'+taskId+'\0'+inputDigest).slice(0,32),stamp=now();
  const initial={schemaVersion:RESULT_SCHEMA,status:'INTAKE_PREPARING',code:'INTAKE_CLAIMED',receiptId,campaignId:campaign.campaignId,taskId,priority:selected.priority,branch,worktreeRoot,taskFile,bindingFile,taskDigest,sourceDigest,baseCommit:campaign.baseCommit,authorityGrant:false,dispatchAllowed:false,checksExecuted:false};
  db.prepare('INSERT INTO intake_receipts(task_id,campaign_id,input_digest,campaign_digest,source_digest,task_digest,state,receipt_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(taskId,campaign.campaignId,inputDigest,campaign.campaignDigest,sourceDigest,taskDigest,'INTAKE_PREPARING',json(initial),stamp,stamp);
  const lock=path.join(paths.locks,taskId+'.lock');fs.mkdirSync(paths.locks,{recursive:true});let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(error){const hold={...initial,status:'HOLD_INTAKE_IN_PROGRESS',code:error.code==='EEXIST'?'INTAKE_LOCK_EXISTS':'INTAKE_LOCK_FAILED'};db.prepare('UPDATE intake_receipts SET state=?,receipt_json=?,updated_at=? WHERE task_id=?').run(hold.status,json(hold),now(),taskId);return hold;}
  let added=false;
  try {
    const conflict=scopeConflict(commonDir,taskId,taskRecord.writeScope);if(conflict)throw new IntakeError('HOLD_SCOPE_CONFLICT','ACTIVE_WRITE_SCOPE_CONFLICT','Scope conflicts with active controller task '+conflict.taskId+'.');
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
    const trustedMandateBinding={resolvedBy:'root',taskId,sourceRef:campaign.sourceRef,repositoryRoot:repoRoot,objective:taskRecord.objective,writeScope:[...taskRecord.writeScope],authorizedEffects:[...campaign.authorizedEffects],prohibitions:[...campaign.prohibitions]};
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
    const loaded=loadCampaign(input),excluded=normalizeExcludedTaskIds(input.excludeTaskIds,loaded.campaign),planned=planLoaded(loaded,input.taskId,excluded),result=planned.result??planned,dbPaths=statePaths(loaded.commonDir);db=openDb(dbPaths.database);
    const evaluationDigest=hash({campaignDigest:loaded.campaign.campaignDigest,sourceDigest:result.sourceDigest??null,taskId:input.taskId??null,excludeTaskIds:input.taskId?[]:excluded});
    if(!planned.choice?.selected){const previous=db.prepare('SELECT result_json FROM intake_evaluations WHERE input_digest=?').get(evaluationDigest);if(previous)return JSON.parse(previous.result_json);const output={...result,receiptId:hash(evaluationDigest).slice(0,32),receiptCreated:true};db.prepare('INSERT INTO intake_evaluations(input_digest,campaign_id,result_json,created_at) VALUES(?,?,?,?)').run(evaluationDigest,loaded.campaign.campaignId,json(output),now());return output;}
    const selected=planned.choice.selected,inputDigest=hash({campaignDigest:loaded.campaign.campaignDigest,sourceDigest:result.sourceDigest??null,taskId:selected.taskId}),prior=db.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(selected.taskId);if(prior)return priorReceipt(prior,inputDigest);
    return createTaskWorktree({loaded,selected,sourceDigest:result.sourceDigest,db,inputDigest});
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
