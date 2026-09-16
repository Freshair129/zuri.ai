# Grant guard statement boundary

Version: 1.0.0b; Date: 2026-09-11; Status: beta.

## Symptom

The approved Marketing migration fails the static service-role grant check even
though it grants only the runtime/web roles and explicitly revokes API roles.

## Evidence

The focused test ran 11 assertions: 10 passed and the only failure named
`20260911030000_marketing_broadcast_intents.sql`. Its runtime GRANT is followed
by a semicolon and a separate REVOKE naming service_role. The scanner uses
`GRANT[\s\S]{0,200}?\bservice_role\b`, crossing that statement boundary.
The isolated PostgreSQL catalog probe independently confirms the intended grants.

## Root cause

A character-distance search conflates separate SQL statements and does not
require the role to occur in the GRANT recipient clause.

## Why the issue escaped detection

Earlier migration layouts did not place a runtime GRANT and API REVOKE close
enough to trigger the regex. No fixture distinguished that pair from an actual
GRANT to an API role. The 200-character limit also misses longer real grants.

## Proposed prevention

Within the approved migration validation scope, bound the scan at semicolons,
require TO before the role, and remove the arbitrary distance limit. Test a real
grant (including quoted/list recipients and a long object list), the adjacent
runtime-GRANT/API-REVOKE pair, and the corresponding EXECUTE cases. Keep the
live catalog proof separate from this static guard. Risk LOW; no SQL changes.

Version diff: new RCA and statement-aware static guard regression.
