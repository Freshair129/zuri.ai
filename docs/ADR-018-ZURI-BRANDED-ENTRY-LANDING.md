---
version: "0.1.0b"
created_at: "2026-08-14T09:12:07+07:00,ATHER,f16904c"
last_update: "2026-08-14T09:12:07+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "entry-experience"
  scope: "Zuri V2"
---

# ADR-018 — Zuri Branded Entry Landing

**Status:** Beta — owner-approved for implementation on 2026-08-14.

## Context

ADR-015 established the pre-shell route boundary and deliberately deferred visual
design for `/`. The approved FR-051 slice now needs a product-specific first
impression without weakening that boundary or importing the fashion, commerce,
fonts, imagery, copy, or brand references from the supplied visual prompt.

Zuri Heritage remains binding under ADR-010. The landing must therefore express
Zuri as an AI-native business operating system through the existing typography,
Amber Citrus, neutral surfaces, Lucide iconography, and product truths already
recorded in PRODUCT-V2.

## Decision

1. `/` becomes a full-viewport Zuri-branded composition inside `EntryShell`.
2. The page keeps exactly one route-bearing action, `เข้าสู่ Zuri`, targeting
   `/login`. It does not mount BusinessShell chrome or resolve viewer data.
3. The visual language is pure white, graphite, neutral gray, and Amber Citrus.
   Existing Zuri Heritage tokens and font stacks are reused; no new visual-system
   primitive or external font is introduced.
4. The background is a code-native operational topology. A pointer spotlight may
   reveal the Amber signal layer on fine-pointer desktop devices. Coarse-pointer
   and reduced-motion contexts receive a static equivalent.
5. Generated raster work is limited to Zuri-owned social-preview artwork stored
   locally. Runtime imagery never depends on third-party URLs.
6. Fashion, retail, cart, catalog, checkout, garment, price, or third-party brand
   semantics are prohibited from the landing source, metadata, and rendered copy.

## Consequences

- ADR-015 remains authoritative for routing, authorization, and shell isolation.
- ADR-010 remains authoritative for tokens, typography, controls, and accessibility.
- FR-051 owns only the landing experience; Login and Business Routing retain their
  current behavior and compact entry surfaces.
- No video payload is required: the responsive signal field provides motion while
  remaining lightweight and honoring reduced-motion preferences.

## Verification

- Static contract tests prove the single `/login` link and absence of prohibited
  references.
- Targeted entry tests prove `/` remains outside BusinessShell.
- `npm test`, `npm run build`, `npm run docs:graph`, `npm run docs:preflight`, and
  `npm run docs:check` are the release gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-08-14 | beta | Owner-approved Zuri-native landing visual contract | f16904c | ATHER |
