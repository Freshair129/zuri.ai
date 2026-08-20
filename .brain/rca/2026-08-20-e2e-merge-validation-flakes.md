# RCA — merge validation E2E flakes (2026-08-20)

## Symptom

The merged branch passed Vitest, production build and governance, but
`npm run verify` exited `1` because `npm run test:e2e` reported two tests that
passed only on retry:

- `FR-091 CRM Conversation Inbox › the CRM domain is navigable rather than a reserved slot`
- `universal routes › projects list + project detail with workstreams`

The final E2E count was 56 passed, 4 skipped and 2 flaky.

## Evidence

1. The FR-091 first attempt failed with a Playwright strict-mode violation:
   `getByRole('link', { name: 'Inbox' })` resolved both the CRM sidebar link
   and the Dashboard CTA link. The failure screenshot shows both valid links.
2. The project smoke first attempt timed out while waiting for the detail
   heading after clicking the project list link; the retry passed. The failure
   screenshot shows the expected project detail page, including
   `Business 01 Transformation Program`.
3. The project detail page is client-fetched: it renders `LoadingCard` until
   `GET /api/projects/{projectId}` resolves. The smoke test asserted the
   heading immediately after the click and did not wait for that response.

## Root Cause

The FR-091 test treated two intentional navigation affordances with the same
accessible name as one unique element. The project smoke test used the rendered
heading as an implicit readiness signal even though the route's primary data is
loaded asynchronously through `useFetch`; under the full serial suite, the
first attempt could still be inside that readiness window when the 10-second
assertion expired.

## Why the issue escaped detection

The CRM page was added with both a persistent sidebar Inbox link and a
Dashboard CTA, while the test copied a broad role/name locator that had been
unique on earlier surfaces. The project smoke test covered the happy path but
did not bind its assertion to the detail API completion. A retry hid both
conditions in ordinary Playwright output; the repository's
`--fail-on-flaky` gate correctly surfaced them.

## Prevention

- Scope the CRM navigation click to the sidebar's labelled `Inbox` link.
- Wait for the exact project detail API response after navigation before
  asserting the detail heading and workstream content.
- Keep `--fail-on-flaky` enabled so retries remain diagnostic rather than
  being treated as a pass.
