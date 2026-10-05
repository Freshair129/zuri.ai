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

## Approved Phase B rebind — 2026-10-06

Symptom: after rebinding the inventory, a permissive extraction/validation callback can let the offline runner export while Marketing custody is nonempty, or accept unsupported empty Marketing fields.

Evidence: the new `phase-b-recovery.test.js` adversarial tests fail for all three nonempty Marketing models (`EXPORTED` rather than `REFUSED`) and all nine delegate/model/top-level unsupported field cases. This is an isolated adapter reproduction, not a live database incident. Complete-count tests already refuse missing/unreadable tables. A separate raw-byte test exposed CRLF checkout schema bytes; `.gitattributes` requires LF. Materializing the identical schema content as LF restores the byte-exact test without a schema diff; canonical hashes are computed over those raw LF bytes, not normalized by the loader.

Root cause: legacy backup-service hooks enforce Marketing custody, but the process runner's generic callback contract reconciles only included arrays and six protected families. It never independently checks the newly excluded retained Marketing family or unsupported fields. A caller supplying an incomplete hook could therefore omit retained custody after the schema gate becomes loadable.

Why escaped detection: the old 194-model checksum blocked collection; native receiver tests exercised the concrete backup-service hooks rather than the generic Phase B runner with permissive callbacks.

Proposed prevention: under the approved rebind scope, check all three census counts before extraction, reject unsupported Marketing fields directly before restore transaction or export commit, preserve complete-count/privilege/lock fences and legacy excluded-state semantics. Test permissive callbacks so hook safety cannot conceal a runner gap. No recovery family or JSON format is extended.
