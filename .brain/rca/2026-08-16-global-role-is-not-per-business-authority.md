---
version: "0.1.0b"
created_at: "2026-08-16T23:45:00+07:00,CLAUDE"
last_update: "2026-08-16T23:45:00+07:00,CLAUDE"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security"
  doc_type: "root-cause-analysis"
  scope: "a global role label used as if it were per-scope authority — three instances"
---

# Incident — a global role label read as per-Business authority

## Summary

`resolveViewer` returns `role: 'OWNER'` when the principal owns **any** Business
anywhere. Three separate call sites treated that label as authority over a
*specific* Business. Two were exploitable, one over-granted UI visibility. All
three are the same defect, and fixing the first one did not fix the others.

## Root cause

```js
// src/modules/identity/resolve-viewer.js
role: memberships.some((m) => m.role === 'OWNER') ? 'OWNER' : 'MEMBER',
```

`role` answers *"is this person an owner of something?"* Every consumer read it
as *"may this person act as owner **here**?"* Those are different questions, and
nothing in the type or the name distinguishes them.

The second-order problem is what made it survive review: the obvious repair —
"also check `visibleBusinessIds`" — **does not compose**, because a plain MEMBER
membership already puts a Business into `visibleBusinessIds`. Two guards that
each look like a scope check, ANDed together, still admit the attacker.

```
person: OWNER of Business A, MEMBER of Business B
  role === 'OWNER'                        → true   (from A)
  visibleBusinessIds.includes(B)          → true   (from the MEMBER row on B)
  ⇒ both guards pass for a Business they do not own
```

## Instance 1 — FR-059 Business Strategy writes (fixed)

The initial fix for a cross-tenant hole added `assertBusinessVisible`. It closed
the outer door only. An adversarial gate reproduced the inner one against the
live database, using the real resolver and the real service: all six strategy
mutations succeeded against Business B.

**Fix.** Added `ownedBusinessIds: string[]` to the viewer — additive, present in
all three `resolveViewer` branches, `⊆ visibleBusinessIds`, `[]` for platform
DEV, all businesses for the local-development branch. `assertBusinessOwned`
replaced `assertBusinessVisible` on all six mutations and fails closed on a
non-array. The Overview UI's `isOwner` moved to
`ownedBusinessIds.includes(businessId)`.

Because the viewer shape belongs to `identity` and the mutation service to
`project-manager`, the work was **split into two tasks with a contract between
them** rather than letting one agent cross lanes — the first live exercise of
[ADR-026](../../docs/decisions/ADR-026-AGENT-TOPOLOGY-FOR-THE-VISUAL-OFFICE.md) D6.

## Instance 2 — FR-038 permission writes (fixed)

Closing instance 1 revealed a side door into the same room. `ownerViewer` in
`profile-permission-service.js` used the identical pair, so the same principal
could **promote themselves to OWNER of Business B** — after which
`resolveViewer` legitimately handed them B in `ownedBusinessIds`, restoring the
authority instance 1 had just removed.

Probe output, before the fix:

```
FR-038 self-promotion            → {"allowed":true,"newRole":"OWNER"}
membership role in B afterwards  → OWNER
ownedBusinessIds now includes B  → true
```

**Fix.** `assertMembershipBusinessOwned(membership.businessId, viewer)`, same
fail-closed shape. The global `role` check is retained only as a coarse
pre-filter and is documented as insufficient alone.

Side effect, judged correct: tenant-wide Memberships (`businessId: null`) can no
longer be edited at all, because `null` is never in `ownedBusinessIds`. This
removes no working capability — no code path in the repository creates a
tenant-wide Membership — and the previous behaviour was *worse* than the hole
being closed, since the old check short-circuited on `null` and let any global
OWNER edit such rows **in unrelated tenants**.

## Instance 3 — domain visibility (fixed 2026-08-17, FR-061)

```js
function visibleDomainsForMemberships(memberships) {
  if (memberships.some((m) => m.role === 'OWNER')) return VIEWER_DOMAINS
  ...
}
```

Verified against real data with the real resolver:

| principal | `ownedBusinessIds` has B | `visibleDomains` |
|---|---|---|
| OWNER of A + MEMBER of B (`domainKeysJson: ["people"]` on B) | `false` | **all 7 domains** |
| control: MEMBER of B only, identical allow-list | — | `["people"]` |

The same person, holding an identical MEMBER membership on B, sees seven domains
instead of one purely because they own an unrelated Business A. The OWNER
membership's own `domainKeysJson: ["projects"]` is ignored too.

**This one cannot be fixed the same way**, and that is the important finding.
`visibleDomains` is a **flat array** on the viewer, but the underlying grant is
per-membership (`Membership.domainKeysJson` is per-Business). A flat field
cannot express the correct answer, so this is not a guard swap — it is a viewer
contract change, consumed by `DomainBar`, `business-shell-guard.js` and
`entry-read-model.js`. Per the FR-first rule it needs its FR declared before any
code.

**Fix** ([FR-061](../../docs/domains/identity/features/FR-061-per-business-domain-visibility.md),
declared first, in its own commit). The viewer gained
`domainsByBusinessId`, built from the same Membership rows and the same
tenant-wide expansion as `visibleBusinessIds`/`ownedBusinessIds`, so OWNER-ness
applies **per Membership**. `domainsForBusiness(viewer, businessId)` is now the
only sanctioned way to ask, it fails closed, and both consumers ask it.

`visibleDomains` was kept and its meaning pinned — the union across visible
Businesses, "may this principal see this domain *anywhere*". That distinction is
the actual lesson of all three instances: none of these fields was wrong, each
answered a question no consumer was asking.

Also rejected on purpose: a `allDomainsEverywhere: true` flag for the platform
DEV and local-development branches. It would have been truthful and much
smaller. But this document is a record of a shortcut being read in place of the
scoped question three separate times, so those branches fill the same map as
everyone else and there is nothing else to read.

## Why review caught this and tests did not

Every test in the affected suites constructed viewer literals by hand — shapes
`resolveViewer` cannot actually produce. The FR-059 tests carried
`visibleBusinessIds` with no `ownedBusinessIds` field at all, so the hole was
invisible from inside the suite. The gate found it by **enumerating every
Business-scoped service in the repo** and noticing this was the only one
skipping the visibility discipline, then proving it against the live database.

## Prevention

1. **A test fixture for an authorization check must be a shape the resolver can
   really emit.** A hand-built viewer proves the guard runs; it does not prove
   the guard is right. Where practical, build the fixture *through* the resolver.
2. **Prove the red state.** Both fixes here were accepted only after a control
   demonstrated the write succeeding under the pre-fix predicate. The first
   round's tests looked correct and proved nothing.
3. **Two guards are not two layers if their inputs overlap.** State the
   independence assumption explicitly, or collapse them into one check whose
   name says what it decides — `assertBusinessOwned`, not `requireOwner` plus a
   visibility call several lines away.
4. **Name the label, not the authority.** `role` should never be spelled the same
   as the permission it does not grant.
