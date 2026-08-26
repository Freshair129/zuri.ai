---
domain: platform-control
feature: FR-105
module: platform-control
source: v2-native
version: 1.0.0
status: accepted
---

# FR-105 — Platform Programme Roadmap

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
  baseline it represents. It does not claim Git activity is programme progress.
- The page has no mutation, no plan import, no API endpoint and no data model.

## Deliberate non-goals

- Business or Project progress roll-up.
- Editing tasks/gates/statuses from the page.
- A substitute for `/projects/[projectId]/roadmap`.
- A new Business navigation item or per-Business permission.
