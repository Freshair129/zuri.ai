# ADR-008 — Business-centric shell, dual scope lens (ERP ⇄ PM), and entry flow

**Status:** Accepted
**Date:** 2026-08-13
**Decided by:** Owen (owner)
**Supersedes (in part):** [PRODUCT-V2](PRODUCT-V2.md) §2 (single fixed scope chain), [SITEMAP-V2](SITEMAP-V2-DOMAIN-NAV.md) §1–§2 (Tier-1 wording); closes SITEMAP-V2 §7 open decisions
**Relates to:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) (V2 replaces V1 by reuse), [ADR-006](ADR-006-SHELL-LIFT-AND-SCOPE-WRAPPER.md) (shell lift · URLs carry no scope), [ADR-007](ADR-007-LINE-AI-STACK-SEQUENCING.md) (LINE/AI stack), FR-002 + FR-020 (adaptive shell)

This ADR is the **single source of truth** for how V2's shell is organised: what the user
lands on, how scope is presented, and where Project vs Campaign live. Where PRODUCT-V2 §2 or
SITEMAP-V2 §1–2 say something narrower, this ADR wins; those documents keep their **schema
truth and per-domain maps** and now point here for the lens + entry flow.

> **Draft amendment:** ADR-015 / FR-044 refines the entry sequence to Landing → Login
> stub → Business Routing → BusinessShell. This preserves D1's Business-centric root
> while moving Business selection before final shell mount; it does not implement auth.

## Context

We compared org-hierarchy patterns across two families of tools before deciding:

| Family | Top container (switcher) | Mid grouping | "Project/Campaign" sits… |
|---|---|---|---|
| **PM tools** — Notion, ClickUp, Linear, Asana, Jira | Workspace / Organization | Teamspace / Space / Team | one board/list/project — never the root |
| **ERP** — SAP, NetSuite, Dynamics 365, Odoo | Client / Organization | **Legal Entity / Company Code** | one **module** (SAP PS, Odoo Project) among many |

Two findings drove the decision:

1. **The top-level container is always the company/account; "Project/Campaign" is always a
   module, never the app root.** HubSpot nests Campaigns under Marketing; Salesforce Campaign
   is one object; Odoo Project is 1 of 80+ apps. Zuri today boots into the Project Manager as
   if it were the whole app — the wrong shape.
2. **The word "Workspace" collides.** In Notion/ClickUp/Linear it is the *top* container; in
   Zuri's schema `Workspace` is a level *below* Business. That collision is what made the nav
   feel "มั่ว". Zuri already has a real top container above Business — **Portfolio** — and a
   real legal anchor — **LegalEntity** (SAP Company Code).

Zuri is ERP-shaped (books, tax, branches, multiple businesses under one owner) but also ships a
PM module. So we present **one schema through two lenses** rather than picking one framing.

## Decision

### D1 — Business is the operational anchor; the shell is Business-centric
The app's root is a **Business Overview** (a cross-domain dashboard of one business), not the
Project Manager. Project Manager becomes **one domain of six** in the domain bar (SITEMAP §3).

### D2 — Two parallel hierarchies over one schema (Dynamics "hierarchy purpose")
No schema change; both are lenses over the same entities
(`Portfolio · Tenant · LegalEntity · Business · Branch · Workspace · Project`):

```
Legal / financial  (books, tax, consolidation)     Operational  (who works on what — drives nav)
──────────────────────────────────────────         ───────────────────────────────────────────
Group (Portfolio)   ── consolidation ──             Group (Portfolio)      = "ทุกธุรกิจ" roll-up
 └ Legal Entity  (นิติบุคคล + เลขภาษี = Company Code)   └ Business / Brand (Business)  = the switcher
    └ Branch / สาขา  (= SAP Plant / Odoo Branch)          └ Workspace (operating unit / "Space")
                                                              └ Project = Workstream→Container→WorkItem (WBS)
```

### D3 — Dual scope lens (ERP ⇄ PM), a per-user toggle, same selection state
Implemented in `src/config/scope-views.js` + `ScopeContext.viewMode`; the lens changes only the
**labels** (table below). Default = **ERP** (Zuri is ERP-shaped). Scope itself is **selected on
pages and shown in the breadcrumb** (§D4; SITEMAP §2b) — there are **no persistent topbar scope
dropdowns**; each breadcrumb crumb links back to its picker page, so the breadcrumb *is* the
switcher. (Refines the earlier "hero switcher" shell.)

| Level (schema) | ERP lens | PM lens |
|---|---|---|
| Portfolio | กลุ่มบริษัท — *consolidation, "รวมงบทุกบริษัท"* | **Workspace** — *top container (Notion)* |
| Business | **บริษัท** — *company / legal anchor (SAP Company Code)* | Business — *teamspace* |
| Workspace | หน่วยงาน — *operating unit* | Space — *ClickUp Space* |
| Project | โปรเจกต์ | Project |

The "all businesses" choice (`onPick(null)`) is the **Group consolidation** view in both lenses.

### D4 — Entry flow
```
login → RBAC (Membership + role) → Home (/)  → Business Overview (root) → domain bar → domain
                                   └ create/select Company → Business
                                     (adaptive via deriveShell: one company ⇒ skip to Business)
```
- **RBAC** decides which businesses/domains a principal sees (Membership = staff; ADR-007 P3
  identity gate feeds this). Today's shell uses a demo identity ("LO") until real auth lands.
- **Home (`/`)** is the entrance: pick or create a Company, then a Business. Single-company
  owners skip straight to the Business picker (FR-020 adaptivity, one level up).
- **Business Overview** is the cross-domain root; `/overview` narrows to the **Projects domain
  dashboard** (it previously did double duty).

### D5 — Project and Campaign are different domains, never the root
- **Project** → **Projects** domain (WBS delivery: Workstream → Container → WorkItem).
- **Campaign** → **Growth** domain (marketing — HubSpot-style, Campaigns under Marketing).

They are separate concerns in separate domains; neither is the app root.

### D6 — Closes SITEMAP-V2 §7 open decisions
1. Domain order — **accepted** as Commerce · Customer · Growth · Operations · Projects · Platform.
2. Projects — **a peer domain** (cross-cutting delivery view), not folded into Platform.
3. B2B & Products — stay under Commerce for now.
4. Per-business module registry — **a small `BusinessModule` table** (deferred; toggles without
   a migration).
5. AI Copilot & Campaigns — **under Growth** (marketing lens).

## Consequences

- **New pages:** `Home (/)` and `Business Overview`. `/overview` becomes the Projects dashboard.
- **Shell (built):** the topbar carries the ERP⇄PM toggle; `ScopeContext` carries `viewMode`
  (persisted `zuri-v2-view`); the domain bar + hover-rail sidebar + breadcrumb are in place.
- **No schema migration.** All UUIDs and FR/BR/SEC/SDD ids are unchanged (ADR-003 §D4); this is
  presentation + IA only.
- **Docs:** PRODUCT-V2 §2 and SITEMAP-V2 §1–2 defer here for the lens + entry flow; SITEMAP §7 is
  resolved. New shell requirements, when specified, register in PRD-SDD under fresh FR ids.
