---
domain: project-manager
feature: FR-060
module: business
source: v2-native
---

# FR-060 — Business Home

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Proposed — Decision 1 needs owner sign-off before code |
| **Date** | 2026-08-17 |
| **Relates to** | FR-041, FR-042, FEAT-002, SDD-033, ADR-025, architecture invariant 8 |

Contract note for the Business Home shell slot and its Dashboard. Written before
the code, per the doc-before-code gate that became enforceable on 2026-08-17.

Source material: a prototype supplied by the owner
(`zuri-business-dashboard-prototype.html`), read as prior art only.

## The prototype's own principle, kept

The prototype states it on the page:

> Business Home is a shell-level aggregation surface. Domain work remains inside
> each domain.

That is also architecture invariant 8 — *reporting may read across domains but
must remain non-owning* — so it is adopted verbatim as the governing rule
(SDD-033), not merely as a layout intention.

## Decision 1 — Business Home absorbs `/overview`; it is not a second surface

This is the decision that needs sign-off, because it changes navigation.

`/overview` today already describes itself as *"Business execution, strategy, and
domain health"* and renders the FR-041 Business Strategy read model. It is
already two-thirds of what the prototype calls Business Home, while nominally
being the **Development** domain's root (`SITEMAP-DOMAIN-NAV.md`: "Development
opens `/overview`").

Two options were weighed:

| | |
|---|---|
| **A — add `/business-home` beside `/overview`** | Smallest diff. Produces two Business-scoped surfaces both showing strategy and domain health, guaranteed to drift apart. This repository spent the whole of 2026-08-16 removing exactly that class of duplication |
| **B — promote `/overview` to be Business Home's Dashboard** *(chosen)* | Business Home becomes a Tier-2 slot ahead of Commerce; its Dashboard is the existing `/overview`, extended. Development stops pointing its root at a cross-domain page and gets a Development-specific root instead |

B is chosen. FR-041 keeps its id and its read contract — the change is where the
surface sits in the shell, not what it computes.

**Consequence requiring approval:** Development's root moves off `/overview`.
`SITEMAP-DOMAIN-NAV.md` and `src/config/domains.js` both encode the old answer
and must change together.

## Decision 2 — reserved domains render as reserved, never as zero

The prototype shows six domains with figures: revenue ฿2.48M, CAC, fulfilment
SLA 96.2%, MRP material readiness 84%, twelve shortages. **None of that data
exists.** Four of the seven domain slots (`commerce`, `customer`, `growth`,
`operations`) are `soon: true` with no module, no schema and no service. There is
no revenue, no pipeline, no SLA and no MRP anywhere in this product.

So the Dashboard renders only what a live domain can source:

| Prototype element | Real source today | Decision |
|---|---|---|
| Strategic Goals | FR-041 / FR-059 roadmap, horizons, goals | **ship** |
| Domain health — Development | project/workstream progress calculators | **ship** |
| Domain health — HR / People | FR-042 people directory | **ship, limited** |
| Attention queue | overdue milestones and gates, missing `FileAsset`s, goals past target | **ship, from real signals only** |
| Revenue, CAC, SLA, pipeline, MRP | nothing | **render the slot as reserved** |
| Composite health score | partial | **ship, but it must state which domains it covers** |

A number a page would disagree with is exactly what the progress rules already
forbid, and "do not fake completion" is a standing rule (AGENTS.md §15). A
dashboard is the single easiest place in a product to violate both, because
plausible figures look like progress. Reserved slots are the honest rendering and
they also advertise the roadmap.

## Decision 3 — it lives in the `business` read slice, and stays read-only

`src/modules/business/` is already the charter's zero-write satellite. Business
Home belongs there: it owns no model, adds no write path, and composes other
domains' read models rather than querying their tables (SDD-033).

It must not accumulate its own persisted rollups. If a figure is slow, the answer
is a read model or a materialised view **owned by the domain that owns the data**
(architecture spec §22), never a private cache inside Business Home — that is how
a projection turns into a second source of truth.

## Scope of the first slice

**In:** the Tier-2 slot and its label; the Dashboard route; briefing line; KPI
tiles limited to live domains; per-domain health with reserved slots shown as
reserved; attention queue from real signals; Strategic Goals reusing the FR-041
read model.

**Out, and each needs its own FR when built:** Goals & KPIs, Risks & Alerts and
Reports sub-pages; the revenue-vs-plan chart (no plan data exists); MRP entirely
(no inventory or manufacturing domain); export; the AI briefing being genuinely
generated rather than composed from the same computed signals.

## Naming

The owner offered Business Home, Business Overview or Business Center.
**Business Home** is used: the prototype's own nav says so, and "Business
Overview" would collide with FR-041's existing "Business Overview" wording at
precisely the moment the two are being merged, which is the worst possible time
to reuse a name.

## Open question for the owner

Decision 1 moves Development's root. If you would rather Development keep
`/overview` and Business Home take a new route, say so — that is option A, and
the cost is two surfaces showing Business strategy that will need reconciling
every time either changes.
