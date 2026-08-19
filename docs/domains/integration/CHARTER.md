---
domain: integration
owns_models:
  - IntegrationProvider
  - IntegrationConnection
  - IntegrationCredential
  - IngestionRun
  - RawExternalRecord
  - SyncCursor
  - ExternalEntityRef
  - DeadLetterRecord
---

# Domain charter — integration platform

The integration platform owns external provider metadata, Business-scoped
connection state, opaque credential references and the raw record of everything
that arrived through a connection. It is not a business-truth owner and it never
writes Customer, Conversation, Message or LINE reply state.
Its planned human management surface is a Platform sub-domain, not a new
Business domain.

## Boundaries

- Raw credential material stays outside Prisma and browser responses.
- Raw ingested payloads are replayable evidence, not truth. They are persisted
  verbatim and translated by a separate later path, so a failed translation can
  never destroy what the provider actually sent.
- Ingestion identity is derived from tenant, connection, entity type, external id
  and a canonical payload hash. External identifiers are mapped through
  `ExternalEntityRef` and never become primary keys (BR-002).
- Raw persistence is bound to one tenant/connection scope at construction and
  refuses a row outside it rather than filtering afterwards (SEC-001).
- Connection selection is always scoped by trusted Tenant/Business authority;
  client payloads and normalized LINE events cannot widen it.
- Runtime selection and credential resolution are read-only ports. Management
  operations for promotion, rotation and revocation are separate audited paths.
- The `/platform/integrations` surface shows metadata and redacted secret status
  only, and accepts only an opaque `supabase-vault:<uuid>` reference. Raw secret
  entry stays in the Supabase Dashboard Vault UI; no browser response contains it.
- Local encrypted vault storage is dev/test only. Production uses Supabase Vault
  through the private `zuri_line_runtime` resolver and fails closed when it is
  unavailable.
- Ollama is a local/dev/test evaluation provider and is not a public LINE or
  production provider.

## Public contracts

- `src/platform/integrations/core/secret-manager.js` — provider-neutral runtime
  source vocabulary and secret resolution contract.
- `supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql` —
  private Vault resolver role/function; live application remains an operator gate.
- `src/platform/integrations/core/integration-registry.js` — scoped provider and
  connection metadata, provider registration and ingestion-run creation.
- `src/platform/integrations/core/contracts.js` — the one normalized ingestion
  envelope every acquisition channel converges on.
- `src/platform/integrations/core/raw-ingest-service.js` — idempotent raw
  persistence; returns `UNCHANGED` for a re-delivered event.
- `src/platform/integrations/core/raw-record-repository.js` — scope-bound raw
  record persistence.
- `src/platform/integrations/providers/line/line-oa-webhook.js` — the LINE event
  normalizer and signature verifier; drops the transient `replyToken` before
  persistence. `normalizeLineWebhookEvent` is the one normalizer the live ingress
  uses. `verifySignature` needs raw request bytes and is **not** exercised on that
  path: `zuri-cli` still owns LINE authenticity and the Reply API (BR-011).
- `src/platform/integrations/providers/line/line-oa-evidence.js` — binds the live
  `POST /api/agent/line-webhook` ingress to this substrate: resolves the `LINE_OA`
  connection from the binding-proved scope and records every event as raw evidence
  before the agent turn runs. See "Wiring status" in
  `docs/domains/integration/features/FR-081-raw-external-ingestion.md`.
- `src/modules/agent/phase1-runtime.js` — binding-scoped Phase 1 composition.
- `docs/decisions/ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md` — planned Platform
  management and provisioning boundary.

## Related requirements

FR-081 is the raw ingestion substrate beneath the three below and changes none
of them. FR-048 remains the provider port and credential-mode contract. FR-079 adds the
runtime connection-selection and secret-resolution cut-over without changing
FR-048 or the existing FR-073 repository-scope contract. FR-080 adds the
secret-safe Platform management surface and Supabase Vault reference mapping
without making UI state an activation authority.
