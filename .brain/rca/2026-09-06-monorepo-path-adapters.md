---
version: "0.1.0b"
created_at: "2026-09-06T21:40:00+07:00,RWANG,be9e1440"
last_update: "2026-09-06T21:40:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: architecture
  scope: monorepo-path-regressions
---

# Relocation path regressions

- Symptom: first moved Server suite had five failed files: three import failures,
  one missing root artifact and one empty runbook read. Governance found 60 broken
  relative links after application files moved.
- Evidence: moved suite 449 files passed; focused native import of domain-state
  succeeded while Vitest failed with Invalid or unexpected token. Both shared
  module import failures disappeared after removing their now-unnecessary hashbang
  lines; all five affected test files then passed (30 assertions).
- Root cause: filesystem consumers assumed docs/artifacts lived beside application
  sources. The script edit also placed an import immediately after a hashbang that
  the Vitest transform rejected, although Node itself accepted it.
- Why missed: old flat-layout tests never exercised separate documentation and
  source roots; ordinary Node syntax validation did not exercise the Vitest loader.
- Prevention: explicit workspace path resolution with flat-fixture compatibility,
  relocated Markdown destinations, monorepo-layout regression tests and the full
  moved suite. Module scripts still run through explicit `node`; no executable
  hashbang is required. No tests or gate thresholds were removed.

Version diff: new relocation RCA, 0.1.0b.
