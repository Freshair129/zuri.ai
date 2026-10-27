---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
implementation_base: "69ebf68debda317eea689d5bfdfbedd8d54b635f"
---

# Compact Task5 first-policy scope correction

The later full-range independent review of `d5525db1..59abfaac` found one P2:
creating the first Marketing report policy could race a native Business tenant
move. An absent-policy advisory lock ordered policy creators but did not lock
the Business. Separate foreign keys did not enforce the Business/Tenant pair.
The native-first schedule committed a policy for tenant A while Business ended
at tenant B, leaving an immutable mismatched policy and audit. This was an
integrity/availability defect, not a demonstrated cross-Business intake leak.

The coordinator selected this correction before further Task7 implementation.
The correction preserves `59abfaac`, the Task6 milestone and all Task7 WIP. The
source change is limited to the existing application transaction: after the
Policy/advisory lock, read whether a policy exists; only the absent-policy path
then locks Business `FOR UPDATE` before reading its current tenant and creating
the disabled policy/audit. A preceding native move completes first and is read
again; a later native move waits and the existing custody guard refuses it after
policy commit. The report-target lock reuses the same Business-lock helper.

Existing SQLite writer locking, Policy-before-Binding ordering, bounded
PostgreSQL waits/retry and outer-commit boundary remain. No auth, credential,
grant, role, baseline SQL, issued Supabase migration or canonical lifecycle row
changes. Explicit PostgreSQL selection and fresh owned Compact TEST scope remain.

Full-range re-review accepted the application race correction, then found a
separate governance false-negative: the original raw-source regex could count
authorization/delegation tokens inside comments or unused code. A hostile test
reproduced it before the helper changed. The helper now parses with the existing
direct pinned esbuild `0.21.5`, normalizes comments/formatting and compares the
complete executable module against a reviewed fixed SHA-256. It does not learn
the pin from the current file. Unknown syntax/version, changed imports, control
flow, unused authorization decoys and string-only decoys fail closed. A future
route behavior change needs review of this pin; no new route exemption or viewer
baseline entry is added. This remains a preflight guard, not runtime auth proof.

## Evidence

Both schedules were promoted from ignored scratch into
`tests/postgres/marketing-report-native.test.js`, using independent actual
`zuri_web_login` sessions and an observer. The tracked focused RED run executed
two failures with 22 unselected tests: native-first reproduced the mismatched
tenant; policy-first could not complete policy creation safely. The focused
GREEN run executed both cases and observed actual PostgreSQL lock waits. It is
not the full-suite claim below. An earlier npm pattern containing a shell pipe
failed before tests; that command error is retained and is not test evidence.

- Full affected PostgreSQL file: **24/24 PASS, zero skipped**, 52.16 s. The
  [sanitized observation](task5-policy-scope-observation.json) derives its 24
  checks from completed cases after disconnect and owned cleanup: **PASS/PASS**.
- Final Compact package/installer/bootstrap regressions: **157/157 PASS, zero skipped**.
- Wire/provider/lock unit consumers: **19/19 PASS, zero skipped**. Historical
  SQLite/wire compatibility: **16 PASS, two paired-Go SKIP**, 11.70 s. Those Go
  cases remain unqualified; no shared generated client was replaced.
- Hostile route-decoy regression: observed RED, then **7/7 PASS** for the workflow/
  route-policy file, also included in the final composed 157-test run.
- Server build of the corrected application source: **PASS**, compile/lint/types,
  94 pages/traces. Final serial registry/graph/views/governance after the guard
  correction: **PASS, 0 critical/0 warning/43 info**, 553 records/96 views. The
  guard-only change after build did not change application source; its parser and
  preflight behavior are checked by the final Node and governance runs.
- Full-diff GPT-6 Luna Max re-review of the original Task5 patch plus final staged
  correction: **both findings resolved; no remaining actionable code finding**.
  The reviewer inspected source and tests, without running tests/Docker/generators.

The earlier [Task5 report](task5-marketing-postgres.md) retains the original
22-case milestone history. These two new schedules are additional evidence,
not a reinterpretation of those tests. The observation's original Task5 base
plus working-patch description is not an exact release attestation; this
correction's current base is recorded above. Paired Go, hosted exact-head CI,
Linux-host, live delivery, production and release gates remain separate.

Task7's core E2E subsequently passed against the `69ebf68` source-archive images
and a working host-harness patch, including actual web recreation. Those images
predate this correction and cannot qualify a final corrected release. No Task7
work, old image, checkpoint, bundle, backup or unrelated runtime was discarded.
