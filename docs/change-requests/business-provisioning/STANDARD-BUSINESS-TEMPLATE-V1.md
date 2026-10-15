---
id: ZAI:STANDARD-BUSINESS-TEMPLATE-V1
doc_type: change-request
title: Standard Business Template v1
status: approved
superseded_by: null
version: "0.1.1"
date: "2026-10-15"
task_id: TASK-ZAI-013
source_revision: e382bafbef22951f23bd5a2e1fee786225a45b35
relations:
  - type: references
    target: ZAI:FR-074
  - type: references
    target: ZAI:FR-169
  - type: references
    target: ZAI:FR-191
  - type: references
    target: ZAI:FR-192
  - type: references
    target: ZAI:FR-197
  - type: references
    target: ZAI:FR-285
---

# Standard Business Template v1

**Terminology:** A default Business Space below is a BUSINESS-scoped row in the Prisma Workspace model. The user-facing Workspace selection is the Portfolio; this proposal creates no WorkspaceMembership.

**Lifecycle:** Root-adopted bounded local contract v0.1.1 under the standing trusted user mandate. Implementation, verification, publication and production effects require their actual evidence.

## Purpose and boundary

Task-ZAI-013 adds one versioned baseline to each newly created Business and one
stable default Business Space. It extends the two existing FR-074 creation paths and
composes with the already delivered FR-285 Business Agent Factory. This contract
covers local schema, service behavior, backup safety, and isolated SQLite and
disposable PostgreSQL acceptance.

This contract lives in docs/change-requests/, which is an intake location and
does not itself create product requirements. The integrator
must use the repository's reviewed record-migration and ID-writer process on a
fresh base before issuing a canonical FR. This contract changes no existing
requirement identity, registry, roadmap row, or historical record.

Task-ZAI-014 owns the separate Business-number-two browser and runtime isolation
acceptance. This contract makes no claim about provider setup, live agent
activation, external migration application, bulk backfill, or a public template
apply API.

## Source-verified facts at the stated revision

The baseline inspected for this proposal is
e382bafbef22951f23bd5a2e1fee786225a45b35.

- [FR-074](../../requirements/FR-074.md) authorizes createBusiness inside an
  existing Tenant only when the caller owns that Tenant. Its self-service
  businessInGroup path requires an authenticated viewer and binds that creator
  as Tenant OWNER in the same transaction.
- The current
  [scope service](../../../apps/server/src/modules/project-manager/application/scope-service.js)
  implements both paths. createBusiness currently creates no Business Space (Workspace model) row.
  createBusinessInGroup creates a BUSINESS-scoped Workspace model row with businessId,
  tenantId, and portfolioId, and already provisions FR-285 configuration.
  Its empty-installation Portfolio and audit are inside the provisioning
  transaction.
- [FR-169](../../requirements/FR-169.md) keeps Business capabilities separate
  from Membership grants. capabilitiesJson defaults to {}; absent physicalStock
  is treated as on. knowledgeCandidatesEnabled is a separate content-admission
  setting and defaults off. A template must not change these values.
- [FR-191](../../features/FEAT-027/requirements/FR-191.md) preserves named,
  reasoned Membership grant and revocation history.
  [FR-192](../../features/FEAT-027/requirements/FR-192.md) makes grant scope
  explicit, preserves the Business/Workspace ancestry rules, and retains the
  existing Workspace.businessId delete restriction. The
  [identity charter](../../domains/identity/CHARTER.md) assigns Membership and
  RoleBinding writes to the identity lane.
- [FR-285](../../requirements/FR-285.md) and the
  [Task9 contract](../agent-factory/AGENT-FACTORY-V1.md) define five persisted
  agent-role configurations, not five running agents. They keep dynamic
  delegation denied, scope to the server-derived Tenant and Business, and
  compose new-Business configuration into FR-074's authorized transaction.
  Agent tool/policy snapshots do not grant Membership, RoleBinding, or Gate F
  authority; agent writes retain FR-026 Gate F.
- The current [domain catalogue](../../../apps/server/src/config/domains.js)
  and [application RBAC catalogue](../../../apps/server/src/modules/identity/rbac.js)
  are reference definitions. DOMAIN_GROUPS such as scm and crm are not
  grantable domain keys. The
  [project-manager charter](../../domains/project-manager/CHARTER.md) requires
  writes to go through an application service and records them in the audit
  trail. The [agent charter](../../domains/agent/CHARTER.md) keeps the FR-285
  owner administration route distinct from internal FR-074 provisioning.
