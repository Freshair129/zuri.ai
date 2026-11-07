# LINE GKS citation fence rejected string generation ids

## Symptom

The lead's real four-process acceptance for TASK-ZAI-094 (answer a real LINE
job and the four-wide tick) ended both jobs as `CANCELLED` with
`LINE_GKS_AUTHORITY_REVOKED`. The supplied diagnostics showed a GKS
`EVIDENCE_SELECTED` retrieval reference with `generation: "g17-…"` and
`corpusGeneration: 1`. The send fence rejected the reference before resolving
its citation.

## Contract answer and evidence

`generation` is the non-empty **string id of the GenesisRAG17 worker snapshot**.
`corpusGeneration` is the **positive safe-integer revision of Zuri's corpus
manifest**. They identify different version axes and must not be interchanged.

| Layer / field | Type and meaning | Producer evidence |
|---|---|---|
| GenesisRAG17 publication receipt `generation` | Non-empty string worker-generation id (`g17-…`) | Receipt schema: [`genesisrag17-contract.js:261-275`](../../apps/server/src/modules/knowledge/genesisrag17-contract.js#L261); parser: [`knowledge-corpus-service.js:297-313`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L297). |
| Prisma `KnowledgeIngestion.snapshotGeneration` | Nullable string column; published records carry the receipt's string | Schema: [`schema.prisma:3942-3960`](../../apps/server/prisma/schema.prisma#L3942); publisher writes `evidence.receipt.generation`: [`knowledge-corpus-service.js:530-536`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L530). |
| Corpus manifest top-level `generation` / `KnowledgeCorpus.generation` | Integer corpus-manifest revision | Manifest validation/build: [`knowledge-corpus-service.js:182-221`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L182); Prisma field: [`schema.prisma:3896-3910`](../../apps/server/prisma/schema.prisma#L3896). |
| Corpus manifest entry `generation` | Non-empty string worker-generation id, equal to `snapshotGeneration` | `manifestEntry` copies `receipt.generation`: [`knowledge-corpus-service.js:389-405`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L389); reader compares them: [`corpus-knowledge-reader.js:120-121`](../../apps/server/src/modules/knowledge/corpus-knowledge-reader.js#L120). |
| `queryKnowledgeCorpus` hit / response | `hit.generation` is a string from the pinned manifest entry; response `corpusGeneration` is an integer revision | Hit and response construction: [`knowledge-corpus-service.js:964-991`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L964). |
| LINE retrieval reference | `generation` is the hit's string; `corpusGeneration` is the response's integer | [`corpus-knowledge-reader.js:351-360`](../../apps/server/src/modules/knowledge/corpus-knowledge-reader.js#L351). |
| `resolveKnowledgeCitation` result | `generation` is the entry's string; `corpusGeneration` is the integer decoded from the citation reference | [`knowledge-corpus-service.js:1057-1068`](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L1057). |

Thus `snapshotGeneration`, manifest-entry `generation`, query-hit
`generation`, retrieval-reference `generation`, and resolver-result
`generation` all carry the worker string. Only corpus-level `generation` and
the corresponding reference `corpusGeneration` carry the integer revision.
The GenesisRAG17 publisher writes the receipt string into both the ingestion
column and manifest entry; no producer/reader type defect was found.

- Wire v1 describes the query envelope and each hit as carrying `snapshotId` and
  `generation`; each hit must match its response envelope:
  [docs/plans/GENESISRAG17-CONTRACT.md:156](../../docs/plans/GENESISRAG17-CONTRACT.md#L156).
- The executable wire schema uses `zNonEmptyString` for both response and hit
  generation, and the parser requires the hit's values to equal the envelope:
  [genesisrag17-contract.js:277](../../apps/server/src/modules/knowledge/genesisrag17-contract.js#L277),
  [genesisrag17-contract.js:285](../../apps/server/src/modules/knowledge/genesisrag17-contract.js#L285),
  [genesisrag17-contract.js:455](../../apps/server/src/modules/knowledge/genesisrag17-contract.js#L455).
- The corpus reader copies `hit.generation` into the retrieval ref and copies
  the separate `result.corpusGeneration` and `result.manifestHash` fields:
  [corpus-knowledge-reader.js:351](../../apps/server/src/modules/knowledge/corpus-knowledge-reader.js#L351).
- `queryKnowledgeCorpus` returns `corpusGeneration` from the local manifest
  revision ([knowledge-corpus-service.js:991](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L991));
  citation decoding separately requires that value to be a positive safe
  integer ([knowledge-corpus-service.js:669](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L669)).
- Manifest entries validate `generation` as a non-empty string
  ([knowledge-corpus-service.js:194](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L194)).
  `resolveKnowledgeCitation` returns the same `entry.generation` and
  `reference.corpusGeneration` ([knowledge-corpus-service.js:1060](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L1060),
  [knowledge-corpus-service.js:1065](../../apps/server/src/modules/knowledge/knowledge-corpus-service.js#L1065)).
- The main-dev RAG producer copies the query hit's `generation` into its ref
  ([main-dev-test-rag-knowledge.js:166](../../apps/server/src/modules/agent/main-dev-test-rag-knowledge.js#L166));
  the customer-product producer returns its validated source ref unchanged
  ([line-customer-product-knowledge.js:107](../../apps/server/src/modules/agent/line-customer-product-knowledge.js#L107),
  [line-customer-product-knowledge.js:115](../../apps/server/src/modules/agent/line-customer-product-knowledge.js#L115)),
  and the source builder fills that ref from the validated manifest entry
  ([line-product-disclosure-source.js:478](../../apps/server/src/modules/knowledge/line-product-disclosure-source.js#L478),
  [line-product-disclosure-source.js:482](../../apps/server/src/modules/knowledge/line-product-disclosure-source.js#L482)).
- LINE grounding forwards the reader's refs unchanged
  ([line-knowledge-grounding.js:147](../../apps/server/src/modules/agent/line-knowledge-grounding.js#L147));
  the execution trace records `meta.retrievalRefs` unchanged
  ([line-execution-trace.js:56](../../apps/server/src/modules/agent/line-execution-trace.js#L56)).
  The trace payload validator checks JSON safety, not retrieval-ref field types
  ([execution-trace.js:152](../../apps/server/src/modules/agent/execution-trace.js#L152),
  [execution-trace.js:233](../../apps/server/src/modules/agent/execution-trace.js#L233)).

The producers and resolver therefore agree with the wire contract. No producer
change is needed.

## Root cause

`lineGksCitationsStillCurrent` treated `ref.generation` as a numeric ordinal
using `Number.isSafeInteger`, while the real query result and resolver use the
GenesisRAG17 string snapshot id. The different field, `corpusGeneration`, is the
integer manifest revision. This type confusion made a current citation fail the
shape check and caused the send path to revoke the answer.

## S1c fixture regression

The catalog pagination fixture changed its manifest-entry `generation` to the
correct `g17-*` string but left the paired `KnowledgeIngestion.snapshotGeneration`
as numeric `1`. The real schema is `String?`, and publication writes the receipt
string to both fields. Both the corpus reader (`corpus-knowledge-reader.js:121`)
and the product-disclosure eligibility check
(`line-product-disclosure-service.js:274-279`) compare them strictly, so the
catalog fixture's sources were filtered out. The fixture now sets
`snapshotGeneration: entry.generation` to match the published record shape.

The W12 hit, retrieval-reference, and resolver fixtures use the same worker
generation string, while their `corpusGeneration` remains an integer. Those
types match the real producers. The original 1,100-character payloads were
calibrated while the fabricated `generation` was numeric: `JSON.stringify`
made each composed corpus record 1,313 characters, so three fit at 3,939 of
4,000. The real string generation adds 21 characters per record, making three
records 4,002 characters; citation `cit-c` is then trimmed. The composer counts
the serialized record as its knowledge-slice text
([`turn-runtime.js:382-390`](../../services/conversation-runtime/src/turn-runtime.js#L382),
[`context-composer.js:56-63`](../../apps/server/src/modules/agent/context-composer.js#L56),
[`context-composer.js:261-266`](../../apps/server/src/modules/agent/context-composer.js#L261)).

The W12 fixture now uses 1,080-character hit text. With the correct string ref,
three composed records use 3,942 characters, so `cit-a` through `cit-c` remain
in the receipt while `cit-d` and the older thread exchanges still fall outside
the budget. This is a test-fixture boundary correction, not a change to the
composer or a production generation defect. The lead's Vitest formatter error
is consistent with the failed citation-list assertion, though its exact
assertion line was not supplied.

## Why the issue escaped detection

The delayed-send integration fixture in
`apps/server/tests/integration/server-line-jobs.test.js` had fabricated
`generation: 2` values in both the retrieval ref and mocked resolver result.
Those matching integers exercised the incorrect assumption and let the test
pass. Other unit/integration fixtures also supplied integer worker generations.
The trace layer accepts safe JSON values without enforcing the GKS ref schema,
so it did not expose the mismatch. Per the lead's supplied acceptance history,
Task6 on 2026-10-28 deselected the four LINE cases; those cases therefore did not
exercise the real tuple before this report.

## Fix

- Added a Zod retrieval-ref schema at the send fence. It requires non-empty
  strings for `citationId`, `sourceId`, `snapshotId` and `generation`; a positive
  safe-integer `corpusGeneration`; and a 64-character hexadecimal
  `manifestHash`. Passthrough preserves valid producer-specific fields such as
  `ingestionId`.
- Kept the resolver currency check as exact equality for `citationId`,
  `sourceId`, `snapshotId`, `generation` and `corpusGeneration`. A ref is refused
  when any of those values differs from the version-bound citation returned by
  the resolver. This preserves existing historical-snapshot behavior; it does
  not add a latest-pointer check.
- Exported the fence helper for a focused unit test covering current string
  generation acceptance, changed generation, changed snapshot, malformed hash,
  every missing required field, and an integer `generation` refusal.
- Corrected fabricated LINE GKS refs and query-hit fixtures in the server unit,
  integration, E2E and Postgres test files to use string worker generations and
  integer corpus revisions. Also corrected fake manifest hashes that were not
  hexadecimal. The lead-owned
  `apps/server/tests/integration/fr110-knowledge-evidence-chain.test.js` was
  left untouched.

## Proposed prevention

Keep GKS query/ref fixtures shaped from the v1 contract: string `generation`,
integer `corpusGeneration`, and hexadecimal manifest hashes. Preserve the
four LINE cases in the real four-process acceptance selection; a deselected
case is not evidence for the live tuple.

## Verification and result report

Contract conclusion and source locations are listed above. The send-fence
schema and exact-equality check are in
[line-conversation-jobs.js:1085](../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js#L1085)
and
[line-conversation-jobs.js:1156](../../apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js#L1156).
The focused accept/reject cases are in
[line-gks-citation-fence.test.js:58](../../apps/server/tests/unit/line-gks-citation-fence.test.js#L58).

Files changed for this task:

- `apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js`
- `apps/server/tests/unit/line-gks-citation-fence.test.js` (new)
- `apps/server/tests/unit/corpus-knowledge-reader.test.js`
- `apps/server/tests/unit/line-customer-product-knowledge.test.js`
- `apps/server/tests/unit/line-execution-trace.test.js`
- `apps/server/tests/integration/server-line-jobs.test.js`
- `apps/server/tests/integration/line-gks-grounding.test.js`
- `apps/server/tests/integration/line-product-disclosure-policy.test.js`
- `apps/server/tests/integration/conversation-runtime-grounding.test.js`
- `apps/server/tests/integration/conversation-runtime-grounding-parity.test.js`
- `apps/server/tests/integration/conversation-runtime-memory-group-gks.test.js`
- `apps/server/tests/e2e/fr254-knowledge-console.spec.js`
- `apps/server/tests/postgres/knowledge-line-withdrawal-races.test.js`

S1c follow-up changes: aligned the catalog fixture's `snapshotGeneration` with
its manifest entry, recalibrated the W12 hit text against the string-ref JSON
size so its intended citation cutoff remains stable, and added the per-layer
type table above.

The lead-owned
`apps/server/tests/integration/fr110-knowledge-evidence-chain.test.js` had
pre-existing changes and was not edited for this task.

`node --check` passed on all 13 task-owned JavaScript files, and `git diff --check`
reported no whitespace errors in the earlier S1b session. That session's Vitest
attempt failed while loading `vitest.config.js` because esbuild could not spawn
its service (`spawn EPERM`). The lead later reported 228 passed, 2 skipped, and
2 failed, including the catalog pagination and W12 replay cases described
above. The S1c Vitest suite and real acceptance have not been rerun here. The
lead still needs to run the changed test files, `npm run
test:genesisrag17` (expected 42/42), and the isolated `-t "TASK-ZAI-094"` run
(expected 4/4), then perform the real four-process acceptance.

From `apps/server`, the focused test commands are:

```powershell
npx.cmd vitest run tests/unit/line-gks-citation-fence.test.js tests/unit/corpus-knowledge-reader.test.js tests/unit/line-customer-product-knowledge.test.js tests/unit/line-execution-trace.test.js tests/integration/line-gks-grounding.test.js tests/integration/server-line-jobs.test.js tests/integration/conversation-runtime-grounding.test.js tests/integration/conversation-runtime-grounding-parity.test.js tests/integration/conversation-runtime-memory-group-gks.test.js tests/integration/line-product-disclosure-policy.test.js tests/postgres/knowledge-line-withdrawal-races.test.js
npm run test:e2e -- tests/e2e/fr254-knowledge-console.spec.js
npm run test:genesisrag17
npx.cmd vitest run -t "TASK-ZAI-094"
```
