---
doc_type: assessment
status: reviewed
version: "0.5.0"
date: "2026-10-26"
source_revision: "4414a33e142decc6bd3941197aa98f6a24b7abd8"
---

# Knowledge lifecycle and serving assessment

Knowledge remains **beta**. This report records a bounded continuation of the
main-dev qualification, not whole-system completion or production adoption.
The [Knowledge charter](../../docs/domains/knowledge/CHARTER.md) owns capability
boundaries; canonical records and approved decisions remain authoritative.
No requirement, permission, model selection or delivery date is created here.

The latest continuation passes focused recovery units and a real MinIO / clean
TEST PostgreSQL **storage and Tier 1** proof with synthetic data. Original exact
versions were deleted after backup, then retained content was copied from the
backup version, hashed and mapped to its new destination version. One newer
withheld object was not copied. Application restore acceptance remains blocked;
no serving, production memory, LINE send, commit or deployment was activated.

A subsequent independent review identified P2: TEST descriptor fields could be
paired with a port configured for another destination. The follow-up now requires
factory-owned immutable endpoint/bucket/region identity before I/O. Earlier
provider results remain history; attempt 4 repeats the proof after capturing
the validated descriptor and port before awaits, preventing caller substitution.

## Inspected source and boundaries

The audit began at Zuri `2700db9790b62340e886219a32412a9050b8ce33`.
After fetching `main`, the Knowledge and relevant Agent application source was
unchanged at `4414a33e142decc6bd3941197aa98f6a24b7abd8`. Repairs are isolated on
`codex/knowledge-storage-recovery-20261026`, based on that main revision; the
existing batch32 helper branch/PR is preserved separately.

Sources: [FR-173](../../docs/features/FEAT-013/requirements/FR-173.md),
[FR-235](../../docs/features/FEAT-038/requirements/FR-235.md),
[FR-111](../../docs/features/FEAT-013/requirements/FR-111.md),
[FR-254](../../docs/features/FEAT-013/requirements/FR-254.md),
[ADR-072](../../docs/decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md),
[durable storage contract](../../docs/plans/TASK-ZAI-049-DURABLE-KNOWLEDGE-STORAGE.md),
[ownership/reliability design](../../docs/change-requests/knowledge/genesisrag17-ownership-reliability-20261023.md),
and [binary parsing contract](../../docs/change-requests/knowledge/binary-document-parsing-20261018.md).
Historical plan paths retain their recorded authority; their directory does
not make them disposable or a new development plan.

## Findings

| Finding | Classification | Evidence and disposition |
|---|---|---|
| Lost object PUT reply blocks recovery | Confirmed implementation defect | The old storage service repeated a conditional PUT for a PENDING reference with no known version. A remotely committed first PUT then makes retry fail with OBJECT_EXISTS. Regression reproduced failure before the repair. Recovery now discovers a candidate version and verifies exact-version bytes/hash/length before attaching it; known versions are retained before readback. |
| Terminal reference can return to READY | Confirmed implementation defect | The old store accepted existing QUARANTINED/ERASED records; the regression can restore READY. A real erased version will usually return not-found instead. Both states now reject before storage access. Deferred-read regressions additionally reproduced READY/quarantine overwriting concurrent ERASED; compare-and-swap transitions and an ERASURE_PENDING fence address that interleaving. |
| Generic GKS answer can outlive source withdrawal before LINE send | Confirmed defect; bounded source ordering verified locally | The candidate rechecks model-retained citations before SENDING and holds source locks through claim commit. The new disposable PostgreSQL tests exercise actual withdrawal and worker transactions in both lock orders and require the expected pg_stat_activity blocker. Citation resolution and provider transport remain mocked; this proves the source-write/claim order, not native lineage or live LINE acceptance. |
| Customer/staff Knowledge Vault policy | Reconciled contract gap | The Knowledge charter now links existing File/Business/Project admission authority, public LINE security and the default-off bounded Product policy, separately from MSP episodic vaults. No canonical source defines general customer/staff document-vault recipients, grants or lifecycle. Existing Business corpus membership is not a new public grant. |
| Storage backup restores original external bytes | Confirmed implementation/acceptance gap | The revised integration test destroys the fixture object bytes before importing the snapshot. DB metadata returns READY and preview still reports AVAILABLE, but the real exact-version raw reader cannot read the missing object. AVAILABLE validates reference metadata, not object availability. There is no object-byte restore port or audited version-remapping path in the current snapshot importer. |
| Managed PDF/DOCX admission through UI/native runtime | Acceptance not rerun | The selected integration covers managed HTML admission and separate PDF/DOCX/HTML parser-lineage/replay. This is not full binary UI/native journey acceptance. |
| Binary raw citation download | Scope qualification needed | The current console returns binary raw metadata with null content and a text download route. Confirm the approved binary extension's download scope before treating this as absent required behavior. Existing exact text citation tests do not prove binary downloads. |
| Integrity failure on the standalone raw-object reader | Confirmed implementation defect; locally verified candidate | The previous reader rejected a declared hash/length mismatch without quarantine, and trusted a port's claimed checksum. It now verifies actual bytes, length and exact version, then quarantines only that same READY version on mismatch. The reader currently has no application caller; this is not application-wide storage adoption. |
| TEST descriptor can hide a differently configured storage port | Confirmed P2; identity-fixed candidate | Method shape alone did not bind transport destination. Three regression failures reproduced requests reaching a mismatched port. A factory-private WeakMap now binds the exact frozen S3 instance to its actual configured endpoint, bucket and region; copied fields/wrappers do not register. Backup, restore and diagnostic entry points reject mismatch before object or DB I/O. |

