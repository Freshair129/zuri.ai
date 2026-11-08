# ASTRA-D1 — Decision ledger

**Authority:** Every decision below is a **delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08**. None is human approval.

**Inspected baseline:** zuri.ai `98b708f11a51578333c52f828f31bec814df1e66`, detached and clean. Other inspected checkouts match the stated pins; MSP has an existing modified `apps/msp-server/bin/msp-server.mjs`, which I left untouched.

Cached `origin/main` references were:

| Repository | Inspected main |
|---|---|
| MSP | `520ac7109b032d11a6b15b87720b58380173ba7f` |
| GKS | `3effb3b0a607a52a474cacbc5ed171b0e9a69133` |
| GenesisBlock | `3b61ee909769b192c8021c5dc27ecc3f38f201f7` |

No fetch, tests, builds, production inspection, secret reads, file writes or Git writes occurred. Test results below are attributed to inspected records, not executions in this turn.

## D1 — FR-189: supersede the Edge LINE rollout obligation

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** Supersede FR-189 as an active product delivery obligation. Preserve its identity, original statement, FEAT-026 membership, implementation, tests and historical evidence.

This is a **new product decision**, not a claim that ADR-110 already explicitly superseded FR-189.

The inventory’s “spec-only/no code” classification is incorrect. Implementation exists in `apps/edge/src/rag/genesisrag17/published-rag.ts:89`, with configuration in `settings.ts:15` and tests in `apps/edge/tests/unit/genesisrag17-edge.test.ts`. Commit `1167d8d2` also changed this reader after Edge retirement.

Nevertheless, the pending product obligation is an Edge answer-path shadow/cutover with a v4 fallback window. The supported LINE executor is now server-owned. ADR-110 D4 removes device execution for LINE, while expressly preserving Knowledge/RAG and excluding deletion of the entire Edge tree. See [ADR-110:82](../../docs/decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md:82), and its lines 121–149.

**Conditions:**

- Do not rename FR-189 into the Server requirement. Server grounding remains under FR-235/ADR-090.
- Do not delete the retained reader, tests, databases or v4 implementation.
- Do not claim that the old cutover, fallback window or sunset criteria passed.
- Amend ADR-075’s current disposition by dated pointer; preserve its original decisions.
- Annotate TASK-ZAI-042’s obsolete Edge LINE criteria as superseded, not successfully executed. Its remaining delivery/recovery obligations require reconciliation.

The new FR-189 status cell must begin:

> superseded — ASTRA-D1 D1, 2026-11-08: retire the Edge LINE shadow/cutover obligation; retain existing Knowledge/RAG implementation, tests and historical evidence. Server LINE grounding remains FR-235/ADR-090. No cutover, sunset or deletion is asserted.

Strike through the existing statement without rewriting its words. ADR-039 D14 recognizes this retirement form and requires a recorded reason.

**Sanctioned ledger command**, after preparing the reviewed migration and generated PRD:

```text
npm run docs:ids -- --supersede FR-189 --reason "Retire the Edge LINE shadow/cutover obligation under ASTRA-D1 D1 while preserving existing Knowledge/RAG readers, tests and historical identity." --declared-in "docs/PRD-SDD-v1.0.md#1.264.0b"
```

`1.264.0b` is the next candidate after the inspected template’s `1.263.0b`; Claude must check for a collision before issuance.

**Exact PRD revision text**, authored in the projection template:

> ASTRA-D1 reconciles FR-187 and FR-188 as deployed and accepted for the SmartGift structured-record profile on the explicitly cited historical evidence, and supersedes FR-189’s Edge LINE shadow/cutover obligation. Existing IDs, subject anchors, FEAT-026 membership, retained Knowledge/RAG code and historical evidence are preserved. This is a delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08; it does not certify current production state, close TASK-ZAI-050 or TASK-ZAI-095, change runtime pins, or authorize deployment.

Implementation: **P0**.

## D2 — FR-187 / FR-188: approve a scoped status migration

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** Change both delivery cells to **deployed and accepted for the SmartGift structured-record profile**, with dated evidence and explicit limitations.

This does not mean every Knowledge profile is accepted, the current production host was inspected, or TASK-ZAI-050 is complete.

