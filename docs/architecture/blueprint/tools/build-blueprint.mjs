import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] ?? '');
const out = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) throw Error('Usage: node build-blueprint.mjs <isolated-repo> <package-directory>');
if (fs.existsSync(path.join(out, 'FROZEN.json'))) throw Error('Published package is frozen; create a new version instead.');
const { parseCanonicalRecord } = await import(pathToFileURL(path.join(repo, 'apps/server/scripts/document-registry-format.mjs')));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const posix = p => p.split(path.sep).join('/');
const put = (relative, content) => { const dest = path.join(out, relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content); };
const json = (relative, content) => put(relative, JSON.stringify(content, null, 2) + '\n');
const csv = (relative, rows) => put(relative, '\uFEFF' + rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n');
const tracked = git('ls-files').split('\n');
const rules = JSON.parse(fs.readFileSync(path.join(repo, 'docs/architecture/blueprint/resolutions.json'), 'utf8'));
const index = JSON.parse(fs.readFileSync(path.join(repo, 'registry/document-registry/index.json'), 'utf8'));
const sources = new Map();
const raw = (relative, kind = 'supporting-source') => {
  if (sources.has(relative)) return sources.get(relative).packagePath;
  const absolute = path.resolve(repo, relative);
  if (!absolute.startsWith(repo + path.sep) || /(?:^|\/)\.env(?:\.|$)/i.test(relative)) throw Error('Unsafe source: ' + relative);
  const bytes = fs.readFileSync(absolute);
  const packagePath = `provenance/source-tree/${relative}`;
  put(packagePath, bytes);
  sources.set(relative, { path: relative, packagePath, sha256: hash(bytes), bytes: bytes.length, role: kind });
  return packagePath;
};
const sourceLink = (from, relative, label = relative) => `[${label}](${posix(path.relative(path.dirname(from), raw(relative)))})`;
const rebaseMarkdown = (text, source, destination) => text.replace(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (whole, target) => {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return whole;
  const [file, fragment] = target.split('#');
  const sourceFile = path.resolve(repo, path.dirname(source), decodeURIComponent(file));
  if (!sourceFile.startsWith(repo + path.sep)) throw Error('Source link escapes repository: ' + source + ' -> ' + target);
  const relative = posix(path.relative(repo, sourceFile));
  if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) throw Error('Unresolved normative source link: ' + source + ' -> ' + target);
  const packageFile = raw(relative);
  return `](${posix(path.relative(path.dirname(destination), packageFile))}${fragment ? '#' + fragment : ''})`;
});

// Store original records without changing IDs, row hashes, memberships, or delivery markers.
const records = index.records.map(record => {
  const bytes = fs.readFileSync(path.join(repo, record.path));
  const parsed = parseCanonicalRecord(bytes.toString('utf8'));
  const lifecycle = parsed.cells.at(-2).trim();
  const retired = /^~~/.test(parsed.statement) || /^(?:superseded|retired|dropped|cancelled)\b/i.test(lifecycle.replace(/\*\*/g, '').trim());
  const exclusion = rules.excludedFromProfile[record.id];
  const override = rules.overrides[record.id];
  const disposition = retired ? 'CANONICAL_RETIRED' : exclusion ? 'OUTSIDE_MINIMUM_PROFILE' : override ? 'IN_PROFILE_WITH_ACCEPTED_AMENDMENT' : 'IN_PROFILE';
  return { id: record.id, family: record.family, namespace: record.namespace, sourcePath: record.path, sourceSha256: hash(bytes), statementSha256: hash(parsed.statement), originalStatement: parsed.statement, originalLifecycle: lifecycle, originalFeatureMembers: parsed.requirementKeys ?? [], profileDisposition: disposition, operativeStatement: retired || exclusion ? null : override?.statement ?? parsed.statement, authority: override?.authority ?? [`ZAI:${record.id}`], exclusion: exclusion ?? null, clauseExclusions: rules.clauseExclusions?.[record.id] ?? null, rawPath: raw(record.path, 'canonical-record') };
});
const active = records.filter(r => r.operativeStatement !== null);
const activeIds = new Set(active.map(r => r.id));
const allIds = new Set(records.map(r => r.id));
for (const record of active) {
  record.profileFeatureMembers = record.originalFeatureMembers.filter(id => activeIds.has(id));
  record.omittedFeatureMembers = record.originalFeatureMembers.filter(id => !activeIds.has(id));
  const refs = [...new Set(record.operativeStatement.match(/\b(?:FR|NFR|BR|SEC|SDD|FEAT)-\d{3,}\b/g) ?? [])];
  const missing = refs.filter(id => !allIds.has(id));
  if (missing.length) throw Error(`${record.id} uses unresolved canonical IDs: ${missing.join(',')}`);
  const excluded = refs.filter(id => !activeIds.has(id));
  if (excluded.length) throw Error(`${record.id} operative statement requires excluded behavior: ${excluded.join(',')}`);
}