Source and test locators for these findings:

- Storage: [lifecycle service](../../apps/server/src/modules/knowledge/knowledge-artifact-storage-service.js),
  [S3 recovery adapter](../../apps/server/src/platform/storage/s3-object-storage.js),
  [lifecycle regressions](../../apps/server/tests/unit/knowledge-artifact-storage-service.test.js)
  and [provider contract tests](../../apps/server/tests/unit/knowledge-s3-object-storage.test.js).
- Generic LINE: [send claim](../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js)
  and [delivery regression](../../apps/server/tests/integration/server-line-jobs.test.js),
  the [Knowledge-owned source fence](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js),
  [adapter unit tests](../../apps/server/tests/unit/knowledge-delivery-fence.test.js)
  and [PostgreSQL ordering tests](../../apps/server/tests/postgres/knowledge-line-withdrawal-races.test.js).
- Backup: [snapshot integration test](../../apps/server/tests/integration/knowledge-storage-ingestion.test.js).
- Binary download: [console service](../../apps/server/src/modules/knowledge/knowledge-console-service.js)
  and [artifact route](../../apps/server/src/app/api/knowledge/citations/[citationId]/artifact/route.js).

## Executed verification

Runs use isolated test databases. No main-dev/production business data, grants,
approved product fields, prices or stock were changed.

