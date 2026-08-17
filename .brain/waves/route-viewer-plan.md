# Route-viewer baseline repayment — Planner wave file

Planner: fable5, 2026-08-17. Input: `.brain/prompts/route-viewer-multiagent.md`,
`docs/.route-viewer-baseline.json` (23 routes), the 8 services behind them (all
read in full), `viewer-authority.js`, `import-authorization.js`,
`project-team-service.js`, `resolve-viewer.js`, PRD registry, both RCAs, the
Wave-0/1 ledger.

**Verdict up front: 19 of 23 routes are repayable from declared rules. 4 are
BLOCKED on missing owner decisions** (`scope`, `backup/import`, `repositories`,
`repositories/[id]`) — each written up below in the FR-065 clause-(b) manner.
Repaying 19 honestly beats repaying 23 by inventing authority for the other 4.

## Corrections to the mission table (verified against code, not assumed)

1. **`milestones`, `milestones/[id]`, `gates`, `gates/[id]` are NOT behind
   `project-service`.** They import from
   `src/modules/project-manager/application/milestone-gate-service.js`. The
   mission's "project-service owns 8 routes" is factually 4 + 4 across two
   source files. The intent of the do-not-split rule — one worker per source
   file — is preserved: each file is one wave. They *can* be worked
   concurrently because they do not share a source file (they do share
   `tests/integration/project-core.test.js` and
   `tests/integration/adaptive-shell.test.js` — resolved by Wave 0, below).
2. **"repositories" =** `repository-service.js`. **"files" =**
   `project-file-service.js` (routes `projects/[id]/files*`).
3. **Every write function behind the 23 routes has exactly one production
   caller: its route handler** (verified by grep across `src/`; the intake
   pipeline and agent stack do not call these services). The guard still goes
   in the **service**, per the mission and the import precedent — the route
   count today is one, and the whole point of the required-viewer-that-throws
   is that the *next* caller crashes loudly instead of writing quietly.

## The shared facts every wave leans on

- **The predicate is `ownsBusiness(viewer, businessId)`**
  (`src/modules/identity/viewer-authority.js`). Never `viewer.role`, never
  `visibleBusinessIds` (RCA 2026-08-16).
- **The governing Business of a Project comes from its Space**:
  `workspace.businessId` (FR-043 makes `project.businessId` equal to it;
  `project-team-service.js` lines 52–61 is the worked derivation, with the
  additive-backfill fallback `project.businessId ?? workspace.businessId`).
- **A Project in a PORTFOLIO/TENANT-scoped Space has `businessId = null`**
  (`resolveProjectBusinessId` permits it; seed creates `WS-PLATFORM`).
  `ownsBusiness(viewer, null)` is `false` for every viewer, so the one
  predicate already refuses those targets — fail closed, no special case in
  code. But that refusal **removes a capability anyone could previously use**,
  which is the FR trigger (see FR decision).
- **Viewer is a required argument that throws when omitted** —
  `authorizeImportTarget()` precedent.
- **Refusal disclosure**, per the two existing precedents the architect will
  choose between per wave: unowned-but-real Business-scoped target answers
  exactly as a nonexistent one (`import-authorization.js`, `reason: null`);
  a target whose governing scope is *above Business* may carry an explicit
  reason naming the missing authority, because that fact is static, identical
  for every caller, and grants nothing (`ungovernedScopeRefusal`).

## FR decision (decided once, here)

- **Enforcing `ownsBusiness` on a Business-governed target is a defect fix.**
  SEC-001 (cross-tenant/business guard), SEC-008 (fail-closed authorization
  from persisted authority), BR-001 (tenant isolation) and the FR-059/FR-036/
  FR-065 precedents already declare that a write inside a Business requires
  that Business's OWNER grant. No new id for this part, in any wave.