| Evidence | What it supports | Limitation |
|---|---|---|
| G-3, 2026-09-16, 35/35 | Historical Linux image acceptance, including SmartGift `ontology_v2`, crash/replay and quality thresholds | MSP `49fe7de7` / GKS `ecf1e4de` / GenesisBlock `7c9261c4`; not the current tuple |
| Production probe, 2026-09-24 | Actual historical publication: 22 published ingestions/receipts; parser-2 and `ontology_v2` evidence | Observation, not the activation event or present-day health |
| Release, 2026-09-28 | Historical deployment and both relay-hop smoke results | Smoke alone does not establish complete acceptance |
| MSP plan §6, 2026-10-24 | Recorded d0 MSP image qualification, restored canary, production publication/query/denial and persistence evidence | Operator-attested record; underlying private artifacts were not inspected here |
| Native acceptance, 2026-11-08, 42/42 | Current pinned runtime tuple with zuri `58991a10`, including SmartGift and LINE cases | Windows developer acceptance; not Linux image or live LINE production acceptance |

Sources: [deployment plan §9](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md:293), [production probe:64](../../.brain/reports/2026-09-24-genesisrag17-production-probe.md:64), and [native report:10](../../.brain/reports/2026-11-08-ki17-native-acceptance.md:10). MSP evidence is `docs/IMPLEMENTATION-PLAN-MSP-GENESISRAG17-ALIGNMENT.md:137–145` at `520ac710`.

A useful additional finding: MSP §6 line 141 records **42/42 in its composed acceptance image** on 2026-10-24. Preserve that exact image/app provenance; do not relabel it as acceptance of today’s Zuri source.

**Approved replacement status cells:**

- **FR-187:**
  `deployed and accepted for the SmartGift structured-record profile — historical Linux acceptance 2026-09-16, production publication evidence 2026-09-24/28, MSP alignment evidence 2026-10-24, and native Windows acceptance 42/42 on 2026-11-08. Current production state and TASK-ZAI-050 activation closure are not verified by this migration.`
- **FR-188:**
  `deployed and accepted for the SmartGift parser-2 / ontology_v2 profile — historical Linux SmartGift acceptance and production parser-2 / ontology_v2 evidence, supplemented by MSP alignment evidence 2026-10-24 and native Windows acceptance 42/42 on 2026-11-08. Future tuple changes still require exact-image G-3 qualification; this is not product-wide acceptance.`

Preserve both statement cells exactly, including their historical wording.

**Required document form:** an existing-record **v1 reviewed source-row migration**, not an authored-v2 addition, new FR, or direct registry edit.

Create:

```text
docs/change-requests/knowledge/ki17-status-reconciliation-20261108.md
```

Use:

```yaml
---
doc_type: change-request
version: "1.0.0"
status: approved
migration_base_revision: 98b708f11a51578333c52f828f31bec814df1e66
approval_scope: FR-187-and-FR-188-status-reconciliation-and-FR-189-retirement
approved_by: "Astra (gpt-6-astra), delegated product owner"
---
```

Include `## Approval`, this delegation’s provenance, exact before/after rows, evidence boundaries, parent/peer impacts and verification requirements.

**Does delegation satisfy this document approval field? Yes.** The controlling canonical-format rule says:

> “The migration document must have `status: approved` in frontmatter and an explicit approval section.”

It does not prescribe a named human approver. [CANONICAL-FORMAT:100](../../docs/migrations/document-reintegration/CANONICAL-FORMAT.md:100). The governance profile separately requires approval, delivery and deployment evidence to remain distinct at lines 54–66. The parser enforces the approved frontmatter and Approval heading in `tools/document-registry.mjs:23–33`.

This delegated approval does **not** satisfy independently named task or operational approvals.

Implementation: **P0**.

## D3 — S6: no-go for changing active pins now

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** **NO-GO for an active pin upgrade now. GO for bounded compatibility and recovery qualification.**

Keep MSP `d0d48c1a`, GKS `ecf1e4de`, and GenesisBlock `5156f412` in `pins.json`.

The verified changes are substantial:

