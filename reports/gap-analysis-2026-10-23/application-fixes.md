---
doc_type: implementation-verification-record
status: reviewed
version: "0.8.0"
source_assessment_revision: "d1a3acb4f9c6827fdf3c78435e6fefb423263665"
follow_up_base_revision: "175faacbabf41dd64a172253b0c00de45d466a3f"
---

# Confirmed application gap fixes

The owner authorized application fixes after committing and pushing the
[assessment](README.md). This record separates implemented behavior, local
verification and remaining external acceptance. It issues no new requirements,
product roadmap or delivery dates. Existing canonical IDs and source-preserved rows are
unchanged; the approved follow-up below adds standalone FR-291; the assessment remains a snapshot of application revision e3474ef3.

## Implemented scope

| Finding | Existing authority | Result |
|---|---|---|
| F01 scope CRUD | FR-001, FR-074/075 | Update/archive Portfolio, Tenant, Business, LegalEntity and Branch through the existing scope boundary. Strict field allowlists and optimistic version claims prevent ancestry changes, lost updates and audit after a failed claim. Workspace update/archive uses the same concurrency protection. |
| F02 responsibility | FR-135 | Asset registration/transfer requires the responsible Person's current active membership in the asset's tenant and Business. |
| F03 allocation | FR-135 | Validate positive quantity, boolean exclusivity, Project/Workstream scope and half-open overlap intervals. Allocation, return and disposal serialize on the asset version; disposed assets cannot be allocated. Disposal details persist in the actual AuditEvent payload. |
| F04 Project Inventory | FR-135 | Add the scoped read-only asset allocation projection, excluding corrupt or foreign-scope rows and leaving shared Projects without private assets. |
| F05 memory erasure | FR-232, ADR-091 D6 | Compose Identity-owned Tier-1 memory erasure into consent decline; tombstone Knowledge candidates and withdraw admitted sources through Knowledge-owned code. Candidate approval/source/ingestion/link/audit changes commit atomically, preventing a late approval from resurrecting erased material. Shared threads follow speaker/message lineage. Preserve identity, login and separate retention-purpose records. |
| F06 context composition | FR-234, SDD-100, ADR-106 | Compose public Knowledge evidence and authorized MSP slices under one budget in both Server and Runtime. Only retained data reaches the provider; persist one content-free canonical receipt before an attempt. Core verifies source/packet bindings and reserved receipt identity. Recheck API-011 private-read permissions before RESOLVED, including withdrawal after durable binding. |

Prepared RECORD slices retained by the composer reach a distinct bounded Runtime
prompt section; they are not reclassified as MSP. Empty RECORD input preserves
the legacy prompt bytes. The published operation schema enforces expressible
packet/reference conditions; executable validators enforce sibling ID/hash
parity and serialized UTF-8 limits. GKS metadata remains in the existing trace,
not in an unbudgeted provider evidence envelope.

FR-127 treats `ConversationAnalysis` as an audited CRM record. Memory-consent
decline preserves it under the existing consent-gated read/write policy;
principal erasure still deletes it. The shared-conversation reader gates by the
owning Customer, not a new per-speaker analysis policy. This patch does not
claim per-speaker CRM analysis denial implemented.

## Verification

Luna Max workers implemented non-overlapping responsibilities. An independent
Luna Max reviewer inspected the composed patch and the corrections it required.
Root integrated the changes and ran shared generators and verification. Server
Vitest runs are serialized because the proof reporter shares a cache path.

