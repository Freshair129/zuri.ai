---
id: ZAI:ADR-072
title: Knowledge admission and corpus publication
version: "1.0.6b"
status: beta
created_at: "2026-09-08T16:30:00+07:00,RWANG,base dfdbaf11"
last_update: "2026-09-25T12:30:00+07:00,Claude Opus 5.5"
relations:
  - type: references
    target: ZAI:ADR-073
  - type: references
    target: ZAI:KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS
  - type: relates_to
    target: ZAI:FR-173
---

# ADR-072 — Knowledge admission and corpus publication

Isolated acceptance: Business owner Files browser admission and session HTTP/MCP reached the real native pipeline; four document runs each have 17 successful evidence rows, four native snapshots and five corpus generations. Project-scoped and bearer/API-grant paths have unit/Prisma authorization evidence, not native browser proof. Browser query controls and production activation are not claimed. See the [phase report](../../.brain/reports/2026-09-08-knowledge-admission-phase0-4.md) for versions, test counts and limits.

**Status:** beta — phases 0–4 implemented and validated in the isolated profile; production excluded.

## Authority and scope

The owner approved phases 0–4 of the shared-admission plan on 2026-09-08. C-3 / HIGH: documents first, then UI/API/MCP admission, source adapters, status/query/citation and multi-document correction/revocation in isolated test systems. Production, PDF/OCR, external URL fetch, connectors, org-wide sharing and cross-business federation remain subsequent phases. The approved scope does not require another implementation approval.

## Root cause and boundaries

At the audited baseline, FileAsset, document staging, legacy business knowledge and internal GenesisRAG17 were distinct paths. UI/API/MCP callers stopped at files or staging; the tested 17-stage chain started at an internal operator entrypoint. Treating their separate successes as one end-user flow was the readiness gap. This ADR's admission service now connects the approved surfaces. Evidence and source enumeration are in the surface inventory; the RCA records prevention through actual HTTP/browser entrypoint acceptance.

## Decisions

1. One knowledge admission service handles text/Markdown and existing readable FileAsset text/Markdown. UI and MCP use that same service. No direct binary/OCR parser, remote URL fetching, fabricated stage report or caller-supplied worker credential is added.
   **Amended by [ADR-090](ADR-090-LINE-ANSWERS-GROUNDED-BY-THE-PUBLISHED-GKS-CORPUS-AND-REVIEWED-KNOWLEDGE-CANDIDATES.md) (2026-09-14):** two TEXT source kinds are added — `LINE_FAQ_CANDIDATE` (a locator-only question and answer an OWNER or `LINE_OA_PUBLISHER` approved) and, later, `LINE_STUDIO_DESCRIPTION`; both are text and admitted before Stage 1 through this same service.