- **GenesisBlock:** commit `2ea37899` removes `hybridSearch.alpha`; current `src/lib.rs:24467` rejects it with `KIMPACT_REMOVED`. The newer worker removes all three affected arguments. Upgrade worker and addon together.
- **GenesisBlock storage:** newer identity/startup handling and schema changes require compatibility and restore proof. Do not open the only copy of a pinned store with the candidate.
- **GenesisBlock artifact:** main’s committed Linux addon is documented as built from `209cc36b`, preceding later source changes. Its recorded verification is 26 passed / 6 model-dependent skips. That cannot qualify a new ki17 release.
- **GKS:** strict JSON-RPC, ordered stage identities, unpublished-entity filtering, cursor-ahead refusal, migrations 0007/0008 and schema-ahead protection change behavior. The restore requirement is explicit in main’s `packages/gks-persistence/src/index.mjs:259–280`.
- **Old GKS pin caveat:** `ecf1e4de` predates the schema-ahead guard. Its ability to open a migrated database would not make a downgrade safe.
- **MSP:** the inspected pin-to-main diff changes six documentation files only. There is no runtime benefit from moving this pin now.

**Future qualification order:** GenesisBlock worker/addon → GKS with retained MSP → composed Zuri stack. Keep MSP pinned unless a demonstrated compatibility change requires otherwise.

**Before changing `pins.json`:**

1. Freeze exact candidate source SHAs and native artifact provenance.
2. Prove migration/recovery using disposable stores and verified pre-upgrade backups.
3. Pass all existing native 42 cases, plus any new regressions, without skips.
4. Pass G-3 against the exact candidate Linux artifacts with the real model and LINE evaluation provider.
5. Obtain independent review and exact-head required CI.

A candidate manifest may be used for qualification. Changing the default manifest on main does not deploy anything; production deployment requires the production host and its separate gates.

Implementation: **P3 → P4 → P2 candidate rerun**.

## D4 — S5: advance preparation; retain production and named-approver gates

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** Authorize local documentation, preflight tooling and isolated acceptance work. Do not declare production activation or perform a production switch.

**Mode decision:** The first production pilot remains `GKS_THEN_BUSINESS_KNOWLEDGE`. It reads the corpus first while retaining traced fallback. `GKS_CORPUS` is a distinct, no-fallback mode, and the existing shadow comparison deliberately excludes it. See `line-knowledge-grounding.js:10–15,156` and `line-grounding-shadow-compare.js:62–70`.

The existing switch action already exists at `line-oa-account-service.js:621`; a second switch API is unnecessary.

**Advance from this machine:**

- Reconcile TASK-ZAI-050 evidence with MSP §6, explicitly as historical attributed evidence.
- Prepare its activation-record skeleton with unknown fields marked `NOT_VERIFIED`.
- Update the TASK-ZAI-095 runbook for current Server/Conversation Runtime ownership, existing shadow implementation and actual dependencies.
- Improve preflight reporting of runtime owner, shadow mode, account version and incomplete queries.
- Rehearse authorized switch → shadow collection → rollback through existing service actions on isolated data.
- Resolve documentation dependency drift: TASK-ZAI-095 requires qualified Phase-3 catalog publication, not successful completion of the retired Edge LINE cutover. Keep TASK-ZAI-042’s remaining obligations visible.

**Pilot window decision:** 14 consecutive days after the qualified switch. The operator must record exact Bangkok start/end timestamps before execution. An empty or incomplete comparison window is not acceptance.

**Must wait for a production-host operator:**

- Current image digests, embedded pins, migrations and runtime ownership verification.
- Backup/restore evidence, production publication receipt hash and a real Business-document query/citation record.
- Actual account identification, valid Business authority and model/provider readiness.
- Migration application where required, account switch, real LINE delivery, campaign evidence and rollback execution.

**Named approval cannot be impersonated.** Both task containers specify `approver: "Owen"`:

- [TASK-ZAI-050:2331](../../apps/server/src/modules/platform-control/program-roadmap-containers.js:2331)
- [TASK-ZAI-095:4677](../../apps/server/src/modules/platform-control/program-roadmap-containers.js:4677)

Astra’s delegation does not fill those named approvals. The compliant route is to prepare the complete evidence and leave the named approval for Owen; do not replace his name to bypass the gate.

Also, TASK-ZAI-050’s three current DoD booleans are **false**, despite changelog prose saying the migration criterion was checked. Its exit criterion requires a real Business document, not the fixed corpus. Do not close it merely by copying the MSP synthetic-run record.

