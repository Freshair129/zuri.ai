---
domain: integration
feature: FR-074
module: integration/agent
source: v2-native
version: "0.1.0b"
status: beta
---

# FR-074 — Phase 1 LINE runtime connection cut-over

## Rationale

The Platform Integrations connection is useful only when the Phase 1 LINE
runtime can select it from the trusted binding scope and resolve its opaque
credential through the correct environment boundary. An `ACTIVE` row or a
local vault file alone is not production runtime evidence.

## Contract

1. Resolve Tenant/Business from the existing server-owned LINE binding.
2. Select exactly one `ACTIVE PRIMARY` connection for
   `PHASE1_LINE_LLM`, with a database uniqueness invariant and CAS promotion.
3. Resolve the connection's `secretRef` through the environment-selected
   SecretManagerPort.
4. Create the existing `ModelProviderPort` only after successful resolution.
5. Fail closed on missing, ambiguous, expired, unauthorized or unavailable
   connection/secret state.
6. Permit Ollama only for explicit local/dev/test evaluation sources; never for
   production LINE or automatic fallback.

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-074-01 | Client/event-supplied Tenant/Business values cannot select a connection. |
| AC-074-02 | Zero or multiple primary candidates stop before knowledge/model/reply work. |
| AC-074-03 | Production cannot construct the local file vault or use raw legacy model credentials. |
| AC-074-04 | Secret-manager errors, expiry, version mismatch and rotation are redacted and fail closed. |
| AC-074-05 | Ollama accepts only exact loopback URLs in local/dev/test and is rejected for public production LINE. |
| AC-074-06 | Real golden evaluation exercises selection and secret-resolution ports, not only injected model ports. |
| AC-074-07 | Rollback is routing-first, idempotent and preserves source/imported data. |

## Out of scope

- Choosing a production secret-manager vendor without owner input;
- production credential creation or migration from a local vault;
- taking LINE Reply API ownership away from `zuri-cli`;
- automatic provider fallback;
- claiming production activation before FR-053/054/055 external gates pass.
