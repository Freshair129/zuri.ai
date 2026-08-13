# ADR-010: Zuri Heritage Design System and V1-Compatible Migration

**Status:** Accepted
**Date:** 2026-08-13
**Decided by:** Owen (owner)
**Relates to:** ADR-003, ADR-006, ADR-008, NFR-008, SDD-010

## Context

The original Zuri Heritage UI kit established brand colours and a few shared classes,
but it lacked a token hierarchy, component-state contract, density model, and
accessibility baseline. It also had implementation traits that do not scale across
the V2 shell: direct palette references, 18px cards, broad decorative shadows,
gradient card surfaces, and coloured side-stripe rows.

V2 replaces V1 through per-module reuse. A new design system must improve native V2
components without turning a shell or token task into an unverified restyle of lifted
V1 modules.

## Decision

1. **Zuri Heritage remains the visual identity.** Amber Citrus, the existing neutral
   surfaces, IBM Plex Sans Thai, Manrope, Lucide, and the dark navigation glass are
   binding. The generic blue/Inter direction is not adopted.
2. **Tokens have primitive, semantic, and component layers.** Component code does not
   reach primitive colours directly. Legacy token names remain temporary aliases so
   the first migration does not require a feature-wide rewrite.
3. **The shared V2 contract is implemented first.** `globals.css` and shared V2 UI
   primitives receive the contract. Feature UI migrates only when that feature is
   touched for a scoped task.
4. **V1 compatibility comes before visual convergence.** ADR-006 components and
   modules are preserved at their lift boundary. Each module gains the V2 system only
   within its own parity-tested cutover.
5. **Accessibility and state coverage are non-negotiable.** New or changed controls
   meet NFR-008 and define their required states before release.
6. **ADR-008 owns navigation.** This system supplies visual treatment only; it does
   not reintroduce topbar scope selectors or change the business-centric shell.

## Consequences

- Existing `.card`, `.btn`, `.input`, `.pill`, and progress classes become
  compatibility primitives backed by semantic/component tokens.
- The first migration replaces the gradient card and side-stripe gate treatment with
  semantic surfaces and textual status indicators.
- New V2 UI cites `NFR-008` and `SDD-010` in code and tests when it directly enforces
  the system contract.
- Dark mode, white-label theming, and a bulk restyle of V1 lifted modules are deferred.

## Verification

- Design token tests assert the semantic/component contract and accessibility fallbacks.
- `npm run docs:graph`, `npm run docs:preflight`, `npm test`, and `npm run build` pass.
- Visual route checks confirm the existing shell remains functional at desktop and
  mobile breakpoints.
