---
version: "0.2.0b"
created_at: "2026-08-18T12:00:00+07:00,ATHER"
last_update: "2026-08-18T16:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "integration"
  doc_type: "implementation-plan"
  scope: "FR-080"
---

# Implementation plan — FR-080 Integration and Secret Manager management UI

## Work order

| Work | Deliverable | Exit |
|---|---|---|
| W0 | ADR-032, FR-080, PRD/SDD/NFR/SEC and sitemap contract | governance pass |
| W1 | Platform Integrations page, read model and owner/business scope guard | route/UI contract tests |
| W2 | Connection metadata create/list with fixed Phase 1 purpose | API/service/redaction tests |
| W3 | Supabase Vault resolver, runtime adapter and scoped versioned cache | migration/adapter/runtime tests |
| W4 | Rotation/revoke lifecycle, cache purge and conflict/error states | idempotency/security tests |
| W5 | Accessibility, browser proof, docs graph/preflight and review | full local gates pass |
| W6 | Apply Supabase migration, provision Vault ref and controlled operator enablement | live role/Vault/identity/canary evidence gates |

## Boundaries

- Supabase Vault is the selected Phase 1 backend; live migration and first-secret
  provisioning remain external gates.
- Raw secret material never enters Prisma, browser responses, logs, audit events or
  generated documentation.
- The UI cannot activate LINE routing or replace FR-053/054/055 canary gates.
- The UI accepts only an opaque Vault reference. Raw entry, rotate and revoke
  remain outside this slice until a separate provisioning port is approved.

## Dependencies and stop conditions

Implementation stops when the trusted viewer/Business ownership boundary is
missing, a client-selected scope can authorize a write, a response contains raw
secret material, the manager port is unavailable but the UI reports success, or
the page is treated as a production activation control.

## Definition of done

- [x] Platform → Integrations route and owner/business scope guard implemented.
- [x] Metadata-only read model and create/list contracts tested.
- [x] Supabase Vault resolver/adapter is server-only and redacted.
- [ ] Secret write/rotate/revoke paths have a separate provisioning contract.
- [ ] Audit/idempotency/CAS/rotation conflict evidence passes.
- [ ] Keyboard/WCAG 2.2 AA and browser state coverage passes.
- [ ] `npm run govern`, `npm run docs:check`, strict preflight, tests and build pass.
- [ ] Production activation remains separately gated and truthfully reported.

## Current state

Local implementation slice complete for page, metadata API, Supabase Vault
adapter and migration artifact. Live Supabase apply, Vault provisioning,
primary promotion and LINE canary remain gated.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | candidate | Initial Platform Integrations UI and secret-safe provisioning plan | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | candidate | Supabase Vault selection and local metadata-only implementation truth-sync | working-tree | ATHER |