| Check | Observed result and scope |
|---|---|
| Scope CRUD and Workspace concurrency | 7/7 and 11/11 targeted tests passed; stale/lost claims write no audit. |
| Asset corrections | Red regressions followed by passing responsibility, interval, projection, return/disposal and persisted-audit checks; final changed-test run below qualifies the composed patch. |
| Schema/migration execution | 4/4 passed, including existing SQLite rows/defaults and a real disposable PostgreSQL migration/reapply check; both Prisma clients regenerated. |
| Erasure and CRM analysis | 4 files / 56 tests passed after the lifecycle correction. Candidate admission fencing and archive-write error metadata also passed their targeted regressions. |
| Final F06 consumers | 8 files / 164 tests passed. Both policy-withdrawal cases reproduced red first, then refused provider/MSP/delivery after the guard. Near-limit tests preserve full 10,000-character questions, actual UTF-8 response bounds and independently computed retained evidence. |
| Runtime | Root independently passed 86/86 Node tests and the 11-source-file boundary build. |
| PostgreSQL acceptance | Root passed all 7 configured files / 71 tests against a disposable embedded cluster. No environment-provided or deployed DB is a test target. |
| Registry/readers and shadow selector | 98/98 documentation regressions and 52/52 verification-planner regressions passed. |
| Final changed-test Server run | Root passed all 28 changed/new test files / 495 tests together on the frozen application patch; zero failed or skipped. |
| Final generation/governance/build | Registry, service map, graph, 96 views, governance and corpus checks passed. Governance reports 0 critical / 4 baseline warnings / 43 informational items. Final Server build passed. |

The initial independently reviewed application/Runtime freeze at c19fae73 contains 70 changed/new
paths against d1a3acb4. Its fingerprint is
`743eeb7208b6042d337592ce7547e3ca89910ddbc5dd5120ddf63dceb18cb78d`:
SHA-256 each UTF-8 file after LF normalization, join ordinal-sorted
`path + space + digest` entries with LF and no final newline, then SHA-256 the
joined text. The reviewer independently reproduced the digest and found no
remaining P1/P2 in the reviewed patch. This binds source review; it does not
claim that the reviewer reran tests.

The first hosted run at c19fae73 found two stale test fixtures outside that
changed-test set: the full Scope service mock omitted newly imported CRUD
exports, and the answer-parity fixture supplied a zero context budget instead
of Core's default prepared budget. The follow-up adds the mock exports and
uses `DEFAULT_CONTEXT_BUDGET_CHARS`; it changes no production code and preserves
the authorization and answer-parity assertions. All four relevant test files
passed together, 41/41 tests. The original hosted run remains a failed run;
qualification requires a fresh run on the corrected commit.

The corrected application/Runtime freeze contains 72 changed/new paths against
d1a3acb4, using the same fingerprint procedure:
`16a0fa16eb8591c57ed5d0958b75f175448dc403157ab1b05f3edd39f885126e`.
Its production source matches c19fae73; only the two test fixtures differ.

The broad local diagnostic was interrupted after 245 completed files. It found
seven stale assertions in `conversation-runtime-grounding.test.js` and
`conversation-runtime-legacy-parity.test.js`; those cases were corrected and
passed in the final 164-test consumer run. Earlier interrupted diagnostics are
also not full-suite passes. The newly found permission-fence defect was proved
by two failing regressions before correction. No interrupted run is labeled
PASS, and the composed local checks are not a claim that a fresh full local
Server suite completed.

The existing CI selector forces full Server qualification for the Prisma schema
and migration changes, using its four existing shards. Hosted CI belongs to the
exact pushed commit/PR checks; this local record does not duplicate mutable CI
state. Merge and release remain gated on those checks. E2E was not run locally
and is not counted as passing. The repository's lint command still opens its
first-run configuration prompt; standalone lint is NOT_CONFIGURED, not PASS.

## Remaining boundaries

- F07 and typed CRM/ERP fact read ports remain source/authority reconciliation.
  Record-only provider calls and numeric/code acceptance are not certified;
  the existing answer verifier/fallback remains Knowledge-evidence-only.
- No external MSP/GKS deletion or withdrawal is inferred from a local fake or
  durable pending state. External acknowledgement and live acceptance remain
  distinct. The initial freeze left caller-level physical rollback cleanup
  fault injection open; the bounded follow-up below now exercises retention
  sweep and principal-erasure callers. It does not certify every filesystem
  fault, the separate consent-decline caller, or live storage operation.
- The three additive scope fields have SQLite and PostgreSQL migrations, but
  no deployed database migration was applied. The Phase B loader binds the new
  schema digest while preserving all 208 table mappings and refusing the former
  same-count schema. Historical recovery evidence remains unchanged.
