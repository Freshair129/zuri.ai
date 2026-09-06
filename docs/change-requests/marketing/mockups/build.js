/* Build design inventory only; does not generate product source or requirements. */
const fs=require('fs'); const path=require('path'); const data=require('./catalog');
const root=__dirname, parent=path.dirname(root);
const rows=data.screens.map(s=>({...s,mockup:`mockups/index.html#${s.id}`,screenshot:`mockups/screenshots/${s.id}.jpg`,status:'candidate mockup; not implemented'}));
if(new Set(rows.map(s=>s.key)).size!==rows.length)throw new Error('Duplicate interface key');
const keys=new Set(rows.map(s=>s.key));
for(const s of rows)for(const key of [s.back,s.next,s.rowTarget,s.primary?.[1]].filter(Boolean))if(!keys.has(key))throw new Error(`${s.key}: missing target ${key}`);
for(const section of data.sections)for(const tab of section.tabs){const key=tab.toLowerCase().replaceAll(' & ','-').replaceAll(' ','-');if(!keys.has(`${section.key}/${key}`))throw new Error(`Missing navigation tab ${section.key}/${key}`);}
fs.writeFileSync(path.join(root,'inventory.json'),JSON.stringify({version:data.version,notice:data.fixtureNotice,counts:count(rows),interfaces:rows},null,2)+'\n');
function count(list){return Object.fromEntries(['page','tab','detail-tab','detail','form','dialog','state'].map(k=>[k,list.filter(s=>s.kind===k).length]));}
const escape=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
const header=`---
version: "0.1.0b"
created_at: "2026-09-06T13:16:52+07:00,RWANG,03e3940"
last_update: "2026-09-06T13:16:52+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: candidate-interface-inventory
  scope: "All Marketing prototype pages, tabs, records, forms, decisions and shared states"
---

# Marketing — Interface Inventory & Mockup Coverage

**Relates to:** [Domain Design](../CR-018-MARKETING-DOMAIN-DESIGN.md), [Navigation](MARKETING-NAVIGATION-VIEWS.md), [Channels](MARKETING-CHANNEL-CONTRACTS.md), [Team refinement](MARKETING-TEAM-REFINEMENT.md)

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Candidate design; none of these new interfaces is claimed implemented |
| Total mockup interfaces | ${rows.length} |
| Shell | Existing BusinessShell → Marketing; separate design-review toolbar outside product UI |
| Source | mockups/catalog.js; this candidate inventory and JSON export are generated with node mockups/build.js |
| Prototype | [Open all screens](mockups/index.html) |
| Machine inventory | [inventory.json](mockups/inventory.json) |

## 1. Counting and scope

“ทุกหน้า” = all pages/tabs in Navigation v0.1.0b, the record interfaces those pages open,
creation forms for documented briefs/experiments/intake/runs, team decision dialogs and ten shared state previews.
Different tabs have separate screen IDs; provider/date filters are not counted as separate pages.
Shared states are reusable presentations, not 10 extra production routes or a claim to render the entire screen × state Cartesian product.
Cross-domain CRM/Commerce/PM/Integration pages remain owned by their existing inventories; the mockup demonstrates the handoff, not cloned destination apps.

MKT-UI-### is a local design anchor, not a new global FR/FEAT/SDD/ADR or a shipped route.
Routes containing brackets are candidate production shapes; the static prototype uses the screen ID in its URL hash.
Fixture titles, names, metrics, accounts, receipts and outcomes are fictional design data, visibly labeled throughout.
External actions are simulated locally and never call a provider. No application source/schema/API is changed.

| Interface kind | Count |
|---|---:|
${Object.entries(count(rows)).map(([k,n])=>`| ${k} | ${n} |`).join('\n')}

## 2. Common behavior and access

- Every read: trusted session, authorized Business and growth visibility; per-account/property/evidence access before reading.
- Every write: owner-resolved target capability, exact Business and version; Team membership grants nothing.
- Review, approve, external action and GKS promotion are distinct capabilities; exact version/target/ceiling is visible before confirmation.
- On Business switch clear incompatible record/account/property and drafts; prototype uses isolated fictional fixtures, never production records.
- Loading/empty/partial/stale/error/forbidden/unavailable/conflict/blocked/unknown differ visibly; unavailable is not zero.
- Production would persist through owner services; prototype drafts/decisions use sessionStorage for demonstration only; no server record is created.
- Global review selector and previous/next let the reviewer inspect every ID, including forms and shared-state previews.
- Each primary action either opens its named prototype target, updates local presentation state, or shows a clearly labeled owner handoff.

## 3. Full screen registry

Each row links to its mockup and screenshot. Screenshot files are produced by the documented verification run,
not screenshots of a working production feature.
`;
let md=header;
for(const section of data.sections){
 md+=`\n### ${section.label}\n\n| ID / mockup | Interface / kind | Candidate route | Purpose / primary action | Source / owner | States | Screenshot |\n|---|---|---|---|---|---|---|\n`;
 for(const s of rows.filter(s=>s.section===section.key))md+=`| [${s.id}](${s.mockup}) | ${escape(s.title)} · ${s.kind} | \`${s.route}\` | ${escape(s.description)}; ${escape(s.primary?.[0]||'Inspect record / filter view')} | ${escape(s.source)} / ${s.owner} | ${s.states.join(', ')} | [View](${s.screenshot}) |\n`;
}
md+=`\n## 4. Detail and action requirements\n
Forms show required fields, validation, cancel/back and draft preview. Editing an approved record creates a new draft/version.
Campaign detail and Live detail replace collection navigation with one detail-tab bar; other records use sections/drawers.
Paid campaign → AdSet/Ad Group → Ad uses breadcrumbs, not nested tab bars; common provider filters preserve metric labels.
Creative/post details expose version and rights; publication is an explicit handoff/receipt, never implied by draft save.
Refinement detail shows bounded rounds/cost/time, role/step receipts, evidence, diff, blockers and human decision.
Approval/rejection/change-request/pause/cancel/action/promotion dialogs each show scope and consequence.
Approval on stale input is rejected; ambiguous provider outcome requires reconciliation rather than blind retry.

## 5. Verification and delivery\n
Evidence is recorded in [verification.json](mockups/verification.json) and [QA report](MARKETING-MOCKUP-QA.md).
Verification must enumerate every catalog ID, open each screen, capture an individual screenshot,
check missing resources/runtime errors/overflow and exercise navigation, filters, forms, version review and shared states.
Desktop and mobile layouts are checked separately; representative contact sheets make visual review practical.
No product unit/build/e2e or live-provider test is claimed by these prototype checks.

## CHANGELOG\n
| Version | Date | Status | Summary | Commit Hash | Agent |\n|---|---|---|---|---|---|\n| 0.1.0b | 2026-09-06 | candidate | Enumerate ${rows.length} Marketing mockup interfaces with route, purpose, source, access, states and traceable screenshots | See git history | RWANG |\n`;
fs.writeFileSync(path.join(parent,'MARKETING-INTERFACE-INVENTORY.md'),md);
console.log(JSON.stringify({interfaces:rows.length,kinds:count(rows),catalogTargets:'PASS'}));
