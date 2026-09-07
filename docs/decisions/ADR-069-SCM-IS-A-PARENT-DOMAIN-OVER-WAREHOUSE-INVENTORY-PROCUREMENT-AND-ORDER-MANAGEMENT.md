---
version: "1.0.0"
created_at: "2026-09-07T11:30:00+07:00,Claude Opus 5"
last_update: "2026-09-07T11:30:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "inventory"
  doc_type: "architecture-decision"
  scope: "the owner's ERP row Supply Chain Management as one slot in the domain bar over Warehouse, Inventory, Procurement and Order Management — a navigation and grouping decision that changes no domain key, no model and no route"
---

# ADR-069 — SCM is a parent domain over Warehouse, Inventory, Procurement and Order Management

**Status:** Accepted. Implemented by FR-167 in the same change.
**Date:** 2026-09-07
**Decided by:** Boss (instruction of 2026-09-07: "ตอนนี้ Warehouse มันเป็นโดเมนมันก็ผิดอะดิ มันต้องให้ SCM
เป็นโดเมน แล้วมันเป็นซับโดเมน — SCM: Warehouse, Inventory, Procurement, Order Management", then "ทำ SCM
ต่อเลย"), after choosing the nested reading over a menu-only grouping and over merging the keys.
**Relates to:** [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[ADR-065](ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md),
[ADR-066](ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md),
ADR-011, ADR-013, ADR-036 (D1), ADR-039, FR-061, FR-077, FR-154, FR-164, FR-166,
FR-167, SEC-001, SDD-018, `docs/ERP-MODULE-MAP.md`, `docs/INTERFACE-INVENTORY.md`.

## Context

The owner named the ERP row on 2026-09-07: *Supply Chain Management (SCM) —
Warehouse, Inventory, Procurement, Order Management*. `docs/ERP-MODULE-MAP.md`
records it, and three of those four modules are built. But the navigation
registry (`apps/server/src/config/domains.js`) presents them as **peers**:

| Registry entry today | Label in the domain bar | Pages |
|---|---|---|
| `inventory` | Warehouse | `/inventory` |
| `procurement` | Procurement | `/procurement`, `/procurement/purchase-orders` |
| `commerce` | Commerce | `/commerce`, `/commerce/orders` |

So a bar that is meant to read as one supply chain reads as three unrelated
capabilities, and the row the owner asked for is visible only in a document.
The owner put it plainly: *"Warehouse มันเป็นโดเมนมันก็ผิด มันต้องให้ SCM เป็นโดเมน
แล้วมันเป็นซับโดเมน"*.

Two facts constrain the fix.

**A domain key is not a label.** `profile-permission-service.js` and
`platform-users-view.js` validate member grants against the registry's keys and
store them per member as `domainKeysJson`; FR-061 gates every Business-scoped
read on them. Collapsing `inventory`, `procurement` and `commerce` into one
`scm` key would renumber a key — the thing AGENTS.md §18 forbids — and would
need a data migration of every member's stored permissions to avoid silently
widening or revoking access.

**The registry is two tiers deep.** Tier 2 is the domain bar; Tier 3 is that
domain's sub-domains in the left sidebar. There is no place for a parent above
Tier 2, which is exactly the shape the owner is asking for.

## Decision

**D1 — SCM is a real slot in the navigation, expressed as a derived tree over
the flat registry.** `DOMAINS` stays exactly what it is: the flat, authoritative
list of domain keys, base paths and sub-domain paths that forty-odd consumers
already walk — the permission resolver (`VIEWER_DOMAINS = DOMAINS.map(d =>
d.key)`), the route inventory, the warm-up list, the palette index. Beside it,
`DOMAIN_GROUPS` states the presentation shape: one group, `scm`, naming its
children **by key**. Two derivations read it — `domainBarSlots()` for the bar
and `sidebarDomainForPath()` for the sidebar — so the group holds no copy of a
domain and the two cannot drift. A test pins that every child key is a real
domain and that no child also stands on its own in the bar.

The rejected alternative was to nest `DOMAINS` itself. It reads better in the
file and worse everywhere else: every consumer that walks one level would need
to walk two, and the ones that quietly skip an entry with no `sub` would drop
a domain from the route inventory or the permission list without failing. A
navigation change should not be able to revoke access.

**D2 — Every child keeps its own key.** `inventory`, `procurement` and
`commerce` stay exactly as they are, keys included, so every stored member
grant keeps meaning what it meant and no permission data moves. `scm` itself
is a container, never a grant: a member is given the child they may use.

**D3 — Warehouse is declared as a `soon` child, not folded into Inventory.**
The owner's row names Warehouse and Inventory as separate modules and they
are: `inventory` owns the catalogue and the one Business-wide stock position
(FR-154, FR-155, FR-156), while warehouse locations, bins, transfers and
stocktake are not built (`docs/ERP-MODULE-MAP.md` says so). A `soon` child
`warehouse` states that in the one place a reader looks, and follows the
`operations` precedent: a reserved slot needs no module and no charter until
someone builds it.

**D4 — The built lane is relabelled from Warehouse to Inventory.** The label
was `Warehouse` because a Project's own `Inventory` section tab (FR-077) sat in
view at the same time as the domain bar, and two links named Inventory are
ambiguous to a screen reader and to Playwright strict mode. Under SCM that
collision is gone — the bar reads SCM, and the child list is only ever on
screen while SCM is the selected domain — and keeping `Warehouse` on the lane
whose warehouse features are the unbuilt half is the more confusing of the two
options. The route key stays `inventory`, as it has since PR #263.

**D5 — SCM owns no models, no routes and no module.** It is a navigation and
authority-grouping concept, so it gets no `docs/domains/scm/CHARTER.md`: the
charter contract (ADR-025) binds a domain folder to a `src/modules/<m>`, and
there is no `src/modules/scm` to claim. The three lanes keep their own
charters and their own boundaries, and the Inventory ↔ Procurement ↔ Commerce
contracts recorded in ADR-065 and ADR-066 are untouched by this change.

**D6 — Visibility resolves through the parent.** A viewer sees the SCM slot
when they hold any of its children's keys; selecting it shows only the children
they hold. A parent that appeared for everyone would advertise capabilities the
viewer cannot open, and one that needed its own grant would lock out every
member whose stored grant predates this change.

## Consequences

- The four-module row the owner named is now visible in the product, not only
  in `docs/ERP-MODULE-MAP.md`.
- One more level exists for other ERP rows to reuse (Finance and HR are the
  obvious next candidates); this ADR is the precedent for how.
- Two surfaces change: the domain bar draws a slot per group, and the sidebar
  lists the whole group. The command palette needs no change at all — it walks
  the flat registry, so it already finds every child's routes and labels them
  with the child, which is what a searcher typed. Everything else that reads
  `DOMAINS` is untouched, including every authorization path.
- A flattened group would have carried four links named `Dashboard`, since every
  domain's first sub-entry is called that (ADR-036 D1). Each child's is renamed
  to the child, which is also what makes the menu legible: Inventory, Warehouse,
  Procurement, Purchase Orders, Order Management, Orders.
- The interface-inventory marker counts two more domain keys (`scm` is declared
  in the same file the counter reads, and `warehouse` is a new reserved slot)
  and one more sub-domain entry. No page route is added: `/warehouse` has no
  page, which is the point of a reserved slot.
- `warehouse` is a key that grants nothing until the module exists. It must
  stay `soon` until then, or it becomes a slot that opens onto nothing.