| Run | Actual result | Limit |
|---|---|---|
| Lifecycle baseline, 13 files | 169 passed, zero skipped | Admission, storage metadata, corpus/withdrawal, binary lineage, owner replay, worker recovery, LINE grounding and customer-product selection. One additional requested filename did not exist; it is not counted as a test. |
| Disclosure/citation/backup baseline, 9 files | 89 passed, 3 PostgreSQL-only tests skipped | Includes owner preview/policy, exact published price, stock policy, historical citation bytes and grant withdrawal during a slow read. Skips are not PASS. |
| Disposable PostgreSQL, 4 files | 36 passed, zero skipped | Same disclosure and stock policies, published price and owner replay; includes the three engine-specific checks skipped above. This is an isolated embedded PostgreSQL cluster, not the deployed database. |
| Storage RED | Three failures reproduced | Lost PUT reply and two terminal-state cases. |
| Storage race RED | Two failures reproduced | Valid/corrupt readback overwrote concurrent ERASED before CAS repair. |
| Storage lifecycle candidate, 4 files | 34 passed, zero skipped | Lost reply, exact version, conditional-write winner, terminal states, erasure/readback and duplicate/journal/integrity races; raw-reader corruption and lying checksum. Object requests use a simulated provider, not a real S3 outage. |
| Prior generic GKS and commercial delivery candidate, 5 files | 95 passed, zero skipped | Earlier point-in-time fence: real Prisma READY retry and Core trace, resolver denial, missing receipt, changed identity, transient resolver/trace-read recovery, customer-product/test-RAG and commercial guards. This is not a fresh live LINE exchange. |
| Prior disposable PostgreSQL candidate, 6 files | 85 passed, zero skipped | Repeats generic sends, disclosure, customer-product delivery, price, stock and replay on PostgreSQL before the source-lock continuation. |
| Source fence unit RED | Seven failures reproduced | The delivery fence export was absent before implementation. Separate process-selector regressions reproduced three unauthorized sends; that RED run was interrupted after the failures because Windows npm split a multiword test filter into extra file filters. It is not a completed suite or PASS. |
| Source-ordering continuation on disposable PostgreSQL, 7 files | 92 passed, zero skipped | Prior source-ordering patch, before the new offline restore module: actual source withdrawal and LINE claim transactions, two independent connections with observed blocking in both orders, process-selector denial, same-answer retry, disclosure, price, stock and replay. |
| Source-ordering/lifecycle continuation on SQLite, 12 files | 193 passed, zero skipped | Prior source-ordering patch, before the new offline restore module. Source fence, delivery, price/stock, corpus/repository and storage integrity/object-loss cases; no concurrent SQLite contention proof. |
| Source-ordering Server build | PASS | Before the offline restore delta: compilation, lint/type-validity and 94 static pages. Existing multiple-lockfile tracing warning; no standalone clean-lint claim. |
| Source-ordering governance and corpus checks | PASS | Before the offline restore delta: registry 553 records; graph 4,894 nodes / 20,283 edges / zero dangling; 96 views / 46 features. Strict preflight zero critical / zero warning / 43 info. Corpus 415 KB generated/check passed. |
| Actual-provider restore attempt 1 | FAIL; one test skipped by failed setup | MinIO did not pass `/minio/health/ready` within 30 seconds. Setup failed before bucket creation, child-database creation, source ingestion, copy or restore. No provider or restore acceptance passed. |
| Earlier offline-restore unit attempt | FAIL: 5 passed / 1 failed | Retained failure: valid empty workspaceId/agentId was rejected. Corrections were initially left unexecuted at closeout, then superseded by the resumed 8/8 result below. An earlier 4/5 attempt also exposed a test-spy phase error. |
| Resumed focused recovery unit suite | PASS: 8 / 8 | Scope and diagnostic identity/reference fixes verified. Two initial resumed failures came from counting fixture readback in diagnostic assertions; those assertions now measure the diagnostic phase only. |
| Port identity follow-up RED | Three failed / eight passed | Endpoint, bucket and region mismatch reached the injected request seam before the identity correction. Retained separately; not a PASS. |
| Port identity follow-up focused units | PASS: recovery 15 + S3 12 | Includes all original eight recovery cases plus genuine factory identity, method-shape forgery, source/destination mismatch, zero-I/O assertions and capture against descriptor mutation during an awaited source read. |
| Post-validation descriptor swap RED | One failed / fourteen passed | A caller swapped the backup port during source read. The attempted write reached the replacement before the capture fix; the current operation uses its validated frozen binding snapshot throughout. |
| Health-only probe 1 | FAIL | Captured MinIO exited 1, OOM false, ECONNREFUSED; startup failed creating/renaming `/data/.minio.sys` with file-access denied on the tmpfs fixture. |
| Health-only probe 2 | PASS; no object copy | Fresh Docker-local volume initialized for image UID/GID 1000:1000; exact `/data` mount verified; first readiness poll returned HTTP 200. No buckets or child database were created by this probe. |
| Actual-provider restore attempt 2 | PASS: one composite test, zero skipped | Real S3-compatible exact-version source/backup/target operations; fresh empty PostgreSQL child DB import; changed destination version, bytes/hash, audited mapping and Tier 1 lineage. Two sources / 16 local stages, one restored object and one newer-withheld object. Stage 9/native Fact recovery remains unproven. |
| Identity-fixed actual-provider restore attempts 3 and 4 | PASS: one composite test each, zero skipped | Attempt 4 repeats the proof after binding capture: real exact-version copy, clean TEST PostgreSQL import, audited mapping, Tier 1 lineage and synthetic withholding using genuine factory ports. Observation stays at the fetch seam; ports are not replaced by wrappers. |
| Earlier composed local regressions after recovery fixes | PASS: SQLite 201 / 13 files | Preserved pre-identity result; superseded for the current candidate by the 208-test run below. Counts overlap. |
| Final composed SQLite regressions after port capture | PASS: 208 / 13 files, zero skipped | Includes all 15 recovery cases, S3 identity, storage, corpus, source-ordering and unchanged product/price/stock delivery checks. Not a completeness percentage. |
| Composed PostgreSQL regressions after factory identity, before capture-only delta | PASS: 92 / 7 files, zero skipped | Actual source-ordering races, generic jobs, disclosure, customer-product, published price, stock and replay on a fresh disposable cluster. These paths do not import the offline restore module changed by the later capture delta; actual-provider attempt 4 separately exercises that final module with clean TEST PostgreSQL. |
| Composed Server build including the recovery delta | PASS | Compilation, lint/type-validity phase and 94 static pages. Existing workspace-root/multiple-lockfile warning remains. This is not deployment or standalone clean-lint proof. |
| Composed governance and corpus | PASS | Registry 553 records; graph 4,897 nodes / 20,287 edges / zero dangling; 96 views / 46 features. Strict preflight zero critical / zero warning / 43 info. Corpus generated/check passed at 415 KB. |
| Deployed main-dev read-only relay smoke | PASS | MSP to GKS evidence and MSP to worker published-generation query (one result). This checks the previously deployed runtime, not the new application patch or a fresh LINE exchange. |

