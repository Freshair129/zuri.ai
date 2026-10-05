---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Authored writer export adapter — development fixture failure

## Symptom

The new writer's first successful-issuance fixture stopped after writing synthetic canonical records and the candidate index. No real record migration was applied.

## Evidence

`tools/tests/document-record-migration.test.mjs` reported `ERR_INVALID_ARG_TYPE` at the writer's `write(file, output.content, ...)` call. The existing `renderCanonicalExports` returns `{path, output}`; the new writer passed those objects into a list whose other entries use `{path, content}`. An exact PARTIAL recovery receipt was emitted by the fixture.

## Root Cause

The new adapter did not translate the existing generator's `output` property into the writer's `content` property. Export entries therefore supplied undefined data. This is a new integration error, not an imported-record or database defect.

## Why the issue escaped detection

Syntax checks and the original corpus projection tests do not execute the new migration writer. Its first apply fixture exercised the interface and caught the mismatch before any real record issuance.

## Proposed prevention

Translate the generator's result explicitly and validate every planned output's content type before writing. Keep the successful apply, original-source preservation and injected partial-failure tests as integration acceptance.
