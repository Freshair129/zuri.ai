---
version: "0.1.0b"
created_at: "2026-09-06T20:26:00+07:00,RWANG,a8b0f430"
last_update: "2026-09-06T20:26:00+07:00,RWANG"
status: beta
superseded_by: null
---

# Campaign schema integration: migration identity and line endings

## Symptom

The first full Campaign test run had 9 failures, 3,921 passes and 14 skips.
Seven failures were schema string/newline comparisons; two were migration-version
uniqueness guards. Focused Campaign behavior tests and the integrated build passed.

## Evidence

`campaign-full-test.log` and the Vitest JSON report identify six provider-parity
test files with CRLF-versus-LF mismatches, plus duplicate-prefix failures in both
migration trees. Enumeration shows both `20260906210000_line_oa_liff_app` and
`20260906210000_marketing_campaigns`. The published LINE migration arrived in the
main merge before the Campaign migration was added. No Campaign migration has been
applied to a production database.

Byte inspection found 2,616 CRLF lines in root's SQLite schema, versus LF in the
generated PostgreSQL schema. `.gitattributes` requires LF for `.prisma` files.
The root edit script used Python `Path.write_text` on Windows without explicit
newline control, which translated newline characters to CRLF in the working copy.
The canonical generated Postgres schema also lacked the new Campaign model:
the foundation generated a temporary diff schema but omitted `db:pg:schema`.
Running that writer adds the model and inverse relations to the tracked artifact.

## Root cause

The new migration timestamp was chosen without reconciling the already merged
migration inventory. Separately, the root writer changed working-copy line endings
contrary to repository policy. Git normalizes the index, so the latter does not
show as a substantive schema diff even though byte-sensitive local tests fail.

## Why the issue escaped detection

The additive migration and focused backup/security tests validate shape and data
preservation, but do not replace the full suite's global uniqueness and schema-
parity gates. Governance's column drift check does not enforce filename uniqueness.
It checks the generated production schema, so it cannot see a source model omitted
from that artifact until generation runs.

## Proposed prevention

Move only the unpublished Campaign migration in both trees to the enumerated-free
`20260906220000` prefix; retain the already published LINE migration. Update the
Campaign policy test path. Write LF bytes for the source schema and regenerate its
Postgres counterpart with `npm run db:pg:schema`. Re-run full tests. Future root
scripts must use explicit UTF-8 bytes/newline handling and enumerate migration
versions before selecting a new identifier.

## Resolution evidence

The corrected full run passed 3,930 tests, with 14 intentional skips and zero
failures. Both migration trees now have unique prefixes; canonical model parity
tests pass. No existing migration or application data was changed.
