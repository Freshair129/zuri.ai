# PM review R1 — write path

Scope reviewed: every write service under
`src/modules/project-manager/application/` and the API routes that front them.
Read the three cited RCAs first
(`2026-08-16-global-role-is-not-per-business-authority.md`,
`2026-08-16-horizon-replace-orphaned-every-goal.md`,
`2026-08-17-read-scope-outran-the-write-scope.md`).

## Findings

### F1 — Team endpoint mints/elevates OWNER memberships with no caller authorization → business-owner privilege escalation
- **Where**: `src/modules/project-manager/application/project-team-service.js:68-92`
  (`addProjectTeamMember`, `changeProjectTeamRole`); route
  `src/app/api/projects/[id]/team/route.js:13-19`.
- **How it fails**: The route calls the service directly and never resolves a
  viewer. `zAddMember` (line 9) accepts `role` from the request body and
  `zMembershipRole` permits `'OWNER'`. `addProjectTeamMember` only checks that
  the project's workspace has a `businessId` and that the person exists — there
  is **no check that the caller owns, or is even a member of, that Business**.
  It then creates `Membership { personId, tenantId: workspace.tenantId,
  businessId: workspace.businessId, role: 'OWNER' }`.
  `resolve-viewer.js:129-132` builds `ownedBusinessIds` from exactly the
  `role === 'OWNER'` memberships, so on the attacker's next `resolveViewer` that
  Business is in `ownedBusinessIds` and they hold full owner write-authority
  (the same authority FR-059/FR-038 gate on). Concrete: `POST
  /api/projects/{anyProjectId}/team` with `{ "personId": "<me>", "role":
  "OWNER" }` → OWNER Membership in that project's Business → owner of that
  Business. `changeProjectTeamRole` is the same escalation for an existing
  in-scope membership (only `mutableMembershipWhere` scope is checked, never
  caller authority).
- **Evidence**: Route has no `resolveRequestViewer` import (contrast
  `src/app/api/business/goals/route.js:7,13` and `src/app/api/files/route.js`,
  which do). `zMembershipRole = z.enum(['OWNER','MEMBER'])`
  (`enums.js:68`). `ownedBusinessIds` derivation confirmed at
  `resolve-viewer.js:126-132`. This is the exact self-promotion shape closed for
  `profile-permission-service.js` in instance 2 of the global-role RCA
  (`assertMembershipBusinessOwned`), left open here with *no* authorization at
  all.
