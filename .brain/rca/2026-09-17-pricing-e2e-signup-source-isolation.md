---
version: "1.0.0b"
status: resolved
created_at: "2026-09-17T04:52:00+07:00,RWANG,e2d9665f"
last_update: "2026-09-17T04:52:00+07:00,RWANG"
---

# Pricing E2E actor consumed another suite's signup quota

## Symptom
The composed release browser run passed 200 tests and skipped four, but Marketing Strategy's independent reviewer signup received HTTP 429 instead of 201, on both attempts. The two FR-253 pricing tests passed.

## Evidence
- `tests/e2e/marketing-strategy.spec.js:164` failed on signup status. The retained release-e2e.log records both assertion failures (HTTP 429, expected 201).
- `signup-rate-limit.js` allows 20 attempts per source per 15-minute window; attempts share a fallback bucket without separate forwarded client identity. The signup route checks the bucket before parsing the body.
- The new pricing outsider fixture signed up through that same local server without a distinct source. Many earlier browser fixtures also sign up through the shared server; a new account/context does not isolate the server's source counter.

## Root cause
Fixture isolation covered account email and database identity but omitted the existing per-source signup quota. The added pricing actor consumes the shared loopback quota, coupling later fixture setup to suite order and elapsed time. The observed 429 is the existing limiter enforcing that quota, not a pricing or Marketing authorization denial.

## Why the issue escaped detection
The focused pricing run stayed below the quota, and the earlier full run completed under different timing. Correct credentials and unique email addresses do not isolate source rate limits.

## Proposed prevention
Within the already-approved FR-253 outsider acceptance fixture, represent its independent client with the reserved documentation address 192.0.2.253 on the single signup request. Keep real signup, sessions, 404 cross-Business assertions and production rate limits unchanged. Do not reset the shared limiter, add sleeps, retry refused writes, or modify unrelated Marketing tests. Re-run the full browser suite and the existing rate-limiter unit tests before marking this resolved.

Risk LOW: one test request's source identity; no production behavior, schema or contract change.

## Verification
The corrected full browser run passed both pricing cases and the Marketing independent-review case that previously received 429. Existing signup route/limiter tests passed 23/23. Independent source review found no weakened authentication or authorization assertion. The full browser command still exited 1 for a separate Marketing Save revision flaky case; see `2026-09-17-marketing-revision-release-flake.md`. Resolving the signup fixture is not a claim that the full release browser gate passed.
