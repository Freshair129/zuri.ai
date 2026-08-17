---
version: "0.1.0b"
created_at: "2026-08-18T03:02:18+07:00,ATHER"
last_update: "2026-08-18T03:02:18+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "architecture-decision"
  scope: "Phase 1 LINE runtime connection selection, secret resolution and local Ollama boundary"
---

# ADR-031 — Phase 1 LINE runtime connection cut-over

**Status:** Accepted for implementation; production adapter and live cut-over remain gated

## Context

The Phase 1 runtime currently composes a synchronous model port from
`ZURI_MODEL_PROVIDER`, `ZURI_MODEL_NAME` and `ZURI_MODEL_CREDENTIAL`. The new
Integration Platform connection slice stores an opaque `secretRef` in metadata
and keeps raw credentials in a local encrypted vault, but it does not yet
provide a production secret-manager adapter, a primary runtime selector or an
automatic Phase 1 cut-over.

The repository-scope work owns FR-073. This decision therefore registers the
cut-over as FR-074 and leaves FR-048, FR-073 and NFR-014 meanings unchanged.

## Decision

### D1 — Explicit runtime source

Every Phase 1 runtime has one explicit source:

```text
PRODUCTION_LINE  -> external production SecretManagerPort only
LOCAL_DEV        -> local/test adapters, including Ollama
TEST             -> injected deterministic adapters or local Ollama
```

`PRODUCTION_LINE` fails closed if the process can construct the local file
vault, use a raw `ZURI_MODEL_CREDENTIAL`, or select Ollama. There is no silent
legacy fallback.

### D2 — Binding-scoped connection selection

The existing server-owned LINE binding resolves the trusted Tenant/Business
scope first. Only then may the runtime select a connection with:

```text
purpose = PHASE1_LINE_LLM
tenant_id = binding.tenant_id
business_id = binding.business_id
status = ACTIVE
role = PRIMARY
```

The database enforces at most one active primary per Tenant/Business/purpose.
Selection never means “most recently updated”. Zero candidates, a rejected
unique constraint, or an ambiguous read fails before knowledge/model/reply work.
The promotion/demotion path uses compare-and-swap on row/version state.

### D3 — Secret manager boundary

The runtime port is provider-neutral:

```text
resolve(secretRef, { tenantId, businessId })
  -> { material, version, expiresAt }
```

The allowed error taxonomy is `NotFound`, `Expired`, `Ambiguous`,
`Unauthorized` and `Unavailable`; every error stops the turn before model or
LINE reply work. Runtime resolution is asynchronous, uses a hard-bounded cache,
keys cache entries by secret version, and immediately purges on rotate/revoke.
Secret material is never logged, audited, returned to the browser or persisted
in Prisma.

The production adapter remains blocked until the owner supplies the manager
vendor/engine, workload identity/auth method, secret path convention,
`secretRef` mapping and rotation/version policy. Local file-vault storage is a
dev/test adapter only. Existing local secrets are never copied into production
implicitly.

### D4 — Local Ollama

Ollama is an explicit `LOCAL_DEV`/`TEST`/`EVAL` provider, not a member of the
public production LINE provider allow-list. It has no cloud credential and may
use only an exact loopback base URL such as `http://127.0.0.1:<port>`.

The adapter rejects non-loopback hosts, DNS-rebinding-prone names, redirects
and user-supplied production base URLs. Missing server/model inventory is a
fail-closed provider-not-ready result; it never triggers automatic fallback.
`PRODUCTION_LINE` and public LINE cannot select Ollama.

### D5 — Ownership and rollback

`zuri-cli` remains the sole LINE signature/Reply API owner and retains the LINE
channel secret. Zuri only receives the normalized event and binding-resolved
scope. Rollback order is routing disablement, connection demotion, secret
revoke/rotate, data preservation and a redacted receipt. The operation is
idempotent and records no raw secret or customer content.

## Acceptance gates

| Gate | Required proof |
|---|---|
| Contract | FR-074/NFR-015/SEC-015/SDD-043 registered; FR-048/FR-073/NFR-014 meanings unchanged |
| Selection | DB uniqueness, trusted binding scope, RLS, CAS and zero/multiple fail-closed tests |
| Secret manager | Production adapter is explicitly wired; error taxonomy, version, expiry, rotation and redaction tests pass |
| Local Ollama | Local-only allow-list, loopback/redirect/SSRF tests, missing-model fail-closed tests, no public LINE path |
| Runtime | Async resolution, no legacy production fallback, bounded cache and real selection/secret path in golden evaluation |
| External activation | Fresh isolation/backup evidence, real provider 20/20, one signed canary, truthful receipt and routing-first rollback |

These gates authorize implementation and evidence generation. They do not
authorize production traffic until the external activation gates pass.

## Consequences

- Provider connection metadata becomes the runtime selection authority only
  after trusted binding scope is resolved.
- Local Ollama remains useful for offline evaluation without becoming a
  production credential or fallback path.
- A production secret-manager vendor is an explicit deployment dependency;
  inventing one in code is prohibited.
- The integration-platform branch must be reconciled onto current main while
  restoring the FR-072 authorization code/tests and preserving unrelated work.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | beta | Owner-approved Phase 1 connection cut-over boundary with provider-neutral secrets and local Ollama isolation | working-tree | ATHER |
