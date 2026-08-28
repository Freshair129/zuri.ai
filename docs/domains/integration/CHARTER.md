---
domain: integration
module: src/modules/integration
owns_routes:
  - src/app/(pm)/platform/integrations/**
  - src/app/(pm)/platform/sot-pipeline/**
  - src/app/api/platform/integrations/**
  - src/app/api/platform/sot/**
owns_models:
  - IntegrationProvider
  - IntegrationConnection
  - IntegrationCredential
  - IngestionRun
  - RawExternalRecord
  - SyncCursor
  - ExternalEntityRef
  - DeadLetterRecord
  - SotDecision
  - PipelineRun
  - PipelineStep
  - PipelineEventReceipt
  - PipelineRecordEvent
  - PipelineReconciliation
  - PipelineGateDecision
owns_code:
  - src/platform/integrations/**
---

<!-- owns_routes stay at the leaf: `platform/` is a shared shell prefix whose
     siblings are customer-import-reviews (crm) and users (identity), so claiming
     it would take two other domains' surfaces with it. -->

# Domain charter — integration platform

The integration platform owns external provider metadata, Business-scoped
connection state, opaque credential references and the raw record of everything
that arrived through a connection. It is not a business-truth owner and it never
writes Customer, Conversation, Message or LINE reply state.
Its human management surface is a Platform sub-domain, not a new Business domain.

The lane is split across two trees on purpose: the provider-neutral substrate —
core contracts, the registry, raw persistence and the per-provider adapters —
lives in `src/platform/integrations/`, because everything above it depends on it
and it depends on no business domain. `src/modules/integration/` holds only what
needs a viewer: the owner-scoped management service behind the Platform surface.

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
- The `/platform/integrations` page and its API are this domain's surfaces. They
  show metadata and redacted secret status only, and accept only an opaque
  `supabase-vault:<uuid>` reference. Raw secret entry stays in the Supabase
  Dashboard Vault UI; no browser response contains it.
- Local encrypted vault storage is dev/test only. Production uses Supabase Vault
  through the private `zuri_line_runtime` resolver and fails closed when it is
  unavailable.
- Ollama is a local/dev/test evaluation provider and is not a public LINE or
  production provider.
- **This lane owns the execution ledger — the six `Pipeline*` models — for every
  pipeline, not only its own.** `PipelineRun`, `PipelineStep`,
  `PipelineEventReceipt`, `PipelineRecordEvent`, `PipelineReconciliation` and
  `PipelineGateDecision` are deliberately pipeline-agnostic: SDD-066 replaced the
  `z.literal` definition pins with a registry so a second definition could share
  the same six tables, and today they carry both this lane's
  `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` and knowledge's `DPL-KNOWLEDGE-INGEST-V1`.
  The alternative owner is not available even in principle: the knowledge charter
  opens with **"Owns no Prisma models"** as a boundary with an architectural
  reason — its store is the runtime's `zuri_core.business_knowledge` behind the
  `postgres-business-knowledge` port — and ADR-050 D4 forbids new models for that
  work. A knowledge-side claim would contradict knowledge's own first boundary
  rather than extend it.
- **Using the ledger is not owning it, and a second caller is not a second
  writer.** `createPipelineRun` and `recordPipelineEvent` in
  `src/platform/integrations/core/pipeline-tracking-service.js` remain the only
  writers of these six models. Another domain records a run by calling them as a
  consumer — which the knowledge charter already describes itself doing — and
  that call grants it no claim here. Recorded because the distinction was
  misread once: `owns_code` covering `src/platform/integrations/**` was taken to
  imply `owns_models` covering anything written from that tree, and
  `IngestionRun` sitting in the list above while `PipelineRun` did not is easy to
  read past.

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
- `src/modules/integration/application/integration-management-service.js` — the
  owner-scoped read and create path behind `/platform/integrations`; raw secret
  values never cross it and connection health is computed, never stored.
- `src/platform/integrations/core/pipeline-tracking-contract.js` /
  `pipeline-tracking-service.js` — the FR-071 execution ledger's identity
  envelope and server-owned write path; `PIPELINE_DEFINITIONS` (SDD-066) is
  the registry both this domain's and the knowledge domain's pipeline
  definitions validate against.
- `src/platform/integrations/core/knowledge-ingestion-executor.js` —
  `ingestKnowledgeDocument` (FR-109), the persistence half of knowledge
  ingestion: calls the knowledge domain's pure `runKnowledgeIngestionStages`
  (FR-118) and `knowledgeIngestionRunInput`, then writes their result onto
  this ledger. The only file in this lane that imports from
  `src/modules/knowledge/`, and it imports pure functions only.
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