Implementation: **P1 and P2**, followed by a production-host handoff.

## D5 — Priority

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** Execute these packets in order, progressing local work while production access remains unavailable.

| Order | Packet | Reason |
|---|---|---|
| 1 | P0 — Canonical decisions/status migration | Removes contradictory requirements and delivery claims |
| 2 | P1 — TASK-050/095 readiness and switch rehearsal | Advances the supported user-facing journey |
| 3 | P2 — Current-tuple Linux and recovery qualification | Establishes release/recovery evidence before promotion |
| 4 | P3 — GenesisBlock process/error-path tests and candidate artifact | Covers active-stack failures and the first S6 dependency |
| 5 | P4 — GKS upgrade compatibility and migration recovery | Qualifies useful fixes without risking existing stores |
| 6 | P5 — MSP retention/channel acceptance | Required before later memory activation; no pin bump needed |

Defer HTTP/G-9 transport adoption, GKS query-time orchestration, MSP summary-worker hosting, native lexical replacement, LLM extraction and unrelated database/UI features. None is necessary to finish the current supported stdio journey.

Do not build new end-to-end paths for FR-112–119 merely because their library tests exist. Qualify FR-236–238/277 through the relevant LINE journey; keep binary parsing/FR-288 as a separate task. Preserve the TASK-049 recovery dependency.

## Merge policy

**Disposition — delegated product-owner decision (Astra, gpt-6-astra) under owner instruction 2026-11-08:** Authorize Claude to merge the resulting in-scope PRs after:

- Independent review of the same final patch, separate from its implementer.
- Exact-head required CI, applicable repository protections and review resolution.
- Verification of scoped local/contract/native gates required for that packet.
- Dependency integration and revalidation after material changes.

Delegated worker, verifier and reviewer roles use **GPT-6 Luna Max**, as required by zuri.ai instructions.

**Exceptions:** No active pin promotion before D3’s gates; no production deployment, account activation, named-Owen approval substitution, secret operation, protected-checkout write or cleanup. A docs-only PR may merge while clearly retaining operational blockers. Green CI does not convert those blockers into completed acceptance.

# Luna implementation packets

All commands below are **handoff commands, NOT_RUN in this turn**. Claude owns commits and shared generators. Establish writer ownership first; preserve the dirty MSP file. Builds require the applicable resource admission and owned Cargo lane. No work in the prohibited primary/MSP/visual-office checkouts.

## P0 — Canonical migration and retirement

**Files**

- New `docs/change-requests/knowledge/ki17-status-reconciliation-20261108.md`
- `docs/change-requests/README.md`
- `docs/features/FEAT-026/requirements/FR-{187,188,189}.md`
- `registry/document-registry/PRD-SDD-v1.0.template.md`
- `tools/tests/document-registry.test.mjs`
- ADR-075 and `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`, scoped disposition pointers
- Generator-owned outputs and ID ledger, through their sanctioned writers only

**Steps**

1. Freeze the migration base and exact revised rows described in D1/D2.
2. Convert the three wrappers to `status: reviewed-migration`; remove `source_revision`; add the approved base/document provenance.
3. Preserve IDs, subjects, membership, projection positions and unrelated bytes. Compute each LF row digest from its approved row.
4. Add the PRD revision text through the template.
5. Add these three IDs to the explicit reviewed-migration inventory assertion at `tools/tests/document-registry.test.mjs:119`; retain the identity/count assertions.
6. Regenerate, then run the D1 supersession command, then regenerate/validate serially.

```text
npm run docs:registry
npm run docs:ids -- --supersede FR-189 --reason "Retire the Edge LINE shadow/cutover obligation under ASTRA-D1 D1 while preserving existing Knowledge/RAG readers, tests and historical identity." --declared-in "docs/PRD-SDD-v1.0.md#1.264.0b"
npm run docs:registry
npm run docs:graph
npm run docs:views
node --test tools/tests/document-registry.test.mjs apps/server/tests/node/canonical-document-registry.test.mjs
npm run govern
git diff --check
```

**Acceptance:** only approved rows change; FR-187/188 statements remain identical; FR-189’s normalized subject and identity remain; generated exports are fresh; unrelated ledger entries/history remain unchanged. No production or task-completion claim is added.