// Exact schemas are supplied in both persistence profiles. The dictionary is derived, not a new model registry.
const dictionaries = [];
for (const provider of ['sqlite', 'postgres']) {
  const relative = provider === 'sqlite' ? 'apps/server/prisma/schema.prisma' : 'apps/server/prisma/schema.postgres.prisma';
  const bytes = fs.readFileSync(path.join(repo, relative));
  put(`normative/data/${provider}.prisma`, bytes); raw(relative, 'persistence-schema');
  const text = bytes.toString('utf8');
  const models = [];
  for (const match of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = [], constraints = [];
    let comments = [];
    for (const rawLine of match[2].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) { comments = []; continue; }
      if (line.startsWith('//')) { comments.push(line.replace(/^\/\/\/?\s*/, '')); continue; }
      if (line.startsWith('@@')) { constraints.push(line); comments = []; continue; }
      const field = line.match(/^(\w+)\s+([\w]+(?:\[\]|\?)?)\s*(.*)$/);
      if (!field) throw Error(`Unparsed ${provider} model line ${match[1]}: ${line}`);
      fields.push({ name: field[1], type: field[2], optional: field[2].endsWith('?'), list: field[2].endsWith('[]'), attributes: field[3], documentation: comments });
      comments = [];
    }
    models.push({ name: match[1], fields, constraints });
  }
  if (!models.length) throw Error('No persistence models parsed: ' + relative);
  dictionaries.push({ provider, sourcePath: relative, sourceSha256: hash(bytes), models });
}
json('normative/data/dictionary.json', dictionaries);
put('normative/data/persisted-enum-constants.json',fs.readFileSync(path.join(out,'contracts/persisted-enum-constants.json')));
raw('apps/server/src/lib/validation/enums.js','persisted-validation-constants');
const dictionaryMd = ['# Data dictionary', '', 'Persisted string enum values and mode-default mappings: [exact shared constants](persisted-enum-constants.json). Prisma declares their storage types; owning validation contracts define allowed values.', '', 'Exact persisted shapes from the source schemas. Historical retired-device tables remain for recovery under ADR-110 D3; their presence does not authorize new pairing, device jobs or APIs. Target additions not declared by these schemas are described only by applicable canonical contracts, never silently added here.', ''];
for (const profile of dictionaries) {
  dictionaryMd.push('## ' + profile.provider, '', `Models: ${profile.models.length}. Exact schema: [${profile.provider}.prisma](${profile.provider}.prisma).`, '');
  for (const model of profile.models) {
    dictionaryMd.push('### ' + model.name, '', '| Field | Type | Constraints / mapping |', '|---|---|---|');
    for (const f of model.fields) dictionaryMd.push(`| ${f.name} | \`${f.type}\` | ${f.attributes.replaceAll('|','\\|')} |`);
    if (model.constraints.length) dictionaryMd.push('', ...model.constraints.map(c => '- `' + c + '`'));
    dictionaryMd.push('');
  }
}
put('normative/data/DICTIONARY.md', dictionaryMd.join('\n') + '\n');

