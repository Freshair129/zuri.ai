---
id: ZAI:RCA-2026-09-17-FEATURE-OPENAPI-VALIDATION-DIALECT
title: Feature OpenAPI checks must preserve the declared schema dialect
version: "0.1.0b"
status: beta
created_at: "2026-09-17T17:31:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T17:31:00+07:00,RWANG"
attributes:
  domain: project-manager
  scope: FR-252 composed contract verification
---

# Symptom

The first composed W4/W5 run passed 57 tests and failed two OpenAPI tests.
The schema-parity test failed before checking instances, and the historical
read-only test rejected the newly approved POST operations.

## Evidence and root cause

The Ajv validator expects JSON Schema draft-07 numeric exclusiveMinimum and
exclusiveMaximum. The published document is OpenAPI 3.0.3, where those keywords
are booleans paired with minimum/maximum. Passing that schema unchanged to Ajv
produced `exclusiveMinimum value must be ["number"]`. Separately, the W3 read
test still asserted POST was absent on every read path after W4/W5 added the
approved create and capture operations. The dedicated nine-write contract test
passed, so this assertion described an obsolete phase boundary.

## Why it escaped detection

The W3 test was correct before writers existed. The new parity check had not
yet run against the full generated OpenAPI schema, including positive-number
constraints from runtime Zod schemas.

## Prevention

Convert only OpenAPI boolean exclusivity keywords to their draft-07 equivalent
in the test adapter before Ajv compilation; preserve each exact numeric bound.
Keep the production document in its declared dialect. Assert the approved
create/capture operation IDs on shared read/write paths and retain absence on
read-only paths. Keep all runtime/schema adversarial instance comparisons.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record schema-dialect test failure and obsolete read-only assertion; preserve strict parity checks | 052821a7 | RWANG |