## P1 — Production-readiness packet and isolated switch rehearsal

**Files**

- `docs/runbooks/TASK-ZAI-095-LINE-GROUNDING-SWITCH.md`
- `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md`
- `docs/roadmap/ROADMAP.md`
- `docs/roadmap/ROADMAP-zuri-ai-24w-program.md`
- `apps/server/src/modules/platform-control/program-roadmap-containers.js`, restricted to TASK-042/050/095 reconciliation
- `apps/server/scripts/ki17-line-grounding-inspect{,-lib}.mjs`
- Their two existing unit tests
- `tests/integration/fr235-line-oa-knowledge-grounding-control.test.js`
- `tests/integration/fr277-line-grounding-shadow-compare.test.js`

**Steps**

1. Correct stale runbook snapshots and document D4’s mode/window decision.
2. Add runtime-owner and shadow-state fields to inspection. Preserve version and audience evidence.
3. Make production preflight require the approved direct connection source and fail clearly on required-query failure; do not treat a partial report as ready.
4. Keep account/Business selection explicit. Do not infer authorization from a “SmartGift” name or DIRECT traffic ratio.
5. Extend existing tests only for missing switch/shadow/rollback coverage: authority denial, stale version, correct audit, corpus evidence, traced fallback and restored mode.
6. Prepare the activation record with attributed historical fields and unresolved current fields. Keep Owen’s approval and unmet DoD unchecked.

From `apps/server`:

```text
npm test -- tests/unit/ki17-line-grounding-inspect-lib.test.js tests/unit/ki17-line-grounding-inspect-script.test.js tests/integration/fr235-line-oa-knowledge-grounding-control.test.js tests/integration/fr277-line-grounding-shadow-compare.test.js
```

Then run repository governance and applicable scope-selected checks. If application runtime behavior changes, run its required build and consumer tests.

**Host-only future commands**, with credentials supplied securely by the authorized operator:

```text
node scripts/ki17-line-grounding-inspect.mjs <protected-output-path>
node scripts/ki17-smoke.mjs
```

Use the existing authenticated `CONFIGURE_KNOWLEDGE_GROUNDING` and shadow actions for rehearsal and eventual operation; never raw SQL updates.

## P2 — Full Linux acceptance and recovery

**Files/responsibility**

- Existing `apps/server/Dockerfile` acceptance target
- `apps/server/deploy/ki17/README.md`
- Existing acceptance suites/harness and recovery configuration, only where a demonstrated qualification defect requires correction
- Dated acceptance evidence and existing operational records

**Steps**

1. Qualify the current tuple first; preserve existing 42-case coverage.
2. Bind source SHAs, addon hash/build source, image digest, model hashes, Node/Python versions and test results.
3. Supply real `qwen2.5:0.5b` for LINE acceptance. The suite uses loopback `127.0.0.1:11434`; provision it in the isolated acceptance network namespace. Do not replace it with a mock or skip LINE cases.
4. Exercise restore of database/native store, raw objects, publication pointer and citations. Keep real-storage recovery separate from fixture recovery.
5. Repeat for the eventual S6 candidate before active pin changes.

Native command, after setting the documented `KI17_*` roots/model and `GENESISRAG17_PYTHON`:

```text
npm --prefix apps/server run test:genesisrag17
npm --prefix apps/server run test:knowledge-restore:isolated
```

Linux build, from the Zuri root:

```text
docker buildx build --load --target ki17-acceptance -t ki17-acceptance:<run-id> --build-context msp=<qualified-msp-context> --build-context gks=<qualified-gks-context> --build-context genesisblock=<qualified-gb-context> --build-context ki17-tests=apps/server/tests apps/server
docker run --rm --network container:<owned-evaluation-provider-container> --mount type=bind,source=<verified-model-directory>,target=/model,readonly ki17-acceptance:<run-id>
```

For an S6 candidate, use a separate manifest through the existing `KI17_PINS_MANIFEST` build argument. Do not change default `pins.json` to conduct the experiment.

**Acceptance:** all original 42 cases pass, no failures/skips; unchanged retrieval thresholds; real crash/replay and isolation cases; matching artifacts; demonstrated restore. Docker Compose against `zuri-ai` remains forbidden.

