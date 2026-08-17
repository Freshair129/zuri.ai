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

## Boundaries

- Raw credential material stays outside Prisma and browser responses.
- Connection selection is always scoped by trusted Tenant/Business authority;
  client payloads and normalized LINE events cannot widen it.
- Runtime selection and credential resolution are read-only ports. Management
  operations for promotion, rotation and revocation are separate audited paths.
- Local encrypted vault storage is dev/test only. Production uses the approved
  external secret manager and fails closed when it is unavailable.
- Ollama is a local/dev/test evaluation provider and is not a public LINE or
  production provider.

## Public contracts

- `src/platform/integrations/core/secret-manager.js` — provider-neutral runtime
  source vocabulary and secret resolution contract.
- `src/platform/integrations/core/integration-registry.js` — scoped provider and
  connection metadata.
- `src/platform/integrations/core/secret-manager.js` — runtime secret resolution
  boundary.
- `src/modules/agent/phase1-runtime.js` — binding-scoped Phase 1 composition.

## Related requirements

FR-048 remains the provider port and credential-mode contract. FR-074 adds the
runtime connection-selection and secret-resolution cut-over without changing
FR-048 or the existing FR-073 repository-scope contract.
