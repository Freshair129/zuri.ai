---
domain: integration
owns_models:
  - IntegrationProvider
  - IntegrationConnection
  - IntegrationCredential
---

# Domain charter — integration platform

The integration platform owns external provider metadata, Business-scoped
connection state and opaque credential references. It is not a business-truth
owner and it never writes Customer, Conversation, Message or LINE reply state.
Its planned human management surface is a Platform sub-domain, not a new
Business domain.

## Boundaries

- Raw credential material stays outside Prisma and browser responses.
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
  connection metadata.
- `src/modules/agent/phase1-runtime.js` — binding-scoped Phase 1 composition.
- `docs/decisions/ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md` — planned Platform
  management and provisioning boundary.

## Related requirements

FR-048 remains the provider port and credential-mode contract. FR-079 adds the
runtime connection-selection and secret-resolution cut-over without changing
FR-048 or the existing FR-073 repository-scope contract. FR-080 adds the
secret-safe Platform management surface and Supabase Vault reference mapping
without making UI state an activation authority.