- **One new FR is needed — `FR-072` (next free: registry currently tops out at
  FR-071; verified no FR-072/073 anywhere in `docs/` or `.brain/`).** It
  covers the *behaviour change* the guards introduce: targets governed by no
  Business — a Project in a PORTFOLIO/TENANT Space, a non-BUSINESS Workspace
  — become unwritable **for every principal**, refused in the FR-065
  clause-(b) manner (name the missing authority; do not invent it; the exit is
  a future FR that makes above-Business authority holdable, cross-referenced
  to FR-066/FR-067 exactly as FR-065 does). Writing into `WS-PLATFORM`'s
  projects worked yesterday and will not work after these waves; that removal
  needs an id.
- **The Planner does not write `docs/`.** The integrator/controller declares
  the FR-072 row at 🔜 in `docs/PRD-SDD-v1.0.md` **as part of Wave 0, before
  any worker starts** (rule 11; the Wave-0/1 ledger verified an FR at 🔜 is
  excluded from `fr_without_code`, so declaring ahead of code does not fail
  govern). Proposed statement:

  > **FR-072** — Project-Manager mutation authorization: every mutating route
  > repaid from `docs/.route-viewer-baseline.json` resolves a request viewer
  > and the service behind it refuses the write unless
  > `ownsBusiness(viewer, <governing Business>)`, where the governing Business
  > is derived from the target's Space (`workspace.businessId`; for
  > Project-scoped targets via the Project's Space per FR-043; for a
  > Dependency, the governing Business of **both** endpoints). (a) A
  > Business-governed target that is not owned answers exactly as a
  > nonexistent one. (b) A target governed above Business (a Project in a
  > PORTFOLIO/TENANT Space, a non-BUSINESS-scoped Workspace) is refused for
  > every principal with a reason naming the missing authority — this
  > requirement deliberately does not invent authority above Business;
  > enabling such writes requires a prior FR that makes that authority
  > holdable (FR-066/FR-067 direction), per the FR-065 precedent.

---

## Wave 0 — serial, lands and merges before any worker starts

Owner: integrator/controller (or one dedicated agent), **not** one of the three
workers. Everything here is needed by ≥2 waves.

1. **The shared authorizer** — one new module, proposed
   `src/modules/project-manager/application/project-authorization.js`
   (architect fixes the final path/signature):
   - `requireViewer(viewer)` — throws (plain Error, wiring-time crash) when
     `viewer` is `null`/`undefined`. Same wording discipline as
     `authorizeImportTarget()`.
   - `governingBusinessId(db, { projectId | workstreamId | ... })` — resolves
     the target chain to `workspace.businessId` (Project →
     `project.businessId ?? workspace.businessId`; Workstream → its Project;
     WorkContainer/WorkItem → their Workstream → Project). Pure derivation +
     reads; no decision.
   - `assertProjectWrite(viewer, projectId, { db })` (and the thin
     workstream/item variants the waves need) — `requireViewer`, derive,
     `ownsBusiness`, refuse with the agreed status/shape. Every wave calls
     **this**, so the predicate is written once — the stated purpose of
     Wave 0.
   - Unit tests using `makeViewer()` / `ownsElsewhere()` / `makeDevViewer()`,
     including the `businessId === null` (shared-Space Project) refusal and
     the throws-without-viewer contract.
2. **The signature convention, frozen in the design doc**: every guarded
   service function takes the viewer in a trailing options bag —
   `createProject(input, { viewer })`, `updateItem(id, patch, { viewer })`,
   `deleteProjectFile(projectId, fileId, { db, viewer })` (extends the
   existing bag where one exists) — and the service throws/refuses when it is
   absent. Workers implement per service; nobody redesigns it per wave.
3. **Pre-thread viewers through the two test files shared by ≥2 waves** —
   this is what makes 3-way concurrency possible at all:
   - `tests/integration/project-core.test.js` — calls **five** of the waved
     services (project 9×, work 5×, milestone/gate 3×, dependency 3×,
     repository 5×). If each wave migrated its own call sites, five waves
     would edit one file.
   - `tests/integration/adaptive-shell.test.js` — project 3× + milestone 3×.
   Mechanism: build one owner viewer per fixture scope with `makeViewer({
   ownedBusinessIds: [business.id], visibleBusinessIds: [business.id] })` in
   the existing setup, pass `{ viewer }` per the frozen signature at every
   call site. Today's services ignore the extra option, so `npm test` stays
   green **before** any guard lands; when a wave lands, its guard validates
   the pre-threaded viewer. (Residual risk: if a pre-threaded viewer is wrong
   for one call site, the wave's worker fixes exactly that call site and says
   so in its report; the integrator merges waves serially, so this cannot
   become a three-way conflict.)
