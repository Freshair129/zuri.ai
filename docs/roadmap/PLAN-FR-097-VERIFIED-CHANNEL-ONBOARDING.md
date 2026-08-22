---
version: "0.1.0"
created_at: "2026-08-22T00:00:00+07:00,ATHER"
last_update: "2026-08-23T01:40:46+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "implementation-plan"
  scope: "Issue #99 / FR-097"
  risk: "HIGH"
  complexity: "C-3"
---

# Phase 1 proposal — verified channel onboarding

## Intent

This is the next local slice after the approved P0 IAM implementation. It makes
the new `ChannelIdentity` model real at the existing LINE identity seam without
activating a LINE provider, changing the `zuri-cli` transport owner or applying
anything to production Supabase.

The binding returned by the server-owned LINE scope resolver is the only source
of `channelAccountId`. A webhook body, LINE display name, raw provider subject,
message or model output cannot select Tenant, Business or Person authority.

## Parent and peer constraints

- The four-tier boundary keeps unified thread and omni-channel identity ownership
  explicit across the tiers;
  neither provider transport nor MSP memory becomes the canonical Person authority.
- [ADR-045](../decisions/ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md)
  D1/D5/D6 define Person, pending channel subjects, shared policy and redacted
  lifecycle audit.
- ADR-007 P2/P3, ADR-018, ADR-020 and ADR-031 keep LINE transport, scope
  binding, activation and reply ownership separate.
- Existing FR-021/FR-022/FR-023/FR-052/FR-057 behavior remains compatible while
  new channel records are introduced.

## Evidence and current gap

1. `resolveLineIdentity` currently creates/reads `ExternalIdentity` and can
   auto-mint a Person on first contact.
2. `link-line-identity` changes `ExternalIdentity` only; the P0
   `ChannelIdentity` row is not yet populated by the live seam.
3. `line-ingest-service` may persist raw inbound evidence and CRM conversation
   rows for a pending customer. That is acceptable for acquisition evidence,
   but pending identity must not unlock private memory, private retrieval or
   staff actions.
4. `resolveAgentAuthorization` already denies private memory when the existing
   identity is not verified; Phase 1 must derive that decision from the shared
   `ChannelIdentity` lifecycle, with an explicit compatibility path for legacy
   `ExternalIdentity` rows.

## Proposed state contract

```text
trusted LINE transport + server binding
        |
        v
ChannelIdentity PENDING  --->  ChannelIdentity ACTIVE
        |                               |
        +-----------> REVOKED <---------+
```

- `PENDING`: subject is known or newly discovered, but has no verified link;
  raw evidence and explicitly public behavior may continue, while private
  memory, private tool reads and staff capabilities are denied.
- `ACTIVE`: a server-owned, single-use link flow has confirmed the subject for
  the target Person. Staff authority still requires an active Membership and
  valid RoleBinding through the shared PEP.
- `REVOKED`: unlink, Person erasure, or lifecycle revocation denies the next
  request/turn. It cannot be reactivated by a webhook payload.

`verifiedAt` records provider/link proof and `linkedAt` records the server-owned
link transition. These timestamps do not replace `status` or Membership checks.

## Implementation boundary

### In scope

1. Add an identity-owned channel adapter that resolves the trusted channel
   namespace and creates/updates `ChannelIdentity` idempotently.
2. Keep `ExternalIdentity` as a compatibility record during migration. New
   resolution reads `ChannelIdentity` first; legacy rows are mirrored into the
   new lifecycle without changing their historical meaning.
3. Extend the existing single-use `IdentityLinkToken` flow so a successful
   server-owned link transitions the matching `ChannelIdentity` to `ACTIVE` in
   the same transaction as the compatibility update.
4. Make revoke and Person erasure transition both records consistently and
   preserve redacted AuditEvents.
5. Feed the resolved channel status into `resolveAgentAuthorization` and the
   existing agent/tool gates. A pending or revoked channel must yield no private
   vault and no staff capability before retrieval or side effects.
6. Add tenant/channel-account isolation, idempotency, pending, active, revoked,
   forged-scope and suspended-membership tests.

### Explicitly out of scope

- Verifying raw LINE signatures inside Zuri-AI; `zuri-cli` remains the transport
  owner under FR-050/BR-011.
- LINE Login/LIFF SDK integration, OIDC, MFA, recovery or device management.
- Provider credentials, live LINE traffic, Supabase migration/RLS/role proof,
  production data backfill or canary activation.
- A new public onboarding route unless an existing approved route is shown to
  be required by the tests; the first slice is the server contract.

## Work order and proof

| Work | Deliverable | Proof |
|---|---|---|
| W0 | Review this boundary against ADR-043 and existing LINE contracts | docs review + `npm run govern` |
| W1 | Implement ChannelIdentity resolver/compatibility adapter | unit tests for namespace, idempotency and tenant isolation |
| W2 | Bind link/revoke/erase lifecycle to the new status | integration tests for single-use link, re-link and revoke |
| W3 | Apply channel status to agent authorization | pending/revoked tests prove no private retrieval/tool/action |
| W4 | Preserve existing ExternalIdentity and raw-ingest behavior | FR-021/022/023 regression suite |
| W5 | Regenerate governed views and report local-only status | `npm run govern`, test, build, e2e |

## Acceptance and exit gates

- The same `(channel, channelAccountId, providerSubject)` resolves to one
  tenant-scoped channel record; another tenant/account cannot read or mutate it.
- A first contact is `PENDING` and never grants private authority.
- Only the server-owned link token flow can produce `ACTIVE`.
- Revoke and erasure deny the next turn/request across compatibility and new
  records.
- Client/model/tool values cannot change `channelAccountId`, Person, Tenant or
  Business scope.
- Existing local LINE ingress and link tests remain green.
- No provider or production activation claim is made until external gates have
  fresh evidence.

## Approval gate

Boss approved this FR-097 boundary on 2026-08-23. The implementation is local
to the Issue #99 worktree; provider credentials, production migration/RLS and
canary activation remain blocked pending their own evidence and approval.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-22 | candidate | Proposed local FR-097 verified channel onboarding slice after P0 IAM | working-tree | ATHER |
| 0.1.0 | 2026-08-23 | beta | Boss approved the FR-097 boundary; local implementation and verification completed | working-tree | ATHER |
