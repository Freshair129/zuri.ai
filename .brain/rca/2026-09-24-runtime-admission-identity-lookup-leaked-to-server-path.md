---
version: "1.0.0b"
created_at: "2026-09-24T09:28:23+07:00,Codex"
last_update: "2026-09-24T09:28:23+07:00,Codex"
status: "candidate"
superseded_by: null
attributes:
  domain: "conversation-runtime"
  doc_type: "root-cause-analysis"
  scope: "runtime cohort admission identity revalidation"
---

# RCA — runtime admission identity lookup leaked into the Server cohort

## Symptom

The mandatory regression run failed five tests in
`tests/unit/line-admission-after-ack.test.js`. Existing Server-owned LINE
admission threw while trying to read `channelIdentity` from fixtures that model
the legacy Server path.

## Evidence

- The failing stack points to `findChannelIdentity` in
  `src/modules/identity/channel-identity.js`, called from
  `src/modules/line-oa-studio/application/line-conversation-jobs.js` during
  `admitLineTextMessage`.
- The call was added to determine whether a direct message was eligible for the
  Conversation Runtime cohort, but the predicate omitted the account's
  `executionMode`.
- Runtime cohort accounts opt in through `executionMode=CONVERSATION_RUNTIME`;
  other accounts must retain the prior Server admission path.
- After the predicate included the runtime cohort, the same focused suite passed
  all 20 tests.

## Root Cause

Admission performed the new authoritative identity lookup for every direct,
non-memory, in-hours, non-legacy-Work message. The lookup is required only when
the account has opted into the Conversation Runtime cohort. Because the check
was not gated on that cohort, the Server path gained a runtime-only DB
dependency and failed when its legacy fixture correctly omitted that model.

## Why the issue escaped detection

The focused Runtime vertical slice exercised opted-in Runtime accounts and did
not cover the Server fallback branch. Only the mandatory full repository suite
ran the broad legacy admission tests against this changed shared admission
function.

## Proposed prevention

- Gate Runtime-only identity lookup and identity-based cohort selection on the
  authoritative account `executionMode` plus existing runtime eligibility
  checks.
- Keep the line admission regression suite in the mandatory full verification
  run; it proves legacy Server admission does not depend on Runtime-only data.
- Retain separate tests for an opted-in Runtime account with a verified
  identity and for ineligible Runtime candidates falling back to Server.