4. **FR-072 declared at 🔜** in `docs/PRD-SDD-v1.0.md` (controller edit,
   single commit, before workers dispatch — id allocation is serial, per the
   ADR-020 collision lesson).

Wave 0 is done when: helper + its tests merged to the integration branch,
`npm test` green with counts, signature convention + pre-threaded files
merged, FR-072 row present.

---

## The waves (every one of the 23 routes appears exactly once — 19 across
## Waves 1–6, 4 in the BLOCKED section)

### Wave 1 — `project-service` (4 routes)

- **Routes:** `src/app/api/projects/route.js` (POST),
  `src/app/api/projects/[id]/route.js` (PATCH, DELETE),
  `src/app/api/workstreams/route.js` (POST),
  `src/app/api/workstreams/[id]/route.js` (PATCH, DELETE)
- **Service file:** `src/modules/project-manager/application/project-service.js`
  (`createProject`, `updateProject`, `archiveProject`, `createWorkstream`,
  `updateWorkstream`, `archiveWorkstream`)
- **Authorization question (one sentence):** may this viewer write within the
  Business that governs the target Space — for `createProject` the destination
  Workspace's `businessId`, for everything else the existing Project's
  governing Business, and for a Project *move* (`updateProject` with a new
  `workspaceId`) **both** the current and the destination Space's Business?
- **Predicate:** `ownsBusiness(viewer, workspace.businessId)` via the Wave-0
  helper; the move case is the conjunction over both Workspaces.
- **FR decision:** no new id for the Business-governed case (SEC-001/SEC-008/
  FR-043 enforcement — defect fix). The `businessId === null` shared-Space
  case (create into `WS-PLATFORM`, mutate a Project living there) is refused
  under **FR-072(b)**.
- **Control test:** same `createProject` input naming the same Workspace —
  `ownsElsewhere({ sees: business.id })` is refused and `project.count()` is
  unchanged; `makeViewer({ ownedBusinessIds: [business.id] })` succeeds.
  Repeat the pair for `updateProject`/`archiveProject`/workstream mutations
  against one fixture Project.
- **Test migration (this wave's own, beyond Wave 0's pre-thread):**
  `project-business-binding.test.js` (5 sites),
  `fr059-business-strategy-mutation.test.js` (3),
  `agent-multi-principal.test.js` (4), `agent-runtime.test.js` (1),
  `backup.test.js` (2 — fixture use only; backup-service itself is untouched),
  `fr045-managed-files.test.js` (1), `work-listing-scope.test.js` (1),
  `scope-and-isolation.test.js` (1). No other wave touches any of these files.
  Prefer the file-local `asOwner` wrapper.

### Wave 2 — `work-service` (4 routes)

- **Routes:** `src/app/api/work/route.js` (POST),
  `src/app/api/work/[id]/route.js` (PATCH, DELETE),
  `src/app/api/containers/route.js` (POST),
  `src/app/api/containers/[id]/route.js` (PATCH)
- **Service file:** `src/modules/project-manager/application/work-service.js`
  (`createItem`, `updateItem`, `deleteItem`, `createContainer`,
  `updateContainer`)
- **Authorization question:** may this viewer write within the Business
  governing the Project that the target's Workstream belongs to?
- **Predicate:** target → `workstreamId` (from the body on create, from the
  loaded record on update/delete) → Workstream → Project →
  `workspace.businessId` → `ownsBusiness`, all via the Wave-0 helper. Note
  `deleteItem` currently loads nothing before writing — it must resolve the
  record first (fail closed on a missing/deleted item rather than authorize
  against nothing).
