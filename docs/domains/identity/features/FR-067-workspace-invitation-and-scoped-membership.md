---
domain: identity
feature: FR-067
module: identity
source: v2-native
---

# FR-067 — Workspace invitation and scoped membership

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | ✅ Implemented (2026-08-26) — `workspace-membership-service.js`, `WorkspaceMembership`/`WorkspaceInvite` (portfolioId-keyed), `/api/workspace-invites/*`, `/api/workspace-memberships`; BR-016 grants-nothing proven in `tests/integration/workspace-onboarding-flow.test.js` |
| **Date** | 2026-08-17 |
| **Relates to** | [ADR-027](../../../decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md), FR-031, FR-036, FR-038, FR-046, FR-065, SDD-015, SDD-037, SDD-038, BR-016, SEC-003, SEC-014 |

## Intent

A Tenant Owner or Workspace Owner must be able to invite a Profile into a
Workspace without granting Tenant, Business, Space or Project authority. The
existing Tenant/Business `Membership` contract remains the source of business
scope; Workspace collaboration is represented separately.

## Target contract

```text
WorkspaceInvite
  → one-use acceptance
  → WorkspaceMembership(ACTIVE)
  → explicit Tenant/Business/Space/Project assignment
```

The server decides the target Workspace, inviter authority, role, expiry and
resulting access. The client cannot submit a role or principal claim that widens
the grant.

## Which "Workspace" — the key, not the label

**`WorkspaceMembership` binds to `portfolioId`.** The word *Workspace* denotes two
different levels of the scope chain in this repository, and only one of them is
meant here:

| Reading | Key | Is it this one? |
|---|---|---|
| Top-level collaboration container, displayed as **Workspace** | `portfolioId` (schema `Portfolio`) | **Yes** — ADR-027 §D2 |
| Project Manager working context, displayed as **Space** | `workspaceId` (schema `Workspace`) | No |

ADR-027 §D2 settles this and keeps `portfolioId` as the internal identity; it is
restated here because this file is what an implementer reads, and the schema
really does contain a `Workspace` model that is **not** the thing this
requirement is about. Binding `WorkspaceMembership` to `workspaceId` would grant
membership one level below the intended one — a different authorization boundary
wearing the same word.

That failure mode is not hypothetical here: a value meaning one thing at one
level and another at the level below is this repository's most repeated defect,
and `role` — global label versus per-Business authority — produced three
privilege escalations before it was closed
(`.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md`). The
label may move freely; the key never does (AGENTS.md §18).

## Relationship to FR-065 — this creates the authority FR-065 refuses for

FR-065 refuses an import whose target Workspace sits above Business. SDD-037
justifies that refusal in **two tenses**, precisely because this requirement
retires the first one. Until FR-067 ships: *no principal can hold portfolio or
tenant authority at all* — `Membership` is created in exactly two code paths and
both bind `businessId`, and the viewer contract exposes only Business-keyed
grants. FR-065's own text names the exit: "a prior FR that makes portfolio/tenant
authority *holdable*: a viewer-contract change in the manner of FR-061".

**FR-067 is that FR.** The ordering is correct, not contradictory — but the two
must be read together, because implementing this one falsifies the premise the
other one's refusal *used* to rest on. Both consequences are settled, and neither
requires a change to FR-065's code:

1. **Answered 2026-08-17 — no.** *May a principal holding a WorkspaceMembership
   on Portfolio P import into a Space (schema `Workspace`) whose `scopeType` is
   `PORTFOLIO` and whose `portfolioId` is P?* **No**, and this is derived from
   this requirement rather than invented for it — see the decision below.
2. **FR-065 clause (b) therefore does not change when this lands.** Its
   behaviour is identical; only SDD-037's *justification* is amended, from "no
   such authority can be held" to "the authority exists and does not extend
   here". Same refusal, different reason.

## Decision — WorkspaceMembership does not authorize import into a Space

**Answer: no.** Three independent grounds, in order of how directly they settle it:

**AC-067.5 already says so.** It makes Tenant/Business/**Space**/Project
assignment "a separate audited mutation" requiring "the relevant owner
authority". Space is named explicitly. Membership on the Portfolio therefore does
not reach a Space belonging to that Portfolio — Space authority is assigned, not
inherited downward from the container. Nothing new had to be decided here; an
earlier reading of this file called the question open by overlooking that
AC-067.5 names Space.

**AC-067.4 forbids the weaker act.** Workspace membership alone "returns no
hidden Business, Project, file, domain or Tenant data". An import *creates*
Projects, Workstreams, Containers, Items, Milestones and Gates. A grant that
cannot read a Project must not be able to write one.