const contractPaths = tracked.filter(p => (p.startsWith('apps/server/contracts/') && p.endsWith('.schema.json')) || (p.startsWith('services/conversation-runtime/contracts/') && p.endsWith('.schema.json')) || /^services\/scm\/contracts\/v1\/scm-(?:api|core)\.v1\.json$/.test(p) || /^services\/file-management\/contracts\/.*\.schema\.json$/.test(p));
const supportingContracts = {'apps/server/contracts/line-conversation-execution.schema.json':{disposition:'RETIRED_EDGE_V1_PROVENANCE_ONLY',root:'provenance/retired-contracts'},'apps/server/contracts/domain-state.schema.json':{disposition:'IMPLEMENTATION_STATE_SCHEMA_ONLY',root:'state/contracts'},'apps/server/contracts/doc-link-metadata.schema.json':{disposition:'DOCUMENT_TOOLING_SCHEMA_ONLY',root:'provenance/tooling-contracts'}};
const contractDocuments = [];
for (const p of contractPaths) {
  const bytes = fs.readFileSync(path.join(repo, p)); const doc = JSON.parse(bytes.toString('utf8'));
  const support=supportingContracts[p]; const packagePath= `${support?.root ?? 'normative/contracts'}/source/${p}`;
  put(packagePath,bytes); raw(p,'typed-contract-source');
  const oldPath=path.join(out,'normative/contracts/source',p);if(support&&fs.existsSync(oldPath)){if(hash(fs.readFileSync(oldPath))!==hash(bytes))throw Error('Refuse removal of independently modified preview schema '+p);fs.unlinkSync(oldPath);}
  contractDocuments.push({ sourcePath: p, packagePath, disposition:support?.disposition??'SELECTED_PRODUCT_CONTRACT', id: doc.$id ?? null, sha256: hash(bytes), type: doc.$schema ? 'JSON_SCHEMA' : 'OWNED_SERVICE_CONTRACT', document: doc });
}
const bySource = new Map(contractDocuments.map(c => [c.sourcePath, c]));
const byId = new Map(contractDocuments.filter(c => c.id).map(c => [c.id, c]));
const refs = [];
const resolvePointer = (document, fragment) => {
  if (!fragment) return true;
  if (!fragment.startsWith('/')) return true; // named anchors are validated by their schema dialect, not guessed here
  let value = document;
  for (const key of fragment.slice(1).split('/').map(x => decodeURIComponent(x).replaceAll('~1','/').replaceAll('~0','~'))) { if (value === null || typeof value !== 'object' || !(key in value)) return false; value = value[key]; }
  return true;
};
function checkRefs(value, current) {
  if (Array.isArray(value)) { value.forEach(x => checkRefs(x,current)); return; }
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') {
    const [file, fragment = ''] = value.$ref.split('#');
    const target = file === '' ? current : byId.get(file) ?? bySource.get(posix(path.normalize(path.join(path.dirname(current.sourcePath), file))));
    if (!target || !resolvePointer(target.document,fragment)) throw Error(`Unresolved typed-contract reference ${current.sourcePath} -> ${value.$ref}`);
    refs.push({ source: current.sourcePath, ref: value.$ref, target: target.sourcePath });
  }
  for (const [k,v] of Object.entries(value)) if (k !== '$ref') checkRefs(v,current);
}
contractDocuments.forEach(c => checkRefs(c.document,c));
json('normative/contracts/INDEX.json', { profile: rules.profile, items: contractDocuments.map(({document,...c})=>c), references: refs, authority: 'Selected product schemas plus explicitly separated retired/state/tooling source contracts. Only SELECTED_PRODUCT_CONTRACT items supply product wire shapes in their accepted scope. JSON $schema URIs identify dialects, not application network dependencies. External providers remain replaceable owner ports with configured endpoints; service schemas do not grant a new runtime or credentials.' });

