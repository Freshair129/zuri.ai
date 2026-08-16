---
domain: project-manager
feature: FR-059
module: project-manager
source: v2-native
---

# FR-059 - Business Strategy Mutation

| Field | Value |
|---|---|
| **Version** | 1.2.0 |
| **Status** | Candidate |
| **Date** | 2026-08-16 |
| **Relates to** | FR-041, FR-043, SDD-020, SDD-032, BR-001, SEC-003 |

FR-041 shipped Business Strategy as a **read-only** projection over
`BusinessRoadmap` / `BusinessRoadmapHorizon` / `BusinessGoal` / `ProjectGoal`,
explicitly deferring mutation. This FR is that follow-up: OWNER-scoped
create/update of the roadmap and its horizons, create/update of goals, and
link/unlink of `ProjectGoal`. The FR-041 read model
(`getBusinessStrategy` in `src/modules/business/application/business-strategy-service.js`)
remains the **only** read contract — these endpoints write, then the client
re-reads through the existing GET.

Writes live in `src/modules/project-manager/application/` — the domain
charter's only writing lane (`docs/domains/project-manager/CHARTER.md`);
`src/modules/business` stays a read slice and gains no write code (SDD-032).

## 1. Authorization

> **T3b-1 remediation (2026-08-16, FIX 1):** this section originally described
> the mutation gate as `viewer.role === 'OWNER'` plus
> `viewer.visibleBusinessIds.includes(businessId)`. An adversarial gate proved
> **live against the database** that this pair does not compose: a principal
> who is OWNER of Business A and merely MEMBER of Business B has the *global*
> `role: 'OWNER'` label (per-principal, not per-Business —
> `resolve-viewer.js`) and Business B legitimately in `visibleBusinessIds`
> (a plain MEMBER Membership populates it), so both checks passed for a write
> to Business B this principal had no OWNER authority over. The text below is
> the corrected contract; §4.1 and the "Known debt" section further down are
> updated to match.

Every endpoint below requires **both** of the following, in this order:

1. `viewer.role === 'OWNER'`, checked with the existing codebase convention
   (`src/modules/identity/profile-permission-service.js:27-35`, the same gate
   FR-038 Users & Permissions uses). This is a coarse pre-filter — it only
   rejects a viewer who is OWNER of *nothing at all* (a pure MEMBER, or a
   platform DEV grant, whose `ownedBusinessIds` is always `[]`):

   ```js
   if (viewer.role !== 'OWNER') {
     const error = new Error('Owner permission is required')
     error.status = 403
     throw error
   }
   ```

