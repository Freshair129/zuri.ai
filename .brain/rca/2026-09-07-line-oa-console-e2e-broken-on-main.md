# LINE OA console e2e tests are obsolete after the LINE OA Studio unification

Status: root cause confirmed. Not caused by, and not fixable within, PR #267.
Quarantined there with this document as the reason. A real replacement test
against the new console is a separate, tracked follow-up (`task_150d0846`;
see `.brain/rca/2026-09-06-navigation-reachability-audit-search-ci-flaky.md`
for the unrelated fix PR #267 actually delivers).

## Symptom

`tests/e2e/fr149-line-server-console.spec.js` ("LINE account onboarding
persists and activation requires an explicit handoff") and
`tests/e2e/fr151-line-oa-rich-menu-console.spec.js` ("authoring a rich menu
persists it and freezing waits on the image the service asks for") both fail
consistently — timing out on both the first attempt and the retry, not
passing-on-retry flaky — waiting for `/line-oa` content (a Thai-language
heading, then a form label) that never appears.

## Investigation

First pass (2026-09-06/07, before this document's final revision) established
this was **not** caused by PR #267: three independent GitHub Actions `e2e`
runs on `windows-latest` — PR #267's own branch (twice) and `main`'s own
governance run (34045894994, carrying none of PR #267's changes) — all failed
the identical pair the same way. That ruled out PR #267's `next.config.js`
change and ruled out ordinary flakiness (both attempts failed every time, on
every run).

What the first pass got wrong: it treated the failure as CI-environment-only,
because every local run performed at the time passed. That stopped being true
once `main` advanced further, past commit `8696b022` ("unify LINE Studio,
Flow Designer, Live CRM and Edge Device console") — after merging that commit,
both tests failed **locally too**, reproducibly.

## Root cause (confirmed)

Commit `8696b022` rewrote `apps/server/src/app/(pm)/line-oa/page.jsx`
(154 of its lines) as part of a deliberate feature replacement: `/line-oa` now
renders the new "LINE OA Studio" unified dashboard (Dashboard / โปรเจก / Design
Studio / Live CRM & แชท / Edge & การเชื่อมต่อ), not the account-onboarding form
these two tests were written against. Confirmed directly — not inferred —
by seeding a scratch database, starting a dev server against this exact
commit, logging in through the browser, and loading `/line-oa`: the page
shown has no heading "บัญชี LINE และการตอบข้อความ" and no "ชื่อ Connection"
field anywhere on it. There is nothing left for either test to find, on CI or
locally; the previous document's "CI-environment-specific" framing was an
artifact of investigating before `main` had actually shipped the page
replacement, not a real environmental difference.

This is not a regression in the sense of a bug. It is the same situation
`tests/e2e/smoke.spec.js` already names for its own retired cases —
`test.skip('...', '(superseded by FR-041)')` — just not yet applied to these
two tests when the page they cover was replaced.

## Action taken

Both tests are quarantined with `test.skip`, each carrying a comment naming
commit `8696b022` as the cause and pointing to this document and to
`task_150d0846`. This is a recorded, reasoned quarantine of tests that
describe a UI which no longer exists, consistent with this repo's own
convention (`test.skip` with a reason, per `tests/e2e/smoke.spec.js`) and its
own rule (`tests/e2e/reconnecting-request.js` — "fix the nondeterminism or
quarantine the test, do not let a retry hide it").

`fr045-files.spec.js`, which flaked once on PR #267's first CI attempt in an
unrelated "timed out waiting for navigation" shape, passed cleanly with no
retry on `main`'s own run and is not shown to be part of this issue — it was
left alone rather than quarantined.

## What happens next

`task_150d0846` should write a real e2e test against the new LINE OA Studio
console (the dashboard, project list, Design Studio, Live CRM, and Edge
connection tabs actually shown at `/line-oa` now) and can then delete these
two `test.skip` blocks entirely rather than re-enable them — there is no
"fixing" a test written against a UI that was intentionally replaced.