// Six normative chapters; source-local links are rebased to the captured provenance tree.
const chapters = [
  ['normative/01-PRD.md','docs/PRODUCT.md'],
  ['normative/03-ARCHITECTURE.md','docs/architecture/blueprint/ARCHITECTURE.md'],
  ['normative/04-DATA-AND-CONTRACTS.md','docs/architecture/blueprint/DATA-AND-CONTRACTS.md'],
  ['normative/05-UX.md','docs/architecture/blueprint/UX.md'],
  ['normative/06-ACCEPTANCE.md','docs/architecture/blueprint/ACCEPTANCE.md'],
  ['normative/SCOPE-AND-PRECEDENCE.md','docs/architecture/blueprint/SCOPE-AND-PRECEDENCE.md'],
  ['normative/RECONCILIATION.md','docs/architecture/blueprint/RECONCILIATION.md'],
];
for (const [dest, source] of chapters) {
  const text = fs.readFileSync(path.join(repo,source),'utf8'); raw(source,'resolved-normative-source');
  put(dest, rebaseMarkdown(text,source,dest));
}
const srsPath = 'normative/02-SRS.md';
const srs = ['# Software requirements specification — ' + rules.profile, '', 'This is the operative target view of declared canonical requirements under the accepted amendments in [RECONCILIATION](RECONCILIATION.md) and [scope/precedence](SCOPE-AND-PRECEDENCE.md). Delivery cells, task dates, implementation progress and old test outcomes are separated in ../state. Exact original rows and hashes remain in provenance; this projection does not edit the requirement registry.', '', 'The seven modes share one core. An ID names its original subject permanently; a scoped amendment is recorded beside the operative clause rather than silently repurposing an ID.', ''];
for (const family of ['FEAT','FR','NFR','BR','SEC','SDD']) {
  srs.push('## ' + family, '');
  for (const r of active.filter(r=>r.family===family).sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}))) {
    srs.push('### ZAI:' + r.id, '', r.operativeStatement, '');
    if (family === 'FEAT') srs.push('In-profile members: ' + (r.profileFeatureMembers.join(', ') || '(none)') + '.', '');
    srs.push('Authority: ' + r.authority.join('; ') + '.', '', sourceLink(srsPath,r.sourcePath,'Original canonical source') + ' · SHA-256 `' + r.sourceSha256 + '`.', '');
  }
}
put(srsPath,srs.join('\n')+'\n');