Commands run from `apps/server` using the repository's zero-test guard:

```powershell
npm test -- tests/unit/knowledge-artifact-storage-service.test.js tests/unit/knowledge-s3-object-storage.test.js tests/integration/knowledge-storage-ingestion.test.js tests/unit/genesisrag17-lineage-repository.test.js
npm test -- tests/integration/server-line-jobs.test.js tests/integration/line-customer-product-delivery.test.js tests/integration/main-dev-test-rag-delivery.test.js tests/integration/line-product-facts.test.js tests/unit/line-knowledge-grounding.test.js
npm run test:postgres -- tests/integration/server-line-jobs.test.js tests/integration/line-product-disclosure-policy.test.js tests/integration/line-stock-disclosure-policy.test.js tests/integration/line-published-price-reader.test.js tests/integration/knowledge-replay.integration.test.js tests/integration/line-customer-product-delivery.test.js
npm run test:postgres -- tests/postgres/knowledge-line-withdrawal-races.test.js tests/integration/server-line-jobs.test.js tests/integration/line-product-disclosure-policy.test.js tests/integration/line-stock-disclosure-policy.test.js tests/integration/line-published-price-reader.test.js tests/integration/knowledge-replay.integration.test.js tests/integration/line-customer-product-delivery.test.js
npm test -- tests/unit/knowledge-delivery-fence.test.js tests/unit/knowledge-artifact-storage-service.test.js tests/unit/knowledge-s3-object-storage.test.js tests/integration/knowledge-storage-ingestion.test.js tests/unit/genesisrag17-lineage-repository.test.js tests/integration/server-line-jobs.test.js tests/integration/line-customer-product-delivery.test.js tests/integration/main-dev-test-rag-delivery.test.js tests/integration/line-product-facts.test.js tests/unit/line-knowledge-grounding.test.js tests/integration/knowledge-corpus.test.js tests/integration/knowledge-corpus-prisma.test.js
```

The baseline additionally selected admission/transaction, corpus, binary parser
lineage, replay, runtime loop/runtime, documents withdrawal, disclosure source/
route/contract, citation-artifact and backup tests. Local JSON reports are retained
in the worktree's ignored `.local/knowledge-readiness-20261026/` directory; they
are not portable checked-in evidence. Counts above overlap across engines and
must not be summed into a unique coverage or completeness percentage.

