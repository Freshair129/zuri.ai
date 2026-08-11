# ADR-006 — Lift V1's Shell, Components and Sitemap; Wrap Them in V2's Scope

**Status:** Accepted
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Relates to:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) §D2/§D3/§D9 (reuse, per-module lift, the shim), FR-020 (adaptive shell)

## Context

ADR-003 decided the web UI is lifted per module at that module's cutover. It did not
say what happens to the **frame** — the layout, the shared component library and the
navigation map that every module renders inside. Lifting those per module is
incoherent: the second module would find the frame already there.

Measured (read-only, `G:\zuri`):

| Piece | Files | Where |
|---|---|---|
| Layout | 5 | `src/components/layouts/{DashboardShell,Topbar,Sidebar,MobileTopbar,MobileBottomBar}.jsx` |
| UI primitives | 8 | `src/components/ui/{Badge,Button,Card,DataTable,Dropdown,EmployeeCard,Input,Modal}.jsx` |
| Shared components | 7 | `src/components/shared/{EmptyState,LoadingSkeleton,Pagination,SearchBar,StatCard,CookieBanner,EmployeeCarousel}.jsx` |
| Composition root | 1 | `src/app/(dashboard)/layout.jsx` |

That is **~21 files**, and the composition root's scope wiring is a single element:
`<TenantProvider>`. V1's navigation is already registry-driven — `MobileBottomBar`
derives its items from "the current module's subFeatures" — so the sitemap is data,
not hand-written markup.

V2 already has its own shell (FR-020: adaptive scope selectors, business switcher,
9 unit + 3 e2e tests). The question is not which shell wins, but which parts of each.

## Decision

**Lift V1's layout, component library and sitemap once, up front, as a foundation —
and wrap them in V2's scope system instead of V1's tenant context.**

| # | Decision | Rationale |
|---|---|---|
| S1 | Lift the ~21 shell files as a unit, before the pilot module | Every lifted module renders inside this frame; it cannot be lifted per module |
| S2 | **Swap `<TenantProvider>` for V2's `<ScopeProvider>`** in the composition root | One element. This is the whole "wrap in V2's workspace" change at the composition level |
| S3 | Keep V1's **structure**: topbar = modules, sidebar = a module's children, mobile bottom bar | It handles mobile, which V2's shell does not, and it is proven in production |
| S4 | Port V2's **scope behaviour into that structure**: business switcher in the identity corner, and the adaptive rules from `src/lib/shell-mode.js` (pure, no I/O, already tested) | V1 has no concept of more than one business; V2's rules are portable as-is |
| S5 | Lift the **module registry** (V1's nav source) and let it render inside the active Business/Workspace | The sitemap comes for free; new V2 modules register the same way |
| S6 | **Feature components stay per-module** (`components/{pos,crm,inbox,…}`) — lifted with their module at cutover, per ADR-003 §D3 | The frame is shared and stable; feature components are neither |
| S7 | **URLs do not carry scope.** Paths stay as they are (`/crm`, `/pos`); the active Business/Workspace comes from `ScopeContext` | Option (ก). Every existing URL keeps working, including the LIFF deep links customers already use and anything bound to `[tenantSlug]` |

### S7 in detail — what we accept and what we owe

Accepted cost: with more than one business, `/crm` means "the CRM of whichever
business is currently selected". A link shared between two people who have different
businesses selected resolves differently for each. That is a real limitation.

Owed follow-up (not now): add scope-carrying routes **additively** —
`/w/:workspace/crm` resolving to the same page — so cross-business deep links become
possible without breaking the unprefixed paths. Additive, never a migration.

Why not the prefixed form now: it breaks every existing URL, including
`(liff)/liff/[tenantSlug]/*`, which is the surface customers actually touch and the
only path that writes PDPA consent. ADR-003 §D4 already committed to "existing
references keep resolving"; this is the same principle applied to URLs.

## Consequences

- The shell lift is a **foundation task in C2**, before the pilot module, not part of
  it. `IMPLEMENTATION-PLAN-V2-REPLACE.md` gains it as a prerequisite of W5.
- This is a bulk copy, and ADR-003 §D3 warned against bulk copies. The warning is
  about *feature* modules going stale against a source moving 213 commits/90 days.
  The frame is ~21 files, changes rarely, and is verified by every page rendered on
  top of it — the staleness argument does not apply the same way. S6 keeps the rule
  where it does apply.
- V2's existing shell components are superseded by the lifted ones, except
  `shell-mode.js` and the business switcher, which move into the lifted structure.
  FR-020's tests must keep passing against the new shell — if they do not, the
  adaptive behaviour was lost in the lift and the lift is not done.
- V1's shell assumes one shop in its **copy**, not just its wiring (labels, empty
  states). Expect to rewrite strings, not structure.

## Review

Revisit if the lifted shell cannot express the multi-business switcher without
significant rework — that would mean the frame is more tenant-coupled than the 21
files suggest, and rebuilding the frame becomes cheaper than adapting it.
