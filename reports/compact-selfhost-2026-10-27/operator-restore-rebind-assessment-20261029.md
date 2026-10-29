---
doc_type: source-assessment
status: draft
version: "0.1.0"
recorded_at: "2026-10-29"
source_revision: "5b5131a0f5bf8706baf52b9dd0ec8b786df00972"
scope: "Compact Asset/catalog managed-blob recovery; planning only"
---

# Compact managed-blob operator recovery assessment

The owner selected planning for **Asset/catalog managed-blob restore/rebind** on
2026-10-29. PostgreSQL installation restore is a separate prerequisite; this
assessment does not qualify complete installation recovery. No application code,
canonical record, schema, authority grant or deployment changes in this task.

## Authority and the selected gate

- [ADR-115 D5–D8](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md)
  preserves fresh-only installation, separately reviewed existing-data import,
  private purpose-separated storage, exact versions, secrets and distinct gates.
- [Task7](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task7-installrestartrecovery-matrix-and-release-handoff)
  leaves a supported PM-owned managed-blob restore/rebind operation open.
- [ZAI:FR-045](../../docs/features/FEAT-001/requirements/FR-045.md) and
  [ADR-016](../../docs/decisions/ADR-016-SQLITE-AUTHORITY-AND-MANAGED-LOCAL-FILE-WORKSPACE.md)
  own FileAsset identity, ownership, links and audit. Their existing local-file
  relink/remount behavior is not a managed-object replacement contract.
- [ZAI:FR-072](../../docs/requirements/FR-072.md) requires the existing
  `ownsBusiness` predicate for Business-governed writes.
  [ZAI:FR-075](../../docs/requirements/FR-075.md) instead governs installation-wide
  restore. Neither authority is an alias for the other.
- [ZAI:FR-013](../../docs/requirements/FR-013.md) and
  [ZAI:BR-008](../../docs/requirements/BR-008.md) require preview/confirmation for
  snapshot restore; they do not authorize an arbitrary ref setter.
- [ZAI:SEC-030](../../docs/requirements/SEC-030.md),
  [ZAI:FR-223](../../docs/features/FEAT-036/requirements/FR-223.md) and ADR-089
  exclude envelope ciphertext/KEK and require credential re-entry after restored
  snapshots. This narrow operation exports no credential families at all.

The [candidate plan](../../docs/plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md)
proposes the missing behavior. It issues no requirement ID or public API/schema.

## Source findings

| Finding | Exact source | Consequence |
|---|---|---|
| Successful core/recovery remains a TEST harness | `apps/server/tests/helpers/compact-recovery-target.mjs`, `copyExactObjectAndRemapFixture()` | Direct SQL/CAS and `COMPACT_TEST_ONLY_REF_REMAP` cannot become an operator implementation by renaming the test. |
| File Management is the sole managed-content metadata writer | `apps/server/src/modules/project-manager/application/file-asset-service.js`, `createManagedBlobFileAsset()` | Asset/Knowledge/Commerce call the File Management service; storage adapters do not own FileAsset updates. |
| Existing relink rejects managed blobs | Same file, `relinkFileAsset()` | It explicitly accepts `LOCAL_FILE` only. There is no managed-object recovery command in the enumerated File API/service scope. |
| Read authorization precedes provider IO | Same file, `resolveFileAssetContent()` | Preserve visibility checks, active/undeleted state and persisted integrity checks; denied callers must cause zero provider IO. |
| Write predicate consumes a server-resolved ownership list | `src/modules/identity/viewer-authority.js`, `ownsBusiness()`; PM `project-authorization.js` | A stale Viewer is not a transaction fence. Confirm must resolve/revalidate current authority; the ownership-revocation serialization protocol needs a reviewed design. |
| S3 business ports already provide immutable put, pinned get and exact remove | `src/platform/storage/private-business-object-storage.js` | Reuse these methods, purpose/bucket/namespace checks and sanitized errors. No endpoint or credential is taken from a ref or request. |
| The shared S3 port already recovers an ambiguous immutable PUT | `src/platform/storage/s3-object-storage.js`, `recoverImmutable()`; `tests/unit/knowledge-s3-object-storage.test.js` | HEAD discovers a candidate version; an exact-version GET verifies bytes/hash/size before attachment. The business wrapper does not expose this helper; an operation-scoped adapter still needs contract approval and tests. |
| Asset and catalog are different configured purposes | Same port; `src/platform/storage/supabase-object-storage.js` | A restore cannot route an unknown/foreign ref to another provider or fall back to Supabase. Native Knowledge `s3://` stores remain excluded. |
| Asset evidence links FileAsset identity/hash | `src/modules/asset-management/application/asset-evidence-service.js`, `asset-intake-service.js` | Preserve evidence links, review decisions and content hash; restoration does not re-extract or approve evidence. |
| Catalog consumers depend on file/content lineage | `src/modules/knowledge/smartgift-catalog-upload-service.js`; `src/modules/commerce/application/pricing-catalog-service.js` | Rebinding identical bytes must preserve IDs and lineage, and must not re-admit, republish, calculate prices or grant Knowledge serving authority. |
| Legacy import is installation-wide replacement | PM `backup-service.js`, `previewImport()` / `importSnapshot()`; `src/app/api/backup/import/route.js` | Its operator check, protected-family guards and delete/replace semantics are not this operation. Do not modify it to make Compact fixtures pass. |

