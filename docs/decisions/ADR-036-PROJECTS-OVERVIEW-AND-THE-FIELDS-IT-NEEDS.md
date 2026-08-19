---
version: "0.1.0b"
created_at: "2026-08-19T12:10:00+07:00,CLAUDE"
last_update: "2026-08-19T12:10:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "the Development Projects surface becomes a domain overview, and the three fields it asks for that the model does not have"
---

# ADR-036 — Projects Overview, and the fields it asks for that do not exist

**Status:** Proposed — design only. No implementation is authorized by this
document.

**Relates to:** FR-086, FR-087, FR-088, FEAT-008, SDD-047 · existing: FR-001,
FR-003, FR-005, FR-036, FR-041, FR-060, FR-077, NFR-008, SDD-045 · ADR-008,
ADR-034

## Context

`/projects` today is a plain resource list: Code, Project, Space, Streams,
Status, Target, and row actions. The request is to make it a **domain overview** —
a band of counts above an enriched list — so that opening Development answers
"how are we doing" before "which projects exist".

Six of the requested columns and three of the requested counts are already
derivable. **Four of the asks are not**, and that is the substance of this
decision. Building the page without settling them would mean inventing data at
the view layer, which is how a number nobody can reproduce ends up on a
dashboard.

| Ask | State of the model |
|---|---|
| Projects: total / ACTIVE / done | ✅ `Project.status` over `PROJECT_STATUSES` |
| Tasks: total / in progress / done | ✅ `WorkItem.status` over `WORK_STATUSES` |
| Code · Name · Space · Streams · Status · Target | ✅ already on the row |
| Progress bar | ✅ pure calculators, `/api/progress/project/{id}` |
| Headcount on projects | 🟡 derivable, but not the way it was asked |
| **Project size** | ❌ no field, and no agreed definition |
| **Priority** (and "Top 5 Priority") | ❌ no field |
| **PIC** | ❌ no accountable owner on `Project` |
| **Team count** | ❌ **there is no Team model in this product** |

## Decision

### D1 — The page becomes an overview; the route keeps its name

`/projects` gains a KPI band and an enriched list. The path does not change —
route keys are keys (AGENTS.md §18), and every inbound link, the domain
registry, the command palette and the route guard resolve on it.

**The heading is a real conflict and this ADR does not pretend otherwise.**
"Overview" already means something in this product: `/overview` is Business
Home's Dashboard, the cross-domain surface FR-060 deliberately moved Development
*off*. Naming this page "Overview" gives the product two Overviews, one
cross-domain and one inside Development, and the FR-060 reasoning — "one page
answering to two domains is how the two surfaces drift apart" — applies to the
word just as it applied to the route.

Three options, and a recommendation rather than a silent choice:

| Option | Reads as | Cost |
|---|---|---|
| **A — "Overview"** | what was asked for | two things named Overview; `domain-navigation.test.js` asserts Development's entries do **not** contain "Overview", so the decision is pinned as a test and reversing it is a deliberate act |
| **B — "Dashboard"** *(recommended)* | matches every other domain, whose first sidebar entry is already "Dashboard" — a pattern preflight-adjacent tests already assert for non-Development domains | the word "Dashboard" is not yet used inside Development, so nothing collides |
| C — keep "Projects" | the list is still the bulk of the page | does not signal the change |

**Decided 2026-08-19: B — "Dashboard".** Development's first sidebar entry
becomes `Dashboard → /projects`, which is the shape every peer domain already
has, and leaves "Overview" meaning exactly one thing in this product. FR-060's
separation survives intact: `/overview` stays Business Home's cross-domain
Dashboard, and Development's is its own, at its own route.

### D2 — "Project size" is derived, and its definition is written down

No field is added. **Size is the count of non-deleted `WorkItem` rows under the
Project**, across all its workstreams.

The definition is stated in the requirement rather than left to the view, because
"size" is exactly the kind of word that means three things to four people. Effort
hours were the alternative and are rejected for now: `WorkItem` carries `weight`
and `numericValue`, neither of which is an hour, so an effort-based size would be
a number the data cannot honestly produce.