// Use owning source annotations as traceability only; no test result is inferred.
const bindingMap = new Map();
for (const p of tracked.filter(p=>/^(?:apps\/server\/(?:src|tests)\/|services\/(?:conversation-runtime|market-intelligence|scm)\/(?:src|tests?)\/)/.test(p)&&/\.(?:[cm]?[jt]sx?)$/.test(p))) {
  const text = fs.readFileSync(path.join(repo,p),'utf8');
  const ids = new Set();
  for (const line of text.split(/\r?\n/).filter(l=>/@req\b|@trace\b/.test(l))) for (const id of line.match(/\b(?:FR|NFR|BR|SEC|SDD|FEAT)-\d{3,}\b/g)??[]) if (activeIds.has(id)) ids.add(id);
  const isTest = /\/tests?\//.test(p);
  const titles = isTest ? [...text.matchAll(/\b(?:it|test)\s*\(\s*(['"`])([^\r\n]*?)\1/g)].map(m=>m[2]) : [];
  for (const id of ids) {
    const values = bindingMap.get(id) ?? [];
    values.push({ path:p, kind:isTest?'test-reference':'implementation-reference', sha256:hash(fs.readFileSync(path.join(repo,p))), scenarioTitles:titles }); bindingMap.set(id,values);
  }
}
const crossCutting = [{id:'AC-SCOPE',match:/tenant|business|workspace|scope|authoriz|access|viewer|permission|ขอบเขต|สิทธิ/i},{id:'AC-CRUD',match:/CRUD|human code|hierarchy|create|update|delete|สร้าง|แก้ไข|ลบ/i},{id:'AC-MODES',match:/workstream|execution.?mode|progress|roll.?up|strategy|น้ำหนัก|ความก้าวหน้า/i},{id:'AC-IMPORT',match:/import|plan.?envelope|execution.?plan.?bundle|dry.run|นำเข้า/i},{id:'AC-LINE',match:/LINE|reply.?token|conversation.?runtime|rich.?menu|LineConversation/i},{id:'AC-KNOWLEDGE',match:/knowledge|file.?asset|citation|parse|document.?version|source.?span|ingestion|ground/i},{id:'AC-UX',match:/UI|interface|loading|empty|keyboard|accessibility|WCAG|token|หน้าจอ|แสดง/i}];
const matrix = active.filter(r=>r.family!=='FEAT').map(r=>({
  requirement:'ZAI:'+r.id, family:r.family, sourcePath:r.sourcePath, sourceSha256:r.sourceSha256,
  oracle:r.operativeStatement, oracleKind:'SOURCE_OBLIGATION_INDEX_NOT_DECOMPOSED_TEST_CASE', crossCuttingScenarioIds:crossCutting.filter(c=>c.match.test(r.operativeStatement)).map(c=>c.id), controllingAuthority:r.authority, clauseExclusions:r.clauseExclusions,
  verificationMethod:r.family==='SEC'?'adversarial authorization/privacy checks':r.family==='NFR'?'measured observation against the exact declared bounds':r.family==='BR'?'invariant/property checks':r.family==='SDD'?'contract/architecture inspection plus behavior checks':'observable behavior/contract checks',
  declaredBounds:[...new Set(r.operativeStatement.match(/\b\d+(?:\.\d+)?\s*(?:MiB|KiB|MB|KB|ms|seconds?|minutes?|hours?|days?|pages?|paragraphs?|cells?|elements?|entries|bytes?|%|THB)\b/gi)??[])],
  expectedRefusals:[...new Set(r.operativeStatement.match(/\b[45]\d{2}\b|\b[A-Z][A-Z0-9_]{4,}\b/g)??[])].filter(x=>/^\d/.test(x)||/(?:DENIED|INVALID|UNAVAILABLE|NOT_FOUND|CONFLICT|MISMATCH|REQUIRED|REFUSED|REJECTED)/.test(x)),
  traceReferences:bindingMap.get(r.id)??[],
  scope:'Target acceptance oracle. Referenced test/source paths explain traceability; they assert no executed PASS and are not required access to implement the spec.',
}));
json('normative/acceptance/requirements.json',matrix);
csv('normative/acceptance/matrix.csv',[['requirement','family','verificationMethod','oracle','declaredBounds','expectedRefusals','sourcePath','sourceSha256','crossCuttingScenarioIds'],...matrix.map(r=>[r.requirement,r.family,r.verificationMethod,r.oracle,r.declaredBounds.join('; '),r.expectedRefusals.join('; '),r.sourcePath,r.sourceSha256,r.crossCuttingScenarioIds.join('; ')])]);
put('normative/06-ACCEPTANCE.md',fs.readFileSync(path.join(out,'normative/06-ACCEPTANCE.md'),'utf8')+'\n## Complete requirement obligation index\n\nEvery in-profile FR/NFR/BR/SEC/SDD has its exact operative source obligation in [requirements.json](acceptance/requirements.json) and [matrix.csv](acceptance/matrix.csv). Local AC-* scenario IDs in each row bind relevant cross-cutting acceptance sections above. This is an obligation index, not a claim of 492 fully decomposed executable tests. The implementing team instantiates source clauses against its chosen UI/internal DTO fields and supplies isolated fixtures, observable assertions and evidence. A reference to a historical test or its title is not an execution result. Feature membership is in chapter 02.\n');
put('normative/04-DATA-AND-CONTRACTS.md',fs.readFileSync(path.join(out,'normative/04-DATA-AND-CONTRACTS.md'),'utf8')+'\n## Supplied exact data and wire artifacts\n\n- [Full data dictionary](data/DICTIONARY.md) and [structured dictionary](data/dictionary.json).\n- [SQLite schema](data/sqlite.prisma) and [PostgreSQL schema](data/postgres.prisma).\n- [Typed schema/service contract index](contracts/INDEX.json); every first-party $ref is resolved inside this package.\n- The [source OpenAPI export](../contracts/openapi.json) and [API operation census](../contracts/api-operations.json) are reference coverage, not a claim that every handler DTO has been typed. They cannot weaken the explicit normative behavior or named typed contracts.\n');

// Keep lifecycle, delivery plan and current-code observations outside the normative book.
csv('state/requirement-lifecycle.csv',[['id','family','originalLifecycle','profileDisposition','sourcePath','sourceSha256'],...records.map(r=>[r.id,r.family,r.originalLifecycle,r.profileDisposition,r.sourcePath,r.sourceSha256])]);
json('state/requirement-trace-references.json',Object.fromEntries(bindingMap));
json('provenance/requirement-resolution.json',records);
json('provenance/resolution-rules.json',rules);
const documents = [...new Set([...tracked.filter(p=>p.startsWith('docs/')), ...chapters.map(([,p])=>p), 'docs/architecture/blueprint/README.md'])].filter(p=>fs.existsSync(path.join(repo,p)));
const docRoles = documents.map(p=>{
  const bytes=fs.readFileSync(path.join(repo,p));
  let role=/\/(?:archive)\//.test(p)?'HISTORY':/\/(?:roadmap|plans)\//.test(p)||/(?:DELIVERY-PLAN|IMPLEMENTATION-PACKET|IMPLEMENTATION-PLAN|PHASE-PLAN)/.test(p)||/^doc_type:\s*implementation-plan\s*$/m.test(bytes.toString('utf8'))?'PLAN':/(?:EVIDENCE|RECEIPT|STATUS|PROGRESS|REPORT|VERIFICATION)/i.test(p)?'STATE_OR_EVIDENCE':'SOURCE_OR_REFERENCE';
  if (/^docs\/features\/FEAT-\d+\/(?:design|verification)\.md$/.test(p)||['docs/PRD-SDD-v1.0.md','docs/FEATURES.md','docs/architecture/README.md','docs/product/README.md','docs/operations/README.md','docs/governance/README.md','docs/DOCUMENT-LINKS.md','docs/FEATURE-MAP.md','docs/DOMAIN-MAP.md','docs/TRACE.md'].includes(p))role='GENERATED_VIEW';
  if (p.startsWith('docs/architecture/blueprint/'))role='RESOLVED_BLUEPRINT';
  const packagePath = role==='PLAN' ? 'plans/source/'+p : role==='STATE_OR_EVIDENCE' ? 'state/source/'+p : null;
  if(packagePath)put(packagePath,bytes);
  return {path:p,role,sha256:hash(bytes),bytes:bytes.length,packagePath};
});
csv('provenance/docs-inventory.csv',[['path','role','bytes','sha256'],...docRoles.map(r=>[r.path,r.role,r.bytes,r.sha256])]);
csv('plans/source-plan-index.csv',[['path','role','bytes','sha256','packagePath'],...docRoles.filter(r=>r.role==='PLAN').map(r=>[r.path,r.role,r.bytes,r.sha256,r.packagePath])]);
put('plans/README.md','# Developer plans\n\nOriginal planning sources selected by delivery-plan path/type are copied under source/ and indexed with SHA-256. They record sequencing and historical constraints, not additional normative product behavior. Approved design decisions embedded in a plan apply only when separately selected by a canonical requirement or accepted ADR. Read the blueprint scope for the exact selected subset.\n');
csv('state/source-state-index.csv',[['path','role','bytes','sha256','packagePath'],...docRoles.filter(r=>r.role==='STATE_OR_EVIDENCE').map(r=>[r.path,r.role,r.bytes,r.sha256,r.packagePath])]);
put('state/README.md','# Historical delivery state and evidence\n\nOriginal lifecycle cells and source reports/receipts are separate from target behavior. Copies under source/ retain original bytes and are indexed with SHA-256. Names/path classification identifies primary documentary purpose, not approval. A historical PASS or deployed label does not establish acceptance of the new implementation. Business-domain state machines remain normative where their accepted source requires them.\n');
const candidates=['docs/architecture/project-manager-system/17-SRS.md','docs/architecture/project-manager-system/19-SYSTEM-BLUEPRINT.md','docs/architecture/project-manager-system/18-DATABASE-TABLES-AND-ERD.md','docs/ARCHITECTURE-TARGET-MODULAR-MONOLITH.md','docs/domains/market-intelligence/SRS.md','docs/domains/asset-management/SRS.md','docs/change-requests/zuri_inference_pool_v0.1.1b_approved/ZURI-INFERENCE-POOL-FULL-REVIEW.md'];
json('plans/excluded-candidate-dispositions.json',candidates.map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(repo,p))),disposition:'NOT_NORMATIVE',reason:p.includes('ARCHITECTURE-TARGET')?'Taxonomy/ownership adopted by ADR-025; proposed runtime/database details excluded.':'No automatic adoption of candidate/unintegrated/full-lifecycle scope; explicitly canonical target records remain mandatory.'})));