**A portfolio-scoped Space sits above the isolation boundary.** Verified, not
assumed: `prisma/seed.js` creates `WS-PLATFORM` with `scopeType: 'PORTFOLIO'` and
`portfolioId` only — **no `tenantId`** — while the same Portfolio spans every
Tenant beneath it (TNT-001…004 in the seed). BR-001 makes `tenant_id` the
isolation scope, so authorizing a write there on the strength of portfolio-level
membership would place a write path *above* the boundary the entire scope chain
rests on. `classify()`'s mandatory scope bounds the damage to that Space — which
is precisely the Space that belongs to no tenant.

A fourth observation, not a ground but worth recording: `listProjects` filters
tenants via `where.workspace.tenantId`, which a portfolio-scoped Space can never
match. Rows written there are invisible to every tenant-scoped read and visible
to every unscoped one. Opening a write path into a half-visible region is not
something to do before the reads are settled.

### What would legitimately unlock it

Not this requirement, and not a looser predicate. It needs a **Space-level owner
authority** — exactly the separate assignment AC-067.5 describes — carried in the
viewer contract as a space- or portfolio-keyed grant, in the manner FR-061
changed the contract for per-Business domains. Only then does
`AUTHORIZERS` in `src/modules/project-manager/import/import-authorization.js`
gain an entry. Adding one ahead of the contract turns the refusal into a hole.

The collision above is what makes this easy to miss: FR-065 says "a Workspace
above Business" (schema `Workspace` = Space) and FR-067 says "Workspace"
(`Portfolio`). Same word, different levels, opposite directions of the scope
chain.

## Acceptance criteria

- **AC-067.1** An authorized owner can issue an invite bound to exactly one
  Workspace with an expiry and server-stored token hash.
- **AC-067.2** An invite can be accepted only once, by the intended or
  server-resolved Profile, and replay/expired/revoked tokens fail closed.
- **AC-067.3** Acceptance creates an audited WorkspaceMembership with a
  server-decided role and status.
- **AC-067.4** Workspace membership alone returns no hidden Business, Project,
  file, domain or Tenant data.
- **AC-067.5** Tenant/Business/Space/Project assignment is a separate audited
  mutation and requires the relevant owner authority.
- **AC-067.6** A Workspace Member cannot self-promote, invite outside the
  authorized Workspace, or edit another person's Tenant/Business Membership.
- **AC-067.7** Workspace membership removal or Profile/session revocation
  prevents the next protected read and does not rely on stale client state.
- **AC-067.8** All invitation and membership mutations preserve tenant
  isolation and append immutable AuditEvents.

## Owner surface — where the owner half actually happens

Until 2026-09-02 this feature shipped as three authenticated endpoints with no
caller: acceptance had a page, and mint/revoke/remove existed only as JSON. A
contract nobody can reach is not a delivered capability, so the owner controls
now live on **Workspace Home** (`src/app/(entry)/workspace-home/page.jsx`), where
ADR-027 §D5 already places membership and invitation state — not on a new route.

- **Reading the roster.** `GET /api/workspace-memberships?portfolioId=…` returns
  the ACTIVE members and still-PENDING invites of one Workspace. It carries no
  token material and takes the same owner authority as every mutation beside it,
  so a non-owner gets the identical 404 an absent Workspace produces (ADR-027
  §D9). Members and invites answer one request rather than two, so the two halves
  of one panel cannot disagree after a mutation.
- **Who sees the panel.** Derived from the server's own read model
  (`GET /api/onboarding/state`, where `role` is the person's WorkspaceMembership
  row), never from a client-held role string. This is the conservative subset:
  the service also accepts a Tenant owner under the Workspace
  (`viewer.ownedTenantIds`), which that read model does not expose, so such an
  owner currently sees no panel. Widening it means widening the server read
  model, not guessing in the client.
- **The token is handed over once.** The raw invite exists in the mint response
  and nowhere else, so the panel shows it once with a copy affordance, bound to
  the Workspace it was minted for, and offers no way to retrieve it later.
  Acceptance stays the Waiting Room's paste field — there is no accept-by-link
  route, and this added none.
- **Self-removal is the one action the client blocks.** The service permits it,
  and permits removing another OWNER (a co-owner handover is legitimate), but an
  owner who removes their own last membership loses the panel that would undo it.
  `isSelf` is marked by the server, which is the only side that knows the
  session principal.
- **Every refusal reaches the person.** Each mutation confirms first and renders
  the server's message; the translation keeps the original text inside it, since
  a friendly sentence that hides which refusal occurred says almost as little as
  silence.

The decisions above are pure functions in
`src/modules/identity/workspace-collaboration-view.js`, tested in
`tests/unit/workspace-collaboration-view.test.js` — this repository has no React
rendering harness, so logic that lives in JSX cannot be proven at all.

## Non-goals

- using Workspace membership as a replacement for Business authorization;
- automatically assigning every invited person to every Business;
- external OAuth/OIDC/password provider selection;
- implementing a second ProjectMember persistence model in this slice.