- **FR decision:** defect fix; shared-Space Projects' items refused under
  FR-072(b).
- **Control test:** same `createItem` payload into the same Workstream —
  attacker (`ownsElsewhere` seeing but not owning the governing Business)
  refused with `workItem.count()` unchanged; owner viewer succeeds. Same pair
  for `updateItem`/`deleteItem`/container ops.
- **Test migration:** only `project-core.test.js` calls this service
  (pre-threaded in Wave 0); the wave adds its own refusal/control test file.

### Wave 3 — `milestone-gate-service` (4 routes)

- **Routes:** `src/app/api/milestones/route.js` (POST),
  `src/app/api/milestones/[id]/route.js` (PATCH),
  `src/app/api/gates/route.js` (POST),
  `src/app/api/gates/[id]/route.js` (PATCH)
- **Service file:**
  `src/modules/project-manager/application/milestone-gate-service.js`
  (`createMilestone`, `updateMilestone`, `createGate`, `updateGate`)
- **Authorization question:** may this viewer write within the Business
  governing the target's Project (`projectId` from the body on create, from
  the loaded Milestone/Gate on update)?
- **Predicate:** `assertProjectWrite(viewer, projectId)` via the Wave-0
  helper. Note `updateMilestone`/`updateGate` already load the record —
  authorize after the load, before the write.
- **FR decision:** defect fix; FR-072(b) for shared-Space Projects.
- **Control test:** same `createMilestone` input against the same Project —
  attacker refused (`milestone.count()` unchanged), owner succeeds; same for
  a gate.
- **Test migration:** `project-core.test.js` and `adaptive-shell.test.js`
  (both pre-threaded in Wave 0); own new test file otherwise.

### Wave 4 — `dependency-service` (2 routes)

- **Routes:** `src/app/api/dependencies/route.js` (POST),
  `src/app/api/dependencies/[id]/route.js` (DELETE)
- **Service file:**
  `src/modules/project-manager/application/dependency-service.js`
  (`createDependency`, `deleteDependency`)
- **Authorization question:** may this viewer write within the governing
  Business of **both** endpoints of the edge (endpoints resolve per
  `ENDPOINT_MODEL`: PROJECT/MILESTONE/GATE carry a `projectId` chain directly;
  WORKSTREAM via its Project; WORK_CONTAINER/WORK_ITEM via their Workstream's
  Project)?
- **Why both, and why this is not invented authority:** an edge is a write
  that touches two governed scopes; requiring the declared per-Business
  authority for *every* scope the write touches is the fail-closed composition
  of SEC-001 — any weaker rule (either endpoint suffices) would be a new
  authority decision this plan refuses to make. `deleteDependency` currently
  deletes without loading — it must resolve the stored edge and both endpoints
  first; an endpoint that no longer resolves fails closed (refuse), never
  open.
- **FR decision:** defect fix under the both-endpoints composition; an
  endpoint governed by no Business (shared-Space Project chain) refused under
  FR-072(b).
- **Control test:** two fixtures — (i) both endpoints in Business B: owner of
  B succeeds, `ownsElsewhere({ sees: B })` refused, `dependency.count()`
  unchanged; (ii) endpoints in A and B: `makeViewer({ ownedBusinessIds: [A, B]
  })` succeeds, a viewer owning only A is refused — proving the conjunction is
  causal, not incidental.
- **Test migration:** `project-core.test.js` only (pre-threaded).

### Wave 5 — `repository-service`, link routes only (2 routes)

- **Routes:** `src/app/api/repositories/link/route.js` (POST),
  `src/app/api/repositories/link/[id]/route.js` (DELETE)
- **Service file:**
  `src/modules/project-manager/application/repository-service.js`
  (`linkRepository`, `unlinkRepository`) — the same file also holds
  `createRepository`/`updateRepository`, which are **BLOCKED** (below) and
  must not be touched; single-file ownership is why this wave and that blocked
  pair sit with the same worker.
- **Authorization question:** may this viewer write within the Business
  governing the Project being linked or unlinked (`projectId` from the body on
  link; from the loaded `projectRepository` row on unlink)?
