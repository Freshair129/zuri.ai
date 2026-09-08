---
version: "0.1.1b"
created_at: "2026-09-08T14:31:25+07:00,RWANG,798d89ed"
last_update: "2026-09-08T15:03:31+07:00,RWANG"
status: "beta"
superseded_by: null
attributes:
  domain: "line-oa-studio"
  scope: "Dashboard render and CRM inbox scope"
---

# RCA: LINE Studio Dashboard crash and inbox scope

## Symptom

During browser verification of the approved icon fix, selecting LINE OA Studio
from Overview crashed the Dashboard. Direct Live CRM navigation rendered after
the icon fix, but conversation loading returned HTTP 400.

## Evidence and root causes

At initial diagnosis, the isolated checkout was based on deployed revision
`798d89ed` with only the approved `MessageSquare` import. Browser login uses the repository's
test owner, its seeded SQLite database, and port 3130, not production credentials.

1. **Dashboard:** authenticated navigation from `/overview` to `/line-oa` produces
   `ReferenceError: groups is not defined`. The overlay points to
   `LineStudioDashboard.jsx:197`: `{Math.max(groups.length, 2)}`. The component
   defines and fetches accounts and projects; it defines no `groups` collection.
   This expression throws on initial render, before any fetch can resolve. Even
   a newly declared empty array would report two groups without supporting data.
2. **Inbox:** direct `/line-oa/live-crm` navigation produces zero JavaScript page
   errors after the icon fix, but requests `/api/crm/conversations` without query
   parameters and receives HTTP 400. `LineCrmLiveChat` destructures `businessId`
   and `selectedBusiness` from `useScope()`. The real provider exposes the selected
   Business through `shell.activeBusinessId` and `currentBusiness`, not those
   top-level fields. The inbox route requires the Business ID through
   `parseConversationInboxQuery` before applying the server-side access policy.

Evidence: ignored `apps/server/test-results/line-crm-browser-evidence.json` records
the failing request and browser exceptions; `line-dashboard-groups-error.png`
captures the overlay. The operator's exact production console trace remains
unavailable, but the reported Overview-to-LINE-domain navigation now reproduces
a concrete failure locally against the deployed revision.

## Why the issues escaped detection

The initial approved test targets the Live CRM component's render only. It catches
the missing icon but cannot replace navigation through Dashboard or assertions
on the inbox's request parameters. The existing Rich Menu browser test visits
the account-connection tab directly. A passing build did not detect the unbound
`groups` reference. Historical CI for the introducing commit was not audited.

## Approved correction

Complexity: **C-2**. Risk: **LOW**. No schema, API, or server authorization changes.
The operator approved both follow-up corrections with "fix it all" on 2026-09-08.

1. In the Dashboard group metric, replace the unsupported count with `—` and the
   explicit copy `ยังไม่มีข้อมูลจำนวนกลุ่ม`. Remove the metric's unsupported
   `Group ID Active` claim. Do not substitute projects for LINE groups or invent
   a minimum count. A real group-count data integration is separate work.
2. In Live CRM, derive `businessId` from `scope.shell.activeBusinessId` and the
   selected Business object from the existing `scope.currentBusiness`. Keep the
   existing API and its server-side tenant/visibility enforcement unchanged.
   While no Business is selected, pass a null path to useFetch so the page waits
   instead of issuing the known-invalid unscoped request.
3. Add a real Dashboard render regression that fails with the current unbound
   identifier and asserts the unavailable-data state after correction. Extend
   the existing Live CRM render test to assert the request's selected Business
   ID using the canonical ScopeProvider fixture, including another Business.
4. Verify browser navigation: login -> Business -> Overview -> LINE OA Dashboard
   -> Live CRM. Require no runtime exception, an inbox HTTP 200, and no new
   browser console error. Use only the isolated fixture environment; send no
   webhook, simulated message, broadcast, or provider request.
5. Run targeted tests, production build, and governance. Update the RCA with
   separate build, browser, and deployment evidence.

## Parent and peer alignment

- LINE OA Studio charter owns the Dashboard and requires observable operational
  facts. An unavailable marker accurately reflects the current missing count.
- FR-091 CRM inbox and its read model own conversation visibility; the selected
  Business identifies the tenant scope and does not replace server authorization.
- ScopeContext and `tests/factories/scope-context.js` establish the shared shell
  contract. No new provider fields or API parameters are introduced.
- The previously approved icon correction remains as documented in the
  [original RCA](2026-09-08-line-crm-client-exception.md).

## Acceptance and exit criteria

- Dashboard renders and labels the unavailable group count without a made-up value.
- Live CRM sends the actual selected Business ID; its authenticated list read
  returns HTTP 200 in the seeded environment.
- Regression tests fail before each correction and pass afterward.
- Overview -> LINE OA Dashboard -> Live CRM passes browser verification.
- No deployment claim until the corrected revision has actually been released
  and verified; production deployment remains a separate decision.

## Out of scope

Other hardcoded Dashboard health indicators, mock badges, real group-count
integration, messaging behavior, and broader CRM functionality are not part of
this targeted proposal.

## Verification and version diff

Version `0.1.0b` to `0.1.1b`: implemented the approved Dashboard unavailable-data
marker and the canonical Business scope read. The original missing icon fix is
retained. No server API, authorization, database schema, or messaging change.

- Before correction, the two icon tests still passed while four new cases failed:
  Dashboard threw `groups is not defined`; both selected-Business cases requested
  the unscoped URL; the no-Business case also issued the invalid request.
- After correction, 26/26 tests passed across `line-crm-live-chat-render.test.js`,
  `line-studio-dashboard-render.test.js`, `conversation-read-model.test.js`, and
  `crm-conversation-inbox.test.js`. This includes existing server read-model and
  authorization integration tests, plus six UI render/scope regressions.
- `npm run build` passed, including compilation, type/lint validation, and static
  page generation. No claim is made that the full repository test suite ran.
- `npm run govern` passed after both corrections and test additions: zero critical
  findings, zero warnings, and zero combined-graph dangling edges. Generated views
  accompany the correction. `git diff --check` also passed.
- Authenticated isolated browser navigation passed: login -> Business -> Overview
  -> LINE OA Dashboard -> Live CRM. The Dashboard displayed the unavailable count;
  the inbox request carried the selected Business UUID and returned HTTP 200 with
  a conversation array. Zero page errors, zero console errors, zero HTTP failures.
- Browser evidence is in ignored `apps/server/test-results/`:
  `line-dashboard-fixed.png`, `line-crm-all-fixed.png`, and
  `line-crm-all-fixed-evidence.json`. Testing used the local dev server and seeded
  SQLite fixture; no LINE messages or simulated webhooks were sent.
- Production has not been deployed or verified with these corrections. The work
  remains isolated on `codex/line-crm-client-exception`; the main checkout's other
  active work is untouched.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 0.1.0b | 2026-09-08 | candidate | Documented browser-reproduced Dashboard exception and missing inbox scope; proposed minimal corrections | 798d89ed (baseline) | RWANG |
| 0.1.1b | 2026-09-08 | beta | Approved corrections implemented; 26 tests, build, and authenticated navigation passed | working-tree | RWANG |
