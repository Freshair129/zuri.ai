---
version: "0.3.0b"
created_at: "2026-08-18T03:02:18+07:00,ATHER"
last_update: "2026-09-05T13:00:00+07:00,Claude Code"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "architecture-decision"
  scope: "Phase 1 LINE runtime connection selection, secret resolution and local Ollama boundary; revision 0.3.0b scopes the Ollama boundary to the cloud runtime and exempts EDGE-mode LINE OA accounts (ADR-060 D5)"
---

# ADR-031 — Phase 1 LINE runtime connection cut-over

**Status:** Accepted for implementation; production adapter and live cut-over remain gated

## Context

The Phase 1 runtime previously composed a model port from direct environment
credentials. The Integration Platform connection slice now stores an opaque
`secretRef`, and production uses a Supabase Vault adapter behind a private
resolver. The migration artifact and first live secret still require operator
evidence before traffic is enabled.

The repository-scope work owns FR-073. This decision therefore registers the
cut-over as FR-079 and leaves FR-048, FR-073 and NFR-014 meanings unchanged.

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
LINE reply work. Runtime resolution is asynchronous and uses a hard-bounded,
scope/version-keyed cache. The port exposes explicit invalidation hooks;
rotate/revoke must wire those hooks and a cross-instance purge strategy before
those lifecycle operations are enabled. Secret material is never logged,
audited, returned to the browser or persisted in Prisma.

Phase 1 selects Supabase Vault as the manager/engine. `secretRef` is
`supabase-vault:<uuid>`, resolved by `zuri_core.resolve_phase1_line_secret` and
executed only under `zuri_line_runtime`; local file-vault storage remains a
dev/test adapter only. Existing local secrets are never copied into production
implicitly. Live migration, Vault provisioning, role verification and rotation
policy evidence remain deployment gates.

### D4 — Local Ollama

Ollama is an explicit `LOCAL_DEV`/`TEST`/`EVAL` provider, not a member of the
public production LINE provider allow-list. It has no cloud credential and may
use only an exact loopback base URL such as `http://127.0.0.1:<port>`.

The adapter rejects non-loopback hosts, DNS-rebinding-prone names, redirects
and user-supplied production base URLs. Missing server/model inventory is a
fail-closed provider-not-ready result; it never triggers automatic fallback.
`PRODUCTION_LINE` and public LINE cannot select Ollama.

**Revision 0.3.0b (2026-09-05) — what D4 governs, and the EDGE exemption.**
Owner decision, recorded from the same answer that produced ADR-060 0.2.0: a
Zuri Edge Device exists only for tenants that want a local LLM through Ollama,
or Codex CLI on a monthly-plan quota instead of an API key; every other tenant
is served from the cloud.

- D4 governs the Phase 1 runtime **in this repository** — the cloud process
  composed by `createPhase1BusinessAgentPortsFromEnv` under `PRODUCTION_LINE`
  (`src/modules/agent/phase1-runtime.js`). For that runtime nothing changes:
  `PRODUCTION_LINE` still fails closed on Ollama, on a raw credential and on
  the local file vault; the Integrations UI still lists no Ollama production
  provider (ADR-032); FR-079, NFR-015, SEC-015 and SDD-043 describe this
  runtime and stay true unchanged.
- D4 does **not** govern a LINE OA account whose `transportMode` is `EDGE`
  (ADR-060 D5). For such an account the answering runtime is the device's own
  process in `zuri-edge-device` (ADR-041), not the Phase 1 cloud runtime: the
  device selects its local Ollama or Codex CLI under its own configuration,
  holds the LINE channel credentials on premise (ADR-041 D2), and the cloud
  never resolves, proxies, lists or falls back to that provider. The
  subscription-backed CLI that P1-W3 denied for public LINE is, on an edge
  device, the tenant's own login on the tenant's own hardware; the cloud stores
  no credential for it and receives only a provider label and model name in
  receipts, the FR-143 `provider: edge` shape.
- What still holds for an EDGE account: loopback-only Ollama on the device (the
  edge adapter keeps this ADR's loopback, redirect and SSRF rules, coded in the
  edge repository against contracts this repository publishes); no automatic
  fallback between cloud and device in either direction; exactly one answering
  runtime and one transport owner per account at any instant (ADR-060 D5,
  BR-011); ADR-020 activation and truthful receipts. A mode switch to `CLOUD`
  moves the credential and the runtime together, so the cloud runtime never
  serves an EDGE account's traffic on Ollama by accident.
- PHASE-01 acceptance criterion 8 ("Public LINE cannot select Ollama or a
  local subscription-backed CLI provider") remains the pilot's rule for the
  cloud runtime it was written against. For an EDGE account the provider is
  chosen on the device by the tenant that runs it, a topology the 2026-08-14
  pilot plan did not contemplate; it is not reopened, it is scoped.

### D5 — Ownership and rollback

`zuri-cli` remains the sole LINE signature/Reply API owner and retains the LINE
channel secret. Zuri only receives the normalized event and binding-resolved
scope. Rollback order is routing disablement, connection demotion, secret
revoke/rotate, data preservation and a redacted receipt. The operation is
idempotent and records no raw secret or customer content.

## Acceptance gates

| Gate | Required proof |
|---|---|
| Contract | FR-079/NFR-015/SEC-015/SDD-043 registered; FR-048/FR-073/NFR-014 meanings unchanged |
| Selection | DB uniqueness, trusted binding scope, RLS, CAS and zero/multiple fail-closed tests |
| Secret manager | Supabase Vault adapter/resolver is explicitly wired; error taxonomy, scoped cache/version, expiry and redaction tests pass; live role/Vault apply remains pending |
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
- Supabase Vault is the Phase 1 production secret backend; live project apply and
  first-secret provisioning are explicit deployment dependencies.
- The human management surface is specified separately in ADR-032; it may show
  metadata and secret-manager readiness but cannot replace the runtime or
  activation boundary.
- The integration-platform branch must be reconciled onto current main while
  restoring the FR-072 authorization code/tests and preserving unrelated work.
- Since revision 0.3.0b, "production LINE cannot select Ollama" is a statement
  about the cloud runtime. An EDGE-mode LINE OA account (ADR-060 D5) answers on
  its own Zuri Edge Device with local Ollama or Codex CLI; the cloud keeps no
  credential for either and the two runtimes never fall back to each other.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | beta | Owner-approved Phase 1 connection cut-over boundary with provider-neutral secrets and local Ollama isolation | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | beta | Select Supabase Vault, wire the production resolver adapter and preserve live migration/canary gates | working-tree | ATHER |
| 0.2.1b | 2026-08-18 | beta | Clarify cache invalidation lifecycle gates and add an apply-time Vault owner precondition | working-tree | ATHER |
| 0.3.0b | 2026-09-05 | beta | Owner decision: D4's Ollama boundary is scoped to the Phase 1 cloud runtime; an EDGE-mode LINE OA account (ADR-060 D5) answers on its own Zuri Edge Device with local Ollama or Codex CLI on the monthly-plan quota, with no cloud credential, listing or fallback; FR-079 / NFR-015 / SEC-015 / SDD-043 unchanged | working-tree | Claude Code |