- [FR-197](../../features/FEAT-029/requirements/FR-197.md) requires operator
  authority and an attributed use audit for backup preview and restore. The
  current [backup service](../../../apps/server/src/modules/project-manager/application/backup-service.js)
  already exports Business, Workspace, and AuditEvent rows and protects Task9
  configuration from legacy snapshots that omit its table. New Business and
  Workspace columns need their own legacy-field protection.

## Adopted bounded decisions

Root adopts these clauses under the standing user delegation. Source facts
above remain pinned to their stated baseline; adoption does not claim delivery.

### Versioned, catalog-only snapshot

Use templateId standard-business and templateVersion 1.0.0. Store a canonical
JSON snapshot and its SHA-256 digest on the Business. The snapshot binds schema
version standard-business/v1, template ID/version, the Business/Tenant/Portfolio
scope IDs, and these catalog definitions:

- Domains: business-home, commerce, customer, market, growth, people, projects,
  assets, line-oa, inventory, procurement, knowledge.
- Application roles and permissions:
  - PRODUCT_OWNER: product.read, product.plan.write, product.decision.write,
    product.work.write.
  - CUSTOMER_DATA_REVIEWER: customer.import.review.read,
    customer.import.review.decide.
  - ASSET_RECEIVER: asset.read, asset.intake.write.
  - ASSET_REVIEWER: asset.read, asset.evidence.review.
  - LINE_OA_PUBLISHER: line-oa.read, line-oa.account.publish.
  - INVENTORY_MANAGER: inventory.read, inventory.catalog.write.
  - SALES_REP: crm.read, crm.sales-task.write, crm.retention-consent.write,
    commerce.read, commerce.order.write.
  - PAYMENT_VERIFIER: commerce.read, commerce.payment.verify.
  - PROCUREMENT_BUYER: procurement.read, procurement.po.write.
  - GOODS_RECEIVER: procurement.read, procurement.receipt.post.
- Conflict pairs: SALES_REP / PAYMENT_VERIFIER and
  PROCUREMENT_BUYER / GOODS_RECEIVER.

The snapshot describes catalog definitions only. It creates no Membership,
domainKeysJson value, RoleBinding, module activation, integration, provider
credential, or action authority. Exclude reserved operations and warehouse,
installation platform, and grouping-only scm/crm from the domain list.
business-home remains governed by its existing always-visible policy.

The five FR-285 agent roles (EXECUTIVE, OPERATIONS, FINANCE_ANALYST, RESEARCH,
MARKETING) remain in their separate BusinessAgentConfig snapshot. Creating a
Business writes that configuration and its existing attributed audit as FR-285
requires; the Task13 catalog snapshot does not turn those roles into application
RBAC grants.

Keep a frozen v1 catalog definition independently of the mutable domain and
RBAC modules. Validate a stored v1 snapshot against that pinned definition, its
schema, scope identity, and canonical SHA-256 digest; never rebuild or validate
it against today's mutable catalogs. Digest consistency alone is not approval.
A later catalog change must not rewrite or relabel an old snapshot with the
same version. A future standard template version must explicitly pin its own
catalog content under a separately reviewed contract. On introduction, tests
compare the pinned v1 definition with the then-current domain/RBAC catalogs; a
simulated later catalog change must leave stored v1 readable and grant-free.

Persist four nullable Business fields:
provisioningTemplateId, provisioningTemplateVersion,
provisioningTemplateDigest, and provisioningSnapshotJson. They are either all
null or all populated. A partial marker, unsupported version, invalid JSON,
wrong scope identity, or digest mismatch refuses without repair or overwrite.
An existing Business with all four values null remains unmarked and untouched.

Export the pure validator validateStoredBusinessProvisioning(business, workspace).
It performs no database reads or writes and validates both unmarked state (all
four Business markers and the Workspace key are null) and a complete marked v1
Business Space, including equality to the pinned v1 definition, digest, stored
scope identity, STANDARD_DEFAULT key, and matching Business/tenant/portfolio
IDs. It returns a typed valid/unmarked result or a typed integrity error.
Backup preview and the replacement transaction use it to validate incoming
Business/Business-Space rows without calling the provisioning helper. The
database-backed creation helper separately confirms that exactly one matching
Business Space exists and that its current ancestry is derived from the Tenant.

### One stable default Business Space

Add nullable Workspace.provisioningKey. The standard Business Space has
provisioningKey STANDARD_DEFAULT; enforce uniqueness by
(businessId, provisioningKey). Ordinary Workspaces keep the key null.
Only a BUSINESS Workspace with a real Business may use the standard key.

