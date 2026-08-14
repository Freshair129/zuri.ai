---
version: "0.1.0b"
created_at: "2026-08-14T08:18:06+07:00,ATHER"
last_update: "2026-08-14T08:18:06+07:00,ATHER"
status: "beta"
attributes:
  domain: "line-ai"
  doc_type: "root-cause-analysis"
  scope: "FR-048 OpenRouter OAuth exchange"
---

# RCA - OpenRouter OAuth exchange contract drift

## Symptom

The PKCE helper included `callback_url` in the key-exchange JSON even though the current OpenRouter
exchange contract lists only `code`, `code_verifier` and `code_challenge_method`.

## Evidence

- The helper sent four exchange fields.
- The current official guide uses `callback_url` only for authorization and omits it from
  `POST /api/v1/auth/keys`.
- The unit test asserted only the returned key, not the outbound request body.

## Root Cause

The implementation reused the redirect parameter in both OAuth steps without an exact request-body
contract test. The mock accepted all fields, hiding the drift.

## Why the issue escaped detection

Provider activation was gated, so no live OAuth exchange had run. The mock covered response
normalization rather than the official wire shape.

## Proposed prevention

Send only documented exchange fields, compare the exact JSON body in tests, keep verifier/code
transient, and store the returned key only in the OS credential store after a model canary passes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Corrected and locked the OpenRouter exchange contract | working-tree | ATHER |
