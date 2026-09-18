---
title: Malformed cookie was reported as an unavailable CSRF session service
version: "0.1.0b"
status: beta
created_at: "2026-09-17T04:02:00+07:00,RWANG,bd99651f"
last_update: "2026-09-17T04:02:00+07:00,RWANG"
attributes:
  domain: identity
  complexity: C-2
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:FR-252-P2
---

# API-write CSRF malformed-cookie refusal

## Symptom

GET /api/auth/csrf returned 503 SESSION_UNAVAILABLE for a malformed
percent-encoded session cookie. The approved Identity contract requires a
401 AUTH_REQUIRED response for an invalid credential.

## Evidence

The real-route integration test in
`apps/server/tests/integration/api-write-csrf.test.js` uses the actual Prisma
session store, session port, issuer and token parser. Before the fix, valid
issuance/revocation, expired rows and rotated hashes passed; the malformed
cookie case alone failed with received 503 versus expected 401 (three pass,
one fail). The independent Luna Max P2 review found the same path.

## Root cause

The shared raw-header cookie reader called decodeURIComponent without handling
URIError. Malformed percent encoding therefore threw before credential
verification. The new route correctly redacted unknown session-port failures
as 503, but could not distinguish this client-input failure from a store failure.

## Why the issue escaped detection

Route unit tests mocked both the session port and issuer. Separate session and
token tests did not send malformed encoded cookies through the composed route.

## Correction and prevention

The cookie reader returns null for an undecodable matching cookie, preserving
the existing invalid-credential path. It does not skip to another duplicate
cookie or alter valid cookie parsing. Actual database/service errors still
produce 503. The integration test locks the composed refusal, live revocation,
expiry and hash-rotation behavior; existing session and plugin-consent tests
remain regression gates. This implements ADR-097's already-approved refusal
contract and introduces no new authority or secret.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Record reproduced malformed-cookie status defect and narrow invalid-credential correction | bd99651f | RWANG |
