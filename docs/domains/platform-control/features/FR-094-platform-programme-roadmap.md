---
domain: platform-control
feature: FR-094
module: platform-control
source: v2-native
version: 1.2.0
status: accepted
---

# FR-094 — Platform Programme Roadmap

The delivery programme needs an operator view without becoming a Business record.
This feature supplies one read-only route, `/control/roadmap`, on a shell that is
outside the Business navigation and scope model.

## User-facing contract

- A signed-in installation operator can inspect the supplied 24-week plan as six
  phases, twelve sprints, thirty task rows, eight acceptance gates and the ten
  proposal deliverables.
- A non-operator cannot reach the board through a Business role, Business
  ownership, Tenant ownership, visible domain, or `isPlatform` flag.
- The board labels the submitted document as a draft plan snapshot and names the
  baseline it represents. Its Day 1 is 2026-08-11, the GitHub repository-creation
  date; that calendar anchor does not turn Git activity into programme progress.
- A separately labelled evidence snapshot reports default-branch commit counts
  and verified, aggregate-only SmartGift migration/pipeline facts as of its
  stated observation date. It excludes PII, raw rows, prices, costs, credentials,
  local filesystem paths and action controls.
- `/programme` is an explicitly public, no-login share of the same static
  aggregate. It is removable as one route and does not grant access to the
  operator-only `/control/roadmap` surface.
- The page has no mutation, no plan import, no API endpoint and no data model.

## Deliberate non-goals

- Business or Project progress roll-up.
- Editing tasks/gates/statuses from the page.
- A substitute for `/projects/[projectId]/roadmap`.
- A new Business navigation item or per-Business permission.
- A live GitHub, DuckDB, Supabase or migration-control integration.
- Treating a share URL as a secret or as authorization.
