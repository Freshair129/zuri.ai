# Route-viewer baseline repayment — Architect design

Architect: fable5, 2026-08-17. Input: `.brain/waves/route-viewer-plan.md` (Waves
0–7; B1–B4 are out of scope and nothing here designs a guard for them).
Read in full before writing this: the mission spec, the integration ledger
(C1–C4), `viewer-authority.js`, `import-authorization.js`,
`plan-import-service.js` (the FR-065 wiring), `project-team-service.js`,
`request-viewer.js`, `src/app/api/_helpers.js`, `tests/factories/viewer.js`,
all 7 service files, all 19 route handlers, the two shared test files, and two
repaid routes (`projects/[id]/team`, `import/commit`).

**Verdict: APPROVED with adjustments** (listed in §9). The plan puts every
predicate in one place and every guard in a service; no reject condition fires.

Everything a worker needs to implement a wave is in §§1–3 (shared) plus its own
wave section in §4. A worker that finds itself deciding *who may do this* must
stop and return here — that would mean this document failed its acceptance test.

---

## 1. The one helper module (written in Wave 0, used by every wave)

**Path:** `src/modules/project-manager/application/project-authorization.js`

File header annotations:

```js
// @req FR-072 — mutations behind the route-viewer baseline refuse the write
// unless the viewer owns the governing Business, derived from the target's Space.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/project-authorization.test.js
```

Imports: `prisma` from `@/lib/db`, `WORKSPACE_SCOPE_TYPES` from
`@/lib/validation/enums`, `ownsBusiness` from
`@/modules/identity/viewer-authority`.

**The predicate exists once.** `ownsBusiness(viewer, businessId)` in
`viewer-authority.js` is the only authorization decision in this entire effort;
this module imports it and never re-implements, inlines, or approximates it.
Everything else below is *derivation* (walking the target chain to a
`businessId`) and *disclosure* (what a refusal says), both fixed here so no
worker chooses either.

This module keeps its own deny-by-default scope-type lookup (the `AUTHORIZERS`
shape) rather than reusing `import-authorization.js`'s: the two share the one
predicate by import, but their refusal wordings are different disclosure
families (import-specific FR-065 messages vs the generic FR-072 messages
below), and refactoring shipped, tested FR-065 code is deliberately outside
this mission. Consolidating the two 5-line tables is recorded as possible
future cleanup, not done here.

### 1.1 Exported API — exact signatures

```js
export function requireViewer(viewer, context)

export function assertWorkspaceWritable(viewer, workspace,
  { notFoundMessage = 'Workspace not found' } = {})            // sync, no I/O

export async function assertProjectWritable(viewer, projectId,
  { db = prisma, notFoundMessage = 'Project not found' } = {}) // returns loaded project (incl. workspace)

export async function assertWorkstreamWritable(viewer, workstreamId,
  { db = prisma, notFoundMessage = 'Workstream not found' } = {}) // returns loaded workstream

export async function assertEndpointWritable(viewer, { type, id },
  { db = prisma, notFoundMessage } = {})
  // notFoundMessage defaults to `Dependency endpoint not found: ${type} ${id}`
```

Workers `await` every call, including `assertWorkspaceWritable` (awaiting a
sync function is a no-op and keeps the five call shapes identical).

### 1.2 Behaviour, function by function

**`requireViewer(viewer, context)`** — throws when `viewer` is `null` or
`undefined`, with a **plain `Error` and no `.status`**, message:

```
`${context}: viewer is required — a write is authorized against a resolved viewer, never against the request that named it`
```

No status means `handle()` returns **500** — correct, because a missing viewer
is a wiring bug in a caller, not a client condition. This is the
`authorizeImportTarget()` required-viewer-that-throws contract: the next caller
wired without authorization crashes loudly instead of writing quietly. Every
`assert*` function below calls `requireViewer` first, so services never call it
directly.

**`assertWorkspaceWritable(viewer, workspace, { notFoundMessage })`** — the
record-based decision, mirroring `authorizeImportTarget` but throwing:

1. `requireViewer(viewer, 'assertWorkspaceWritable')`.
2. `workspace` must be a loaded record; if absent/non-object, throw a plain
   `Error('assertWorkspaceWritable(): workspace is required — resolve the target before authorizing it')`
   (no status → 500, programmer error).
3. Deny-by-default lookup keyed by `workspace.scopeType`:

```js
const AUTHORIZERS = {
  BUSINESS: (viewer, workspace) => ownsBusiness(viewer, workspace.businessId),
}
```

   - `BUSINESS` and `ownsBusiness` true → return (authorized).
   - `BUSINESS` and false → throw `status = 404`, message `notFoundMessage`
     (unowned target answers exactly as an absent one; a BUSINESS workspace
     with a null `businessId` cannot exist per `createWorkspace`, and if one
     ever does, `ownsBusiness(viewer, null)` is false for everyone — fail
     closed with the same 404).
   - scope type has no `AUTHORIZERS` entry but is in `WORKSPACE_SCOPE_TYPES`
     (today: `PORTFOLIO`, `TENANT`) → throw `status = 403`, message
     `ungovernedWorkspaceRefusal(workspace)` (§1.3).
   - scope type not in the enum at all → throw `status = 403`, message
     `unknownScopeRefusal(workspace)` (§1.3). A value someone adds to
     `WORKSPACE_SCOPE_TYPES` is therefore refused until someone declares how it
     is authorized — the `import-authorization.js` deny-by-default reasoning.

**`assertProjectWritable(viewer, projectId, { db, notFoundMessage })`**:

1. `requireViewer(viewer, 'assertProjectWritable')`.
2. `const project = await db.project.findUnique({ where: { id: projectId }, include: { workspace: true } })`.
3. `!project || project.deletedAt` → throw `status = 404`, `notFoundMessage`.
4. `const businessId = project.businessId ?? project.workspace?.businessId ?? null`
   — the `project-team-service.js` derivation: the direct Project owner is
   authoritative (FR-043), the Space is the additive-backfill fallback.
5. `businessId` non-null: `ownsBusiness(viewer, businessId)` → return
   `project`; else throw `status = 404`, `notFoundMessage`. **Never** consult
   `viewer.role` or `visibleBusinessIds`.
6. `businessId === null` (a Project in a PORTFOLIO/TENANT-scoped shared Space)
   → throw `status = 403`, message `ungovernedProjectRefusal(project, project.workspace)`
   (§1.3). This is FR-072(b): refused for every principal, the reason names the
   missing authority, and no rule is invented.

**`assertWorkstreamWritable(viewer, workstreamId, { db, notFoundMessage })`**:

1. `requireViewer(viewer, 'assertWorkstreamWritable')`.
2. Load the workstream; `!ws || ws.deletedAt` → throw 404 `notFoundMessage`.
3. `await assertProjectWritable(viewer, ws.projectId, { db, notFoundMessage })`
   — **the same `notFoundMessage` propagates down the chain**, so a refusal at
   any depth is indistinguishable from the target itself being absent, and a
   dangling `projectId` fails closed with the same 404 rather than authorizing
   against nothing.
4. Return `ws`.

**`assertEndpointWritable(viewer, { type, id }, { db, notFoundMessage })`** —
the complete Wave-4 derivation lives here, not in `dependency-service.js`, so
the Wave-4 worker wires two calls and derives nothing. Default
`notFoundMessage` = `` `Dependency endpoint not found: ${type} ${id}` `` (the
exact string `assertEndpointExists` already uses). Deny-by-default table:

