---
version: "1.0.0"
created_at: "2026-09-08T09:00:00+07:00,Claude Sonnet 5"
last_update: "2026-09-08T09:00:00+07:00,Claude Sonnet 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "architecture-decision"
  scope: "the rest of the top domain bar organised by ERP taxonomy, per the owner's instruction — CRM becomes one slot over Customer and Market Intelligence; every other remaining domain is confirmed as already standing correctly on its own. Navigation and grouping only: no domain key, model or route changes."
---

# ADR-070 — CRM is a parent domain over Customer and Market Intelligence

**Status:** Accepted. Implemented by FR-171 in the same change.
**Date:** 2026-09-08
**Decided by:** Boss (instruction of 2026-09-07: "โดเมน ที่แสดงในtop nav bar เป็น
โดเมนตามหลัก erp ยกเว้น business home", confirmed 2026-09-08: "จัดกลุ่ม top nav bar
ที่เหลือตามหลัก ERP ด้วย" — apply the same principle ADR-069 used for SCM to
every domain the owner had not already named).
**Relates to:** [ADR-069](ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md)
(the precedent this ADR follows and extends), ADR-025, ADR-011, ADR-013,
ADR-036 (D1), FR-060, FR-061, FR-091, FR-159, FR-160, FR-161, FR-167,
`docs/ERP-MODULE-MAP.md`, `docs/SITEMAP-DOMAIN-NAV.md`.

## Context

ADR-069 grouped four peer domains under one SCM slot because the owner named
them as one ERP row and the registry showed them as unrelated tabs. The owner's
later instruction generalises the same test to the rest of the bar: every
top-level slot except Business Home (which ADR-069's own text already treats
differently — it is the shell's cross-domain landing surface, not itself an
ERP module, per FR-060) should read as an ERP domain.

Applying that test means checking each remaining slot against the question
ADR-069 asked of SCM: **is this one ERP-recognised business function shown as
more than one peer tab, when it should be one tab with sub-domains?** Walking
`apps/server/src/config/domains.js` slot by slot after SCM:

| Slot today | What it is | Siblings that belong to the same ERP function? |
|---|---|---|
| `customer` (label "CRM") | Inbox, Sales Tasks — the relationship/sales-facing half of Customer Relationship Management | `market` — see below |
| `market` (Market Intelligence) | competitor and customer intelligence | belongs with `customer`: CRM taxonomy (Salesforce, HubSpot, SAP C/4HANA, Odoo) treats market/customer intelligence as a CRM analytics function, not a peer application |
| `growth` (Marketing) | strategy, campaigns, content, marketing operations — five sub-pages, its own FRs (FR-157, FR-159, FR-160, FR-162) | no. Every ERP/CRM suite the owner would recognise offers Marketing (or "Marketing Automation") as its own top-level application beside CRM, not a child of it — Odoo ships CRM and Marketing as separate apps; Salesforce and Dynamics separate Sales Cloud from Marketing Cloud. Nesting Marketing under CRM here would misrepresent the taxonomy, not honour it |
| `operations` | reserved, `soon`, no sibling | already its own slot; nothing to consolidate |
| `people` (HR / People) | HCM: dashboard, directory | already its own slot; ADR-069 named "Finance and HR" as the next candidates for grouping, but there is no second HR-shaped domain in this registry to group it with today |
| `projects` (Development) | PPM: work, execution, timeline, dependencies, milestones, files, repositories | already its own slot |
| `assets` (Asset Management) | EAM: receiving, register, scanner | already its own slot |
| `line-oa` (LINE OA Studio) | the LINE Official Account channel-management studio: design, rich menu, live chat, edge connection, integrations, templates, team, settings | not an ERP business function at all — it is channel/integration tooling for one specific surface (`docs/PRODUCT.md`: "LINE is the primary surface"), ten sub-pages already, no sibling domain of the same shape to consolidate with |
| `platform` | system administration: users, integrations, audit, backup, settings | system/admin area, the same class of exception as Business Home — not itself a named ERP business function |