Paths in the table are Server-relative after the first two rows. Inspected
filesystem scopes include PM application/services and File API routes, private
storage ports, Asset/catalog consumers, canonical records and the retained Compact
reports. Generated registry/view membership is not an absence proof.

## Actual 5b evidence and its limits

- [Producer 40818222990](https://github.com/Freshair129/zuri.ai/actions/runs/40818222990)
  passed 217 contracts and an actual TEST provider probe. Its input artifact is
  `12873068839`.
- [Consumer 40819105575](https://github.com/Freshair129/zuri.ai/actions/runs/40819105575)
  passed packaging, core browser 1/1 and bounded recovery 2/2. Both observations
  report cleanup PASS. Observations artifact: `12873612547`.
- The source is `5b5131a0f5bf8706baf52b9dd0ec8b786df00972`, manifest SHA256
  `80c6c5d3dd8620b24b4cd589c391628f3787bf72665b596b9e84a8ac175f9318`,
  package inventory SHA256
  `89d481b50690e44565a82463cf2fcbec870d7f974a4de07c0453cc4d6d7ed86c`.
- The fixture transferred synthetic rows and exact Asset/catalog bytes, excluded
  one envelope row, exercised credential re-entry and retained distinct physical
  DB identities. Its eight postconditions are not a public/operator workflow.
- `operatorRecovery` explicitly remains `NOT_QUALIFIED`. AI, native Knowledge,
  off-host recovery, minimum hardware and production/release remain separate.

Older `NOT_RUN` reports are historical snapshots, not errors to rewrite. Earlier
e1 qualification and failed producer attempts remain separate evidence.

## Missing contract and implementation

1. A reviewed canonical behavior record for managed-blob recovery and the
   permission/transport/data-lifecycle contract. FR-045/FR-013/FR-075 must not be
   silently broadened or have their pinned subjects repurposed.
2. A supported owner-authorized prepare/preview/confirm path, with trusted
   staging, current metadata/authority checks and opaque operation identity.
3. Durable operation/result/cleanup semantics for request loss and crashes.
   An audit row alone is not a resumable operation receipt. S3 and PostgreSQL
   do not provide a shared atomic commit.
4. Native PostgreSQL proof of authority/CAS/audit ordering, including revocation,
   concurrent file changes and deletion. A fresh Viewer at preview alone is not
   sufficient.
5. A supported operator procedure and actual product entrypoint tests replacing
   the fixture-only metadata remap. Success cannot be manufactured with direct
   bootstrap SQL, a fabricated Viewer or a domain-admission bypass.

## Disposition

Reuse of `recoverImmutable()` is a concrete building block, not unknown-provider
magic: only a durable server-created operation key and expected hash/size may be
inspected through the reviewed purpose/configuration boundary. Missing/null
versions, absent objects, hash mismatch and ambiguous outcomes remain refusals,
not permission to attach `latest`. Existing Compact provider tests exercise this
helper for versioned replacement bytes; they do not qualify a resumable operator
operation or its authority/cleanup protocol.

FR-045/ADR-016 retain their historical local-file/SQLite authority statement.
The adopting recovery contract must explicitly name the Compact PostgreSQL
metadata target for managed blobs rather than rewriting that pinned statement.

The managed-blob subgate stays **NOT_QUALIFIED** pending contract adoption,
implementation and exact-artifact acceptance. The selected first slice can
qualify same-target Asset/catalog byte restoration/rebinding against trusted
current metadata. It cannot qualify PostgreSQL database restore, an imported
historical authorization state, cross-Tenant/Business transfer, complete
installation recovery or an off-host backup failure domain.
