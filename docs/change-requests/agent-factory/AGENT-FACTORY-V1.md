---
version: "0.1.2"
status: approved
task_id: TASK-ZAI-009
---

# Agent Factory v1 local contract

## Disposition source

The user delegated in-scope product and technical decisions and instructed root
on 2026-10-15 to repair ordinary delivery workflow and continue the roadmap.
Root adopts the bounded decisions below under that mandate. This contract is
the reviewed local design source, not an implementation completion claim. Requirement issuance uses the sanctioned writer.

## Decisions

- Persist one standard Business agent configuration, not five running model
  processes. Configuration carries exactly the five existing core role IDs,
  their tool/policy snapshots, explicit template/schema versions and a config
  version. Model/provider provisioning remains separate.
- Identity is server-derived Tenant + Business. Registry metadata, including
  ENTERPRISE_WIDE, is a capability ceiling intersected with that one Business;
  it confers no cross-Business permission, Membership or action grant.
- Use active persisted OWNER Membership for initial apply and preview. The
  authenticated principal comes from the server session. Business ownership or
  Tenant-wide ownership is checked against the actual Business/Tenant pairing.
  Payload actor/tenant/role fields do not grant authority.
- Create the configuration atomically in both existing Business creation paths.
  For self-provisioning, establish the founder Membership in the same transaction
  before applying the config. Do not change Portfolio selection semantics;
  include the empty-installation Portfolio bootstrap and its audit in that same
  transaction so a later config or audit failure leaves no partial Portfolio.
- Existing Businesses receive no background/bulk backfill. An authorized owner
  can preview and explicitly apply the initial template to one Business. A
  runtime read with no persisted config returns NOT_CONFIGURED with no write
  and no registry-default fallback.
- Reapplying identical v1 content is a no-op, with no duplicate config or APPLIED
  audit. A unique Business identity and a transaction handle concurrency.
  A different template or version is a typed conflict without overwrite.
  Malformed or tampered v1 content is a typed corruption error, also without overwrite.
- v1 supports no customization, upgrade, rollback command or dynamic child
  creation. Unsupported operations refuse before config/provider effects.
  Dynamic delegation is always DENY. Future upgrades need their own contract.
- Config creation and its append-only audit commit together. The APPLIED event
  includes server-derived actorId, tenantId, businessId, template/config versions
  and snapshot digest; these fields cannot rely on null audit-helper defaults.
  Failed config or audit writes roll back. All agent action writes retain FR-026
  Gate F.

Automatic configuration of a newly created Business is an internal part of the
already authorized FR-074 creation transaction. It uses the server-resolved
creator and creation authority, not a client flag or the old request snapshot's
ownedBusinessIds for a Business that did not yet exist. Keep this provision
helper out of the public administration path. Explicit preview/apply for an
existing Business checks active persisted OWNER Membership; no payload can
select an internal authorization bypass.

## Acceptance criteria

1. Given the standard v1 template, when built and persisted, then exactly
   EXECUTIVE, OPERATIONS, FINANCE_ANALYST, RESEARCH and MARKETING are present,
   with only their declared tools. Unknown, duplicate or malformed roles/tools
   fail before applying effects. A runtime config reader returns the same
   validated persisted roles. Reading an existing Business with no persisted
   config returns NOT_CONFIGURED without a write or registry-default fallback;
   no factory config is a write authorization.
2. Given active Tenant-owner Membership, when createBusiness succeeds, then
   Business, standard config and scoped creation/audit records commit together.
   A principal without that persisted Membership has no creation/config write.
3. Given a server-authenticated self-provisioning principal, when
   createBusinessInGroup succeeds, then any bootstrap Portfolio, Tenant, Business, starter Workspace,
   founder OWNER Membership, config and audits commit in one transaction.
   Fault injection at config or audit persistence leaves no partial new scope.