2. The knowledge domain owns four additive models: KnowledgeCorpus, KnowledgeSource, KnowledgeIngestion and KnowledgeCorpusGeneration. Repository interfaces own their persistence. Corpus identity is Business plus optional Project; the Project must be live and belong to that Business. Corpus association is explicit at Tier 1 and is not silently inserted into the frozen six-field wire scope.
3. Each authorized immutable source version becomes one durable queued ingestion with text hash, idempotency identity, source link, actor and monotonically ordered source revision. Same request/key returns the same job; changed input/key or changed content at an existing source version conflicts. The raw executor source identity is namespaced by corpus/source UUIDs, not user display names.
4. End-user authorization occurs before source content/configuration is disclosed. Business writers use existing owner authority; Business readers use existing visibility. Project corpora additionally use the existing Project read/write ancestry guards; this does not invent finer per-project ACLs than the product currently has. Machine credentials cannot gain new authority merely because an API route was added; any admitted API key must have an explicit configured knowledge grant and matching tenant. Scope/policy are server-resolved, never copied unchecked from a request.
5. Runtime execution uses an unforgeable in-process scoped knowledge capability, distinct from installation-operator authority. It can execute only GenesisRAG knowledge runs of its exact authorized scope; it does not unlock backup/restore, general pipeline definitions or unrelated tenant operations. Request JSON and a caller actor/isOperator field cannot mint it. Existing operator and external reporter behavior stays intact.
6. An opt-in source runtime starts/resumes from durable queue and persisted GenesisRAG intent/batches. Admission is accepted only for an explicitly configured source binding/policy. Leases and compare-and-set prevent concurrent application workers from publishing the same job or overwriting newer corrections. Loss after remote writes reuses the same source/attempt identity; recorded failure never becomes success by hand.
7. GKS and the native worker remain authorities for one document's 17-stage publication. A corpus generation is an immutable Tier 1 manifest of verified per-source snapshot receipts, not a replacement GKS fact store or an invented Tier 4 receipt. Publishing a document atomically merges its verified snapshot into the previous corpus manifest in one database transaction. The native worker's latest pointer alone is not a multi-document corpus.
8. Only an ingestion whose underlying run succeeded and whose source/scope/exact receipt validate may update corpus membership. Older admitted revisions cannot overwrite a newer admitted source revision; a withdrawn source cannot be republished by a late receipt. Unchanged sources retain their prior snapshot references.
9. Query pins one corpus manifest, asks MSP for each active source's explicit snapshot, validates result/source/snapshot/generation/lineage and combines per-snapshot ranks with explicit reciprocal-rank fusion (k=60, stable source/chunk tie-break). Native hybrid/BM25 scores are not globally comparable and remain snapshot-local evidence. It does not silently search the worker's latest snapshot. A required snapshot/read failure fails the query rather than claiming a complete answer. Current authorization and source revocation are rechecked before returning results.
10. Citation identifiers bind corpus generation, source, ingestion and chunk. Resolution checks manifest membership, immutable source hashes/lineage and current source/Project/Business access. An old citation may resolve after a correction while still authorized; revocation or deleted source file/Project denies access. Audit retention is not permission to read withdrawn content.
11. FileAsset metadata removal does not mutate historical snapshots. Serving checks its current state before returning file-backed evidence; explicit knowledge-source withdrawal atomically removes membership and retains audit history. Restore includes corpus/source/job/generation data along with existing immutable lineage, without claiming a zuri-only backup restores native stores.
12. Existing Files and Project Files gain bounded knowledge controls for Text/Markdown, queue/status, query/citations and source withdrawal. No new navigation domain, arbitrary source crawler, LLM extractor or public reporter-success button is introduced.

The `/knowledge/documents` page is a local convenience surface inside the existing
Knowledge slot, not a second admission authority. It sends only Text/Markdown content
through the same `/api/knowledge/ingestions` service and can admit existing readable
Text/Markdown FileAssets. It does not advertise direct JSON/catalog, binary/OCR or
remote-URL ingestion. Queue, query and withdrawal states on this page remain local and
isolated evidence; they do not claim production activation.

The atomic corpus manifest is a Tier 1 read set of independently gated document snapshots, not one FR-110 native knowledge_snapshot_id. This phase proves multi-document retrieval and membership, not corpus-wide graph deduplication, cross-document traversal or one aggregate native quality gate. All selected snapshots use the same configured scope/store; cross-store routing is a later phase.

## Amendment (2026-09-24)

Owner approval: the owner approved remediation item C2 of the 2026-09-24 gap
board with the single word **"approve"**, after being told "start C1 and C2 in
parallel". C2's definition of done: "a TEXT containing a phone number or a LINE
user id fails Stage 5 with terminal evidence"; board detail: "at least use the
candidate prose policy or the FR-111 lattice for documents an OWNER admits, and
record the policy identity in Stage 5 evidence as done for SMARTGIFT_CATALOG".

