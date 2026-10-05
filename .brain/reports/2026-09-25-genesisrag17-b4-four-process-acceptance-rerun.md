# GenesisRAG17 B4 — four-process acceptance re-run (2026-09-25)

Board item B4, 2026-09-24 GenesisRAG17 remediation review: "re-run four-process acceptance and record a receipt". Depends on
B2 (done, PRs #549/#555/#558), C1 (done, PR #567) and C2 (done, PR #566); B3 skipped by owner ruling. Definition of done:
zero skips, and the report names its provenance (native / Linux image / hosted CI) per
[`.brain/rca/2026-09-20-ki17-runtime-roots-deleted.md`](../rca/2026-09-20-ki17-runtime-roots-deleted.md)'s own rule.

## Provenance

**Native Windows.** Not the Linux image (G-3), not hosted CI, not production. This machine, run directly.

| Root | Repository | Commit | How it was prepared |
|---|---|---|---|
| zuri-ai (driver) | Freshair129/zuri.ai | `7031a4afa72706b15032141df175e82934dfb058` | `git worktree add --detach origin/main` at `C:\Users\pc\workspace\ki17-accept-zuri`; `npm --prefix apps/server ci`; `npx prisma generate` |
| KI17_MSP_ROOT | Freshair129/Memory-and-Soul-Passport | `68e6169dbb371dac2f0debf0bf731b553f7dc26d` | `git worktree add --detach` from the local clone, at `C:\Users\pc\workspace\ki17-accept-msp`; `npm ci` at the workspace root |
| KI17_GKS_ROOT | Freshair129/Genesis-Knowledge-System | `ecf1e4de269e949406a6a5f791f9ff8fe30c9578` | same, at `C:\Users\pc\workspace\ki17-accept-gks` |
| KI17_GENESIS_ROOT | Freshair129/GenesisBlock | `5156f412da73905a23d74775a82cc14d1f6d04d0` | fresh `gh repo clone`, checked out to the pin, at `C:\Users\pc\workspace\ki17-accept-genesis`; **built from source** (`npm run build` → `napi build --platform --release`, 2m01s) — see "Native addon" below |
| Model | `intfloat/multilingual-e5-small` | revision `614241f622f53c4eeff9890bdc4f31cfecc418b3` | existing local Hugging Face cache, unchanged |

Node `v24.19.0` throughout (`KI17_NODE` left unset, so `process.execPath` — the same Node runs Tier 1, MSP, GKS and the
worker in this native run, unlike the production image's Node 22/Node 24 split; that split is a container-build fact this
run does not reproduce). System Python `3.12.10` (`numpy` 2.5.2, `onnxruntime` 1.29.0, `tokenizers` 0.23.1) — matches
`genesisrag17-worker/requirements.txt` exactly, so `GENESISRAG17_PYTHON=python` with no venv, per
[[ki17-acceptance-run-setup]].

**Native addon note.** GenesisBlock's `package.json` at this pin lists `optionalDependencies` at version `0.2.0` for every
platform's native binding. That version does not exist on the npm registry (published versions start at `0.2.3`), so a
plain `npm install` silently skips it — this is a stale pin in the repository, not something this run can fix. Building
from source at the exact pinned commit sidesteps it entirely and is the provenance-correct choice: the resulting
`index.win32-x64-msvc.node` matches this pin exactly, unlike substituting a later published binary would.

## Command and result

```
npm run test:genesisrag17
```
(`apps/server`, from the driver worktree, `KI17_MSP_ROOT`/`KI17_GKS_ROOT`/`KI17_GENESIS_ROOT`/`KI17_MODEL_DIR` set to the
roots above). Three files, 42 tests, **38 passed, 4 failed, 0 skipped**:

| Suite | Tests | Result |
|---|---|---|
| `genesisrag17-e2e.test.js` — "GenesisRAG17 actual four-process acceptance (no skips)" | 24 | **24/24 PASS** |
| `genesisrag17-e2e.test.js` — "TASK-ZAI-094 isolated LINE grounding acceptance" | 4 | **0/4 — see below** |
| `genesisrag17-smartgift.test.js` | 8 | **8/8 PASS** |
| `genesisrag17-smartgift-merged-fixture.test.js` (new, see below) | 2 | **2/2 PASS** |

Zero test files were skipped for a missing prerequisite (the suite's own design: it throws rather than skips), and the
overall command's non-zero exit reflects the 4 known-unrelated failures below honestly rather than a clean pass being
claimed where one output failures.

## The 4 failing tests are not a GenesisRAG17 regression

All four live in one describe block, "TASK-ZAI-094 isolated LINE grounding acceptance"
(`genesisrag17-e2e.test.js:594-790`), and fail identically: `runLineConversationWorker`'s answer step throws
`PHASE1_CONFIGURATION_MISSING: ZURI_LINE_DB_URL, ZURI_MODEL_PROVIDER, ZURI_MODEL_NAME, ZURI_MODEL_CREDENTIAL`
(`src/modules/agent/phase1-runtime.js`), masked by two catch-all handlers into the generic `LINE_ANSWER_UNAVAILABLE` /
`EXECUTION_FAILED` codes the test output shows (`status: FAILED, sent: 0` on every one of the four). Confirmed with a
temporary diagnostic print, reverted before commit (`git diff` clean on both touched files after the run).

This is a Phase-1 business-agent / LINE-answer configuration gap (ADR-100 D3: every answered turn now resolves a real
model provider, no more `LOCAL_ONLY` deterministic-answerer branch), not a GenesisRAG17 chunking or Zero-PII defect:

- Every record these four tests need is admitted, chunked (parser-3), Zero-PII-checked and **published** successfully —
  the failure is entirely in the LINE reply-generation step that runs *after* a successful publish, querying the
  already-published corpus.
- The 24 core GenesisRAG17 tests and both SmartGift suites, which exercise the exact same admission → chunk → Zero-PII →
  publish → retrieve path these four tests also depend on, all pass.
- The acceptance harness's `isolatedEnvironment()` (`tests/acceptance/harness.js`) never sets
  `ZURI_LINE_DB_URL`/`ZURI_MODEL_PROVIDER`/`ZURI_MODEL_NAME`/`ZURI_MODEL_CREDENTIAL`, so this describe block cannot pass in
  a genuinely from-scratch isolated run without either a safe test-only model/DB configuration or a documented, deliberate
  dependency on ambient credentials — neither exists today. Filed as a separate follow-up (not this session's to fix, and
  explicitly not fixed by copying real production secrets into a test harness); GenesisRAG17's own B4 item does not depend
  on it.

## New: the merge ("added") path gets its full-stack proof

Every existing acceptance test boots the native worker with a single, isolated benchmark entry per record. That never
exercises the worker's own `scopedBenchmarkFixture` (`genesisrag17-worker/src/worker.mjs`) scoping logic across *multiple
co-resident* records — which is exactly what production's real fixture file does on every publish. Board item B2's
closing decision named this as the one path B4 should exercise before the first real catalog change.

New suite `tests/acceptance/genesisrag17-smartgift-merged-fixture.test.js` (registered in `vitest.ki17.config.js`):

1. Builds a "deployed" baseline from the acceptance corpus's own 4 existing benchmarks (the exact multi-record
   `{fixtureVersion, benchmarks: [...]}` shape the worker boots with in production).
2. Writes one new, real, valid SmartGift `ProductMaster` record (`PM-B4-MERGED-FIXTURE`) to a catalog file and merges it
   on with `build-smartgift-real-corpus.mjs --base` (the exact §10.1 operator tool) — `added: ['PM-B4-MERGED-FIXTURE']`,
   `replaced: []`, both asserted, plus a pre-upload `--check` that reports full coverage.
3. Boots the **real native worker once** with the full 5-record merged fixture — not a single isolated entry.
4. Admits and publishes only the new record through the real four processes, and proves Stage 16/17 scores it correctly
   (Recall@5 1.00, MRR 1.00, citation correctness 1.00, 0 cross-tenant leaks) despite four other records' benchmarks
   sitting in the same fixture file, then queries and resolves its citation through Tier 1.

**2/2 passed.** Report: `.brain/reports/genesisrag17-b4-merged-fixture.json` (repo-root path, written by the test itself;
`recordCount: 5`, `newRecordExternalId: PM-B4-MERGED-FIXTURE`, full benchmark metrics).

## What this closes and what remains

- B4's definition of done — zero skips, provenance stated, receipt recorded, commits named — is met for the GenesisRAG17
  pipeline itself.
- The merged-fixture gap B2 flagged is now closed: the `--base` "added" path has a real, passing, full-stack acceptance
  test, permanently in the suite (not a one-off run).
- The TASK-ZAI-094 LINE-answer harness gap is filed as its own follow-up and does not block B4.
- Files changed in this repo: `apps/server/vitest.ki17.config.js` (registers the new suite),
  `apps/server/tests/acceptance/genesisrag17-smartgift-merged-fixture.test.js` (new). No other repo (MSP, GKS,
  GenesisBlock) needed a change — all three were used exactly as pinned.
