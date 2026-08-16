---
domain: identity
feature: FR-061
module: identity
source: v2-native
---

# FR-061: Per-Business domain visibility

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Implemented |
| **Date** | 2026-08-17 |
| **Relates to** | FR-031 (viewer gate), FR-038 (permissions), SDD-017, SDD-034, SEC-008 |
| **Incident** | [.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md](../../../../.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md) — instance 3 |

## Why this is an FR and not a bug fix

Instances 1 and 2 of that incident were guard swaps: the correct answer already
existed on the viewer (`ownedBusinessIds`), and the fix was to make the call
sites ask for it. Instance 3 has no correct answer to swap to.

```js
function visibleDomainsForMemberships(memberships) {
  if (memberships.some((m) => m.role === 'OWNER')) return VIEWER_DOMAINS
  ...
}
```

`visibleDomains` is a **flat array on the principal**, while the grant it
represents is **per Membership**, and Membership is per Business. A flat field
cannot express "all domains in A, only `people` in B" — so no rewrite of this
function is correct while its return type stays `string[]`. Changing the type is
a change to the viewer contract, which is this domain's public contract
(`docs/domains/identity/CHARTER.md`), consumed by `DomainBar`,
`business-shell-guard.js` and `entry-read-model.js`. That is a behaviour change
with a contract change, which is what an FR is for.

Confirmed against real data with the real resolver before any of this was
written:

| principal | `ownedBusinessIds` has B | `visibleDomains` |
|---|---|---|
| OWNER of A + MEMBER of B (`domainKeysJson: ["people"]` on B) | `false` | **all 7 domains** |
| control: MEMBER of B only, identical allow-list | — | `["people"]` |

## Decision 1 — the map is additive, the flat field is redefined, not removed

The viewer gains:

```js
domainsByBusinessId: { [businessId]: string[] }   // absent or [] denies
```

`visibleDomains` stays, because `GET /api/entry` publishes it under a strict Zod
contract (FR-046) and removing it is a breaking change to a surface that has no
Business selected yet. Its **meaning** is pinned instead: it is the union across
visible Businesses, answering "may this principal see this domain *anywhere*".
That question has exactly one legitimate consumer shape — a surface with no
Business in hand — and it is never an authorization input for a Business-scoped
decision.

The union is not itself the leak. For the attacker shape above, the union really
is all seven domains, and that is the honest answer to the question it now asks.
The leak was reading the union as the answer to a different question.

## Decision 2 — every branch fills the map; there is no "sees everything" flag

Platform DEV and the local-development fallback are legitimately unrestricted,
so a flag (`allDomainsEverywhere: true`) would be a truthful and much smaller
encoding. It is rejected anyway: the moment a shortcut exists, a consumer will
read the shortcut instead of asking the per-Business question, and this incident
is a record of exactly that happening three times with `role === 'OWNER'`.

One rule, one field, no branch in the reader. Both of those branches already
materialise every Business into `visibleBusinessIds`, so the map is the same
order of magnitude as a value the viewer already carries.

Cost is O(visible Businesses × domains). Accepted at current scale and recorded
in SDD-034; the exit, if it stops being acceptable, is a Business-scoped
resolution (`resolveViewer({ businessId })`) — not a flag.

## Decision 3 — `domainsForBusiness` fails closed, with one narrow legacy seam

```js
domainsForBusiness(viewer, businessId) // → string[]
```

- Unknown or missing `businessId`, or a Business absent from the map → `[]`.
  In `business-shell-guard` the Business has already been checked against
  `visibleBusinessIds` before the domain question is asked, so `[]` here means a
  genuinely ungranted Business.
- A viewer object with **no map at all** falls back to `visibleDomains`. This is
  the old-fixture seam that `isDomainVisible` already documents, and it can only
  be reached by a hand-built viewer — every `resolveViewer` branch emits the map.
  The fixture-realism gate (`docs/.viewer-fixture-baseline.json`) is what keeps
  that seam from quietly becoming the normal path again.

`business-home` stays `alwaysVisible` (FR-060): a MEMBER granted only `projects`
must still land somewhere after choosing a Business. `isDomainVisible` keeps
that rule, so it is honoured identically by the bar and the guard whichever
allow-list is passed in.

## Decision 4 — "not loaded yet" is not a denial

Found by running it, not by reading it. The first implementation had `DomainBar`
call `domainsForBusiness(viewer.data, businessId)` unconditionally. While
`/api/viewer` was in flight `viewer.data` is `undefined`, the helper correctly
failed closed, and the bar collapsed to Business Home for several seconds —
every click had to wait the fetch out. It turned an e2e navigation into a 10s
timeout, and a diagnostic run reported `DEVELOPMENT LINKS 0`.

The helper is right to fail closed; the caller was wrong to ask early. The bar
asks only once it has a viewer and stays unfiltered until then, which is exactly
what it did before FR-061. The bar is chrome — the guard is what denies, and it
does not render children until the viewer has resolved.

Worth keeping as a general point: a fail-closed default is a property of the
*answer*, not of the *question being asked at the wrong time*. Pushing the
"unknown" case into the caller is what keeps the two from being confused.

## Out of scope

- The global `role` label is not removed. It is a per-principal label and stays
  one; FR-059 and FR-038 already moved every authority decision off it.
- `Membership.domainKeysJson` on an OWNER Membership is still ignored — an OWNER
  derives all domains from the role, now per Membership (SDD-017 as refined).
  Making an OWNER's own allow-list meaningful would be a separate FR.
- No change to `/api/entry`'s response shape.
