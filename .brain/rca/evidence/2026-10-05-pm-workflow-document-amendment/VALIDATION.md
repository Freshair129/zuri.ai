---
status: active
superseded_by: null
version: "0.1.0"
---

# Prepared amendment validation

Scope: C-2, document-only patch. This receipt reviews the prepared wording and
its exact-byte application to isolated copies. It is not an executed agent
adoption experiment, product test, build or governance run.

Reviewed patch SHA-256:
`85a6486d0d4244801e3260f5ae532a98f36b4adaa3f06ce79e28304634627d6b`.
Expected Document 20 preview SHA-256:
`401cfb57baec3371c514faf63bff646d8d7eb61b02fcd4336244633ab6ffa7f9`.
Expected AGENTS preview SHA-256:
`99d3dd1684d28d95a1a336ff747d9f176c3799c4c0f75c8e55f20c1d65cd0b9d`.
The [manifest](manifest.json) records the source/preimage hashes and bytes.

## Document scenario review

| Approved scenario | Clause in prepared Document 20 | Review result |
|---|---|---|
| Summary claims no retry rule | Entry point item 3 and §5 claim reconciliation require source/counterevidence reconciliation; example explicitly preserves the existing two-round rule | PASS — document specifies the correction |
| Attempt history missing after compaction | §5 rule-check requires evidenced round count and UNKNOWN/NEEDS_DECISION; forbids inferring zero | PASS — document forbids an invented reset |
| Candidate renamed, acceptance unchanged | §10 applicability says name/version alone does not establish a new acceptance revision | PASS — cap remains attached to acceptance |
| Provenance/tool retry | §10 requires classification, decision owner, applicability/limit decision and stop condition; no new numeric cap is invented | PASS — authority remains with existing roles/gates |
| Historical count differs from selected plan | Entry point and history notice select exact plan/hash and latest decision receipt; retain old receipt-time observations | PASS — historical value is not current evidence |
| Source changed after rule-check | §5 refers affected meaning to existing §10 STALE/reverification rule and disallows calling the old hash current | PASS — affected decisions cannot use stale proof |
| Compaction event unavailable | §5 uses actual task/action triggers and forbids fabricating an event; absent command timestamps remain UNKNOWN | PASS — records reflect observable events |

These are checks of the written requirements. Agent execution of these scenarios
is NOT_RUN; no reduction in real looping is claimed.

## Static and preservation checks

One-off Node 24.16.0 file checks and Git patch operations on isolated temporary
copies produced the following results:

- PASS: both input hashes checked before preparing the patch.
- PASS: `git -c core.autocrlf=false apply --check` on isolated copies, followed
  by application to those copies and exact raw-byte postimage comparison.
- PASS: original retry clause unchanged; original §14-to-end historical bytes
  unchanged; newly added anchors unique and local anchor links resolve.
- PASS: all 20 original handoff manifest entries and all supplemental excerpt
  manifest entries/pinned sources still match raw hashes and sizes.
- PASS: README relative links resolve; worktree `git diff --check` passes.
- PASS: primary checkout remains clean; canonical Document 20/AGENTS hashes,
  earlier guard/test/original-RCA hashes and approved document-RCA hash are
  unchanged.
- NOT_RUN: canonical integration/version allocation, corpus/generators, govern,
  product tests/build, agent adoption and runtime.

The first isolated patch rehearsal did not match raw bytes because global Git
CRLF conversion changed line endings. It did not touch canonical sources. The
final LF patch and explicit Git setting produced exact postimage matches.

Prepared wording approval is recorded in README and manifest. Independent review
of this concrete patch is recorded separately; prior PASS on the RCA draft is
not transferred to new patch bytes.

0.0 → 0.1.0: records exact patch/previews, document scenario review, byte checks
and verification limitations. No implementation or candidate authority changes.
