---
version: "1.0.0b"
created_at: "2026-09-08T01:54:00+07:00,RWANG"
last_update: "2026-09-08T01:57:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: verification-report
  scope: four-repository draft PR review, isolated synthetic runtime
---

# GenesisRAG17 coordinated PR review

This report records integration-branch verification after incorporating zuri
main. It supplements the [original acceptance](GENESISRAG17-ACCEPTANCE.md) and
[documentation update](GENESISRAG17-DOCUMENTATION-UPDATE.md); their historical
run IDs and evidence files are preserved unchanged. Scope remains C-3 / HIGH
for the four-tier architecture, with synthetic data and isolated databases.
No production migration, deployment or PR merge is authorized by this report.

## Revisions tested together

| Repository | Revision |
|---|---|
| zuri integration before main integration | `00fda528849202ce2c35bee492f3d6452ce29784` |
| zuri main incorporated in this merge | `bc35fd460e36b065b212ad4a3e727d08afcae644` |
| GKS | `373fd8d6ca09221e171e98e855fe5f519236eff7` |
| MSP | `4707912583b800ecaa353162a1e5da7d2db7278a` |
| GenesisBlock worker | `022ad3d3144d40f1f33f80b53ec555bb40584799` |
| Native engine base | `e15e35b0093394e0a8880af7f4e6f63cf81223b7` |
| Embedding revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |

The zuri revision is the containing merge commit: its two parents are recorded
above, and the additional preparation changes are this report, fresh evidence,
the review-only ledger acknowledgements and regenerated governance. The native
acceptance ran on the merged application source and schema. Subsequent changes
are documentation, evidence and governance only.

The wire remains `genesisrag17.v1`; the contract document is `1.2.1b`, the stage
spec is `1.1.0b` and the flow is `1.0.0b`. Runtime profiles remain `rule_v1`,
`ontology_v1`, `enrich_v1`. The model is multilingual-e5-small on local CPU,
384 dimensions/cosine, with all five pinned artifacts verified. Node is
24.18.0 and Python is 3.12.10; dependency pins and migration identities remain
those in the original acceptance report.

## Fresh verification of the merged branch

| Check | Result |
|---|---|
| Native four-repository acceptance | **17 passed, zero failed, zero skipped**, 117.24 seconds |
| zuri full unit/integration after ledger review | **4,202 passed, zero failed**, 15 environment-gated skips; 260.32 seconds |
| Legacy live MSP/GKS evidence compatibility | **1 passed, zero failed, zero skipped**, separately with explicit sibling roots |
| zuri web build | Passed on the merged source/schema |
| SQLite and Postgres Prisma client generation | Passed; no database migration applied |
| Root governance | Passed: zero critical, zero warning, 22 INFO; no duplicate IDs or dangling cross-app links |
| Documentation links | 497 local or companion-branch targets checked; zero missing |

Governance was regenerated twice. The graph, monorepo graph, preflight report
and traceability content remained identical on the second pass. The two domain
state files change their generated timestamp by design; the canonical check
removes `generatedAt` before comparing and passed on both runs.

Native proof: [17-case results](genesisrag17-pr-acceptance-vitest.json),
[runner log](genesisrag17-pr-acceptance.log),
[raw-to-published chain](genesisrag17-pr-native-chain.json).

Other fresh proof: [full Vitest results](genesisrag17-pr-full-vitest.json),
[legacy chain results](genesisrag17-pr-legacy-chain-vitest.json) and
[web build log](genesisrag17-pr-build.log). The separate legacy test resolves
one of the default run's 15 exclusions; the remaining 14 are unrelated
environment-gated tests, not unexecuted native acceptance cases.

- Run: `bbdcf34b-0e49-4db1-a886-127478725e1b`.
- Snapshot: `snap-fbc95e68b3a488d73e106eb82fded7a1`.
- Generation: `g17-e8c3c768c41dbdef49f8d7e9a88cb3fb`.
- Corpus: `ki17-corpus-v1`; eight chunks, sixteen mentions, twelve entities,
  eight facts and five retrieval queries.
- Recall@5 **1.00**, MRR **1.00**, citation correctness **1.00**, cross-tenant
  leaks **0**. These synthetic results do not measure production quality.

All 17 terminal stages have real six-metric evidence. The suite exercised actual
native process crashes, lost receipts/replies, new-attempt replay, old-attempt
rejection, scoped retrieval, lineage resolution after restart, gate/policy
denials, source/worker loops and isolated backup restore. It did not insert
successful stage evidence on behalf of the worker.

The first full-suite invocation on the merged tree found one stale-digest
failure (4,201 passed, one failed, 15 skipped). The correction is documented in
the [RCA](../rca/2026-09-08-genesisrag17-unreviewed-statement-digests.md): review
the approved same-subject edits through the ledger tool. No test or runtime
code was changed to suppress the failure.

## Review boundaries

The full default suite has environment-gated suites: three controlled Postgres
activation tests, five composed Postgres activation tests, five LINE CLI
round-trip tests and one Postgres isolation test. They remain excluded and are
not claimed as passing. The legacy evidence-chain test additionally requires
explicit `ZURI_MSP_REPO_ROOT` and `ZURI_GKS_REPO_ROOT`; its separate execution
is reported above. Native GenesisRAG17 acceptance has no such skips.

Browser e2e was not rerun during PR preparation. The earlier 112 passed / four
legacy skips / zero flaky result belongs to the original acceptance revision,
not this main integration. GKS/MSP/worker unit and security results likewise
retain their original implementation revision attribution. The fresh native
acceptance exercises their exact current heads together.

Hosted CI is tracked on the PR checks, separately from these local results.
GKS and MSP had no hosted checks reported when their drafts were opened;
absence of checks is not a CI pass. Draft status is preserved for coordinated
review. Review all four PRs against the same wire/model revisions before any
later rollout decision.

## Version diff

The merge incorporates zuri main without adding unrelated UI changes to the
PR diff. The two inherited LINE CRM JSX conflicts use main's implementation.
Six generated governance conflicts were resolved by regeneration. Requirement
IDs and subject anchors remain unchanged; only the review witnesses for
SDD-057, SDD-059 and FEAT-013 were acknowledged through tooling. This report
and fresh evidence are new; historical evidence was not overwritten.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | Record main integration and coordinated PR verification | See containing merge commit | RWANG |
