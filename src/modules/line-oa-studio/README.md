# LINE OA Studio module lane

This directory reserves the technical ownership lane `TD-LINE-OA-STUDIO`
proposed by ADR-060 — the multi-account command center for LINE Official
Accounts.

There is intentionally **no runtime implementation in Phase 0**.

Before adding JavaScript, routes, Prisma models or runtime navigation, the
implementing slice must:

1. reserve global requirement ids in `docs/PRD-SDD-v1.0.md` (and a `FEAT` row in
   `docs/FEATURES.md` when the slice bundles several FRs), then pin them with
   `npm run docs:ids -- --write`;
2. update `docs/domains/line-oa-studio/CHARTER.md` ownership claims for any new
   model or route in the same change;
3. add `@req` / `@spec` / `@tested` annotations required by AGENTS.md;
4. run `npm run verify` and commit generated governance outputs rather than
   editing them by hand.

Boundary summary:

```text
IntegrationConnection (LINE_OA) + agent binding code + transport-owner credential
        ↓ referenced by
LineOaAccount  (N per Business, exactly one Business per account)
        ↓ owns
rich menu · Flex · flow · LIFF · templates · dispatch · insight snapshot
        ↓ reaches LINE only through
LineOaTransportJob  → EDGE account:  claimed by the tenant's Zuri Edge Device (pull model, FR-144 credential)
                    → CLOUD account: executed by the Studio worker through the integration lane's
                                     Vault-resolved LINE Messaging port (token never leaves the port)
```

Integration owns connections, credentials, raw evidence and the LINE port.
Agent owns the binding, activation and the single reply. CRM owns conversations
and consent. Identity owns persons, subjects and authority. File management
owns image bytes. The transport owner — the edge device for EDGE accounts, the
integration lane's port for CLOUD accounts — holds every LINE secret; nothing
here ever does. An edge device exists only for tenants that want a local LLM
(Ollama) or Codex CLI on the monthly-plan quota (owner, 2026-09-05).

See:

- `docs/decisions/ADR-060-LINE-OA-STUDIO-DOMAIN-AND-MULTI-ACCOUNT-BOUNDARY.md`
- `docs/domains/line-oa-studio/CHARTER.md`
- `docs/domains/line-oa-studio/CONTEXT-MAP.md`
- `docs/domains/line-oa-studio/SRS.md`
