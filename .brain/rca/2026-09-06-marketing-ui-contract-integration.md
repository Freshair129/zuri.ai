# Marketing UI contract integration RCA

## Symptom

The first real browser pass exposed a missing accessible name for the Strategy
tablist, a failed native revision, and a handoff surface that did not reflect
the persisted Project Manager preview or receipt contract. Review and decision
controls also remained visible when the loaded plan was read-only or archived.

## Evidence

- Playwright returned `400 {"error":"Validation failed","issues":[": Unrecognized key(s) in object: 'action'"]}` for the revise PATCH.
- The route accepts the discriminated `action` envelope, while the core revise service initially parsed the same object as the action-free revision schema.
- The handoff adapter returns change rows under `result.preview.pm.preview.{inserts,updates,conflicts}` and stores the receipt in `MarketingHandoff.receiptJson`, exposed later through `plan.handoffs[].receipt`.
- The tab test could not resolve `getByRole('tablist', { name: 'Marketing strategy sections' })` because the accessible label was on the containing nav rather than the element with `role="tablist"`.

## Root Cause

The UI was implemented against the approved boundary description before the
merged core and PM adapters were available. That left one request-schema drift,
one nested ARIA locator mismatch, and a lossy handoff projection that guessed
top-level diff fields instead of adapting the actual nested DTO. Receipt state
was held only in component state, so a reload could not display the persisted
handoff history.

## Why the issue escaped detection

Unit tests mocked the request boundary and the first browser run exercised the
real route only after the core merge. The initial e2e assertion also waited for
a revision label without asserting the PATCH response. The handoff UI had no
real adapter fixture or reload assertion, and permission states were not part
of the first browser slice.

## Proposed prevention

Keep the UI adapter aligned to the exported DTO shape, assert real response
status for every mutation in browser tests, and cover the persisted receipt
after detail reload. Use stable test IDs for role-sensitive review controls,
label the element that owns the ARIA role, and gate every write form and commit
button on the server-provided `canWrite` grant plus plan mutability.