- **Predicate:** `assertProjectWrite` via the Wave-0 helper. `unlinkRepository`
  currently deletes without loading — resolve the link row first.
- **FR decision:** defect fix; FR-072(b) for shared-Space Projects.
- **Control test:** same `linkRepository` input (same `projectId`, same
  `repoId`) — attacker refused with `projectRepository.count()` unchanged;
  owner succeeds. Same pair for unlink.
- **Test migration:** `project-core.test.js` only (pre-threaded).

### Wave 6 — `scope-service`, Workspace mutations only (1 route)

- **Route:** `src/app/api/workspaces/[id]/route.js` (PATCH, DELETE)
- **Service file:**
  `src/modules/project-manager/application/scope-service.js`
  (`updateWorkspace`, `archiveWorkspace`) — the same file's creators back the
  **BLOCKED** `scope` route (below) and must not be touched.
- **Authorization question:** may this viewer write within the Business that
  owns the target Workspace — where a Workspace scoped above Business
  (PORTFOLIO/TENANT) is governed by an authority no principal can hold, so
  the answer is no for everyone?
- **Predicate:** the `AUTHORIZERS`-lookup shape from
  `import-authorization.js`, applied to the Workspace record itself:
  `BUSINESS → ownsBusiness(viewer, workspace.businessId)`; any other
  `scopeType` → refused with the explicit missing-authority reason
  (`ungovernedScopeRefusal` wording precedent — a fact that is static and
  grants nothing). This is deliberately the *same decision* FR-065 already
  made for Workspace-targeted writes, extended by FR-072(b) to mutations of
  the Workspace record.
- **FR decision:** Business-scoped case is a defect fix; the above-Business
  refusal is a behaviour change (anyone could previously rename/archive
  `WS-PLATFORM`) declared under **FR-072(b)**. Verified: no e2e spec and no
  unit/integration test mutates a Workspace through this route or service, so
  the removal breaks no existing suite.
- **Control test:** PATCH rename of a BUSINESS-scoped Workspace — owner of its
  Business succeeds; `ownsElsewhere` refused, record unchanged (name and
  `version` both). Plus the FR-072(b) probe: a viewer owning *every* Business
  is still refused on a PORTFOLIO-scoped Workspace, with the reason naming the
  missing authority — proving the refusal is about the system, not the caller.
- **Test migration:** none (no existing test calls these two functions).

---

## BLOCKED — 4 routes that stay in the baseline, with the missing decision named

Per the Planner contract these are not guesses deferred to workers; each needs
an owner decision that does not exist in any declared rule. Written in the
FR-065 clause-(b) style: state what authority is missing; refuse to invent it.

### B1 — `src/app/api/scope/route.js` (POST)

One route, seven creators: `createPortfolio`, `createTenant`,
`createBusiness`, `createBusinessInGroup` (FR-020), `createLegalEntity`,
`createBranch`, `createWorkspace`.

- `createBranch` and `createWorkspace(scopeType: BUSINESS)` *are* governable
  (`ownsBusiness` on the named `businessId`) — but the route can leave the
  baseline only when **every** write behind it fails closed.
- The other five create scope **at or above the Business boundary**:
  a Portfolio, a Tenant, a Business inside a Tenant, a LegalEntity inside a
  Portfolio, or (FR-020) a new Tenant + Business + Workspace in one
  transaction. **No declared rule answers "who may create these."** The viewer
  contract carries only Business-keyed grants (`ownedBusinessIds`,
  `visibleBusinessIds`, `domainsByBusinessId`); there is no holdable
  portfolio- or tenant-level authority (the exact fact SDD-037 records), and
  there is no Business to own before the Business exists.
