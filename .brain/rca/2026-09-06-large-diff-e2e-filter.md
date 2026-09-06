---
version: "0.1.0b"
created_at: "2026-09-06T22:05:00+07:00,RWANG,be6aedb6"
last_update: "2026-09-06T22:05:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: architecture
  scope: monorepo-ci-change-filter
---

# Large relocation diff incorrectly skipped E2E

- Symptom: PR 264 head be6aedb6 changed application source, but governance run
  34041054921 marked changes successful and skipped E2E.
- Evidence: the workflow evaluates `printf ... | grep -qvE ...` under `pipefail`.
  Replaying the exact expression with 5,000 synthetic `apps/server/src/` paths
  returned `code=false` locally, although every line is application source.
- Root cause: `grep -q` exits after its first match before the producer has finished
  writing the large list. The resulting broken pipe makes the whole pipeline
  nonzero under `pipefail`; the conditional interprets that as documentation-only.
- Why missed: small diffs fit in a pipe buffer. Existing fail-safe comments and
  unreadable-diff handling did not cover early consumer exit on large input.
- Prevention: a dependency-free classifier consumes all stdin before deciding,
  preserves the explicit docs allowlist, treats empty/unknown input as code, and
  falls back to code=true if classification fails. Test small docs-only input,
  application paths, unknown paths, empty input, and a large mixed diff through
  the actual CLI. Full hosted E2E must run before this migration merges.

Version diff: new CI regression RCA, 0.1.0b; within the approved relocation/CI scope.