### D3 — Priority is a first-class field, not a derivation

"Top 5 Priority Projects" cannot be computed from anything currently stored.
Ordering by `targetAt` would be a deadline list, not a priority list, and
presenting one as the other is worse than not shipping the panel.

So `Project.priority` is added as a string enum with its values in
`src/lib/validation/enums.js` — the single source of truth every dropdown,
OpenAPI document and validator derives from, never hand-copied. It is nullable at
rest for the same reason every additive column here is: rows exist already.

**Consequence to accept knowingly:** until priorities are set, "Top 5 Priority"
has no honest content. The panel therefore renders an empty state that says so
and offers the action that fixes it, rather than silently falling back to an
ordering the user would read as priority.

### D4 — PIC is one accountable Person, and it is not the same as the team

`Project` gains a single nullable accountable owner referencing `Person`.

The distinction matters because the product already has something adjacent:
`FR-036` project Team, which resolves to the `Membership` rows scoped to the
project's Business, and `WorkItem.assigneeRef`, which already holds a `personId`.
Neither is a PIC:

- Team membership says *who may work here*, not *who answers for it*.
- An item assignee says *who does this piece*, not *who owns the whole*.

One accountable name is a different fact from either, so it gets its own field
rather than being inferred from the busiest assignee — an inference that would
change whenever work moved.

### D5 — "Number of teams" is refused as asked, because there is no Team

There is no `Team` model in `prisma/schema.prisma`. Not a thin one, not a
disguised one. `listProjectTeam` returns Business-scoped `Membership` rows, so
"the team of a project" is currently "everyone in the Business that owns it" —
which means a count of teams would either be a count of Businesses, or a count of
one.

Rather than ship a number that is technically produced and semantically empty,
this ADR named three options:

1. **Count people, not teams** — distinct `WorkItem.assigneeRef` across the
   in-scope Projects. The honest half of the ask that the data already supports.
2. **Read Workstream as the team lane** — closest existing thing, but the list
   already shows it as `Streams`, so it would be one number printed twice.
3. **Add a real `Team`** — its own model, ownership and authorization surface.

**Decided 2026-08-19: option 3.** `Team` becomes a real entity, specified by
FR-089 and ADR-037. It is a large enough addition to deserve its own decision
record, and the security question it raises — a Team must never become a second
source of authority — is not one to settle in a footnote here.

The overview therefore ships **both** numbers, and labels each for what it counts:
the headcount from option 1 (people actually assigned work) and the team count
from FR-089. They answer different questions and neither substitutes for the
other.

### D6 — One request, not one per row

A progress bar per row means calling `/api/progress/project/{id}` once per
project, which is an N+1 across the page's main content.

`GET /api/projects/overview` returns one composed read model: the counts and the
rows, progress included, in a single response (SDD-047). It follows SDD-045's
discipline exactly — authorize the scope before composing, use the pure
calculators, never mutate `progressCache` on read, and keep the existing
`/api/projects` list contract untouched so its consumers do not move.

## Consequences

- Two additive nullable columns on `Project` (`priority`, accountable owner),
  both inside the `project-manager` charter's ownership. No new aggregate.
- One new read route. `/api/projects` is unchanged: the incident in
  `.brain/rca/2026-08-18-project-list-envelope-broke-relation-consumers.md` is
  what a change there costs.
- The topbar loses its "New Project" button. The page already has one, so today
  the same action exists twice; after this it exists once, on the surface it
  belongs to.
- `PROJECT_STATUSES` has five values and the ask names three. `ON_HOLD` and
  `ARCHIVED` do not vanish because the KPI band ignores them — the band shows
  what was asked plus an explicit account of the remainder, so the numbers add up
  to the list beneath them. A dashboard whose parts do not sum to its whole is
  the fastest way to lose a reader's trust in all of it.

## Sequencing

1. **FR-087 / FR-088** — the two fields, with their enum and their editing path.
   Without them the overview has two dead columns.
2. **SDD-047 / FR-086** — the read model, then the surface.

Shipping FR-086 first would put "Priority" and "PIC" headers above empty columns
for a release, teaching users the page is unreliable before it is finished.
