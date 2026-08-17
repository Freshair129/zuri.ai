---
domain: project-manager
feature: FR-065
module: project-manager
source: v2-native
---

# Import Target Authorization — who may write into the Workspace a plan names

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Implemented (FR-065) |
| **Author** | Claude |
| **Created** | 2026-08-17 |
| **Last Updated** | 2026-08-17 |

> Declared ahead of code deliberately. This requirement exists because the fix it
> describes was **not** made during the PM review that found the hole — the
> Business half was decidable, the half above Business was not, and shipping a
> guess for the second half at the end of a long security change is how a fix
> becomes the next incident. Writing the id first is what makes "we chose not to
> guess" a recorded decision rather than an omission someone later mistakes for
> an oversight.

> **Implemented 2026-08-17.** `src/modules/project-manager/import/import-authorization.js`
> holds the decision; `plan-import-service.js` calls it from `resolveAuthorizedTarget`,
> before the plan is parsed. All three routes resolve a viewer and have left
> `docs/.route-viewer-baseline.json` (26 → 23). Pinned by
> `tests/unit/import-authorization.test.js` (the decision) and
> `tests/integration/import-target-authorization.test.js` (the pipeline).
>
> One thing implementation clarified that the declaration only implied: the target
> can arrive as an explicit `workspaceId` **or** as the plan's own
> `scope.workspaceCode`. A guard placed in the route handlers would have covered
> only the first and left the second wide open — the same "checked in one
> representation, used in another" shape as every other defect this review found.
> That is the concrete reason SDD-037 puts the check in the pipeline rather than
> at the three call sites, and there is a test for the plan-supplied path
> specifically.

## The state this requirement addresses

`/api/import/dry-run`, `/api/import/commit` and `/api/import/xlsx` take
`workspaceId` from the request body and resolve **no viewer at all**. They are
the last mutating surfaces in the repository that do; all three sit in
`docs/.route-viewer-baseline.json`.

What that is, and what it is not:

- It **is** "choose a Workspace you were not given". The body names the target;
  nothing checks that the caller is entitled to it.
- It is **no longer** "overwrite any tenant's work". The structural fix in the
  same review made `classify()` require a mandatory `scope`, so a plan can only
  match rows *inside* the resolved Workspace. The blast radius is now bounded to
  the chosen target rather than reaching arbitrary rows by globally-unique code.

The dry run matters as much as the commit. It is read-only, which is exactly why
it is easy to leave unguarded — and an unguarded preview of another scope's
contents is a read leak that a commit-only guard would happily preserve.

## Clause (a) — Business-scoped: decided, using the predicate that already exists

Import is a write. Every other write path in this domain authorizes a write with
`ownsBusiness(viewer, businessId)`. So a Business-scoped Workspace requires
`ownsBusiness(viewer, workspace.businessId)` — the same function, not a fourth
reading of the same idea.

That "not a fourth reading" is the whole point. This repository's most repeated
defect is *a rule enforced at one level and absent at the level below, or a value
checked in one representation and used in another* — eight instances in three
days, of which three were the specific belief that a global `role === 'OWNER'`
label answers a per-Business question. `viewer-authority.js` exists so the
question has exactly one implementation; import calls it rather than growing a
fifth.

## Clause (b) — above Business: refused, and refused on evidence

A Workspace can be `PORTFOLIO` or `TENANT` scoped. `WS-PLATFORM` in the seed is
one, so this is a live path, not a theoretical one. `ownsBusiness` cannot answer
for it — there is no Business to own.