- Matching Core/Runtime revisions require the documented coordinated drain and
  rollout. Local tests do not establish old-client rolling compatibility,
  production cutover, live provider operation or deployment readiness.
- The initial application freeze reported four governance warnings: two absent
  candidate receipts in Document 20, the absent Marketing authored-verification
  record, and the synthetic fixture edge. Their explanatory follow-up is below;
  the original counts remain evidence for that earlier run.

## Follow-up reconciliation — 2026-10-23

This follow-up starts from 175faacb. It separates supported source repairs from
missing cross-service contracts. It does not change canonical rows, issued IDs,
membership, caller permissions, runtime operations or deployment configuration.
The earlier source fingerprints identify their stated freezes, not this later
explanatory/test delta.

### F07: a GKS primitive exists; the MSP traversal contract is still missing

[FR-024](../../docs/requirements/FR-024.md),
[FR-029](../../docs/requirements/FR-029.md) and
[ADR-063 D2](../../docs/decisions/ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md)
retain the injected relation-reader seam while prohibiting a direct substrate
client. Current Phase-1 ports construct Postgres Business Knowledge and optional
MSP memory. Server LINE and Core prepare use that factory; they do not bind the
FR-024 principal-neighborhood reader. FR-235 published-corpus retrieval is a
different contract and cannot be substituted for relation traversal.

The read-only check covered both local inventory and the two accessible remote
repositories at pinned default-branch heads:

