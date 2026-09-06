---
version: "0.1.0b"
created_at: "2026-09-06T13:44:15+07:00,RWANG,03e3940"
last_update: "2026-09-06T13:44:15+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: candidate-interface-validation
  scope: "Standalone Marketing mockup coverage and design review evidence"
---

# Marketing — Mockup QA & Review Guide

**Relates to:** [Domain proposal](../CR-018-MARKETING-DOMAIN-DESIGN.md), [Navigation](MARKETING-NAVIGATION-VIEWS.md), [Inventory](MARKETING-INTERFACE-INVENTORY.md)

| Field | Value |
|---|---|
| **Version** | 0.1.0b |
| **Status** | Candidate design, verified as a standalone prototype |
| Risk | LOW for these reversible design artifacts; future domain implementation remains C-3 / HIGH |
| Entry point | [Open interactive mockups](mockups/index.html) |
| Result evidence | [verification.json](mockups/verification.json) |
| Source of screen count | [catalog.js](mockups/catalog.js), exported to [inventory.json](mockups/inventory.json) |

## 1. What is delivered

100 screens across 13 sidebar entries: 3 collection pages, 40 capability tabs,
9 detail tabs, 22 record details, 9 creation forms, 7 decision dialogs and 10 shared state previews.
All screens have individual desktop captures linked from their inventory row.
The ten shared states are not multiplied across every screen and are not additional production routes.

The shell follows Zuri's amber/navy surfaces and existing Business context. Creative tiles are simple
illustrative artwork drawn in CSS. People, accounts and outcomes are fictional. The supplied team image
informed responsibilities and flow; its original file was not edited.

## 2. How to review

1. Open `mockups/index.html` in Chrome or Edge. Keep its sibling assets and scripts together; no server or login is needed.
2. Use **Interface inventory** to search by name, ID or candidate route. The top selector and previous/next buttons reach all 100 IDs.
3. Use the sidebar and local tab bar for the proposed product navigation. Record links replace the list; Campaign and Live show one detail-tab bar.
4. Follow Campaign brief → Plan → Results → Team review → version comparison → exact-version approval dialog.
5. Review Paid Media separately from Instagram organic, and inspect Analytics attribution and Data Quality before interpreting results.
6. Inspect state IDs MKT-UI-091 through MKT-UI-100, especially unavailable, conflict, forbidden and unknown outcome.

Forms demonstrate required-field validation and local draft capture. Their next page is a predefined
example record, not a complete CRUD implementation. Decision dialogs require a reason and acknowledgement,
then display a visibly simulated receipt. Closing the browser session clears these local examples;
switching Business also clears draft/decision data. No external API is called.

## 3. Verification evidence

The standalone verifier enumerates every catalog ID, checks the rendered title and internal hash targets,
captures each desktop screen, and checks document overflow at both viewport sizes.

| Check | Result |
|---|---|
| Catalog keys, navigation tabs and target references | PASS — 100 unique screens |
| Desktop at 1440 × 1000 | PASS — 100/100 screens, 100 full-page JPGs |
| Mobile at 390 × 844 | PASS — 100/100 screen layout checks, 13 representative JPGs |
| Browser runtime / failed resource requests | 0 reported |
| Broken internal screen links | 0 reported |
| Document horizontal overflow | 0 on either viewport; tables/calendars use their own scroll containers |
| Behavioral assertions | PASS — 13 assertions; exact names in verification.json |
| Visual inspection | All 13 contact sheets reviewed; team/partner card layout refined after inspection |
| Governance | Run with the repository graph/check/strict-preflight chain; see generated preflight report |

Behavioral checks cover list/board switching, provider filtering, search with no matches, scenario
recalculation, invalid/valid forms, approval acknowledgement, simulated decision receipt, Business scope
clearing, inventory lookup, forbidden content and unknown-outcome reconciliation.

Initial browser launch with a cached Playwright Chromium failed due to a Windows side-by-side runtime
configuration. Verification succeeded with installed Google Chrome; the exact browser version is in the
JSON receipt. This was an environment launch issue, not a prototype page failure.

## 4. Contact sheets

| Area | All screens in that area |
|---|---|
| Dashboard and shared states | [Contact sheet](mockups/contact-sheets/dashboard.jpg) |
| Strategy & Planning | [Contact sheet](mockups/contact-sheets/strategy.jpg) |
| Campaigns | [Contact sheet](mockups/contact-sheets/campaigns.jpg) |
| Paid Media | [Contact sheet](mockups/contact-sheets/paid-media.jpg) |
| Content & Creative | [Contact sheet](mockups/contact-sheets/content.jpg) |
| Social & Community | [Contact sheet](mockups/contact-sheets/social.jpg) |
| Creators & Partnerships | [Contact sheet](mockups/contact-sheets/partners.jpg) |
| Live Marketing | [Contact sheet](mockups/contact-sheets/live.jpg) |
| Website & CRO | [Contact sheet](mockups/contact-sheets/website.jpg) |
| SEO | [Contact sheet](mockups/contact-sheets/seo.jpg) |
| Analytics & Attribution | [Contact sheet](mockups/contact-sheets/analytics.jpg) |
| Marketing Operations | [Contact sheet](mockups/contact-sheets/operations.jpg) |
| Team & Refinement | [Contact sheet](mockups/contact-sheets/team.jpg) |

## 5. Limits of this evidence

- These are reviewable mockups, not shipped interfaces, working connectors, production permission enforcement or runtime agents.
- Filter controls demonstrate provider/search selection. The headline chart/metrics retain the labeled all-provider fixture scope; Instagram placement selection explains the ad-level drilldown. Arbitrary date/account combinations are not a query engine.
- Record lists link to one representative detail per interface type. The fixture does not model every possible record or every screen/state combination.
- Live and campaign data include illustrative planning and result states; screenshots are design examples, not execution receipts.
- Navigation uses addressable screen hashes. Production tab/filter persistence, keyboard-tab behavior, screen-reader audit, contrast certification and permission integration remain implementation acceptance work.
- Typography declares IBM Plex Sans Thai / Manrope, with offline Segoe UI / Tahoma fallback. No font installation or external font request is required for this package; screenshot typography uses available local fonts.
- Lucide is bundled locally with its license. No application dependency or package-lock change is needed.
- Product unit tests, build, e2e, live provider access, spend/publication calls, MSP execution and GKS promotion are not claimed by this report.

## 6. Reproduce

From this directory, `node mockups/build.js` validates the catalog and regenerates the candidate inventory.
For browser verification, provide a Node runtime with `playwright` and `sharp` available, optionally through
`NODE_PATH`, and set `MKT_BROWSER` to an installed Chromium-family executable; run `node mockups/verify.cjs`.
This command regenerates screenshots, contact sheets and verification.json. It does not install packages,
run the product or modify a database. Then run the repository documentation governance chain once.

## 7. Version diff

| Artifact | Before | After |
|---|---|---|
| Marketing domain proposal | 1.0.0b | 1.1.0b — adds interface review package |
| Navigation proposal | 0.1.0b | 0.2.0b — links exhaustive inventory and mockups |
| Interface inventory / mockups / QA | Not part of previous proposal | 0.1.0b — 100 enumerated screens |
| Domain topology | 11 subdomains + Dashboard + Team | Unchanged |
| Product routes / schema / global requirement IDs | Existing baseline | Unchanged |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Record prototype coverage, reproducible checks, contact sheets and implementation limits | See git history | RWANG |
