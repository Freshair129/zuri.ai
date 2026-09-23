---
version: "0.2.0b"
status: "beta"
attributes:
  domain: "agent-governance"
  doc_type: "complexity-rule"
  scope: "TASK-ZAI-001"
---

# RCA: zuri MSP transport allowlist lagged the pinned MSP runtime contract

## Risk

HIGH — this is a security boundary. The child environment must remain an
allowlist, but it must also carry every non-secret MSP control variable needed
for fail-closed authorization and erasure receipts.

## Symptom

The isolated real-MSP acceptance process reached the erasure-receipt step and
failed with `identity_hmac_unconfigured`, even though the synthetic parent
process had configured an identity key and version.

## Evidence

- The pinned MSP source reads `MSP_IDENTITY_HMAC_KEY_VERSION` for erasure
  receipts and `MSP_GLOBAL_PRIVATE_GRANT_REQUIRED` for the global-private gate.
- The pinned MSP client contract also names `MSP_IDENTITY_HMAC_KEYRING` and
  `NODE_EXTRA_CA_CERTS`.
- `apps/server/src/modules/agent/msp-stdio-transport.js` allowlisted
  `MSP_IDENTITY_HMAC_KEY` but omitted those newer names, so the child never
  received them.
- The acceptance failure occurred before any production data or production
  database was used; it used a temporary SQLite database and synthetic values.

## Root Cause

The zuri transport's manually maintained environment allowlist was not updated
when the pinned MSP runtime added key-version/keyring and global-private
configuration. The fail-closed child boundary therefore became
over-restrictive for the approved API-011 receipt path.

## Why the issue escaped detection

The existing transport unit fixture covered the older MSP variable set and the
production memory flag was disabled, so the missing names were not exercised by
the live canary or the previous local suite.

## Proposed prevention

Keep the allowlist synchronized with the pinned MSP contract, add the current
control variables to the exact-environment regression fixture, and retain the
real-process acceptance as a separate local proof. Never replace the allowlist
with pass-through environment inheritance.

## Resolution status

Added the four current pinned-runtime names to the explicit zuri allowlist and
the exact-environment regression fixture. Transport/MSP tests passed 4 files
and 38 tests, and the isolated real-MSP process acceptance passed 1/1 with
synthetic data and temporary SQLite. The repair was deployed in
`zuri-ai-web-ki17:task-zai-001-20260922-r2` at manifest digest
`sha256:147b9784cb5a193a0f6235b29ffe24686c4ce9a2e5e181afc4cf8121b31c2046`.
The allowlist remains explicit; no environment pass-through was introduced.