| Source | Observed contract |
|---|---|
| [GKS 36ae491d](https://github.com/Freshair129/Genesis-Knowledge-System/tree/36ae491d10ca6e8fe170df6ce9238d3f1eedfca1) | `gks_relations_get({ref, scope})` is registered in `packages/gks-contracts/src/tool-definitions.mjs` and implemented by `GksServicePort.getRelations`. It returns relation rows, without FR-024's node objects. Scope requires `portfolioId`; `tenantId`, Business and other scope fields are additional inputs. The port document is 0.11.0b/beta; this tool schema has no operation-level version field. |
| [MSP 800ee64b](https://github.com/Freshair129/Memory-and-Soul-Passport/tree/800ee64bf28d8bbc36093ee74502f3844adac8ba) | Its GKS stdio/HTTP providers expose pipeline calls, promotion and evidence export, without a relation-read tool. `msp_pipeline_query` returns published corpus passages/citations; it is not FR-024 traversal. |

GKS's source declares `gks-msp-auth/v1`, normalized-scope binding and explicit
`gks_invalid_request` / `gks_scope_denied` failures. Source inspection does not
establish a deployed relay credential, caller grant, tool availability or live
acceptance. Neither remote repository was modified and no MSP/GKS runtime API
was called.

An implementation still needs an outward MSP relation contract, a trusted
mapping from Zuri's `tenantId`/`principalId` to GKS `ref`/scope, relation-to-node
materialization, bounded result/error behavior, and the consuming answer path.
Those are not supplied by the existing GKS primitive. Do not bypass MSP, alias
the corpus query into traversal, or invent that mapping. The local comments now
name the approved injected service seam and accurately say that empty-result
fallback exists while traversal errors propagate; executable behavior is unchanged.

### Typed CRM/ERP facts: authority and answer semantics need a contract

[FR-234](../../docs/features/FEAT-037/requirements/FR-234.md) explicitly leaves
CRM/ERP fact ports to separate establishment. [SDD-100](../../docs/requirements/SDD-100.md)
specifies injection and receipt shape, not allowed record fields or a caller
grant. [ADR-091 D7](../../docs/decisions/ADR-091-CHAT-RECORD-AND-AGENT-MEMORY-SPLIT-AND-THE-CONTEXT-COMPOSER.md)
gives source precedence and denial behavior;
[ADR-106](../../docs/decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md)
keeps authoritative reads in Core and prohibits Runtime database access.

Core prepare currently supplies Knowledge and authorized MSP slices, without a
typed RECORD producer. The composer/model port can preserve supplied RECORD
slices, but both answer paths still gate and verify against Knowledge evidence.
Record-only answering is therefore not certified. CRM's SCM reference readers
return identifiers/scope only under their own facade authority; they are not
answer-fact ports. Other domain readers require trusted viewer/domain authority,
which a LINE sender or memory `READ` grant does not establish.

The owner selected stock availability and published product prices on 2026-10-23.
The [proposed fact contract](../../docs/change-requests/integration/line-agent-stock-price-facts-20261023.md)
now records bounded fields, exact SKU/quantity/unit binding, separate stock and
price authority, read-through limitations and deterministic answer acceptance.
It records design approval, not a runtime reader, stock permission or a change
to FR-132's existing quotation rules. At e444eb46 the ATP reader lacked a
consistent quantity boundary; the bounded source correction below addresses
that defect. Customer eligibility, lot-expiry filtering, published price
verification and the future typed consumer are not established. Record-only model verification
and a versioned Runtime operation remain open. The existing fail-closed path
is retained; no operational-data grant is inferred. F07 relation traversal is
separate from this selected fact family. The owner approved the 0.1.0 design
with quantity-independent positive/zero ATP. The
[bounded implementation plan](stock-price-implementation.md) targets the real
existing ATP consistency defect first and records the distinct caller/Runtime/
published-price prerequisites; design approval grants no customer stock access.

### Warning repairs and evidence boundaries

- The CLI fixture still generates the same deliberately malformed compatibility
  projection. Its synthetic unissued token is assembled rather than written as
  a bare requirement reference in test source. The graph scanner, requirement
  registry, warnings and critical checks are not weakened.
- Candidate Document 20 keeps both exact receipt filenames as historical
  locators and records their unavailability in the enumerated checkout. No
  receipt was synthesized and no candidate pin or approval was rebound.
- The Marketing intake preserves its unavailable original verification locator
  and locally unresolved `90b9df7d` claim. Existing reconciled tooling verification
  and the applied reconciliation receipt are linked as distinct successor
  evidence, without retrospectively proving the earlier claim.

The CLI/agent-runtime regressions passed 5/5, including the unchanged malformed
projection assertion. The documentation migration/reader suite passed 98/98.
Governance and hosted qualification belong to the composed follow-up revision;
these scoped results are not a fresh full Server-suite or live-service claim.

### Physical archive cleanup regression evidence

The two existing CRM archive integration files passed 31/31 tests on isolated
SQLite with per-test temporary directories. The added caller-level cases cover:

- Retention sweep: a manifest write fails after a new archive file exists.
  The sweep reports `archiveFailed`, removes that unreferenced new file and
  preserves the candidate, earlier archive/chain and database state.
- Principal erasure with a legal hold: reseal manifest creation fails after the
  new file is written but before reseal metadata returns. The error reaches
  the erasure caller with its archive identity; rollback removes only the new
  file and preserves prior archive bytes, database, consent and hold state.
- The same erasure path: read-back fails after the new file is renamed but
  before `writeArchiveFile` returns. The test observes the file at that boundary,
  verifies propagated `error.archiveFile`, and checks the same cleanup and
  preservation invariants.

No production failure appeared in these cases and no executable archive code
was changed. This is direct fault-injection evidence for the named local paths,
not evidence of external erasure or unrestricted storage-failure recovery.

### ATP source consistency after design approval

The owner approved the stock/price design with positive/zero ATP rather than
exact customer counts. The [implementation plan](stock-price-implementation.md)
then narrowed executable work to the existing FR-180 staff/source API. A new
customer fact port would have no approved caller or Runtime reply kind today;
no unused port, intent matcher, customer grant or v1 payload was added.

`availableToPromiseFor` now authorizes, acquires the existing Business ledger
fence and reads quantities through the same transaction. Reservation actions
re-read their authoritative row before CAS under that fence; expiry selects and
stamps due rows inside it. The reader and expiry selector choose an implicit
clock after the fence. `maxBuildableSets`, `checkInventoryAtp` and the registered
SmartGift tool preserve an omitted clock through to that boundary, while a
caller-supplied Date or factory clock callback remains authoritative. The API
shape, staff authority and existing transaction support remain unchanged.

Real disposable SQLite regressions first observed:

- Torn quantity: ATP returned 10 where the complete before/after states were 7/8.
- Expiry while waiting: the direct reader returned 7 with a hold of 3 instead
  of post-expiry ATP 10 with no live hold.
- The implicit buildable-set caller returned 499 instead of 500 after expiry.
- The registered SmartGift tool returned 1199 instead of 1200 after expiry.

The final tests preserve explicit-time behavior, response keys, denied-read
no-fence behavior and existing transaction use. The PostgreSQL race waits for
both independent writers to reach the row-fence attempt before releasing the
reader; SQLite uses transaction-start gates because BEGIN can block first.
The independent Luna Max reviewer required the wrapper and PostgreSQL proof
corrections, then approved the frozen five-file source/test/config delta.

| Corrected check | Actual result |
|---|---|
| Worker: `npm test -- tests/integration/fr180-atp-reservations.test.js` | 11/11 on disposable SQLite. |
| Worker: `npm test -- tests/integration/fr181-smartgift-agent-tools.test.js` | 19/19 on disposable SQLite, including the registered tool and explicit callback clock. |
| Root: exact FR-177, FR-178 and FR-184 caller files via `npm test --` | 19/19 on disposable SQLite after the wrapper corrections. |
| Root: `npm run test:postgres` | 9 files / 101 tests passed on a new disposable embedded cluster, including the same FR-180/181 suites. |
| Root: `npm run build` | Corrected Server source build passed. |

These are separate scoped runs, not a fresh full local Server suite. An earlier
mistaken `test:integration` invocation selected the broad integration directory
and was interrupted; it is not acceptance evidence. Its single orphaned
disposable SQLite file was removed after verifying no matching test process;
subsequent runs used normal teardown. No live database was a test target.

Source base: e444eb461f9fec8ab95e6c09b19b4476261964d5. The frozen five-file
delta's SHA-256 is
`d856c1553ff790ea1fef3334c3688ab7a0d390b3b2798c4929db64b70a392e8b`:
hash the bytes from `git diff --binary <base> --` followed by the two changed
source paths, the FR-180/181 test paths and `vitest.postgres.config.js`, in that
order. Document navigation/evidence edits are outside that source fingerprint.

The guarantee is quantity consistency with participating fenced Inventory
writers. It is not immutable product-catalog metadata, one snapshot across
separate compound tool reads, lot/shelf-life eligibility or customer fulfillment.
The fence can upsert internal lock metadata; a read creates no stock movement
or reservation. Customer stock rights, request/intent selection, published-price
proof, deterministic LINE replies and a versioned Runtime amendment remain the
distinct integration prerequisites recorded in the plan. F07 is unchanged.
Final document checks and exact-head hosted CI remain required for this composed
patch; their actual results belong in the PR. Merge and deployment remain separate.

### Consent identity snapshot correction after final review

The final merge-readiness review found that consent decline selected the
Customer's mutable `personId` before the transaction. A real LINE account merge
could commit in that gap, leaving `DECLINED` recorded while erasure selected the
previous Person and missed the Customer's current memory lineage. A disposable
SQLite regression reproduced that outcome: the consent changed but the private
message retained its original body.

The existing owner/domain gates and early tenant-scoped admission lookup remain.
Inside the Serializable transaction, the service now re-reads the tenant-scoped
Customer and claims its exact Person/version before erasing memory. The claim,
erasure and audit commit or roll back together. The claim precedes erasure's
existing `PENDING_MSP` writer, which can itself increment the Customer version;
the returned summary re-reads that final state. No identity, retention-purpose,
schema or external-erasure authority changes.

Verification of the correction:

- The actual identity-link interleave first failed because the original message
  survived; it passes after the transaction-scoped selection and claim.
- A second real-database test injects a row/Person/version change between the
  authoritative read and claim, verifies rejection and complete rollback of
  Customer/message/audit state. This is deterministic claim fault injection,
  not a claim of two independent concurrent database writers.
- Five selected SQLite files passed **64/64**: consent unit/integration,
  Knowledge candidate erasure, shared-speaker erasure and identity linking.
- The same consent integration file passed **10/10** on a fresh disposable
  PostgreSQL cluster via `npm run test:postgres --
  tests/integration/crm-customer-consent.test.js`. It is now included in the
  existing PostgreSQL profile. No ambient or deployed database was used.

These results qualify the added correction, not a fresh full local application
suite. The earlier source fingerprints remain historical. Final independent
re-review and exact-head hosted checks are recorded in PR #723; #724 must carry
this corrected parent before its own final readiness audit.

## Customer LINE stock and published-price implementation

The owner authorized implementation of the approved
[stock/price contract](../../docs/change-requests/integration/line-agent-stock-price-facts-20261023.md).
The sanctioned authored-record migration adds
[FR-291](../../docs/requirements/FR-291.md) without changing existing identities,
statements or FEAT membership. Its approval copy, manifest and receipt remain
frozen. Readiness presentation is maintained in the FEATURES template and
regenerated; Agent is the orchestration navigation, not exclusive data ownership.

Customers use an explicit strict command, for example:

```text
#product {"sku":"MUG-01","facets":["availability","price"],"quantity":100,"unit":"piece"}
```

Stock requires the original signed DIRECT source, live verified identity, an
exact non-erased Customer-to-Business binding and an owner-enabled account/SKU
policy. That policy defaults OFF, uses version CAS and audited changes, and is
excluded from portable recovery authority. Inventory returns only positive/zero
ATP or not-measured, never counts, sufficiency or delivery promises.

Price-only keeps existing published Knowledge authority without stock-specific
identity or policy gates. Commerce verifies current receipt-backed publication,
exact PCAT bytes/hash, frozen calculation and effective rule lineage, exact
SKU/quantity/base-unit and safe THB minor units; tax remains UNKNOWN. The
producer now freezes baseUnit privately. Legacy calculations without that proof
and records whose current unit differs return unavailable rather than being
relabeled or backfilled.

Both Server and Runtime use the same deterministic resolver and final live
revalidation gate. Strict v1 is unchanged; the production client explicitly uses
v2 PRODUCT_FACTS. The private execution-bound decision stays in Core, with a
content-free idempotent AuditEvent and immutable trace. Recognized malformed,
denied or unavailable commands never fall through to a model. Stock-policy or
identity denial suppresses a combined request; an authorized technical failure
in one source preserves the other as PARTIAL. Product turns do not read memory;
a real memory-read receipt still requires its matching append receipt.

Review corrections include opted-in memory completion, facet-local failure
handling, the frozen published unit, policy first-create concurrency mapping,
real Knowledge owner withdrawal coverage, literal AuditEvent persistence and
facet-aware documentation. Graph scanning validates canonical provenance before
excluding exact sealed approval copies from live identity declarations;
unregistered duplicate documents remain subject to normal guards.

The final composed source passed these local checks:

| Command / scope | Actual result |
|---|---|
| Server `npm test --` all 16 `tests/integration/conversation-runtime-*.test.js` files plus the 13 files listed below | 29 files; 475 passed, 1 PostgreSQL-only race skipped on SQLite. |
| Server `npm run test:postgres` | Full configured profile: 17 files; 158/158 passed on a new disposable embedded cluster, including that race and retained CRM consent coverage. |
| Runtime `npm test` / `npm run build` | 91/91; boundary build passed for 11 source files. |
| Server `npm run build` | Passed compilation and type checks. Existing multiple-lockfile root-inference warning remains; standalone lint is not configured. |
| SQLite and PostgreSQL baseline plus incremental policy DDL | Passed in isolated databases; PostgreSQL proves three scoped foreign keys and default-OFF policy. Supabase migration source is byte-identical to the tested PostgreSQL incremental DDL. No deployed migration applied. |
| `npm run docs:migration:test` | 99/99 registry, migration, reader, query and view contracts. |
| Registry/services/graph/views, `npm run govern`, `npm run docs:llms` and `npm run docs:llms:check` | Passed on the final composed tree; strict preflight 0 critical, 0 warning, 43 information. Corpus fresh (411 KB). |

The 13 additional Server files are `tests/unit/line-product-facts.test.js`,
`tests/unit/corpus-knowledge-reader.test.js`,
`tests/unit/line-job-answer-text-marker.test.js`,
`tests/unit/customer-consent-service.test.js`,
`tests/integration/line-product-facts.test.js`,
`tests/integration/line-stock-disclosure-policy.test.js`,
`tests/integration/line-published-price-reader.test.js`,
`tests/integration/fr253-pricing-catalog.test.js`,
`tests/integration/openapi-docs.test.js`,
`tests/integration/line-stock-policy-backup.test.js`,
`tests/integration/fr075-restore-authorization.test.js`,
`tests/integration/line-server-backup.test.js` and
`tests/integration/crm-customer-consent.test.js`. Commands run from apps/server;
Runtime commands run from services/conversation-runtime. Select the 16 Runtime
integration paths with `rg --files tests/integration` filtered by
`conversation-runtime-.*\.test\.js$`, then pass those exact paths plus the 13
additional paths to `npm test --`; this avoids selecting the whole directory.

Earlier failing composed runs are not passes: the 16-file PostgreSQL attempt
had one IDLE failure because the owner-reader fixture left its own expired
CLAIMED jobs in the shared test database. Cleanup now cancels only the tracked
fixture job IDs. The first broad Server run had eight vertical failures after
the HTTP harness sent the new production v2 client to v1 handlers, plus one
writer-inventory assertion. The corrected harness dispatches by the real path,
asserts v2 traffic and preserves v1 tests; the writer guard explicitly includes
the reviewed cancellation clear. The final complete reruns above passed after
those corrections, without test retries or widening a baseline.

Independent Luna Max review covered author-separated source slices and the
final audit race, fixture dispatch/cleanup, marker invariant and governance
reader fixes. No P1/P2 remained in those reviewed deltas. Registry, services,
graph, views, strict governance and corpus freshness are separate final checks;
the pull request records their output and exact-head hosted CI. Local results
are scoped, not a fresh full Server suite or live/provider acceptance.

PR #723 merged independently as fbe6485e1ee037e55b6eea1cd078ee5d5cdc28b0
while this follow-up was being verified. Its tree matches the incorporated
c49fbdf consent patch; all three CRM source/test files were preserved exactly.
This stock/price change is delivered on a separate follow-up branch and PR.
No live LINE send, provider activation, deployment, active database migration
or stock disclosure enabling is included. F07 and the separate GenesisRAG work
remain outside this implementation.

## Version diff

0.2.0 → 0.3.0 records the final policy-fence correction, consumer reconciliation,
engine boundaries and exact-head CI qualification without rewriting the original
assessment or its matrix.

0.3.0 → 0.3.1 records the two hosted-CI fixture corrections and their targeted
verification without changing the implemented behavior or assessment snapshot.

0.3.1 → 0.4.0 records pinned remote graph-contract inspection, the unresolved
typed-fact authority/answer contract, and narrow warning repairs. It preserves
the original assessment and historical receipts without adding requirements or
operational permissions.

0.4.0 → 0.5.0 records the owner's first-family selection and links its proposed
interface contract. No canonical row, runtime operation or access grant changes.

0.5.0 → 0.6.0 records design approval, the bounded ATP source/clock correction,
its real-database red/green evidence and the implementation plan. It does not
certify customer stock/price integration or alter canonical rows and grants.

0.6.0 → 0.7.0 records the final review's consent/identity race correction and
its SQLite/PostgreSQL claim and rollback proof. Earlier verification records
and their source fingerprints are preserved.

0.7.0 to 0.8.0 records the approved customer LINE stock/price implementation,
review corrections and actual composed verification without rewriting the dated
assessment or claiming production acceptance.