The Workspace is scoped to the Business and carries the full database-derived
ancestry: businessId, tenantId, and portfolioId. Resolve those ancestors from
the persisted Business and Tenant; never trust request-supplied ancestor IDs.
In createBusinessInGroup, mark the existing starter Workspace as the standard
default rather than adding a second Workspace. In createBusiness, create exactly
one such Workspace in the existing Tenant transaction. Preserve the existing
workspaceName override where that creation path accepts one; otherwise use the
existing Thai fallback derived from the Business name. The name, code, and
Business settings remain ordinary mutable product data after creation.

### Private provisioning and transaction boundary

Use a private application-service helper called only from the two existing,
already-authorized FR-074 transactions:

1. createBusiness first resolves and verifies persisted Tenant OWNER authority.
   It then creates the Business, standard default Business Space, Task9 configuration,
   and attributed audits in that transaction. It does not grant an OWNER or any
   other Membership.
2. createBusinessInGroup keeps its authenticated self-service path, including
   empty-installation Portfolio bootstrap. It creates the Tenant, Business,
   existing starter/default Business Space, the existing founder Tenant OWNER
   Membership, Task9 configuration, and attributed audits in one transaction.
   The founder OWNER row is the existing FR-074 grant, not a template grant.

Derive actor, Tenant, Business, and Workspace ancestry from server-resolved
context and transaction rows. A client flag, ownedBusinessIds snapshot, role,
actor ID, or tenant ID cannot select an internal authorization bypass. Keep
standard-template provisioning out of public preview/apply routes. The existing
FR-285 owner administration API remains a separate feature.

Record one attributed Business template-provisioning audit with action
BUSINESS_TEMPLATE_APPLIED for the new snapshot,
including the server actor, Tenant, Business, template ID/version, and digest.
It commits with the Business, Workspace, FR-285 configuration and existing
creation/configuration audits. A failure in any write leaves no partial scope;
the empty-installation Portfolio and its audit also roll back.

### Exact repeat, conflict, and catalog drift

If the private helper is invoked again for the same persisted Business and sees
a complete, valid matching v1 marker and exactly one STANDARD_DEFAULT
Business Space with matching Business identity and derived ancestry, it
returns ALREADY_APPLIED. It does not update Business capabilitiesJson,
knowledgeCandidatesEnabled, name, version or timestamps; does not update the
Business Space name, status, version or timestamps; and does not add another template
or another BUSINESS_TEMPLATE_APPLIED or Task9 APPLIED audit. This helper-level rule preserves legitimate edits made
after creation. It does not promise duplicate HTTP create requests are
idempotent.

A different marker version or digest, a partial/corrupt snapshot, or a missing,
duplicate, wrongly keyed, or incorrectly scoped default Business Space is a
typed refusal. Do not silently replace, recreate, or repair these rows. Matching
identity and ancestry are the integrity checks; post-creation names and settings
are not compared with their initial values.

## Given / When / Then acceptance

1. **Catalog snapshot and no implicit grants.** Given template v1.0.0, when a
   Business is provisioned, then its canonical snapshot and digest match the
   pinned catalog above; no Membership, domain grant, RoleBinding, Business
   capability, knowledge-admission setting, provider, or action authority is
   created by the template. FR-285's five persisted agent configurations stay
   separate.
2. **Existing-Tenant creation.** Given an authenticated persisted OWNER of a
   Tenant, when createBusiness succeeds, then one Business, one
   STANDARD_DEFAULT Business Space with the Business's database-derived three-ID
   ancestry, its Task9 configuration, and the attributed creation/template
   audits commit together. No new Membership is granted.
3. **Self-service creation.** Given an authenticated principal, when
   createBusinessInGroup succeeds, then its Tenant, Business, exactly one
   existing starter/default Business Space, founder Tenant OWNER Membership, Task9
   configuration and all audits commit together. If the installation has no
   Portfolio, its bootstrap Portfolio and audit commit in that same transaction.
4. **Authority refusal.** Given an unauthorized or unauthenticated principal,
   a wrong-Tenant Business, or payload fields that claim another actor, role,
   Tenant or ancestor IDs, when either creation path is attempted, then
   existing FR-074 authorization and server-derived ancestry prevail and no
   unauthorized scope, Membership, Workspace, Task9 configuration or template
   audit is written.
5. **Same-Business helper no-op.** Given a valid matching v1 marker and default
   Business Space, when the private helper is invoked again for that same
   persisted Business, then one marker/snapshot and one default Business Space
   remain and no timestamps, versions, Workspace status, mutable settings, user-edited names, or
   attributed APPLIED audits change. No duplicate HTTP create idempotence is
   implied.
6. **Conflict and corruption refusal.** Given a partial marker, unknown or
   mismatched version/digest, invalid or tampered snapshot, or missing,
   duplicate, or mis-scoped STANDARD_DEFAULT Business Space, when provisioning
   encounters it, then it returns a typed refusal before overwrite. Existing
   Business data and audit history remain unchanged.