## Document audience reconciliation

The explanatory [Knowledge charter](../../docs/domains/knowledge/CHARTER.md#document-access-and-vault-terminology)
does not issue new policy. The canonical sources distinguish:

- File/Business/Project-authorized document admission and current citation access:
  FR-173, FR-254 and ADR-072/ADR-107.
- Existing internal Membership/RoleBinding authority: BR-020 and BR-034; being
  an employee or belonging to a Team does not itself grant document access.
- Public LINE Knowledge: SEC-009 and specifically approved, default-off FR-235
  Product disclosure, without widening price/stock authority or arbitrary document access.
- MSP episodic vaults: ADR-022, FR-057 and SEC-013; memory consent is not a
  document-vault grant.

**CONTRACT_BLOCKED:** a general document Vault needs eligible customer/staff
principal identities, grant/approval authority, allowed classifications and
Business/Project/account/customer scopes, and expiry/revocation/publication
semantics. This task does not infer those decisions or add a model/grant.

The following choices are **proposals for an owner decision only**. They do not
activate a document audience, supersede canonical contracts or authorize code:

| Open decision | Alternatives | Conservative proposal only | Existing authority |
|---|---|---|---|
| Eligible recipients | Existing internal Person/Membership/RoleBinding; or a separately approved external Customer/ChannelIdentity audience | Start with existing internal authority; define external identity/audience separately | BR-020, BR-034; FR-291's stock identity is a narrower contract |
| Grant and approval | Existing Business visibility; explicit per-file recipient/actions grant; or a separately reviewed owner workflow | Keep current internal visibility and require explicit scoped sharing beyond it | Identity resolves principals; File Management capability port authorizes file actions/sharing (ADR-107); Knowledge consumes that authority |
| Classification | PUBLIC for the existing public LINE query boundary; reviewed internal classifications; or additional CONFIDENTIAL/RESTRICTED controls | Classification alone grants no recipient access; preserve the public-serving boundary | SDD-062, FR-111 and TASK-ZAI-049 processing/location requirements |
| Scope | Business; Business plus owned Project; or separately approved account/customer/cross-Business scope | Tenant isolation and Business default, existing owned-Project guards | ADR-072 and ADR-107; no null-Business wildcard or implicit cross-Business grant |
| Expiry and revocation | Current-access denial; explicit Knowledge source/corpus withdrawal; or a new expiry-to-withdrawal workflow | Deny expired/revoked reads and define serving withdrawal explicitly; keep physical purge separate | Knowledge owns publication/citation enforcement (ADR-072); File Management owns file deletion/sharing (ADR-107); MSP memory rules remain separate |

## Restore qualification boundary

The negative restore test executes export, loss of original fixture object bytes,
snapshot import, and the real exact-version reader. It is a simulated object
provider; it neither backs up nor restores MinIO/S3. The importer restores reference
rows and local FileAsset content but has no external-object byte-copy or version
mapping operation. A successful import therefore cannot certify TASK-ZAI-049 §8.

The process-only TEST candidate implements exact-version copying
and audited physical-reference mapping:
[service](../../apps/server/src/modules/knowledge/knowledge-object-recovery-service.js),
[unit suite](../../apps/server/tests/unit/knowledge-object-recovery.test.js),
[isolated provider helper](../../apps/server/tests/helpers/knowledge-restore-storage.js),
[provider qualification](../../apps/server/tests/storage/knowledge-object-restore.test.js)
and [explicit config](../../apps/server/vitest.knowledge-restore.config.js).
It leaves original READY references unchanged and always records serving/runtime
activation and full acceptance as false. Its synthetic withholding set controls
only target object copying/diagnostic verification; it does not purge inline or
backup payloads and is not an operational erasure ledger.

Attempt 1 ran `npm --prefix apps/server run test:knowledge-restore:isolated` and
failed with `KNOWLEDGE_RESTORE_TEST_MINIO_HEALTH_TIMEOUT`. The resumed health-only
probe preserved startup state and credential-redacted logs: MinIO exited 1
without OOM, failed to create/rename under `/data/.minio.sys`, and readiness
received ECONNREFUSED. The actual fixture used tmpfs, not a Windows bind mount;
the pinned image runs as UID/GID 1000:1000. A fresh Docker-managed local volume
initialized for that identity passed health immediately. This corrects the
test storage/permission setup without disabling MinIO checks or borrowing
existing buckets/credentials. The failed attempts remain retained evidence.

Credentials were generated for each new container only. PostgreSQL authority
comes through Vitest injection into an embedded disposable cluster, not a
persistent TEST environment variable. The full successful run created three
fresh versioned buckets and a clean child database, then removed only its own
container, owned local volume and child database. Read-only post-run checks found
zero labelled containers, zero labelled volumes and zero temporary credential
directories; the read-only observation is retained as `restore-cleanup-check.json`
under the ignored local evidence directory. No existing volume/bucket, main-dev data, deployment or LINE send
was involved.

Independent review found the valid-empty-scope and diagnostic identity/reference
binding issues; the resumed 8/8 units verify the corrections. Re-review found no
blocker in the named-volume isolation or cleanup path; a startup cleanup failure
can deliberately leave an uncertain owned resource and must remain unverified.
The actual post-run resource check, rather than that path alone, establishes
the zero-resources result recorded here.

Latest successful provider identifiers, identity-fixed attempt 4 (synthetic data only):

| Evidence | Recorded value |
|---|---|
| MinIO local image ID | `sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f` (not a vendor RepoDigest) |
| Provider container | `fb5f443f92e6996a6eb19de788409f37cac211d110ab6e86a740af9132c2ab94` |
| Owned local volume | `zuri-restore-test-89e6de98-4bbe-46af-9379-a38da6b40169-data` |
| Clean child database | `zuri_knowledge_restore_test_a6665ee256c548ea96d60c5608a95e55` |
| Backup manifest SHA-256 | `5deebcecef2bda4cbab79eb4f0fe4857a04921c4f2c9a105343e92240a5fb9aa` |
| Mapping receipt SHA-256 | `fadb902de9e2a3d17c44664fd26c5eeb87578657c216d10492ea33d527b6c3bd` |

The latest version sequence was source `b337e5ff-632c-4fcb-9c5e-49fb16647fea` → backup
`62b7447b-9915-4c8e-bfda-0f69a7f93fdf` → restored
`ad7448a6-6ccd-44d2-b7eb-11505c92e5e8`. No latest-version read or mutation of the
original READY reference was used. Attempt-4 selected post-run code/config hashes
include the lifecycle service, S3 adapter, Tier 1 executor and snapshot importer.
Earlier attempt-2 source records, dependency supplement and executed helper copy
are retained as historical evidence. Git HEAD names only the base revision of
the dirty worktree; none of these is a signed release attestation.

Final independent composed-diff review by GPT-6 Luna Max found **no P1/P2
implementation blockers** within this bounded TEST path. The reviewer made no
file changes and ran no tests. Non-blocking findings were reconciled: source
hash coverage gained the pre/post dependency supplement, container-label wording
was narrowed to the actual identity/scope checks, and the inherited-credential
comment now distinguishes the explicit disposable PostgreSQL URL. Startup
cleanup uncertainty, operational erasure and application activation limits
remain explicit; they are not converted into acceptance by this review.

The later P2 port-binding finding supersedes that earlier signoff's coverage.
Independent Luna Max delta re-review found no remaining blocker after the
factory-identity correction. The WeakMap validates configured destination, not
the arbitrary behavior of an injected fetch function; the actual TEST helper's
observer delegates to fetch with the supplied URL and retains the genuine port.
The reviewer made no edits and ran no checks; execution results remain separate.
The capture-delta re-review also found no blocker: validated descriptors and
their genuine ports are frozen locally before awaits, preventing a later caller
mutation from redirecting subsequent reads or writes.

**APPLICATION_ACCEPTANCE_BLOCKED:** the storage/Tier 1 proof passes, but the
candidate is not wired into an application reader/activation gate. The three
buckets share one ephemeral MinIO instance; this is not separate-host disaster
recovery or recoverable-key proof. **OWNER_EVIDENCE_BLOCKED:** native snapshot checkpoints,
owner restore instructions, current erasure ledger/key recovery and a coordinated
inventory are also required by the approved contract. Whole-pipeline restore or
Fact-to-raw recovery stays unqualified. No ad hoc foreign-store writes or
latest-version substitutions were used to manufacture a positive result.

Required inputs for future full acceptance are the owner-issued coordinated
native checkpoint inventory and restore instructions, the §8-required current
raw-artifact erasure ledger outside older snapshots with its verification
contract, and storage encryption/key-reference recovery evidence. None is
replaced by this synthetic test decision set. No external credential is requested
to bypass the failed local setup or connect to an existing system.

## Remaining qualification

This continuation does not rerun the previous expensive E5 frozen comparison.
Its 240-position consistency result is not semantic answer accuracy on broader
Thai business documents. External MSP/GKS/GenesisBlock contracts, source
versions, operational restore/load measurements and live LINE/UI journeys
need their own exact-revision evidence. A healthy main-dev container alone
does not close them.

The continuation adds a Knowledge-owned source fence before the existing
SENDING claim. PostgreSQL locks all model-retained source rows with ordered
`FOR SHARE OF s`, and source withdrawal's existing UPDATE conflicts with it.
SQLite uses the send transaction's earlier account write before the scoped
source read. This narrows ordering to source withdrawal versus the send claim;
it does not serialize arbitrary FileAsset, Membership or other ACL changes.
Locks end at transaction commit, before provider I/O. An already claimed
provider attempt cannot be recalled. No new document-vault grant is inferred.

Independent review found a process-wide environment bypass in the earlier
candidate. Three regressions reproduced a send despite denied citations.
The exception now requires this execution's successful specific TEST ONLY or
customer-Product send decision; environment selectors alone do not bypass the
generic fence. Those paths retain their existing source, scope, reply-hash,
commercial and disclosure guards.

Independent GPT-6 Luna Max storage review found no remaining blocker in the
bounded recovery/lifecycle patch, including the subsequent raw-reader integrity
correction. That earlier review covered point-in-time revalidation, before this
continuation added source locking. The new review and verification retain the
mocked-resolver, simulated-provider and remaining ACL-ordering limits above.
Independent Luna Max re-review found no blocker in the corrected exception or
the PostgreSQL test's bounded ordering evidence. The document review confirmed
that the charter clarification adds no canonical grants; its surface/profile
wording corrections are included.

The deployed main-dev native worker was observed healthy on image
`8ea64e5f47a2051ecdae1f3cee1f3a9943a9f059ce33dc7e80a3c3e77c1a2829`.
That is the prior qualified native image, not proof that this application patch
has been deployed. No production deployment is performed by this assessment.
The new patch has not been committed, pushed or qualified by hosted CI in this
continuation. Previous GenesisBlock CI is evidence for its own native change,
not for this separate Zuri application patch.

## Version diff

0.1.0: records a source-backed lifecycle/access assessment and bounded storage
repair verification. Canonical lifecycle and source-preserved rows are unchanged.

0.1.0 → 0.2.0: reconciles document audience authority, adds source-withdrawal
ordering qualification and removes the process-setting bypass; replaces the
surviving-object backup test with explicit object-loss characterization.
No general Vault policy, restore implementation, production activation or
live LINE acceptance is declared.

0.2.0 → 0.3.0: adds a bounded offline TEST copy/mapping candidate and proposal-only
Vault decisions; records failed actual-provider setup without promoting it to
restore acceptance. No application restore adoption, operational erasure contract,
new grant, commit or deployment.

0.3.0 → 0.4.0: retains failed setup/unit evidence, verifies focused fixes, captures
the MinIO permission failure, and records successful isolated provider copy,
clean TEST database/Tier 1 lineage and cleanup. Full application recovery,
operational erasure, native checkpoints and key-recovery gates stay closed.

0.4.0 → 0.5.0: records the independently reported P2 descriptor/port mismatch,
factory-owned identity fix, zero-I/O regressions and repeated actual-provider
qualification. Full recovery and serving gates remain unchanged.