2. **Business ownership**, not mere visibility. `viewer.role === 'OWNER'` is a
   *global* per-principal label — `resolve-viewer.js` sets `role: 'OWNER'` if
   the principal is OWNER of *any single* Business — so role alone does not
   establish OWNER authority over any *particular* Business, and (per the
   remediation note above) neither does `visibleBusinessIds`, which a plain
   MEMBER Membership also populates. Every mutation therefore asserts the
   target `businessId` is in `viewer.ownedBusinessIds` — the actual
   per-Business OWNER grant set `resolve-viewer.js` computes from OWNER-role
   Memberships specifically:

   ```js
   function assertBusinessOwned(businessId, viewer) {
     const ownedBusinessIds = viewer?.ownedBusinessIds
     if (!Array.isArray(ownedBusinessIds) || !ownedBusinessIds.includes(businessId)) {
       throw badRequest('Business access denied (not owned)') // error.status = 400, explicit — see §4.1
     }
   }
   ```

   `ownedBusinessIds` is always an array (never `undefined`) and is a
   **subset** of `visibleBusinessIds` (`resolve-viewer.js`'s invariant), so
   this check subsumes the old `visibleBusinessIds`-only check: any Business
   it passes is necessarily also visible. The old `assertBusinessVisible`
   helper was **removed**, not kept alongside this one — see the "removed as
   redundant" decision recorded next to `assertBusinessOwned` in
   `business-strategy-mutation-service.js` for the full reasoning. The
   observable HTTP status for a refused write is unchanged (400, as before);
   only the message text changed, from "not visible" to "not owned", to match
   what is actually being checked now.

   For by-id operations (`updateRoadmap`, `updateGoal`, `linkProjectToGoal`,
   `unlinkProjectFromGoal`) the owning `businessId` is resolved from the
   roadmap/goal row **first**, then asserted — the row is looked up by id
   before its Business is checked, matching `resolveFileAssetContent`'s order
   in `file-asset-service.js`.

`DEV` (platform grant) is **not** OWNER and is rejected by the role check,
matching existing precedent — do not special-case DEV for this feature; its
`ownedBusinessIds` is always `[]` regardless (resolve-viewer.js), so it would
fail the ownership check even if it somehow passed the role check. The viewer
comes from `resolveRequestViewer(request)` at the route boundary, same as the
FR-041 GET route, and already carries `ownedBusinessIds` (see
`resolve-viewer.js`) — no extra route-handler wiring is needed beyond passing
the whole `viewer` through, as the routes already do.

## 2. Endpoints

All request/response bodies are JSON. All mutation responses return the
**same serialized shape** the FR-041 read model already produces for that
entity (`serializeRoadmap` / `serializeGoal` in `business-strategy-service.js`),
not a raw Prisma row — so the client never needs a second mapping layer.

| Method | Path | Request body | Response |
|---|---|---|---|
| `POST` | `/api/business/roadmaps` | `{ businessId, title, description?, status?, startAt?, targetAt?, horizons: [{ key, label, position, description?, targetAt? }, ...] }` (2–3 entries) | `serializeRoadmap(created, businessId)` |
| `PATCH` | `/api/business/roadmaps/{id}` | `{ title?, description?, status?, startAt?, targetAt?, horizons?: [{ key, label, position, description?, targetAt? }, ...] }` — when `horizons` is present it is **reconciled by `key`** against the existing set (2–3 entries required); see §3.1 | `serializeRoadmap(updated, businessId)` |
| `POST` | `/api/business/goals` | `{ businessId, roadmapId?, horizonId, title, description?, status?, priority?, progress?, startAt?, targetAt? }` — `horizonId` is **required** (see §3.2); `roadmapId` is derived from the horizon if omitted, and must agree with it if supplied | `serializeGoal(created, businessId)` |
| `PATCH` | `/api/business/goals/{id}` | partial of the same fields (any subset); `horizonId`/`roadmapId` may **move** a Goal to a different horizon/roadmap but can never be explicitly set to `null` (would recreate the invisible-goal bug §3.2 closes) | `serializeGoal(updated, businessId)` |
| `POST` | `/api/business/goals/{id}/projects` | `{ projectId }` | `serializeGoal(updated, businessId)` (with the new link included in `.projects`); re-linking an already-linked Project is a `409`, not a raw constraint-violation `500` |
| `DELETE` | `/api/business/goals/{id}/projects/{projectId}` | — | `serializeGoal(updated, businessId)` |

`status` on roadmap create/update: `ROADMAP_STATUSES` (`src/lib/validation/enums.js`),
default `'ACTIVE'` (matches `BusinessRoadmap.status` schema default). `status`
on goal create/update: `GOAL_STATUSES`, default `'PLANNED'` (matches
`BusinessGoal.status` schema default). `priority`: `GOAL_PRIORITIES`, default
`'MEDIUM'` (matches `BusinessGoal.priority` schema default). Reject any value
outside these Zod enums with a 400, same as every other intake surface (BR-009).

A `PATCH` whose parsed body has no keys (`{}`) is a true no-op: it does not
bump `version` and does not record an `UPDATED` AuditEvent. An update that
changes nothing should not look, in the audit trail, like one that did.

## 3. Horizon cardinality rule

A roadmap must always have exactly 2 or 3 horizons — enforced by the
**service**, not only defensively at read time. Reuse the exact existing error
text so a write-time rejection and the read-side defensive check
(`business-strategy-service.js:51-53`) mean the same thing to any caller
that greps for it:

```js
if (horizons.length < 2 || horizons.length > 3) {
  throw new Error('Business roadmap must have 2 or 3 horizons')
}
```

This check runs before any write. Creating a roadmap with 1 or 4+ horizons in
the request body fails closed with this message (mapped to 400 at the route).
Updating a roadmap's `horizons` array to a size outside [2,3] fails the same
way and leaves the existing horizon set untouched (no partial replace) —
implement the write as `prisma.$transaction([...])`, matching SDD-006's
single-transaction convention for other multi-row writes.

A submitted horizon set with a duplicate `key` or a duplicate `position` is
rejected before any write, with a `400` (`Duplicate horizon key "X"` /
`Duplicate horizon position N`) — the schema's `@@unique([roadmapId, key])`
and `@@unique([roadmapId, position])` would otherwise surface as a raw P2002,
which `_helpers.js`'s message sniffing maps to `500`.

### 3.1 Horizon reconciliation on update — decision

`PATCH .../roadmaps/{id}` with `horizons` does **not** delete-then-recreate
the horizon set. The schema's `BusinessGoal.horizonId` foreign key is
`ON DELETE SET NULL`, and the FR-041 read model nests goals only under
`roadmap.horizons.goals` — so delete-then-recreate detaches every goal on the
roadmap from the only read contract that can see it, permanently, on any
update that merely renames a horizon (this was BLOCKER 2 in the FR-059
remediation review; the regression test is
`tests/integration/fr059-business-strategy-mutation.test.js`, describe block
"Horizon replace preserves goals").

Instead, the horizon set is **reconciled by `key`**, the one stable identifier
a horizon has across updates (`id` is server-generated, `position` is
expected to change by design):

- a horizon whose `key` still appears in the patch is **updated in place**
  (same row, same `id` — so `BusinessGoal.horizonId` never moves or nulls);
- a `key` not previously present is **inserted** as a new horizon;
- a previously-present `key` that is missing from the patch is **deleted**
  only if no `BusinessGoal` still references it. If one does, the whole
  operation is refused with a `400` (`Cannot remove horizon "KEY" — it still
  has N goal(s) attached...`) rather than silently orphaning those goals.
  **This is the decision, taken here**, for Wave 2's UI to build against: a
  horizon carrying goals cannot be dropped by a horizons PATCH; the caller
  must move or update those goals first. A future FR may add an explicit
  "move these goals to horizon X" affordance — out of scope here.
- positions are cleared to unique negative sentinel values before the final
  values are written, so reordering kept horizons never trips
  `@@unique([roadmapId, position])` mid-transaction.

### 3.2 `horizonId` is required on Goal create — decision

`POST /api/business/goals` requires `horizonId`. The FR-041 read model is
frozen in this build and nests goals only under `roadmap.horizons.goals`, so a
goal created with `roadmapId` but no `horizonId` (both independently optional
in the original draft of this endpoint) would return `200` and then be
invisible on the very next GET — a real, observed bug (SHOULD-FIX 5 in the
remediation review). Rather than change the frozen read side, the write
contract now conforms to it: every goal must be created under a horizon.
`roadmapId` remains independently supplied-or-derived (see §2), but a
`PATCH .../goals/{id}` can never set `horizonId` or `roadmapId` to an explicit
`null` — only move the goal to another horizon/roadmap — so an update can
never recreate the invisible state either.

## 4. Business isolation rule

Three isolation checks, all service-level, all fail-closed, all mapped to an
**explicit `400`** on the thrown `Error` (`error.status = 400`) rather than
relying on `_helpers.js`'s message-sniffing fallback — a client that
references a roadmap/horizon/project outside its Business is making a bad
request, not triggering a server fault, and Wave 2's UI needs to tell that
apart from a real `500`:

1. **Business ownership** (§1.2) — the target `businessId` must be in the
   viewer's `ownedBusinessIds`. `Error('Business access denied (not owned)')`.
   As of the T1d remediation pass this check also sets `error.status = 400`
   explicitly, same as the other two below — it previously relied on
   `_helpers.js`'s message-sniffing fallback (the `denied` regex), which
   happened to map the same message to the same `400`, so the observable
   status did not change. As of the T3b-1 remediation pass (§1) this check
   was also **retargeted** from `visibleBusinessIds` (a visibility check
   `file-asset-service.js`'s `assertVisible` also uses) to `ownedBusinessIds`
   (an OWNER-authority check `assertVisible` has no equivalent of — Business
   Files has no OWNER-only write boundary to enforce) — the observable
   status stayed `400` across that change too; only the message wording did
   not.

2. **Goal → Roadmap/Horizon:** if `roadmapId` and/or `horizonId` are supplied
   on a goal create/update, the referenced `BusinessRoadmap.businessId` (and,
   if a horizon is given, its parent roadmap) must equal the goal's
   `businessId`. Mismatch throws `Error('Roadmap does not belong to Business')`
   / `Error('Horizon does not belong to Business')`. A horizon whose roadmap
   disagrees with an independently-supplied `roadmapId` throws
   `Error('horizonId does not belong to roadmapId')` — the two fields are
   otherwise a silently contradictory pair.

3. **Goal ↔ Project link:** a goal in Business A must never link a project
   owned by Business B. This is the same rule FR-043 already enforces for
   direct Project ownership (AC-043.2/043.3) and that the FR-041 read side
   already applies defensively in `projectLink()`
   (`business-strategy-service.js:8-19`, which drops any project whose
   resolved owner id does not equal the goal's `businessId`). The **write**
   side must reject before creating the `ProjectGoal` row, not just filter it
   out later on read:

   ```js
   const project = await db.project.findUnique({ where: { id: projectId }, select: { businessId: true } })
   if (!project || project.businessId !== goal.businessId) {
     const error = new Error('Project does not belong to Business')
     error.status = 400
     throw error
   }
   ```

   This mirrors the exact phrasing already used for the equivalent Business
   File Manager check (`'Project does not belong to selected Business'` in
   `file-manager-read-model.js:148`) — a project with a **null** `businessId`
   (explicit shared portfolio/tenant project, FR-043) is never linkable to any
   Business's goal, since `null !== goal.businessId` for every real
   `businessId`. Re-linking a Project already linked to the same Goal is a
   `409` (`'Project is already linked to this Goal'`), not a raw
   constraint-violation `500`.

## 5. AuditEvent vocabulary

Following the existing `entityType` convention (SCREAMING_SNAKE model name,
singular — see `PROJECT_FILE`, `WORK_CONTAINER`, `LOCAL_WORKSPACE_MOUNT` in
`src/modules/project-manager/application/audit.js` call sites) and the
existing `action` convention (`CREATED` / `UPDATED` / `UNLINKED`, already used
verbatim for other entities):

| Mutation | `entityType` | `action` | `payload` |
|---|---|---|---|
| Roadmap create | `BUSINESS_ROADMAP` | `CREATED` | `{ code, businessId, horizonKeys: [...] }` |
| Roadmap update | `BUSINESS_ROADMAP` | `UPDATED` | the applied patch — the **Zod-parsed** data (`data`, not the raw request body `patch`), so keys the schema stripped never land in the audit record (matching the `payload: patch`/`payload: data` convention in `milestone-gate-service.js` / `work-service.js`) |
| Goal create | `BUSINESS_GOAL` | `CREATED` | `{ code, businessId, roadmapId, horizonId }` — `roadmapId` is the resolved/derived value, not necessarily the caller's raw input |
| Goal update | `BUSINESS_GOAL` | `UPDATED` | the applied (Zod-parsed) patch, same rule as Roadmap update |
| Project link | `PROJECT_GOAL` | `LINKED` | `{ goalId, projectId }` |
| Project unlink | `PROJECT_GOAL` | `UNLINKED` | `{ goalId, projectId }` (exact action name matches the existing `PROJECT_REPOSITORY` → `UNLINKED` precedent in `repository-service.js:88`) |

Every mutation records exactly one `AuditEvent` inside the same transaction as
its data write (SDD-006 discipline), via the shared `recordAudit` helper
(`src/modules/project-manager/application/audit.js`) — never a second,
differently-shaped audit call.

## Known debt (visible on purpose)

`serializeRoadmapDto`/`serializeGoalDto` in
`business-strategy-mutation-service.js` duplicate the private
`serializeRoadmap`/`serializeGoal` helpers in the frozen
`business-strategy-service.js` field-for-field (see that file's header
comment for why re-deriving through the exported `getBusinessStrategy()` was
rejected). Nothing at the type level stops the two from drifting apart; an
equivalence test in `tests/integration/fr059-business-strategy-mutation.test.js`
("Mutation DTO / FR-041 read model parity") creates a Goal via the mutation
service and asserts its response deep-equals the corresponding node in
`GET /api/business/strategy`, so drift fails CI even though the duplication
itself remains. Extracting a shared serializer is left as future work — it
would need `src/modules/business` to either gain write code (contradicting
SDD-032) or the shared shape to move to a third, mutually-imported location,
which is a bigger call than this slice should make unilaterally.

## Known debt (accepted, T1d remediation pass)

**The by-id existence oracle is not masked.** For `updateRoadmap`, `updateGoal`,
`linkProjectToGoal` and `unlinkProjectFromGoal`, a row that exists but belongs
to a Business outside the viewer's `ownedBusinessIds` (T3b-1: originally
`visibleBusinessIds`, retargeted per §1) returns `400`
("... does not belong to Business" / the isolation checks in §4), while a row
that does not exist at all returns a different status: `error.status` is
unset on those `Error('... not found')` throws, so `_helpers.js`'s `notFound`
regex on `"not found"` maps them to `404`. A caller probing ids across
Businesses can therefore learn "this id exists somewhere" from the 400-vs-404
split — one bit of cross-tenant information leakage. The FR-059 remediation
review considered closing this by returning `404` for the outside-scope case
too (matching not-found, so a caller cannot distinguish "wrong business" from
"no such row"). That change is deliberately **not** made in this pass: it
alters an observable status code (400 → 404) on an endpoint contract a
sibling agent (T2b) is actively coding a UI against, and FR-059 §4 already
commits three of the four isolation checks to explicit `400`s for the
mirror-image reason (Wave 2's UI needs to tell isolation failures apart from
real `500`s). Left as accepted debt, to be revisited once the UI build is no
longer live against this contract.

## T3b-1 remediation (2026-08-16)

A follow-up review of the Wave 2 UI build (`overview/page.jsx`,
`StrategyEditModals.jsx`, `useApi.js`) surfaced one blocker and several
should-fix items beyond the authorization hole covered in §1:

- **FIX 1 (blocker).** OWNER-scoped writes were not actually scoped to the
  Business — see §1's remediation note and §4.1.
- **FIX 2.** `RoadmapModal` resubmitted the horizon array's own 0-based index
  as `position` on every save, including a title-only edit that never touched
  the horizons at all — rewriting the seeded `1,2,3` to `0,1,2` and breaking
  `prisma/seed.js`'s idempotent `roadmapId_position` upsert (a P2002 on the
  next `db:seed`). Fixed by carrying each row's real `position` from the
  FR-041 read model through to submit (`horizonRowsFromRoadmap` /
  `horizonsPayloadFromRows` in `StrategyEditModals.jsx`); only a genuinely new
  row gets a fresh position, computed past the current maximum
  (`nextHorizonPosition`), never colliding with a kept horizon's real value.
- **FIX 3.** `RoadmapModal` was rendered unconditionally (gated only on
  `isOwner`) with only its `open` prop toggled, so — because the shared
  `Modal` returns `null` while closed rather than unmounting — the component
  itself never unmounted and its `useState(() => ...)` initializer never
  re-ran. Two observed consequences: typing into the form and clicking
  Cancel did not discard the text (it silently persisted on the next Save
  after reopening), and a Goal created while the modal was closed still
  showed the horizon's stale `goalCount` on reopen. Fixed by rendering
  `RoadmapModal` conditionally on `editingRoadmap`, matching the
  already-correct `GoalModal`/`LinkProjectModal` pattern, so every open is a
  fresh mount with fresh state.

  **Accepted debt, not fixed here:** there is still no optimistic-concurrency
  check on `updateRoadmap`/`updateGoal` — `version` is incremented on every
  write but never compared against the value the form was loaded with, so
  saving from a stale form is a silent last-write-wins over a concurrent
  editor. Building that mechanism (a `version` sent with the PATCH, checked
  and rejected with a `409` on mismatch, both service-side and in the modal's
  error handling) is out of scope for this remediation pass — it is a
  separate, deliberate scope decision, not an oversight, and is recorded here
  so it is visible rather than silently absent.
- **FIX 4.** Two independent mechanisms both pushed focus outside the open
  dialog, and both had to be fixed for the Playwright regression test to go
  green:
  1. The focus-trap effect's dependency array was `[open, onClose]`, and
     `onClose` is a fresh inline arrow from `page.jsx` on every parent
     render. `LinkProjectModal` deliberately stays open across a link/unlink
     (so an OWNER can work through several Projects in one sitting), and
     every `reload()` after such a mutation therefore tore the effect down
     and re-ran it — restoring focus to whatever `document.activeElement`
     was at that instant, which React may already have replaced.
     Escape-closing also left focus on `<body>` rather than the button that
     opened the modal, contradicting `A11yModal`'s own header comment. Fixed
     by reading `onClose` through a ref (`onCloseRef`) inside `A11yModal`
     instead of depending on it directly, so the effect's identity is tied
     only to `open` actually transitioning, not to the parent re-rendering.
  2. Independently of (1): every submit button in these modals disables
     itself via `disabled={busy}` while its mutation is in flight. A
     currently-focused button that becomes `disabled` is a native browser
     focus fix-up, not a React re-render — Chromium moves focus straight to
     `document.body` and leaves it there once the button re-enables (nothing
     refocuses it). Measured live via a throwaway Playwright debug script
     (not assumed): Chromium fires `focusout` on the disabling button but
     *no* matching `focusin` for the implicit move to `<body>`, so a
     `focusin`-based reclaim listener — the first attempt — never fired.
     Fixed with a `focusout` listener that checks `document.activeElement`
     on the next tick and, if it has landed on `<body>` while the dialog is
     still open, refocuses the first focusable element in the dialog
     (`reclaimFocusIfEscapedToBody` in `A11yModal`).

  Covered by a real Playwright focus assertion
  (`tests/e2e/fr059-strategy-edit.spec.js`, "focus stays trapped ... across a
  mutation reload") that checks `toBeFocused()`/`not.toBeFocused()` before and
  after a real Link mutation against a live browser DOM — this is what
  actually caught that fix (1) alone was insufficient. The unit-level
  coverage for this fix is necessarily a narrower structural check (this
  repo's unit-test harness has no DOM/rendering layer), but is not a generic
  string grep either: it asserts the effect's dependency array is `[open]`
  and that the reclaim is wired to `focusout`, not the empirically-dead-end
  `focusin`.
- **FIX 5.** `overview/page.jsx`'s `@spec SDD-032, BR-001` line used to read
  "writes go through the FR-059 mutation service" — `scripts/doc-graph.mjs`
  scans the whole `@spec`-tagged text for any `FR|NFR|BR|SEC|SDD-\d{3}`
  token, so the mid-sentence `FR-059` was ingested as a (bogus) `@spec`
  dependency alongside the real `SDD-032`/`BR-001` ones. Fixed by dropping
  the FR mention from that line's prose (the `@req FR-059` line two lines up
  already declares the requirement this file delivers).
- **FIX 6.** `useApi.js`'s `api()` only surfaced `err.message`, so the one
  status-dependent UI branch (`LinkProjectModal`'s 409-vs-everything-else
  split for an already-linked Project) had to sniff message text with
  `/already linked/i.test(err.message)` — a reworded server message would
  have silently degraded it to a generic red error. Fixed by attaching
  `error.status = res.status` in `api()` (purely additive; every existing
  consumer reads only `.message`) and switching the 409 branch to
  `err.status === 409`.

## Out of scope

- Deleting a roadmap or a goal outright (only create/update/link/unlink are in
  scope for this slice). Deleting a *horizon* is possible, but only as a side
  effect of a horizons PATCH that omits its key and only when no goal is still
  attached to it — see §3.1.
- Reordering horizons independently of a full roadmap update.
- Any change to the FR-041 GET response shape beyond what create/update now
  populate.
- An explicit "move these goals off horizon X" affordance for the case where a
  caller wants to remove a horizon that still has goals — §3.1's decision is
  to refuse the removal, not to provide a bulk-move endpoint.
- An optimistic-concurrency mechanism for `updateRoadmap`/`updateGoal` — see
  the accepted-debt note under FIX 3 above.