| `type` | Resolution (all with the propagated `notFoundMessage`) |
|---|---|
| `PROJECT` | `assertProjectWritable(viewer, id, { db, notFoundMessage })` |
| `WORKSTREAM` | `assertWorkstreamWritable(viewer, id, { db, notFoundMessage })` |
| `MILESTONE` | `db.milestone.findUnique({ where: { id } })`; missing → 404 `notFoundMessage`; then `assertProjectWritable(viewer, milestone.projectId, { db, notFoundMessage })` |
| `GATE` | same as MILESTONE via `db.gate` |
| `WORK_CONTAINER` | `db.workContainer.findUnique(...)`; missing → 404; then `assertWorkstreamWritable(viewer, container.workstreamId, { db, notFoundMessage })` |
| `WORK_ITEM` | same via `db.workItem` (no `deletedAt` filter — parity with today's `assertEndpointExists`, which does not filter either) |
| anything else | throw plain `Error(`Unsupported dependency endpoint type: ${type}`)` — same message the service uses today; no status on purpose (parity) |

### 1.3 Refusal message texts (exact; workers never write message text)

```js
// status 403 — FR-072(b): static fact about the system, identical for every
// caller, grants nothing. Named-missing-authority per the FR-065 precedent.
function ungovernedWorkspaceRefusal(workspace) {
  return (
    `Workspace "${workspace.code}" is a ${workspace.scopeType}-scoped workspace. ` +
    'Write authority is declared at Business scope only — no authority above Business ' +
    'grants it, so this write cannot be authorized for any principal.'
  )
}

function ungovernedProjectRefusal(project, workspace) {
  return (
    `Project "${project.code}" lives in ${workspace.scopeType}-scoped workspace ` +
    `"${workspace.code}", which no Business governs. Write authority is declared at ` +
    'Business scope only, so this write cannot be authorized for any principal.'
  )
}

// status 403 — deny-by-default arm for enum values with no AUTHORIZERS entry.
function unknownScopeRefusal(workspace) {
  return (
    `Workspace "${workspace.code}" has an unrecognised scope type ` +
    `"${workspace.scopeType}", so no authority can be established for it.`
  )
}
```

The 403 messages knowingly confirm that the named target exists and is not
Business-governed. Accepted for the same reason `import-authorization.js`
accepted it: the fact is static, identical for every authenticated caller, and
grants nobody anything — and shared Spaces are visible to every viewer anyway.

### 1.4 The disclosure model (referenced by every wave)

Two tiers, decided here once:

- **Tier A — Business-governed target, viewer does not own the Business:**
  `status = 404` with **exactly the message the service's own missing-record
  path produces for that target kind** (pinned per call site in §4). An unowned
  real target is indistinguishable from a nonexistent one — no enumeration
  oracle (`import-authorization.js` `reason: null` precedent; mission rule 7).
- **Tier B — target governed by no Business** (`businessId === null` project
  chain, PORTFOLIO/TENANT workspace, unrecognised scope type):
  `status = 403` with the explicit §1.3 reason. This is the FR-065 clause-(b)
  move: the refusal names the missing authority instead of inventing one, and
  is identical for every principal (a control test proves a viewer owning
  *every* Business is still refused).

### 1.5 Error mechanics

All statused throws are built the same way (module-local helper):

```js
function refusal(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
```

`handle()` in `src/app/api/_helpers.js` honours `err.status` explicitly, so 404
and 403 pass through untouched. Zod parse errors keep returning 400 before any
guard runs — a malformed body reveals nothing about resources, matching the
`project-team-service.js` parse-first order.

---

## 2. The frozen conventions (identical across all waves)

### 2.1 Service signature convention

Every guarded service function takes the viewer in a **trailing options bag**,
extending the existing bag where one exists:

```js
createProject(input, { viewer } = {})
updateItem(id, patch, { viewer } = {})
deleteProjectFile(projectId, fileId, { db = prisma, viewer } = {})
```

The bag defaults to `{}` — the *enforcement* that the viewer is required lives
in the guard (`requireViewer` throws), not in the signature. A caller that
omits the bag gets the loud 500, which is the contract.

### 2.2 Guard placement rule (one rule, every function)

```
Zod parse  →  resolve/load the primary target  →  AUTHORIZE  →  any secondary
validation reads  →  write  →  audit
```

Concretely: the guard call goes **immediately after the primary target's
not-found check and before any other read that could confirm or deny the
existence of related records** (parent containers, sibling workstreams, cycle
scans). Functions that today write without loading (`archiveProject`,
`archiveWorkspace`, `deleteItem`, `deleteDependency`, `unlinkRepository`)
**must load the record first and fail closed (404, Tier A message) when it does
not resolve** — never authorize against nothing, never let Prisma's P2025
stand in for a decision. §4 names the exact placement per function.

### 2.3 Route handler convention (the "two lines" per handler)

The service holds the guard; the handler's only job is resolving one trusted
viewer and passing it. Pattern (from the repaid `projects/[id]/team/route.js`):

```js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createProject(await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => archiveProject(params.id, { viewer: await resolveRequestViewer(request) }))
}
```

`resolveRequestViewer` throws 401/503 itself; resolve it **before**
`request.json()` so an unauthenticated caller learns nothing, not even whether
its body parses. **GET handlers in the same files are not touched** — read
scoping is separate work (the FR-062 family), and the baseline is about
mutating verbs.

Every repaid route file adds this annotation block (uniform, so preflight's
graph stays coherent — existing `@req` lines stay):

```js
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested <the wave's test file, from §4>
```

Every guarded service file adds `@req FR-072`, `@spec SEC-001, SEC-008, BR-001`
and `@tested <the wave's test file>` to its header block.

### 2.4 Why the service and not the handler — stated once, true for every wave

The planner verified each write function currently has exactly one production
caller (its route handler); I re-verified by grep. That does not move the guard
to the handler: the required-viewer-that-throws exists precisely so the *next*
caller — an agent tool, an intake converter, a script — crashes loudly at
wiring time instead of writing quietly. `plan-import-service.js` documents the
same reasoning ("the authorized thing is the resolved thing"): the guard lives
where the target is resolved, and there is exactly one such place per target —
the service. **Per wave, the answer to "where is the guard?" is: the service
functions named in §4. The handlers only resolve and pass.**

### 2.5 Test conventions

- Viewers come from `tests/factories/viewer.js` **only**: `makeViewer()`,
  `ownsElsewhere()`, `makeDevViewer()`. A hand-built literal is a preflight
  CRITICAL against the shrink-only fixture baseline.
- The attacker shape is `ownsElsewhere({ sees: <governing business id> })` —
  global role OWNER, target Business visible, not owned.
- **Every refusal test has its control**: the same call, same target, a
  `makeViewer({ visibleBusinessIds: [b.id], ownedBusinessIds: [b.id] })`
  owner — and it succeeds.
- **Every refusal asserts nothing was written**: the relevant `count()` (or the
  record's `name`/`version` for updates) unchanged.
- **Tier A oracle check**: at least one test per wave asserts the refusal for
  an unowned *real* target carries the same status and message as the same
  call against a fabricated id (e.g. `'no-such-id'`), so check #7 is proven,
  not assumed.
- **Tier B check** (waves that touch it): a viewer owning *every* Business in
  the fixture is still refused with 403 and a message naming the missing
  authority — proving the refusal is about the system, not the caller.
- `makeDevViewer()` refused on Tier A targets (a platform DEV sees everything,
  owns nothing — visibility is not authority).

---

## 3. Wave 0 — exact work list (integrator/controller, serial, lands first)

1. **Declare FR-072 at 🔜 in `docs/PRD-SDD-v1.0.md`** — one commit, before any
   worker dispatch. Use the planner's statement with one revision (§8).
2. **Write `src/modules/project-manager/application/project-authorization.js`**
   exactly per §1.
3. **Write `tests/integration/project-authorization.test.js`** covering, at
   minimum:
   - each exported assert throws (plain Error, no status) when `viewer` is
     omitted / null;
   - Tier A: `ownsElsewhere({ sees: b.id })` refused 404 with the pinned
     message; owner control succeeds; `makeDevViewer()` refused;
   - Tier A oracle: unowned-real-target error `status` + `message` strictly
     equal to fabricated-id error;
   - Tier B: project in a PORTFOLIO-scoped Space refused 403 for a viewer
     owning every fixture Business, message contains
     `cannot be authorized for any principal`;
   - deny-by-default: a workspace record with a scope type outside the enum is
     refused 403 (planted control for the lookup, per mission rule 8's spirit);
   - `assertEndpointWritable`: one governed type of each chain shape
     (PROJECT, MILESTONE, WORK_ITEM at minimum), unknown type throws the
     `Unsupported dependency endpoint type` message, and a dangling chain
     (endpoint whose workstream/project row is deleted) fails closed 404.
4. **Pre-thread the two shared test files** (verified workable — §5):
   - `tests/integration/project-core.test.js`: import `makeViewer`; after the
     fixture `business` is created in `beforeAll`, build one module-level
     `viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })`;
     append the bag (`, { viewer }`) to every call of: `createProject`,
     `updateProject`, `archiveProject`, `createWorkstream`, `updateWorkstream`,
     `createContainer`, `createItem`, `updateItem`, `createMilestone`,
     `createGate`, `updateGate`, `createDependency`, `linkRepository`.
     **Do NOT thread** `createRepository`, `createPortfolio`, `createTenant`,
     `createBusiness`, `createWorkspace` — those functions stay unguarded
     (BLOCKED B1/B3), and threading them would imply a contract nobody
     declared.
   - `tests/integration/adaptive-shell.test.js`: one viewer owning **both**
     fixture businesses
     (`makeViewer({ visibleBusinessIds: [first.business.id, second.business.id], ownedBusinessIds: [same] })`,
     built after the fixtures exist); thread `createProject`,
     `createWorkstream`, `createMilestone`, `createGate` calls. Do not thread
     `createBusinessInGroup` (BLOCKED B1).
5. Run `npm test` — must stay green at the C4 floor (992 passing) **before any
   guard exists**, proving the pre-thread is a no-op today.
6. Merge to the integration branch. Wave 0 is done when helper + tests + both
   pre-threaded files + the FR-072 row are on that branch with counts pasted.

---

## 4. The waves

Each wave section: service changes (function by function, with placement and
the pinned Tier A message), route changes, disclosure, tests. The authorization
question and FR decision per wave are the planner's and are unchanged.

### Wave 1 — `project-service` (Worker 1)

Service: `src/modules/project-manager/application/project-service.js`.
Import `assertProjectWritable`, `assertWorkstreamWritable`,
`assertWorkspaceWritable` from `./project-authorization`.

| Function | New signature | Guard and placement |
|---|---|---|
| `createProject` | `(input, { viewer } = {})` | after the existing `if (!workspace) throw new Error('Workspace not found')`: `await assertWorkspaceWritable(viewer, workspace)` (default message `'Workspace not found'` — unowned destination ≡ absent destination). Before `resolveProjectBusinessId`. |
| `updateProject` | `(id, patch, { viewer } = {})` | immediately after `const data = zProjectUpdate.parse(patch)`: `await assertProjectWritable(viewer, id)` (Tier A message `'Project not found'`). Then, after `targetWorkspace` is resolved and `workspaceChanged` computed: `if (workspaceChanged) await assertWorkspaceWritable(viewer, targetWorkspace)` — the move conjunction: current Project's Business **and** destination Space's authority both required. |
| `archiveProject` | `(id, { viewer } = {})` | **first line**: `await assertProjectWritable(viewer, id)`. This also fixes the write-without-load: a missing/deleted id now gets 404 `'Project not found'` instead of a P2025 crash. |
| `createWorkstream` | `(input, { viewer } = {})` | after the existing `'Project not found'` throw: `await assertProjectWritable(viewer, data.projectId)`. |
| `updateWorkstream` | `(id, patch, { viewer } = {})` | after the existing `'Workstream not found'` throw: `await assertWorkstreamWritable(viewer, id)` (default message matches). |
| `archiveWorkstream` | `(id, { viewer } = {})` | **first line**: `await assertWorkstreamWritable(viewer, id)` (fixes write-without-load; missing id → 404 `'Workstream not found'`). |

Note on `updateProject`: today a Business Project **can** legally move into a
shared (PORTFOLIO/TENANT) Space — the cross-business guard passes because the
destination businessId is null. After this wave that move is refused 403 by
`assertWorkspaceWritable` (Tier B). That capability removal is exactly
FR-072(b); the commit message states it.

Routes (mutating verbs only; §2.3 pattern + annotation block):
- `src/app/api/projects/route.js` — POST resolves viewer, passes `{ viewer }`.
- `src/app/api/projects/[id]/route.js` — PATCH and DELETE.
- `src/app/api/workstreams/route.js` — POST.
- `src/app/api/workstreams/[id]/route.js` — PATCH and DELETE.

Disclosure: Tier A (`'Project not found'` / `'Workstream not found'` /
`'Workspace not found'`); Tier B 403 for shared-Space targets.

Tests: new `tests/integration/fr072-project-service-authorization.test.js` —
the planner's control pairs, plus: (a) the §2.5 oracle-equality assertion,
(b) the move pair: owner of the Project's Business moving it to a workspace of
an unowned Business → 404 `'Workspace not found'`; same owner moving between
two workspaces of the *same* owned Business → succeeds; any viewer (even
owning every Business) moving it to a PORTFOLIO Space → 403.
Migration (this wave's own, beyond the Wave-0 pre-thread; prefer the §6
wrapper): `project-business-binding.test.js`,
`fr059-business-strategy-mutation.test.js`, `agent-multi-principal.test.js`,
`agent-runtime.test.js`, `backup.test.js` (fixture use only),
`fr045-managed-files.test.js`, `work-listing-scope.test.js`,
`scope-and-isolation.test.js`.

### Wave 2 — `work-service` (Worker 2)

Service: `src/modules/project-manager/application/work-service.js`.
Import `assertWorkstreamWritable`.

| Function | New signature | Guard and placement |
|---|---|---|
| `createContainer` | `(input, { viewer } = {})` | after the existing `'Workstream not found'` throw, **before** the `parentId` lookup (so an attacker cannot probe parent containers in unowned workstreams): `await assertWorkstreamWritable(viewer, data.workstreamId)`. |
| `updateContainer` | `(id, patch, { viewer } = {})` | after the existing `'Container not found'` throw: `await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Container not found' })` — unowned container ≡ missing container. |
| `createItem` | `(input, { viewer } = {})` | after the `'Workstream not found'` throw, before the `containerId` lookup: `await assertWorkstreamWritable(viewer, data.workstreamId)`. |
| `updateItem` | `(id, patch, { viewer } = {})` | after the existing `'Work item not found'` throw: `await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Work item not found' })`. |
| `deleteItem` | `(id, { viewer } = {})` | currently writes without loading. New body order: `const existing = await prisma.workItem.findUnique({ where: { id } })`; `if (!existing || existing.deletedAt) throw refusal-style 404 'Work item not found'`; `await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Work item not found' })`; then the existing soft-delete update. |

Routes: `work/route.js` POST · `work/[id]/route.js` PATCH, DELETE ·
`containers/route.js` POST · `containers/[id]/route.js` PATCH.

Disclosure: Tier A messages as pinned above; Tier B 403 through the chain for
items/containers under a shared-Space Project.

Tests: new `tests/integration/fr072-work-service-authorization.test.js` —
planner's pairs + oracle equality + `workItem.count()` / `workContainer.count()`
unchanged on refusal. Migration: none beyond the Wave-0 pre-thread
(`project-core.test.js` is already threaded).

### Wave 3 — `milestone-gate-service` (Worker 3)

Service: `src/modules/project-manager/application/milestone-gate-service.js`.
Import `assertProjectWritable`.

| Function | New signature | Guard and placement |
|---|---|---|
| `createMilestone` | `(input, { viewer } = {})` | after the existing `'Project not found'` throw, **before** the `workstreamId` lookup: `await assertProjectWritable(viewer, data.projectId)`. |
| `updateMilestone` | `(id, patch, { viewer } = {})` | after the existing `'Milestone not found'` throw: `await assertProjectWritable(viewer, existing.projectId, { notFoundMessage: 'Milestone not found' })`. |
| `createGate` | `(input, { viewer } = {})` | after the `'Project not found'` throw, before the workstream lookup: `await assertProjectWritable(viewer, data.projectId)`. |
| `updateGate` | `(id, patch, { viewer } = {})` | after the `'Gate not found'` throw: `await assertProjectWritable(viewer, existing.projectId, { notFoundMessage: 'Gate not found' })`. |

Routes: `milestones/route.js` POST · `milestones/[id]/route.js` PATCH ·
`gates/route.js` POST · `gates/[id]/route.js` PATCH.

Disclosure: Tier A as pinned; Tier B 403 for shared-Space Projects.

Tests: new `tests/integration/fr072-milestone-gate-authorization.test.js`.
Migration: none beyond the Wave-0 pre-thread (`project-core.test.js`,
`adaptive-shell.test.js`).

### Wave 4 — `dependency-service` (Worker 2, after Wave 2)

Service: `src/modules/project-manager/application/dependency-service.js`.
Import `assertEndpointWritable`.

| Function | New signature | Guard and placement |
|---|---|---|
| `createDependency` | `(input, { viewer } = {})` | after both `assertEndpointExists` calls and **before** `wouldCreateCycle` (the cycle scan reads every edge; an unauthorized caller must not reach it): `await assertEndpointWritable(viewer, { type: data.sourceType, id: data.sourceId })` then `await assertEndpointWritable(viewer, { type: data.targetType, id: data.targetId })`. Both must pass — the conjunction is the fail-closed composition of SEC-001, and the helper owns all derivation (§1.2). An unowned endpoint throws the default message ``Dependency endpoint not found: TYPE id`` — byte-identical to what `assertEndpointExists` says for a missing one. |
| `deleteDependency` | `(id, { viewer } = {})` | currently deletes without loading. New body order: `const dependency = await prisma.dependency.findUnique({ where: { id } })`; `if (!dependency) throw` 404 `'Dependency not found'`; `await assertEndpointWritable(viewer, { type: dependency.sourceType, id: dependency.sourceId }, { notFoundMessage: 'Dependency not found' })`; same for the target endpoint; then the delete. The propagated message makes an unowned edge ≡ a missing edge. **An endpoint that no longer resolves fails closed** (the helper throws 404 `'Dependency not found'`) — the edge becomes deletable by nobody until the data is repaired; refuse, never open. |

Routes: `dependencies/route.js` POST · `dependencies/[id]/route.js` DELETE.

Disclosure: Tier A both functions; Tier B 403 when an endpoint's chain reaches
a shared-Space Project.

Tests: new `tests/integration/fr072-dependency-authorization.test.js` — the
planner's two-fixture design is required verbatim: (i) both endpoints in
Business B — owner succeeds, `ownsElsewhere({ sees: B })` refused,
`dependency.count()` unchanged; (ii) endpoints in A and B —
`makeViewer({ visibleBusinessIds: [A, B], ownedBusinessIds: [A, B] })`
succeeds, a viewer owning only A
(`makeViewer({ visibleBusinessIds: [A, B], ownedBusinessIds: [A] })`) refused —
the conjunction proven causal. Plus oracle equality and a delete pair.
Migration: none beyond the pre-thread.

### Wave 5 — `repository-service`, link functions ONLY (Worker 3, after Wave 3)

Service: `src/modules/project-manager/application/repository-service.js`.
Import `assertProjectWritable`. **`createRepository` and `updateRepository` are
BLOCKED (B3/B4) and must not be touched, threaded, or annotated.**

| Function | New signature | Guard and placement |
|---|---|---|
| `linkRepository` | `(input, { viewer } = {})` | after the existing `'Project not found'` / `'Repository not found'` throws: `await assertProjectWritable(viewer, data.projectId)`. |
| `unlinkRepository` | `(linkId, { viewer } = {})` | currently deletes without loading. New body order: `const link = await prisma.projectRepository.findUnique({ where: { id: linkId } })`; `if (!link) throw` 404 `'Repository link not found'` (today a missing id is a raw P2025 → effectively 500; the explicit 404 is the fail-closed fix); `await assertProjectWritable(viewer, link.projectId, { notFoundMessage: 'Repository link not found' })`; then the delete. |

Routes: `repositories/link/route.js` POST ·
`repositories/link/[id]/route.js` DELETE.

Disclosure: Tier A (`'Project not found'` / `'Repository link not found'`);
Tier B 403 for a link on a shared-Space Project.

Tests: new `tests/integration/fr072-repository-link-authorization.test.js` —
same `projectId` + `repoId` pair for attacker and owner;
`projectRepository.count()` unchanged on refusal; unlink pair; oracle equality.
Migration: none beyond the pre-thread.

### Wave 6 — `scope-service`, Workspace mutations ONLY (Worker 3, after Wave 5)

Service: `src/modules/project-manager/application/scope-service.js`.
Import `assertWorkspaceWritable`. **The seven creators are BLOCKED (B1) and
must not be touched.**

| Function | New signature | Guard and placement |
|---|---|---|
| `updateWorkspace` | `(id, patch, { viewer } = {})` | after the existing `'Workspace not found'` throw: `await assertWorkspaceWritable(viewer, existing)`. |
| `archiveWorkspace` | `(id, { viewer } = {})` | currently writes without loading. New body order: `const existing = await prisma.workspace.findUnique({ where: { id } })`; `if (!existing) throw` 404 `'Workspace not found'`; `await assertWorkspaceWritable(viewer, existing)`; then the archive update. |

Routes: `workspaces/[id]/route.js` PATCH and DELETE.

Disclosure: this wave exercises all three arms of the §1.2 lookup — Tier A 404
`'Workspace not found'` for an unowned BUSINESS workspace; Tier B 403
`ungovernedWorkspaceRefusal` for PORTFOLIO/TENANT (anyone could previously
rename or archive `WS-PLATFORM`; after this wave nobody can — the FR-072(b)
behaviour change the FR row exists for); 403 `unknownScopeRefusal` for a scope
type outside the enum.

Tests: new `tests/integration/fr072-workspace-mutation-authorization.test.js` —
PATCH rename pair with `name` **and** `version` asserted unchanged on refusal;
the Tier B probe (viewer owning every fixture Business still refused 403 on a
PORTFOLIO workspace, message names the missing authority); oracle equality;
archive pair. Migration: none — no existing test calls these two functions
(planner verified; nothing was threaded for them in Wave 0).

### Wave 7 — `project-file-service` (Worker 1, after Wave 1)

Service: `src/modules/project-manager/application/project-file-service.js`.
Import `assertProjectWritable`. Both functions already take a `{ db }` bag —
`viewer` joins it.

| Function | New signature | Guard and placement |
|---|---|---|
| `createProjectFile` | `(projectId, input, { db = prisma, viewer } = {})` | after the existing `assertProject(db, projectId)` call, **before** the `workItemId` lookup: `await assertProjectWritable(viewer, projectId, { db })`. (`assertProject`'s `'Project not found'` and the guard's Tier A message are the same string, so unowned ≡ absent holds across both paths.) |
| `deleteProjectFile` | `(projectId, fileId, { db = prisma, viewer } = {})` | after `assertProject(db, projectId)`, **before** the `projectFile`/`fileAsset` lookups: `await assertProjectWritable(viewer, projectId, { db })` — a refused caller learns nothing about which files exist. |

Routes: `projects/[id]/files/route.js` POST ·
`projects/[id]/files/[fileId]/route.js` DELETE. (GET / `listProjectFiles`
untouched.)

Disclosure: Tier A `'Project not found'`; Tier B 403 for shared-Space Projects.

Tests: new `tests/integration/fr072-project-file-authorization.test.js` — on
refused delete assert **both** `projectFile.count()` and `fileAsset.count()`
unchanged (delete touches both populations); create pair; oracle equality.
Migration: `tests/unit/project-file-service.test.js` (3 sites, exclusively this
wave's file) — merge `viewer` into the existing `{ db }` bags per §6.

---

## 5. Pre-thread verification (the plan's Wave-0 §3 premise, confirmed)

Verified against today's code, not assumed:

- `createProject(input)`, `updateItem(id, patch)`, `deleteItem(id)`,
  `deleteDependency(id)`, `linkRepository(input)`, `unlinkRepository(id)`,
  `createMilestone(input)`, `updateWorkspace(id, patch)`, etc. take **no
  options bag today** — JavaScript ignores extra positional arguments, so
  appending `, { viewer }` at a call site is a no-op until the wave lands.
- `createProjectFile` / `deleteProjectFile` destructure `{ db = prisma } = {}`
  — an extra `viewer` key in that bag is ignored by destructuring today.

So Wave 0's pre-thread keeps `npm test` green at the 992 floor **before** any
guard exists, and each wave's guard then validates the already-threaded viewer.
The plan's mechanism is workable as written. Residual risk stands as the plan
recorded it: if one pre-threaded viewer proves wrong for one call site, that
wave's worker fixes exactly that call site and reports it; the integrator
merges serially.

## 6. Migration wrappers for a worker's own test files

Prefer a file-local wrapper over editing every call site. Two shapes, matching
the two signature families:

```js
// Family 1 — service takes no options bag today (most functions):
const viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
const asOwner = (fn) => (...args) => fn(...args, { viewer })
const createProjectAsOwner = asOwner(createProject)   // createProjectAsOwner(input)

// Family 2 — service already takes a trailing options bag (project-file-service):
const withOwner = (fn) => (a, b, opts = {}) => fn(a, b, { ...opts, viewer })
const deleteProjectFileAsOwner = withOwner(deleteProjectFile)  // preserves { db }
```

Rule: the viewer always travels in the **last** options-bag argument, merged
into any existing bag — never a new positional parameter. Build the wrapper's
viewer from the file's own fixture Business ids with `makeViewer()`; if a file
uses several disjoint Businesses, one viewer owning all of them is legitimate
(`ownedBusinessIds ⊆ visibleBusinessIds` holds; the factory accepts it).

## 7. What each worker must NOT do (restating the contract in this design's terms)

- No worker writes an `ownsBusiness`-shaped expression, a `role` check, a
  `visibleBusinessIds` check, or any refusal message text — all of that exists
  only in `viewer-authority.js` and the §1 helper.
- No worker touches `createRepository`, `updateRepository`, the seven
  scope-service creators, `previewImport`/`importSnapshot`, or anything in
  `docs/` or the baselines.
- No worker edits the two Wave-0 pre-threaded test files except the narrow
  own-call-site fix in §5, reported explicitly.
- A wave that seems to need a decision not written here returns to the
  architect. It does not choose.

## 8. FR-072 statement — one revision to the planner's text

The planner's proposed FR-072 statement stands with **one added clause** (the
Wave-1 move conjunction was implicit; make it explicit). Revised text for the
controller's Wave-0 PRD edit — the planner's paragraph with the underlined
insertion after the Dependency clause:

> **FR-072** — Project-Manager mutation authorization: every mutating route
> repaid from `docs/.route-viewer-baseline.json` resolves a request viewer and
> the service behind it refuses the write unless
> `ownsBusiness(viewer, <governing Business>)`, where the governing Business is
> derived from the target's Space (`workspace.businessId`; for Project-scoped
> targets via the Project's Space per FR-043; for a Dependency, the governing
> Business of **both** endpoints; for a Project moved between Spaces, the
> authority of **both** the current governing Business and the destination
> Space). (a) A Business-governed target that is not owned answers exactly as a
> nonexistent one. (b) A target governed above Business (a Project in a
> PORTFOLIO/TENANT Space, a non-BUSINESS-scoped Workspace) is refused for every
> principal with a reason naming the missing authority — this requirement
> deliberately does not invent authority above Business; enabling such writes
> requires a prior FR that makes that authority holdable (FR-066/FR-067
> direction), per the FR-065 precedent.

## 9. Adjustments to the plan (what this design changed, and why)

1. **Wave 4's endpoint derivation moved into the Wave-0 helper**
   (`assertEndpointWritable`, §1.2) instead of being composed inside
   `dependency-service.js`. The plan's both-endpoints rule is unchanged; moving
   the type→chain table into the shared module removes the last place a worker
   would have written derivation logic, which is the acceptance test for this
   document.
2. **Five write-without-load functions get an explicit load-then-authorize
   order** (`archiveProject`, `archiveWorkstream`, `deleteItem`,
   `deleteDependency`, `unlinkRepository`, plus `archiveWorkspace`), with new
   explicit 404s replacing today's raw P2025 behaviour on missing ids. The plan
   named three of these; the design pins all of them with exact messages.
3. **The disclosure decision is now a two-tier model fixed once** (§1.4) with
   per-call-site pinned messages, including the requirement that Tier A
   refusals be *tested* byte-identical to the absent case — turning verify-gate
   check #7 into an assertion rather than a review judgement.
4. **The pre-thread premise is verified** (§5), not assumed: extra positional
   args and extra bag keys are ignored by today's signatures, so Wave 0 stays
   green before any guard lands.
5. **FR-072 gains the move-conjunction clause** (§8).
6. **`requireViewer` deliberately yields a 500**, not a 4xx (§1.2) — a missing
   viewer is a wiring defect and must be loud, per the `authorizeImportTarget`
   precedent. The plan left the status unstated.

Nothing was rejected: the plan asks for one predicate in one place, guards in
services only, and no wave requires a worker-side authorization decision once
adjustment 1 is applied.
