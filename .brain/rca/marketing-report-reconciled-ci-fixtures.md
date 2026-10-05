---
status: active
superseded_by: null
---

# Reconciled report CI fixture drift

Symptom: PR633 at5958b38 fails governance and unit shards despite isolated receiver acceptance.

Evidence: hosted run37313759406 expects748 identities but the independently issued current registry has752; `doc-graph-retired-rules.test.js` still expects receiver FR278/279/280. Main FR278 is the dashboard; the fresh reviewed receiver issuance is FR281/282/283 plus SDD112. No historical ledger or manifest may be rewritten to satisfy these tests.

Root cause: reconciliation updated canonical records/projections but carried old identity/count fixtures forward. Focused native and snapshot suites did not include these two CI test files.

Prevention: update exact acceptance assertions to752 and fresh receiver IDs, verify their identity publication and planned/no-credit projections against the generated graph. Run both suites before republishing. Keep exact cardinality checks and old issuance evidence intact.

The candidate projection already records80% partial implementation while keeping registry planned, readyfalse and not_ready. Correct the obsolete docs-only0% fixture without changing the generator or crediting a release. Identity publication checks construct their subject IDs separately so graph heuristics do not misclassify registry publication as receiver runtime acceptance.

Separate finding: `phase-b-recovery.test.js` cannot load its committed frozen target inventory because the additive receiver schema changes its pinned schema checksum. Its fail-closed loader is working; Phase B inventory/custody rebind is not part of these fixture corrections. It remains a merge blocker pending a reviewable parent/peer contract proposal. Do not bypass its checksum, weaken tests or infer whole-SQLite backup acceptance authorizes Phase B snapshot import/export changes.