const context=[...tracked.filter(p=>/^docs\/decisions\/.*\.md$/.test(p)||/^docs\/domains\/[^/]+\/CHARTER\.md$/.test(p)||/^docs\/services\/[^/]+\/SERVICE\.md$/.test(p)), 'docs/DOMAIN-MODEL.md','docs/ARCHITECTURE.md','docs/EXECUTION-MODES.md','docs/zuri_workspace_system.md','docs/UI-DESIGN-SYSTEM.md','docs/ROUTES-SITEMAP.md','docs/appendices/A-api-spec.md','docs/appendices/B-db-schema.md','registry/document-registry/index.json','docs/domains/line-oa-studio/SRS.md', 'docs/change-requests/agent-factory/AGENT-FACTORY-V1.md','docs/change-requests/business-provisioning/STANDARD-BUSINESS-TEMPLATE-V1.md','docs/change-requests/marketing/ZURI-GO-REPORT-RECEIVER.md','docs/change-requests/marketing/ZURI-GO-REPORT-PHYSICAL-DESIGN.md','docs/plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md','docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md'];
for(const p of context)raw(p,'authority-or-context-provenance');
for(const p of tracked.filter(p=>/^docs\/domains\/[^/]+\/features\/FR-(\d+)[^/]*\.md$/.test(p))){const id=p.match(/\/(FR-\d+)/)?.[1];if(activeIds.has(id))raw(p,'owning-feature-context-provenance');}
for(const p of tracked.filter(p=>p.startsWith('docs/architecture/blueprint/')))raw(p,'projection-source-or-generator');
const sourceManifest=[...sources.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
const snapshotDigest=hash(JSON.stringify(sourceManifest.map(s=>[s.path,s.sha256])));
const sourceRevision=git('rev-parse','HEAD');
const summary={schemaVersion:'zuri-rebuild-blueprint/v1',profile:rules.profile,status:'RECONCILED_SOURCE_BASELINE_PENDING_FINAL_VALIDATION',sourceRepository:'Freshair129/zuri.ai',baseMain:rules.baseMain,sourceRevision,sourceTreeDigest:snapshotDigest,sourceDirtyPaths:git('status','--short'),canonicalRecords:records.length,inProfile:active.length,canonicalRetired:records.filter(r=>r.profileDisposition==='CANONICAL_RETIRED').map(r=>r.id),outOfProfile:records.filter(r=>r.profileDisposition==='OUTSIDE_MINIMUM_PROFILE').map(r=>r.id),amendedRecords:active.filter(r=>r.profileDisposition==='IN_PROFILE_WITH_ACCEPTED_AMENDMENT').map(r=>r.id),familyCounts:active.reduce((c,r)=>(c[r.family]=(c[r.family]??0)+1,c),{}),persistenceProfiles:dictionaries.map(p=>({provider:p.provider,models:p.models.length,fields:p.models.reduce((n,m)=>n+m.fields.length,0)})),typedContractDocuments:contractDocuments.length,selectedProductContracts:contractDocuments.filter(c=>c.disposition==='SELECTED_PRODUCT_CONTRACT').length,supportingContractDocuments:contractDocuments.filter(c=>c.disposition!=='SELECTED_PRODUCT_CONTRACT').map(c=>({path:c.sourcePath,disposition:c.disposition})),typedContractReferencesResolved:refs.length,acceptanceOracles:matrix.length,sourceFiles:sourceManifest.length,scope:'Accepted target requirements in the selected minimum core profile; not a claim of deployed completeness, old test success, frozen untyped internal HTTP DTOs, or newly approved candidate expansion.'};
json('provenance/source-manifest.json',sourceManifest); json('manifest.json',summary);
put('README.md',`# zuri.ai — rebuild blueprint\n\nProfile **${rules.profile}** · source revision \`${sourceRevision}\` · source tree digest \`${snapshotDigest}\`.\n\nThis package is the resolved specification source of truth for the selected standalone rebuild profile. It consolidates existing canonical obligations under accepted controlling amendments; it does not replace the editable canonical registry. The source repo remains authoritative for future edits, and an edit creates a new blueprint version.\n\n## Normative book\n\n1. [Product / PRD](normative/01-PRD.md)\n2. [SRS](normative/02-SRS.md) — ${active.length} in-profile records, exact original statements retained separately\n3. [Architecture](normative/03-ARCHITECTURE.md)\n4. [Data and contracts](normative/04-DATA-AND-CONTRACTS.md) — full field dictionary, both schemas and typed wire artifacts\n5. [UX and user flows](normative/05-UX.md)\n6. [Acceptance](normative/06-ACCEPTANCE.md) — ${matrix.length} source-linked acceptance obligations and concrete cross-cutting scenarios\n\nRead [scope and precedence](normative/SCOPE-AND-PRECEDENCE.md) and [resolved conflicts](normative/RECONCILIATION.md) with the book. All seven execution modes share the same neutral core. The ${records.length}-record source catalog remains intact; ${summary.canonicalRetired.length} canonical-retired records and ${summary.outOfProfile.length} explicitly excluded transport/device profile records are preserved without repurposing their IDs.\n\n## Separate supporting material\n\n- \`state/\`: original lifecycle cells, code/test trace references and source-state index. These assert no new-system PASS.\n- \`plans/\`: old delivery-plan index and candidate exclusions. They do not add scope to the book.\n- \`contracts/openapi.json\` and \`contracts/api-operations.json\`: source export/operation census. Inventory-only DTOs are not promoted to exact schemas.\n- \`provenance/\`: original source bytes, resolution rules and SHA-256 manifest. Raw historical paragraphs and source delivery cells are not operative blueprint clauses.\n- \`evidence/\`: actual verification/review/CI results for this package, distinct from product acceptance.\n\nThe package closes its supplied first-party JSON-schema references and includes both exact persistence schemas. External LINE/model/MSP/GKS services remain explicit configured owner ports; secrets, private deployments, legacy repository access and external provider activation are not prerequisites to read or implement the blueprint.\n\nImplementation freedom applies where no governing spec declares an internal field or UI layout. It cannot weaken scope, authorization, transactional behavior, audit, canonical identities or an explicitly typed boundary. This profile does not promise a byte-for-byte clone of unspecified current internal endpoints.\n\nUse synthetic isolated acceptance fixtures in the new implementation. Verify each applicable source obligation, bound cross-cutting scenario and exact schema; do not import old rollout state or count a test reference as a result.\n`);
console.log(JSON.stringify(summary));