## P3 — First S6 packet: GenesisBlock qualification

**Files**

- `genesisrag17-worker/src/cli.mjs`
- `genesisrag17-worker/src/msp-stdio.mjs`
- New focused tests under `genesisrag17-worker/test/`
- `genesisrag17-worker/test/worker.test.mjs`
- `npm/linux-x64-gnu/index.linux-x64-gnu.node` and its README, only through a qualified artifact refresh

**Steps**

1. Start from a frozen, owned candidate based on inspected main; preserve the pinned baseline.
2. Add process-level tests for malformed JSON, RPC/tool error, timeout, child exit, restart, close and shutdown. Add loopback/token refusal tests where coverage is missing.
3. Fix only failures demonstrated by those tests.
4. Reuse main’s existing alpha-removal/startup fixes; do not duplicate them.
5. Build addon and worker from compatible source; refresh Linux artifact provenance and run the model-dependent cases.
6. Verify old-store upgrade/recovery on copies, including rollback through restored pre-upgrade state.

```text
npm test --prefix genesisrag17-worker
python -m unittest discover -s genesisrag17-worker/test -p test_embedder_batching.py
npm test
```

Qualified Linux artifact build:

```text
npm run build -- --cargo-flags=--locked
```

**Acceptance:** process failures remain bounded, recovery does not lose accepted receipts, model cases execute, no worker/addon source mismatch, and new storage cannot overwrite the only recovery copy.

## P4 — GKS upgrade and real MSP compatibility

**Files**

- Existing `tests/contract/{server-dispatch,pipeline-genesisrag17,schema-ahead-guard}.test.mjs`
- Existing `tests/integration/{msp-provider-compatibility,msp-service-chain,stdio-restart}.test.mjs`
- A focused migration/recovery integration test if existing coverage is insufficient
- Relevant GKS runbook/evidence
- Runtime files only for reproduced compatibility failures

**Steps**

1. Freeze candidate main, including S2 fix `3effb3b0`.
2. Prove pinned MSP sends valid JSON-RPC and Zuri submits ordered stages.
3. Exercise unpublished reads, cursor-ahead refusal, invalid Unicode, scope denials and publication receipts.
4. Migrate a disposable pin-era store through 0007/0008; verify attribution, restart and data preservation.
5. Prove restore-based rollback. Never “test rollback” by pointing the old binary at the only migrated store.
6. Run the composed P2 candidate matrix after GenesisBlock qualification.

With `MSP_REPO_ROOT` pointing to the qualified retained MSP pin:

```text
npm test
npm run check:c0
npm run check:baseline
npm run check:corpus
```

**Acceptance:** external MSP tests actually execute; migration and rollback evidence is retained; no HTTP transport or governed-caller activation is introduced incidentally.

## P5 — MSP acceptance before memory activation

**Files/responsibility**

- Existing MSP cross/security tests and alignment evidence
- Zuri `docs/plans/MSP-RETENTION-SCHEDULER-20261024.md`
- Existing retention operations runbook and real-process acceptance scripts

**Steps**

1. Retain MSP `d0d48c1a`; main is documentation-only relative to it.
2. Complete retention plan steps 4–5 on qualified environments.
3. Run the Linux-only acceptance on a real Linux artifact; do not count Windows exclusions as passes.
4. Obtain actual scheduler invocation and target-binding evidence before memory activation.
5. Keep production memory OFF until retention acceptance and real LINE UAT pass.

MSP, with `MSP_TEST_ZURI_ROOT` configured:

```text
npm run test:cross-zuri
npm run test:security
```

Zuri `apps/server`, with `MSP_REPO_PATH` configured:

```text
node tests/acceptance/msp-principal-memory-real-process.mjs
node tests/acceptance/msp-memoryos-real-process.mjs
node tests/acceptance/msp-retention-real-process.mjs
```

**Acceptance:** scope/replay/erasure boundaries hold; scheduler evidence names the actual artifact and execution environment; no claim that summary-worker hosting or broader Memory OS activation is complete.

**Final disposition:** Decision work complete; implementation handed to Luna and integration to Claude. Current production state, raw private operator artifacts, new exact-image acceptance, future PR checks and named Owen approvals remain unverified or pending. No on-disk result file or session note was created.
