---
version: "0.1.0b"
created_at: "2026-08-19T12:40:00+07:00,CLAUDE"
last_update: "2026-08-19T12:40:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "the Team entity — what it is, what it must never become, and how it relates to Membership and Project"
---

# ADR-037 — Team is an organisational grouping, never an authority

**Status:** Proposed — design only. No implementation is authorized by this
document.

**Relates to:** FR-089, FR-086, FEAT-008, ADR-036 (D5) · existing: FR-036,
FR-042, FR-072, FR-073, SEC-001, SEC-003, SEC-008, BR-016 · ADR-011, ADR-014

## Context

ADR-036 D5 found that this product has no `Team`. "The team of a project"
currently resolves, through `listProjectTeam`, to the `Membership` rows scoped to
the project's Business — which is to say *everyone in the Business*. The Projects
Dashboard was asked for a team count and there was nothing to count.

The decision taken on ADR-036 D5 is to add a real one.

## The danger this ADR exists to name

`Membership` is not a directory. It is the **authority record**:

```prisma
model Membership {
  personId       String
  tenantId       String
  businessId     String?
  role           String   @default("OWNER")
  domainKeysJson String   @default("[]")
}
```

`resolveViewer` builds `ownedBusinessIds` from OWNER memberships, and
`domainKeysJson` is the per-Business domain grant that `DomainBar`,
`BusinessShellGuard` and the command palette all read. This is exactly why
`src/app/api/projects/[id]/team/route.js` carries the comment it does: those
handlers resolved no viewer until 2026-08-17, and because `addProjectTeamMember`
took `role` from the request body and wrote a `Membership`, **a single
unauthenticated POST minted business-owner authority over any Business that owned
a project.**

A new grouping called "Team", added carelessly next to that, is the same
incident waiting to be rewritten. If a Team can grant anything, then "add someone
to a team" becomes a privilege escalation with a friendly name.

## Decision

### D1 — Team is an organisational grouping and grants nothing

`Team` records *who works together*. It never appears in any authorization
decision:

- `resolveViewer` does not read it.
- No route guard consults it.
- Adding a Person to a Team changes no `role`, no `domainKeysJson`, and no
  visible or owned Business.
- A Person who is in a Team but has no `Membership` sees exactly what they saw
  before: nothing.

Stated as a rule so it can be enforced rather than remembered: **BR-018 — Team
membership is never an input to an authorization decision.** A test asserts the
identity resolver's source files do not reference the Team models at all, because
"nobody consults it" is only true while nobody consults it.

### D2 — Team is Business-scoped

A `Team` belongs to one `Business`, the same scope `Project` and `Membership`
already use for isolation (SEC-001). Tenant-level teams are not modelled: the
Business is the operating unit in this product's scope chain, and a team that
spans Businesses would be a grouping whose members cannot all see the same
Projects, which is a grouping that cannot act.

### D3 — Team ↔ Project is many-to-many; Team ↔ Person is its own membership

Two link models, for two reasons that are not the same reason:

- `ProjectTeam` — a Project may be worked by several Teams and a Team works
  several Projects. Modelling it as one Team per Project would force a fake
  "primary team" the moment two teams share an initiative, which is the normal
  case rather than the exception.
- `TeamMembership` — Person ↔ Team, deliberately **separate from `Membership`**.
  Same discipline BR-016 already applies to `WorkspaceMembership`: distinct
  authority layers, and a lower one never widens a higher one. Reusing
  `Membership` with a `teamId` column would put grouping and authority in one
  row, and the first person to write "membership" in a query would get whichever
  meaning the schema happened to hand them.

### D4 — A Team does not own work, and does not replace the assignee

`WorkItem.assigneeRef` stays a `personId`. Work is done by people; a team is who
they sit with. Introducing team-assigned work would mean a work item with no
answerable name, and the product already has one accountable-owner concept in
flight (FR-088 PIC) without adding a second, vaguer one.

This also keeps ADR-036's two counts genuinely different: headcount is *people
with work assigned*, team count is *teams attached to Projects*. Neither is
derivable from the other, which is why the Dashboard shows both.

### D5 — `listProjectTeam` keeps its name and its meaning, for now

FR-036's "project Team" tab predates this entity and means "people in the
Business who may work here". Renaming it in the same change that introduces a
different Team would leave two things called Team during the transition, in a
codebase where the word is about to become load-bearing.

So: FR-089 adds the entity; the FR-036 surface is untouched by it; and the
reconciliation of the two — whether the Team tab should show real Teams — is
deliberately deferred and written down here so it is a decision someone takes
rather than a mess someone finds.

## Consequences

- Three additive models (`Team`, `TeamMembership`, `ProjectTeam`), all claimed by
  the `project-manager` charter, all Business-scoped.
- One new business rule (BR-018) with a test that reads the identity module's
  sources, because a negative invariant is only worth stating if something checks
  it.
- The Projects Dashboard can count teams honestly.
- Cost accepted: for a while the product has *two* things a user might call the
  team of a project. D5 makes that explicit rather than incidental.

## Alternatives rejected

**Add `teamId` to `Membership`.** Rejected in D3 — it merges the authority record
with the directory, and the 2026-08-17 incident is what that merge costs when
someone writes to it.

**Derive Team from `Workstream`.** Rejected in ADR-036 D5 — the Dashboard already
shows workstreams as `Streams`, so it would print one number under two headings.

**Let Team carry a role.** Rejected in D1. A role on a Team is authority on a
Team, and D1 exists precisely to keep those apart.
