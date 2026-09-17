---
version: "0.1.0b"
created_at: "2026-09-16T16:50:00+07:00,RWANG,a37ca6dd"
last_update: "2026-09-16T16:50:00+07:00,RWANG"
status: beta
attributes:
  domain: project-manager
  scope: FR-250 local implementation gate
---

# FR-250 navigation integration findings

## Symptom

The first desktop visual review split Delivery Governance inside the word Governance. Integration also exposed unit expectations that still assumed direct registry imports and grouped Resources with wholly planned modules.

Mobile exploration also found that switching to a live module hid the menu but retained an expanded planned disclosure. Its Escape listener still targeted a trigger inside the hidden menu.

## Evidence

- Root CUA review of source commit a37ca6dd on the isolated :3158 fixture at 1440 CSS pixels showed the Planned badge and chevron sharing the label's narrow row. The sidebar label used `break-words`; Governance wrapped across two lines within a word.
- The first focused unit run reported 65 passes and two failures in project-work-route.test.js. The component receives activeModule from the guarded layout; Resources is declared in the live Resource Coordination module's plannedBusinessTabs.
- Independent Luna review found registry-only reachability could pass even if a component emitted no links, and the direct Inventory-to-Repositories assertion had been lost during test adaptation.
- Root CUA at 390px opened Delivery Design, switched from Work Management to Resource Coordination, and observed the hidden trigger still had `aria-expanded="true"`. Reopening the mobile menu exposed the stale expanded disclosure.
- Independent source review SRC-P2-001 enumerated only `execution/[mode]/page.jsx` while the classifier also accepted the parent `/execution` path as a current Project Management view.

## Root cause

The planned badge competed with the desktop label for horizontal space. Unit adaptations mirrored an anticipated source structure instead of checking the composed render. Resource state was conflated with module state in one expectation.

The module navigation handler reset only mobileOpen; openPlannedId and its document-level Escape listener remained active. The mobile close button had the same missing state reset.

The execution classifier treated an intermediate route directory as a page. It must accept the seven canonical mode leaves and reject the bare parent directory.

## Why the issue escaped detection

Compilation proves valid code, not readable labels or usable navigation. Registry membership proves declared metadata, not rendered links. Worker-local checks did not exercise the final combination of source and adapted tests.

## Proposed prevention

Put the Planned badge below the module label, preserving full-word wrapping. Enumerate hrefs from rendered navigation, retain Inventory's direct drilldown assertion, and validate actual clicks, desktop readability and the 390px menu before root acceptance. Preserve failures as local gate evidence; do not weaken assertions, widen timeouts or change the authorization boundary.

Clear planned disclosure state when the menu closes or a live module opens. The mobile browser scenario must open a planned disclosure before choosing a live module, then check both states are collapsed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | beta | Record pre-release composition findings and bounded prevention | source a37ca6dd | RWANG |
