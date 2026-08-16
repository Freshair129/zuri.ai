---
domain: project-manager
version: "0.1.0b"
created_at: "2026-08-14T09:12:07+07:00,ATHER,f16904c"
last_update: "2026-08-14T09:12:07+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "shell-entry"
  scope: "Zuri V2"
feature: FR-056
module: shell-entry
source: v2-native
---

# FR-056 — Zuri Branded Entry Landing Experience

## Requirement

The root entry presents Zuri as an AI-native business operating system through a
full-viewport, responsive Zuri Heritage composition while preserving the accepted
FR-044 route and authorization boundary.

## Product copy

| Role | Copy |
|---|---|
| Brand | `ZURI` |
| Kicker | `AI-NATIVE BUSINESS OPERATING SYSTEM` |
| Headline | `SEE THE WHOLE BUSINESS. MOVE WITH CLARITY.` |
| Support | `รวมธุรกิจ งาน ทีม และหลักฐานการตัดสินใจไว้ในพื้นที่เดียว` |
| CTA | `เข้าสู่ Zuri` |
| Principles | `LOCAL-FIRST · AI-READY · HUMAN-CONTROLLED` |

## Acceptance criteria

| ID | Acceptance criterion |
|---|---|
| AC-056.1 | `/` renders Zuri-only brand and product copy with no third-party, fashion, retail, or commerce reference. |
| AC-056.2 | The page has exactly one route-bearing action and it targets `/login`. |
| AC-056.3 | EntryShell remains outside DomainBar, Sidebar, Business picker, and all BusinessShell data resolution. |
| AC-056.4 | The composition reuses ADR-010 tokens, font stack, Lucide, focus treatment, and reduced-motion contract without introducing new design primitives. |
| AC-056.5 | Fine-pointer desktop receives an eased, non-interactive signal reveal; mobile, coarse-pointer, and reduced-motion contexts receive a static operational topology. |
| AC-056.6 | Runtime visual assets are local or code-native; no external image or font URL is required. |
| AC-056.7 | The page remains usable at mobile and desktop sizes, with its CTA keyboard reachable and visually identifiable. |
| AC-056.8 | FR-044 and FR-046 routing, session, and viewer contracts remain unchanged. |

## Implementation boundary

- Landing page and landing-specific presentation component.
- A narrowly scoped EntryShell full-viewport variant; compact Login behavior stays
  unchanged.
- Zuri-only metadata and local Open Graph artwork.
- Static contract tests plus the existing entry-route proof.

## Out of scope

Production authentication, Business selection behavior, BusinessShell navigation,
new design tokens, external media hosting, marketing CMS, commerce, and checkout.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-08-14 | beta | Owner-approved Zuri-branded entry experience | f16904c | ATHER |