The tempting move is to invent a rule here ("tenant owners may", "portfolio
admins may"). Checking first showed why that would have been fiction:

| Claim | How it was checked | Result |
|---|---|---|
| A portfolio-scoped Workspace exists and is used | `prisma/seed.js` | Yes — `WS-PLATFORM`, `scopeType: 'PORTFOLIO'` |
| Some principal can hold authority above Business | every `Membership` create in the repository | **No** — Membership is created in exactly two places and both set `businessId` |
| The viewer could express such authority | the `resolveViewer` contract | **No** — the only grant fields are `visibleBusinessIds`, `ownedBusinessIds`, `domainsByBusinessId`, all keyed by Business |

So the schema has a slot for authority above Business and **nothing fills it**.
Any rule written for it today would be untestable — there is no principal that
could satisfy it and none that could be denied by it, so the test would assert
the behaviour of an empty set.

The requirement therefore **refuses**, with a reason that says so: not "you are
not permitted", which implies someone else would be, but "no authority above
Business is declared". A refusal that names the missing thing is a signpost to
the next requirement. A silent denial is a bug report waiting to be filed.

**The exit is a prior FR, not a flag.** Making portfolio/tenant import work means
first making that authority *holdable* — a viewer-contract change of exactly the
shape FR-061 was, where the answer moved from a global field to a scoped one.
Ordering matters: authority must be expressible before anything can check it.

## Design consequences (SDD-037)

**One decision point, in the pipeline that resolves the target.** The Workspace
is resolved inside `plan-import-service`, so that is where it is authorized —
`authorizeImportTarget(viewer, workspace)`. Three route handlers each doing their
own check is three copies that drift; the review that produced this FR found the
`ownsBusiness` idea written out longhand in three separate services, which is
what made two of them wrong.

**The viewer is a required argument, not an optional one.** Omitting it throws at
the call site, the same way `classify()` now throws when a caller omits `scope`.
The reason is stated plainly in the prevention section of that review: *a guard
belongs where the thing it guards is constructed, not at every place the
construction is used.* If a fourth intake surface is added later, the failure
mode for forgetting authorization must be a loud crash at wiring time, not a
quiet write.

**Authorize before validate.** The target is checked before the plan is parsed,
so an unauthorized caller learns nothing about the plan or the target's
contents — not even whether their envelope was well-formed.

**The baseline shrinks.** All three routes leave
`docs/.route-viewer-baseline.json` when this lands. Editing that file to
accommodate an unguarded route is the one move the ratchet exists to prevent.

## The premise has an expiry date — FR-067

Clause (b) refuses, and SDD-037 now justifies that refusal in **two tenses**. The
first was verified rather than assumed — *no principal can hold authority above
Business at all* — and it is true only until **FR-067** (Workspace invitation and
scoped membership, design-approved 2026-08-17) ships, because FR-067 is designed
to make exactly that authority holdable. It is the "prior FR of the FR-061 shape"
this requirement named as its own exit.

**Resolved 2026-08-17 — clause (b) does not change.** The question that was left
open (may a WorkspaceMembership on Portfolio *P* import into a Space whose
`scopeType` is `PORTFOLIO` and whose `portfolioId` is *P*?) is answered **no**,
and answered from FR-067's own acceptance criteria rather than invented:
AC-067.5 makes Space assignment a separate audited mutation requiring the
relevant owner authority, so membership on the container does not reach a Space
inside it; AC-067.4 denies membership even the *read* of Project data that an
import would *create*. Verified alongside it: a portfolio-scoped Space carries no
`tenantId` at all (`prisma/seed.js` WS-PLATFORM), so it sits above the BR-001
isolation boundary that the whole scope chain rests on. Full reasoning in
FR-067's "Decision" section.

So the behaviour here is unchanged and the sequence is the intended one. What
changes is only the **reason** printed in SDD-037, which has been amended into
two tenses — the pre-FR-067 premise ("no such authority can be held") is true
today and expires on the day FR-067 ships, replaced by the stronger one ("the
authority exists and does not extend to writing a Space"). That amendment is the
whole point: an argument resting on a verified fact must say when the fact stops
being true, or the next reader finds a false premise and discounts the entire
requirement.

When FR-067 lands:

- **Swap SDD-037's justification to its second tense; change no code.** The
  pre-FR-067 argument was "no rule here could be tested, because nothing could
  satisfy or be denied by it". From that day it is "the authority exists as
  collaboration scope and AC-067.5 keeps Space assignment separate". The guard,
  the tests and the refusal message all stay as they are.
- **Decide it through the viewer contract, not by relaxing
  `authorizeImportTarget`.** Adding a `PORTFOLIO` entry to `AUTHORIZERS` is
  correct only once the viewer actually carries a portfolio-keyed grant;
  loosening the predicate ahead of the contract is how the refusal becomes a
  hole.
- **Mind the word.** FR-065 says "a Workspace above Business", meaning the schema
  `Workspace` model (displayed as **Space**). FR-067 says "Workspace", meaning
  the top-level container keyed by `portfolioId`. Same word, two levels of the
  scope chain — see FR-067's "Which Workspace" section.

## Related

- [[FR-012]] — the PlanEnvelope pipeline this authorizes
- [[FR-061]] — the precedent: authority that must be *holdable* before it is checkable
- [[FR-062]] — read scope derived from the field the write authorizes on
- [[FR-067]] — creates the authority class clause (b) refuses for; read together
- `.brain/reviews/pm-triage-2026-08-17.md` — where this was deferred, and why
