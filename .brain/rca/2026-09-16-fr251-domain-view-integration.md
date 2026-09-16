---
version: "0.1.0b"
created_at: "2026-09-16T23:15:00+07:00,RWANG,uncommitted FR-251"
last_update: "2026-09-17T00:32:00+07:00,RWANG"
status: beta
attributes:
  domain: project-manager
  scope: FR-251 Phase A integration
---

# FR-251 integration findings

## Symptom

Review of the first local UI revision found that switching the `projectId` prop
could render the previous Project's Domain DTO until a passive effect cleared
state. This is a source-confirmed stale-render path; no production incident is
claimed. The first UI copy also exposed internal phase and authorization terms.

## Evidence

The initial `ProjectDomainView.jsx` held `{ data, loading, error }` without the
Project identity in state. Its `useEffect([projectId])` reset ran after the render,
while `ProjectDomainViewPage` reused the same component without a Project key.
The initial copy contained `Not bound in Phase A` and a DDD/grant disclaimer.
Root sent the bounded corrections to the UI owner before final tests.

## Root cause

The in-flight response guard rejected late responses after effect cleanup, but
did not associate already stored data with the Project currently being rendered.
Internal design constraints were copied into product-facing explanatory text.

## Why the issue escaped detection

This was the initial implementation review before browser tests ran. A successful
single-Project fetch cannot prove safety when context changes without a full page
reload. Documentation approval did not constitute runtime verification.

## Proposed prevention

Key the view by Project and check the DTO Project identity before showing data;
retain cancellation of stale asynchronous results. Exercise Project change and
unavailable/error states in browser checks. Use user-facing descriptions of
missing bindings/evidence and overlapping counts, and wrap long immutable IDs at
390px. Do not modify shared authorization or API helpers for this UI correction.

## Runtime Swagger session declaration

The first composed source registered the Domain-view DTO and typed errors but
omitted an OpenAPI `security` declaration. The runtime document has no global
session security default, while the approved candidate explicitly requires
`SessionAuth` using the actual `zuri_session` cookie. The route itself already
calls the trusted session resolver; this finding concerns the API contract.
The first tests checked response schemas/refusals but omitted authentication
metadata, so all 22 focused checks passed without detecting this drift. Root
requested an operation-only session declaration and matching assertions; peer
operations and authentication behavior must remain unchanged.

## Browser locator failures

The first full browser run completed on 2026-09-17 with 197 passed, four existing
skips, two deterministic failures and no flaky cases. Both failures are in the
new FR-251 test. The runner log and failure screenshots confirm the controls and
error message rendered; the test asked for different accessibility semantics:

- At line 98 the test clicked a link named `Back to Project`, but the existing
  `ProjectTabs` link has `aria-label="Return to Project overview"`. The preceding
  href assertion already found that canonical accessible name successfully.
- At line 157 the test searched for an `Authentication required` heading. The
  shared `ErrorState` renders an alert containing a paragraph title. Its alert
  and text are visible in the captured browser; it has no heading role.

The earlier source review accepted locators derived from visible copy without
checking the existing component's accessible name and role. Correct the test to
click the already asserted return link and assert exact error-title text inside
the Domain view's alert. Keep every state, zero-row, foreign-DTO sentinel, URL and
keyboard assertion, and retain existing timeout and fail-on-flaky behavior. The
shared UI and its accessibility contract require no change. Preserve the initial
failure report/traces, then rerun the full browser gate. Capture screenshots with
animations disabled to avoid recording an intermediate sidebar transition.

## Verification status

Verified locally on 2026-09-17. Independent Luna Max source review found no
remaining blocking findings after the scoped corrections. Root's full server
suite passed 5,956 tests with 32 existing skips and no failures; production build
passed. The full browser rerun passed 199 cases with four existing skips, no
failures and no flaky cases, including all four FR-251 cases and ten FR-250
regressions. The original timeout and fail-on-flaky gates remain in force.

Root inspected the final desktop and 390px captures. The desktop uses the
isolated seeded API; mobile long-ID rows are synthetic intercepted data.
Governance passed with zero critical findings and two existing warnings;
candidate validation passed nine positive/negative DTO checks. The initial
failed browser log, traces and screenshots remain in the local parallel QA
packet. Hosted CI and release evidence belong to the exact implementation
commit in PR443; these local checks do not establish production deployment.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record context state, product copy, Swagger security and browser locator causes; retain initial failures and verified local corrections | implementation tracked in PR443 | RWANG |