7. **Atomic rollback.** Given injected failures after Portfolio bootstrap,
   Workspace creation, template persistence, FR-285 configuration, or any
   required audit write in either path, when the transaction fails, then no
   partial Business/Workspace/template/configuration/grant/audit rows remain.
8. **Business lifecycle.** Given the existing FR-192 Workspace restriction,
   when an authorized existing lifecycle removes a Business after its dependent
   Workspaces permit deletion, then the template fields disappear with that
   Business, the dependent FR-285 config follows its existing lifecycle, and
   the original attributed template audit and other Businesses' data remain.
   This adds no Business deletion endpoint and does not weaken Workspace
   ancestry or delete protection.
9. **Complete backup round trip.** Given a current export containing Business,
   Workspace and AuditEvent rows, when the established authorized restore runs,
   then all four Business marker values, STANDARD_DEFAULT key, names,
   timestamps, versions, canonical snapshot, digest, and original attributed
   template audit are restored exactly. Restore does not call the provisioning
   helper or create another APPLIED event. Existing FR-197 operator checks and
   restore audit placement remain intact.
10. **Legacy field omission.** Given a legacy artifact whose Business and
    Workspace arrays exist but whose rows omit the new marker/key fields, when
    preview or import targets a live non-null marker or key, then preview refuses
    before replacement and import rechecks inside its Serializable replacement
    transaction before the first delete. Keep FR-197's authorized preview-use
    audit on the refusal. A row property explicitly present as null, or an
    explicit empty table array, is a complete replacement value under the
    existing operator-confirmed restore flow; show that replacement in preview
    and do not confuse it with an omitted legacy field. An empty installation
    may still accept a legacy artifact without inventing a template.
11. **Schema and recovery census.** Given isolated SQLite and disposable
    PostgreSQL schemas, when the nullable markers, Business/Workspace key
    constraints, transaction path and backup guards are checked, then both
    adapters enforce the same scope, uniqueness and rollback outcomes. The
    Phase B static inventory remains 205 models, its current schema hash/pin is
    rebound to the new columns, all historical mappings and pins remain
    unchanged, and historical schemas continue to refuse under their original
    rules.
12. **Bounded result.** Given the frozen local Task13 patch, when its required
    tests, independent review, governance, and exact-head CI run, then root
    reconciles only evidence actually produced. Browser Business-number-two
    isolation remains Task14; no provider, live-agent, external migration, or
    production activation is reported as delivered by this task.

## Implementation and test map

Proposed implementation sources are the existing
apps/server/src/modules/project-manager/application/scope-service.js, new
business-provisioning-template.js and business-provisioning-service.js in that
application directory, apps/server/prisma/schema.prisma, and one new source SQL
migration under apps/server/supabase/migrations/. The migration filename is
assigned by the integrator. Do not change the separately owned FR-285 agent
factory unless implementation review identifies a concrete defect.

Meaningful checks should cover the pure template snapshot/digest and corruption
rules; both FR-074 integration paths and spoofed authority; transaction rollback,
repeat/concurrent no-op, post-creation edits and Workspace ancestry; Business
lifecycle constraints; backup round trip and legacy omission with commit-side
recheck; and Phase B model-count/hash history. Relevant existing suites include
apps/server/tests/integration/fr074-scope-creation-authorization.test.js,
apps/server/tests/integration/agent-factory-backup.test.js, and
apps/server/tests/integration/phase-b-recovery.test.js. Add focused
business-provisioning-template unit/integration coverage instead of relying
only on the existing factory tests.

Task13 uses isolated SQLite and disposable PostgreSQL for local schema and
service verification. The source SQL migration is not applied to production or
Supabase by this contract. Root owns backup integration and the static
inventory/recovery metadata reconciliation.

## Approval

On 2026-10-15 root adopts v0.1.1 under the user's explicit standing delegation
to decide and execute in-scope roadmap work, continued by the current “next”.
The distinct Luna max design review requested concrete TaskContainer semantics
and preservation of mutable Space status; this revision incorporates both.
This is root disposition under existing authority, not a fabricated separate
human approval. The exact local scope is contract, sanctioned FR issuance,
schema/service/tests, backup integrity and static recovery census. Production,
Supabase apply, provider/live-agent activation and credentials remain excluded.

## Version diff

0.0.0 → 0.1.0: proposed the bounded template and provisioning contract.

0.1.0 → 0.1.1: adopts the independently reviewed catalog-only semantics,
version-pinned historical validation and same-Business no-op, including Space
status preservation; reconciles the Task13 acceptance wording. No test or
implementation completion is claimed by adoption.
