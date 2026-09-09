---
version: "0.1.0b"
created_at: "2026-09-09T14:15:00+07:00,RWANG,base e8c6b13e"
last_update: "2026-09-09T14:15:00+07:00,RWANG"
status: beta
attributes:
  domain: agent
  scope: approved FR-150 sidebar implementation
---

# Sidebar text zoom layout

## Symptom

At 200% text size the visible Thai Overview label extended outside its navigation
button at every supported viewport. Normal-scale sidebar checks passed.
After correcting the rail width, the 1050×680 zoom case also exposed an AI
model-picker button below the bottom of its card.

## Evidence

The four new `sidebar text zoom navigation` Playwright cases measured label left
6.6875 CSS px against button left 8 px. The 112 px rail lost 16 px to horizontal
padding and one pixel to its border, leaving less room than the doubled Thai text.
The earlier 31 UI tests passed, but did not compare nav-label bounds to its button.
The new wide zoom case measured `openModelPicker` bottom 509.39 against its
article bottom 462.61 CSS px; `providerMessage` extended to 510.89.

## Root cause

The proposed zoom width was estimated without measuring the actual Thai font
advance and the sidebar's padding/border. A visible label is not necessarily
contained by its button.
Separately, JavaScript selected compact AI steps from remaining panel width,
but the CSS for enlarged AI steps was still restricted to the smallest viewport
media query. A wide window with less content space therefore advanced the step
state without applying the matching field visibility rules.

## Why the issue escaped detection

Existing no-scroll checks covered viewport and control bounds; the inline label
is a child of the button and needed its own bounds assertion. The design mock
covered the normal font size, not actual browser text enlargement.

## Proposed prevention / implemented refinement

Use a 120 px rail at 200% text, retain 80 px normally, and measure content width
after the rail changes. Keep label-to-button bounds checks at all four supported
viewports and continue through Connect, Settings and AI configuration/Save.
This is a sizing refinement within the approved sidebar contract; it adds no
feature, IPC, provider permission or production activation.
Scope enlarged AI field rules to `.compact-steps` instead of the smallest
viewport media query, so the rendered fields match the existing step state at
every supported size. Keep the new wide-to-compact zoom navigation tests.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-09 | beta | Measured Thai label overflow and refined zoom rail width | uncommitted | RWANG |