Only one pair — `customer` and `market` — is genuinely the SCM situation again:
two peer tabs that are sub-parts of one ERP-recognised function (CRM), shown
as if they were unrelated. Every other remaining slot is already either a
single, complete ERP-style module with no sibling to fold in, or (LINE OA
Studio, Platform) a non-ERP system/channel area that the "except Business Home"
carve-out already implied belongs outside this taxonomy, the same way Business
Home does.

## Decision

**D1 — CRM is a real slot in the navigation, expressed the same way SCM is: a
derived tree over the flat registry.** A second entry is added to the existing
`DOMAIN_GROUPS` array (`src/config/domains.js`), naming its children by key:

```js
{
  key: 'crm',
  label: 'CRM',
  caption: 'ลูกค้าและตลาด',
  icon: Contact,
  childKeys: ['customer', 'market'],
}
```

`domainBarSlots()` and `sidebarDomainForPath()` already read `DOMAIN_GROUPS`
generically — nothing about either function assumed exactly one group — so
adding a second group needs no change to either derivation, only to the array
literal. `DOMAINS` itself is untouched: both `customer` and `market` keep every
field they have today except the one label change in D2.

**D2 — `customer`'s bar label changes from "CRM" to "Customer"; its key does
not move.** The label collision ADR-069 D4 fixed for Inventory/Warehouse
recurs here in the same shape: the new CRM group and the `customer` domain
cannot both read "CRM" in the same bar, or a viewer sees two links named CRM —
one for the group slot, one that used to be the leaf. `customer` keeps its
route key, its Membership grant meaning and its charter; only the bar's
display label moves, the same class of change FR-039/SDD-018 already cover
for Business-bound ERP labels.

**D3 — Market Intelligence keeps its label and its key.** Nothing here
collides: "Market Intelligence" does not repeat "CRM", so no relabel is
needed on this side.

**D4 — Marketing, Operations, HR / People, Development, Asset Management,
LINE OA Studio and Platform are confirmed unchanged.** This ADR's Context
table is the record of that check for each one, so a future reader asking
"was Marketing considered for the CRM group?" finds the answer here instead
of re-deriving it. None of the seven gets a `DOMAIN_GROUPS` entry, a relabel,
or a reserved sibling — each already satisfies the test ADR-069 established
(one ERP function, one slot, no unconsolidated sibling).

**D5 — CRM owns no models, no routes and no module**, for the same reason
ADR-069 D5 gave SCM none: it is a navigation and authority-grouping concept
over lanes that already have their own charters (`crm`'s CHARTER.md, if one
exists, or the domain's existing owner). `crm` the group key is never a grant
and never reaches `domainKeysJson`, exactly as `scm` is not.

**D6 — Visibility resolves through the parent, identically to SCM D6.** A
viewer sees the CRM slot when they hold either child's key; opening it shows
only the children they hold.

## Consequences

- The bar now reads, left to right: Business Home, SCM, CRM, Marketing,
  Operations, HR / People, Development, Asset Management, LINE OA Studio,
  Platform — one slot fewer than before (Customer and Market Intelligence
  collapse into one), every remaining slot either a grouped ERP function or a
  standalone one already correctly represented.
- `groupForDomainKey`, `groupChildren`, `domainBarSlots` and
  `sidebarDomainForPath` need no new logic: they were written generically
  against `DOMAIN_GROUPS` by ADR-069, and a second array entry is the whole of
  what exercises them differently. This is the reuse ADR-069's "Consequences"
  section anticipated ("one more level exists for other ERP rows to reuse").
- The sidebar under CRM lists Customer's three entries (relabelled Dashboard →
  Customer, per ADR-036 D1 / ADR-069's own "flattened group" note) followed by
  Market Intelligence's one entry — four items, well inside what SCM's own
  six-item flattened group already proved workable.
- `docs/ERP-MODULE-MAP.md` gains a CRM row alongside the existing SCM row, so
  the owner's ERP vocabulary and the navigation stay in the same document that
  already bridges the two for SCM.
- No permission data moves: every Membership's `domainKeysJson` keeps meaning
  exactly what it meant, because `customer` and `market`'s keys are untouched.
- Marketing remains a full top-level peer, unchanged in every respect — this
  ADR record is what stops a future session from "helpfully" folding it under
  CRM without re-deriving why that was rejected.
