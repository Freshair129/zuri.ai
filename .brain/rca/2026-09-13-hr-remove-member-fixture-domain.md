# HR Remove browser fixture omitted its read grant

Date: 2026-09-13. Scope: isolated E2E fixture only; no production data change.

## Symptom

The ordinary-member Remove test could not find Members with access after login.

## Evidence

`fr193-access-members.spec.js` used `signUpBusinessActor`, which creates an OWNER
Membership without explicit domain grants, and changed only its role to MEMBER.
The failure screenshot shows Business Home with no HR navigation. Both attempts
failed before any Remove assertion. The fixture therefore had no people domain
grant; OWNER had previously provided implicit all-domain visibility.

## Root cause

The test conflated loss of ownership with retention of HR read permission.
Once the role became MEMBER, its empty domain list correctly denied HR entry.

## Why the issue escaped detection

API tests use the sanctioned viewer factory, which supplies the people read
grant explicitly. The browser fixture created a persisted grant with a different
shape, and had not previously exercised this role transition.

## Proposed prevention

Set `domainKeysJson` to `['people']` when creating this MEMBER fixture. Retain
all production domain guards, Remove denials and fail-on-flaky checks. The test
must reach HR, observe no Remove controls, and receive 404 on direct mutation
requests before testing live Operator authority and expiry in the same session.