**Gap closed:** an OWNER-admitted TEXT/FILE document (Decision 1's
"text/Markdown and existing readable FileAsset text/Markdown" path) carries
provider `KNOWLEDGE_ADMISSION` into `genesisrag17-executor.js`
(`apps/server/src/modules/knowledge/knowledge-runtime.js:358`). Before this
amendment, `ZERO_PII_POLICY_BY_PROVIDER`
(`apps/server/src/platform/integrations/core/genesisrag17-executor.js:104`,
after this amendment's own comment lines — it was `:90` beforehand) named only
`SMARTGIFT_CATALOG` (FR-187) and `LINE_FAQ_CANDIDATE` (FR-236); a provider
absent from that map "carries no Stage 5 Zero-PII gate at all" (the map's own
comment), so an owner document containing a phone number or a LINE user id
reached GKS/GenesisBlockDB with no check.

**Scope boundary — FR-238 is deliberately excluded.** `KNOWLEDGE_ADMISSION` is
not the only provider that used to fall back to it: before this amendment,
`LINE_STUDIO_DESCRIPTION` (FR-238, ADR-090 D7 — a rich menu / LIFF app / bot
profile's operator-authored copy) had no `structured` descriptor either
(`knowledge-admission-service.js`), so it also took the runtime's
`structured?.provider || 'KNOWLEDGE_ADMISSION'` default and would silently
have started running this new gate. That is out of scope for C2 (approved for
"documents an OWNER admits", not operator-authored menu/LIFF/profile copy) and
contrary to D7's own reasoning. So this amendment also gives
`LINE_STUDIO_DESCRIPTION` its own explicit `{ provider:
'LINE_STUDIO_DESCRIPTION', ... }` descriptor in `knowledge-admission-service.js`,
which stays absent from `ZERO_PII_POLICY_BY_PROVIDER` — D7's no-gate decision
keeps holding on its own terms, not by accident of a shared fallback. A studio
description admitted before that descriptor existed has `sourceMetaJson` `'{}'`, so
the runtime (`knowledge-runtime.js`, the `structured` lookup before `ingest`) also
falls back to the same descriptor when the source kind is `LINE_STUDIO_DESCRIPTION`;
`tests/unit/knowledge-runtime.test.js` runs such a description, quoting a phone
number, through the real Tier 1 executor and shows Stage 5 succeeding.
`fr238-line-studio-description-admission.test.js` is unchanged in behaviour by
this amendment.

**Rule set adopted — reused, not copied:** `KNOWLEDGE_ADMISSION` now runs a new
provider-scoped policy, identity `knowledge-document-zero-pii-1`
(`apps/server/src/modules/knowledge/knowledge-document-zero-pii.js`), checking
only four identifier-shaped rules: LINE user id, Thai phone number
(0-prefixed/+66), international phone number, and e-mail address. The first
three are the exact same patterns FR-236's candidate prose policy
(`knowledge-candidate-zero-pii.js`) already exports and uses — imported, never
re-typed, so the two policies cannot silently disagree on what a phone number
or LINE id looks like. E-mail address is this policy's own addition; FR-236's
policy has no e-mail rule because a LINE FAQ candidate answer is not the shape
that carries one. Two document-only guards keep ordinary catalogue content from
being refused, without changing the shared patterns: a match whose last
dot-label is a common image/file extension (case-insensitive: `logo@2x.PNG`,
`logo@2x.retina.png`) is not an e-mail address; and the phone rule fails closed: the only
phone-shaped match it skips is one inside a single run of exactly 13 contiguous
digits forming a valid EAN-13 (correct GS1 check digit, for example
`8850123456787`). A barcode written with separators (`885 0123456787`) is
refused, and the owner writes it unseparated. A phone number after an ordinary
number, year or house number (`สาขา 3 081-234-5678`, `อัปเดตปี 2026 02-123-4567`,
`บ้านเลขที่ 199 081-234-5675`) is always refused.
`tests/unit/knowledge-document-zero-pii.test.js` pins all of these. No leak
is accepted: a false refusal can be corrected by the owner, a leak cannot.

**Rule set deliberately NOT extended to owner documents:** the Thai-honorific
personal-name heuristic and the quoted-wording rule, both from FR-236's
candidate prose policy, are excluded here on purpose. An owner's own admitted
document (a policy page, a procedure, a product manual) legitimately quotes
wording and legitimately names staff, roles or brands by honorific far more
often than a two-sentence FAQ answer does — ADR-090 D6's reasoning that a rule
shaped for one payload denies ordinary, approved content of a different shape
applies at least as strongly here. See the module header for the full
argument.

**Wiring:** `KNOWLEDGE_ADMISSION: { assert: assertDocumentProseZeroPii, policy:
DOCUMENT_ZERO_PII_POLICY }` is added to `ZERO_PII_POLICY_BY_PROVIDER`. A
violation stops the run at Stage 5 with terminal `STEP_FAILED` evidence, the
same failure code family as `SMARTGIFT_CATALOG`/`LINE_FAQ_CANDIDATE`
(`KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED`, status 422) — **never the matched value
itself**, so evidence cannot leak the PII it caught. This matches
`SMARTGIFT_CATALOG`/`LINE_FAQ_CANDIDATE` denials exactly, including a detail
worth stating precisely rather than glossing over: the executor's generic
failure path (`runLocalStage` in `genesisrag17-executor.js`) persists only
`{ errorCode: failureCode }` into the Stage 5 evidence row for *every*
provider's denial — the policy identity and the violated rule name live on
the *thrown error's* `details` (`assertDocumentProseZeroPii`,
`assertCandidateProseZeroPii`, `assertZeroPii` each set them), which the
caller sees and can log, but which is not itself persisted to
`GenesisRag17StageEvidence`. `zeroPiiPolicy` is recorded in Stage 5 evidence
only on the **success** path (the non-throwing branch, where the source
passed the gate) — this is pre-existing behaviour for `SMARTGIFT_CATALOG`,
unchanged here. Both a TEXT source and a FILE source admitted as
`KNOWLEDGE_ADMISSION` reach Stage 5 through the same `value.content` field and
are covered by the same path. `SMARTGIFT_CATALOG`/`LINE_FAQ_CANDIDATE`
behaviour is byte-identical to before this amendment; their existing tests are
unchanged and still pass.

**Production note:** SmartGift production sources use provider
`SMARTGIFT_CATALOG`, so this changes no published record. The one production
`TEXT` source failed at Stage 16 (`BENCHMARK_NO_APPLICABLE_QUERIES`, run
`774b95f7`, 2026-09-21) and was never published
([production probe](../../.brain/reports/2026-09-24-genesisrag17-production-probe.md),
"`GenesisRag17StageEvidence` per stage" table), so no published corpus content is
affected by this gate's addition.

**No new FR/NFR/BR/SEC/SDD/ADR id is declared.** This amendment cites existing
FR-173 (KNOWLEDGE_ADMISSION provider), FR-187, FR-236, ADR-072 (this
document), ADR-073, ADR-075 and ADR-090.

@tested tests/unit/knowledge-document-zero-pii.test.js,
tests/integration/genesisrag17-tier1-knowledge-admission-zero-pii.test.js

## Public operations

| Operation | Purpose |
|---|---|
| POST /api/knowledge/ingestions | Admit text or existing file reference under a requested Business/Project, return durable job identity |
| GET /api/knowledge/ingestions | List scoped source jobs and publication state for existing Files/Project context |
| GET /api/knowledge/ingestions/{runId} | Read the opaque admission job; include executionRunId separately when bound |
| POST /api/knowledge/queries | Query one authorized corpus, return manifest identity and citations |
| GET /api/knowledge/citations/{citationId} | Resolve authorized version-bound evidence |
| DELETE /api/knowledge/sources/{sourceId} | Withdraw source membership with optimistic concurrency and audit |

The opaque `{runId}` in the public admission API identifies KnowledgeIngestion.id, not a caller-created FR-071 execution run. Responses name both admission id and executionRunId explicitly. Corresponding MCP tools call the same services and resolve viewers through the existing authenticated transport.

## Data flow

```mermaid
flowchart TB
  A["Files / Project Files / API / MCP"] --> B["Authorized admission + immutable queued text"]
  B --> C["Scoped source runtime and durable lease"]
  C --> D["Existing 17-stage execution through MSP"]
  D --> E["Verified per-document publication receipt"]
  E --> F["Atomic corpus generation manifest"]
  F --> G["Authorized explicit-snapshot queries through MSP"]
  G --> H["Verified citations + current ACL / revocation check"]
```

## Acceptance

- Actual UI/API/MCP admission, not a direct internal raw call standing in for a surface.
- Two documents searchable together; correcting one preserves the other; stale completion cannot undo a newer correction; old authorized citations still resolve.
- Source withdrawal, deleted FileAsset/Project and changed viewer grants cannot leak text through queries or citations, including delayed responses.
- Duplicate keys, hash/version conflicts, wrong scope, forbidden writes and unsupported source type fail closed.
- Runtime restart resumes queued/admitted work without fabricated stage completion; receipt loss and failure remain truthful.
- Source receipt and corpus publication are separate evidence; PASS without a matching receipt is never user-visible READY.
- Relevant tests/build/govern and actual native acceptance pass; production remains a separate release gate.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.6b | 2026-09-25 | beta | Gate round 2: the production note now cites the probe (run `774b95f7`, Stage 16, never published); e-mail and barcode guards hardened (case-insensitive last-label extension check; phone matches skipped only inside a contiguous valid EAN-13) with tests that real addresses and phone numbers are still refused (gate rounds 3-4: the barcode skip now fails closed, contiguous valid EAN-13 only, after two phone leaks were found); FR-238 exclusion also keyed on the source kind for descriptions admitted before their descriptor existed, tested through the real executor; version renumbered from the out-of-convention 1.0.4c to 1.0.5b | working-tree | Claude Opus 5.5 |
| 1.0.5b | 2026-09-24 | beta | Fixes after gate review: FR-238 (`LINE_STUDIO_DESCRIPTION`) explicitly excluded from the new gate (its own provider descriptor, not the shared `KNOWLEDGE_ADMISSION` fallback), so ADR-090 D7's no-gate decision is unaffected; corrected the Wiring paragraph — a Stage 5 denial's persisted evidence carries only `errorCode`, never the policy identity or rule name (those live on the thrown error only, same as `SMARTGIFT_CATALOG`/`LINE_FAQ_CANDIDATE` today); corrected the `ZERO_PII_POLICY_BY_PROVIDER` line reference | working-tree | Claude Sonnet 5 |
| 1.0.4b | 2026-09-24 | beta | Amendment: KNOWLEDGE_ADMISSION (owner-admitted TEXT/FILE documents) gets its own Stage 5 Zero-PII gate, identity `knowledge-document-zero-pii-1` (identifier rules only — LINE id, phone, e-mail; no name/quote rules); owner approved remediation item C2 2026-09-24 ("approve") | working-tree | Claude Sonnet 5 |
| 1.0.3b | 2026-09-16 | beta | Bound `/knowledge/documents` to the existing Text/Markdown admission path and removed unsupported direct JSON/catalog and binary intake claims; local/isolated evidence only | working-tree | RWANG |
| 1.0.2b | 2026-09-14 | beta | Pointer only: D1 gains the `LINE_FAQ_CANDIDATE` and `LINE_STUDIO_DESCRIPTION` TEXT source kinds under ADR-090 | working-tree | Claude Opus 5 |
| 1.0.1b | 2026-09-08 | beta | Record isolated Business surface/native acceptance and distinguish Project/API-grant test evidence | 03256b74 + integration | RWANG |
| 1.0.0b | 2026-09-08 | beta | Owner-approved phases 0–4: scoped admission, explicit corpus snapshot manifests and current-access citation serving | base dfdbaf11 | RWANG |