4. Given an owner or unauthorized principal, when scoped preview/apply runs,
   then authorization uses active persisted Membership and the DB-derived
   Tenant/Business pair. Wrong Tenant, other Business, MEMBER-only, revoked,
   deleted and payload-spoofed authority are refused before mutation. Preview
   performs no persistent write. Config reads remain server scoped.
5. Given identical v1 apply calls, including concurrent calls, when completed,
   then one config and one APPLIED audit exist. Reapply preserves identity,
   version and content. The single APPLIED event identifies the server actor,
   Tenant, Business, template/config versions and snapshot digest. A different
   template/version produces a typed conflict; malformed or tampered v1 content
   produces a typed corruption error. Neither overwrites content or adds another
   APPLIED audit; audit failure rolls back config.
6. Given any request for dynamic delegation, customization, upgrade, rollback
   command or bulk backfill, when evaluated by v1, then a typed refusal occurs
   before any config, child agent or provider effect. No fallback silently grants
   another role. Existing Businesses remain untouched until explicit apply.
7. Given EXECUTIVE or any other role, when its effective configuration is read,
   then scope is limited to the actual Tenant + Business; private role/principal
   and Business-shared memory partitions remain unchanged. Tool/policy metadata
   never bypasses Membership, ownership, step-up, transaction or Gate F audit.
8. Given SQLite and PostgreSQL test schemas, when constraints and the factory
   persistence path are tested in isolated databases, then Tenant mismatch,
   duplicate application and rollback invariants hold. Production/Supabase
   migration apply is not authorized by this local feature contract.
   Existing installation backup export/restore preserves this persisted config
   after its Business, including timestamps/content and the existing apply audit,
   without replaying factory apply or silently discarding configuration.

## Task boundary

Task9 closes only after these criteria, independent verification/review and
required exact-head CI pass. It delivers five persisted role configurations,
scoped preview/apply and automatic configuration of new Businesses. It does
not claim five live agents. Task13 retains broader standard Business provisioning
and provider/runtime activation; Task10 retains L1-L4 approval semantics.
Canonical task status remains unchanged until actual delivery evidence exists.

## Documentation issuance

[FR-285](../../requirements/FR-285.md) is a standalone reviewed-migration record.
Root checked freshly fetched main at 60ffd1d9 before issuance and used the
sanctioned reviewed-record registration, ID writer and registry generator.
Existing IDs and feature memberships remain unchanged. This source records root
disposition under the trusted user mandate; registration does not prove delivery.
No existing source-row hash or generated export was edited manually.

## Approval

The review hash below covers the earlier private v1 design, not this later
revision text or runtime patch. Root adopted the v0.1.1 error clarification and
v0.1.2 backup criterion under the same delegated mandate. Independent final
verification/review must bind the complete artifact head before merge.

Root disposition on 2026-10-15 under the current trusted user mandate and standing in-scope product/technical delegation. The independent Luna reviewer passed the source design at SHA-256 0396B6AE4800EB70ED713A0A8873DEC493B8A462A9CDC4DC90218247B072650C after three bounded findings were corrected. Root adopts these eight criteria for local repository implementation; no production/Supabase migration apply, provider credentials, live-agent activation or bulk backfill is admitted. The user did not separately approve this exact document; root records the delegated decision explicitly.

## Version diff

0.1.1 -> 0.1.2: adds the existing installation backup round-trip invariant to persistence acceptance after strict governance exposed the new model's missing snapshot integration. Root admits a corrected bounded cycle under the same Task9 identity with prior repair history retained; no restore authority or external migration permission changes.

0.1.0 -> 0.1.1: clarifies the existing fail-closed error categories: incompatible template/version is a conflict; malformed or tampered v1 content is corruption. Both refuse mutation. No authority, feature scope or persistence behavior changes.

0.0.0 -> 0.1.0: adopts the bounded Agent Factory v1 local contract, resolves the candidate proposal's technical choices for v1, specifies runtime NOT_CONFIGURED and scoped audit/rollback requirements, and admits one standalone FR through the reviewed migration workflow. Existing identities, feature memberships and unrelated candidate ADRs remain unchanged.