- The FR-065(b) move — refuse for every principal — is **not available
  here**, because it would remove FR-020's shipped "เพิ่มธุรกิจ" onboarding
  flow, live today in `src/app/(pm)/settings/page.jsx` and
  `src/app/(pm)/workspaces/page.jsx`. Two declared requirements (SEC-008
  fail-closed vs FR-020's capability) collide, and resolving that collision is
  an owner decision, not a planner inference.
- **Missing decision:** who may create top-level scope (Portfolio / Tenant /
  Business / LegalEntity / business-in-group) before FR-066/FR-067 make an
  above-Business authority holdable? Candidate shapes for the owner to choose
  from — any authenticated principal may self-provision a new Tenant+Business
  (self-service onboarding reading of FR-020); or creation requires the
  FR-066 owner role once it exists and the flow is gated until then; or an
  interim explicit grant. Until one is chosen: **the route stays in the
  baseline with this paragraph as the recorded reason.**

### B2 — `src/app/api/backup/import/route.js` (POST)

`previewImport` reads counts of **every table across every tenant**;
`importSnapshot` deletes and replaces **the entire database** — all
portfolios, tenants, businesses, identities, audit events.

- No per-Business predicate can govern a whole-database replace: owning every
  Business still leaves Portfolio/Tenant/LegalEntity/Person/identity rows —
  and BR-001's isolation boundary itself — ungoverned. The platform DEV grant
  is explicitly visibility-without-authority (`ownedBusinessIds: []`,
  `resolve-viewer.js`), so `isPlatform` is not an answer either; using it
  would repeat the exact global-label-as-authority defect of the 2026-08-16
  RCA at platform scale.
- Refusing for every principal (FR-065(b)) would remove FR-013's shipped
  restore capability — a declared ✅ requirement with BR-008 semantics
  (preview-then-confirm) and a real UI. Same collision shape as B1.
- **Missing decision:** what authority governs a full-database restore — a
  platform *operator* authority that is holdable (an FR-061-style
  viewer-contract change, which FR-065 already names as the only exit for
  above-Business authority), a device/local-session gate (ADR-016 is a
  local-backup design), or something else. Until declared: **stays in the
  baseline with this reason.**

### B3 + B4 — `src/app/api/repositories/route.js` (POST),
### `src/app/api/repositories/[id]/route.js` (PATCH)

`createRepository` / `updateRepository` write the `Repository` model — which
**carries no scope field at all** (verified in `prisma/schema.prisma`: no
`tenantId`, no `businessId`, no `projectId`; links are a separate
`ProjectRepository` row). There is no Business to derive, so `ownsBusiness`
has no argument.

- Deriving authority from the repo's *links* fails closed the wrong way:
  a freshly created Repository has no links, so a links-conjunction is
  vacuously true — "any authenticated caller", which is a new authority rule,
  not an enforcement of a declared one. Refusing everyone removes FR-008's
  shipped record CRUD. Same collision shape again.
- **Missing decision:** what scope owns a `Repository` record. The likely
  answer is a modelling decision (give `Repository` an owning
  Tenant/Business, which also closes the cross-tenant *read* of
  `listRepositories` — the FR-062 leak shape) and that is a schema + owner
  call, far outside a guard wave. Until declared: **both routes stay in the
  baseline with this reason.** The two link routes (Wave 5) are *not*
  blocked — they are Project-governed.

---

## Ordering, dependencies, concurrency (3 workers)

```
Wave 0  (serial — helper + signatures + FR-072 row + pre-threaded shared tests)
   │        merges to the integration branch FIRST
   ├── Worker 1:  Wave 1 (project-service)                     [4 routes]
   ├── Worker 2:  Wave 2 (work-service) → Wave 4 (dependency)  [4 + 2 routes]
   └── Worker 3:  Wave 3 (milestone-gate) → Wave 5 (repo links)
                  → Wave 6 (workspace mutations)               [4 + 2 + 1]
```

- **Stated dependency:** every wave imports the Wave-0 helper and follows the
  Wave-0 signature convention; nothing else crosses waves. No wave changes a
  signature another wave calls (each service file belongs to exactly one
  wave; the blocked functions in `repository-service.js` and
  `scope-service.js` are untouched and belong to the worker who owns that
  file's wave, so no file has two writers).
- **No two in-flight waves share a source file.** Checked, not assumed:
  service files are 1:1 with waves; route files are 1:1 with waves; the only
  cross-wave files were the two shared test files, which Wave 0 pre-threads so
  workers do not edit them (fallback if a pre-threaded viewer proves wrong:
  the worker fixes only its own call sites and reports it; integrator merges
  serially). Wave 1's eight remaining migration test files are touched by no
  other wave (verified by per-file function grep).
- **Workers run `npm test` + `npm run build` only**, in their own worktrees.
  `govern` / `verify` / `test:e2e` are the integrator's singletons.
  ⚠ Operational note from the Wave-0/1 ledger: a fresh worktree has no
  `node_modules` — each worker must install dependencies in its worktree
  before its first test run, or the orchestrator provisions it.
- **Baseline edit is the integrator's, once**: remove exactly the 19 repaid
  routes; the 4 blocked routes remain, and the integrator should append the
  blocked reasons (pointer to this file's §BLOCKED) to the baseline's
  `purpose` note or a sibling record — the baseline itself only ever shrinks.
- **Integrator e2e risk note:** e2e runs under the demo session → dev-fallback
  viewer that owns every Business, so Business-governed flows keep passing;
  no e2e spec mutates scope/workspaces/backup/repositories (verified — only
  GETs of `/api/scope`). The residual risk is any e2e flow writing to a
  Project in a shared Space; none was found, but the first full `verify` after
  merge is the proof.

## Acceptance self-check

- 23 routes, each in exactly one place: Waves 1–6 cover 4+4+4+2+2+1 = 17…
  plus `projects/[id]/files` ×2 — see Wave 7 below — = 19; BLOCKED covers 4.
- No wave mixes two authorization questions (Wave 4's both-endpoints rule and
  Wave 6's scope-type lookup are each ONE question with a composed answer).
- No worker makes an authorization decision: every predicate, derivation,
  null-business outcome, and disclosure precedent is fixed above or by the
  architect from the precedents named above.

### Wave 7 — `project-file-service` (2 routes) — assigned to Worker 1 after Wave 1

Listed last only because it was nearly lost in the count above — it is a
normal, unblocked wave:

- **Routes:** `src/app/api/projects/[id]/files/route.js` (POST),
  `src/app/api/projects/[id]/files/[fileId]/route.js` (DELETE)
- **Service file:**
  `src/modules/project-manager/application/project-file-service.js`
  (`createProjectFile`, `deleteProjectFile` — both already take a `{ db }`
  bag; add `viewer` to it)
- **Authorization question:** may this viewer write within the Business
  governing the Project named in the route path (`params.id` →
  `assertProject` → Space → `workspace.businessId`)?
- **Predicate:** `assertProjectWrite` via the Wave-0 helper, immediately after
  the existing `assertProject` resolution.
- **FR decision:** defect fix (SEC-003 already binds these mutations to the
  owning Project; SEC-001/SEC-008 supply the owner bar); FR-072(b) for
  shared-Space Projects.
- **Control test:** same `createProjectFile(projectId, input)` — attacker
  refused with `projectFile.count()` unchanged; owner succeeds; same pair for
  delete (assert both `projectFile` and `fileAsset` populations unchanged on
  refusal, since delete touches both).
- **Test migration:** `tests/unit/project-file-service.test.js` (3 sites —
  exclusively this wave's file).

Final worker assignment therefore:

| Worker | Waves | Routes repaid |
|---|---|---|
| 1 | Wave 1 → Wave 7 | 6 |
| 2 | Wave 2 → Wave 4 | 6 |
| 3 | Wave 3 → Wave 5 → Wave 6 | 7 |
| — | BLOCKED (B1–B4) | 0 (stay in baseline, reasons recorded) |

19 repaid + 4 blocked = 23. `route-viewer` will report **4 remaining**, each
with a named missing decision an owner can act on.

**PLANNER STATUS: BLOCKED (partial) — Waves 0–7 are dispatchable as planned;
routes `scope`, `backup/import`, `repositories`, `repositories/[id]` await the
owner decisions named in §BLOCKED B1–B4.**