- **Severity**: HIGH (authorization / privilege escalation)
- **Declared requirement it violates**: SEC-008 ("Pre-shell identity and
  authorization fail closed … role, platform grant … come only from a trusted
  server session"); BR-001 tenant/business isolation. The membership-write
  authorization is otherwise undeclared for this route.

### F2 — SEC-001 cross-scope write guard is invoked by no write path; the bulk of PM mutation routes carry no viewer and enforce no scope
- **Where**: `assertWorkspaceInScope` defined at
  `scope-service.js:215`; callers = none in `src/`. Routes: `projects`,
  `workstreams`, `work`, `containers`, `milestones`, `gates`, `dependencies`,
  `repositories`, `workspaces`, `projects/[id]/team`, `projects/[id]/files`.
- **How it fails**: A grep for `assertWorkspaceInScope` across `src/` returns
  only its definition and its own unit test — no service or route calls it. The
  write services (`project-service`, `work-service`, `milestone-gate-service`,
  `scope-service`, `dependency-service`, `repository-service`,
  `project-file-service`) take **no `viewer` argument** and perform no
  tenant/business/ownership check; their routes pass no viewer. So e.g. `POST
  /api/workstreams { projectId }` creates a workstream under *any* project in
  *any* tenant (the service only checks the project row exists,
  `project-service.js:164-165`); `PATCH /api/work/[id]`, `DELETE
  /api/projects/[id]`, `PATCH /api/workspaces/[id]` are all reachable with no
  scope authority. SEC-001 is marked "✅ tested" on the strength of a guard that
  nothing in the write path calls.
- **Evidence**: `grep -rn assertWorkspaceInScope src/` → one hit (its
  definition). Route files under `src/app/api/{projects,work,containers,
  milestones,gates,dependencies,repositories,workstreams}` import only the
  service + `handle`, never `resolveRequestViewer`. `_helpers.handle` adds no
  auth.
- **Severity**: HIGH (authorization) — may be partly known pre-FR-046 posture;
  see Uncertain. Flagged because SEC-001 explicitly claims this guard rejects
  cross-scope writes and it is wired to nothing.
- **Declared requirement it violates**: SEC-001 (`assertWorkspaceInScope` —
  reject cross-scope), BR-001.

### F3 — `listProjectTeam` returns every Person in the database (incl. email), unscoped by tenant
- **Where**: `project-team-service.js:53` (`availablePeople` source) and
  `:64`, returned by `GET /api/projects/[id]/team` (no viewer).
- **How it fails**: The `members` list is correctly tenant-scoped
  (`membershipScopeForWorkspace`, `:39`), but `availablePeople` comes from
  `db.person.findMany({ select: { id, code, displayName, email } })` with **no
  where clause** — every Person across every tenant/portfolio, minus those
  already on the team. `email` is included. A caller opening the team picker for
  one project enumerates all persons and their emails system-wide. This is the
  same class as the `2026-08-17-read-scope` RCA (`Person.email` selected into a
  response the surface never needed, cross-tenant rows).
- **Evidence**: Line 53 has no scope filter while the rest of the function is
  tenant-scoped; the inconsistency is the tell. `Person` has no `tenantId`
  column (`schema.prisma:122`), so correct scoping must go through `Membership`
  (tenant), exactly as `members` already does.
- **Severity**: MEDIUM (cross-scope PII read)
- **Declared requirement it violates**: BR-001 tenant isolation; parallels the
  `Person.email`-should-not-be-selected conclusion of the read-scope RCA.
  `availablePeople` scoping itself is undeclared.

### F4 — Older single-write services record the audit outside any transaction
- **Where**: `project-service.js` (109,147,156,180,205,214),
  `work-service.js` (50,69,104,130,139), `milestone-gate-service.js`
  (33,56,81,100), `scope-service.js` (43,53,71,87,148,183,198,207),
  `repository-service.js` (36,56,77,88), `dependency-service.js` (72,83),
  `project-file-service.js` (57,70).
- **How it fails**: Each does `const x = await prisma.<model>.create/update(...)`
  then a separate `await recordAudit(prisma, ...)`. The two are not wrapped in
  `$transaction`, so if the audit insert fails (or the process dies between the
  two awaits) the mutation persists with no `AuditEvent`. SEC-003 requires every
  significant mutation to record one. The newer services do this correctly —
  `business-strategy-mutation-service`, `file-asset-service`, `backup-service`,
  `file-reconcile-cache-service` all call `recordAudit(tx, …)` inside
  `$transaction`. The inconsistency is the finding.
- **Evidence**: Compare `project-service.js:96-109` (create, then audit, no tx)
  with `business-strategy-mutation-service.js:273-303` (create + `recordAudit(tx)`
  in one `$transaction`).
- **Severity**: LOW (durability edge; consistent pre-existing pattern, likely
  accepted debt, but a genuine SEC-003 gap)
- **Declared requirement it violates**: SEC-003 (AuditEvent for every mutation).

## Checked and found sound
- **`business-strategy-mutation-service.js` (FR-059)** — authorization is on
  `viewer.ownedBusinessIds` via `assertBusinessOwned` (fails closed on a
  non-array), not on `role`/`visibleBusinessIds`; every mutation records its
  audit inside the same `$transaction`; the strategy routes resolve a viewer.
  Matches the global-role RCA's prescribed fix. Sound.
- **`reconcileHorizons` (`:322-373`)** — no longer delete-and-recreate. It
  reconciles by stable `key`, refuses (`badRequest`) to delete a horizon that
  still has goals (`businessGoal.count` guard, `:329-335`), updates surviving
  rows in place so no `BusinessGoal.horizonId` is ever `SET NULL`, and stages
  kept positions through negative sentinels to avoid the
  `@@unique([roadmapId,position])` collision. The horizon-orphan precedent is
  closed. No other hard-delete in the lane orphans a read-required nullable FK
  (workstream/project/workspace archives are soft `deletedAt`; junction deletes
  have no dependents).
- **`file-asset-service.js` / reveal / reconcile / cache (FR-045)** — guard on
  `visibleBusinessIds` is *correct here*: US-045-03 declares "authorized
  owner/member" may add files, so member-level visibility is the intended
  authority (this is NOT the FR-059 role-vs-ownership bug). `businessScope`
  confirms project/workItem belong to the Business; writes-with-content are
  transactional (create + FileLink + audit in one `$transaction`), staging is
  quarantine-first. Routes resolve a viewer. Sound.
- **`backup-service.importSnapshot`** — full delete+recreate is inside one
  `$transaction` with the audit; remount validation runs before mutation. Sound.
- **`project-team-service` mutation *scope*** (as opposed to *authorization*, see
  F1): `mutableMembershipWhere` correctly restricts edits to
  `businessId === workspace.businessId`, and tenant-wide (`businessId: null`)
  rows are read-only, matching SDD-015. The `{ businessId: null }` branch in
  `membershipScopeForWorkspace` is safe because it is ANDed under
  `tenantId: workspace.tenantId` (not a bare cross-tenant OR).

## Uncertain
- **F2 scope**: I could not find an ADR/roadmap statement declaring the legacy
  PM routes (pre-FR-046) as *accepted* unauthenticated debt. FR-046/SEC-008 were
  adopted only by `files`, `business/*`, `people`, `entry`, `profile`,
  `platform`. If a decision record accepts the remaining routes as intentionally
  open for the local single-user console, F2 (and the reachability half of F1)
  would drop to "known debt". What would confirm: an ADR or roadmap entry
  scoping SEC-008 rollout. F1's *escalation* (minting OWNER via an open route)
  remains serious regardless.
- **`dependency-service.createDependency` (`:61-71`)**: `wouldCreateCycle`
  reads all edges, then the insert happens outside a transaction — two
  concurrent inserts could each pass the check and jointly form a cycle
  (TOCTOU). Low impact and no declared transactional requirement; did not count
  it as a firm finding. Confirm with a concurrent-insert test if cycle-freedom
  is a hard invariant.
