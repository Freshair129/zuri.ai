# KI17 native acceptance and status reconciliation (2026-11-08)

## Scope

This report records the Windows native developer acceptance facts supplied by
the lead, the production MSP provenance caveat, and the documentation changes
made in the `docs/ki17-native-acceptance-recipe` worktree. No credentials or
private payloads are recorded.

## Native Windows acceptance

**Host and exact tuple:** host `freshair`, Windows, Node `v24.20.0`; zuri.ai
`58991a10` (PR #791; fix head `a7485c3e`); MSP
`d0d48c1a8e833478525d9a6ce5ee16af2c85444d`; GKS
`ecf1e4de269e949406a6a5f791f9ff8fe30c9578`; GenesisBlock
`5156f412da73905a23d74775a82cc14d1f6d04d0`.

From `apps/server`, the command is:

```text
npm run test:genesisrag17
```

It requires `KI17_MSP_ROOT`, `KI17_GKS_ROOT`, and `KI17_GENESIS_ROOT` to name
detached checkouts at the exact pins; `KI17_MODEL_DIR` to name the
`intfloat/multilingual-e5-small` files at revision
`614241f622f53c4eeff9890bdc4f31cfecc418b3`; and `GENESISRAG17_PYTHON` to name
the Python 3.12 executable from a venv created at
`<GenesisBlock checkout>/genesisrag17-worker/.venv` with that worker's pinned
`requirements.txt` installed. `KI17_NODE` is optional; when unset the harness
uses `process.execPath`. The worker verifies five model files by SHA-256.

On Windows, MSP and GKS dependencies install with `npm ci --ignore-scripts`;
plain `npm ci` tries to compile `better-sqlite3` 13.0.3 and fails without a
working MSVC/Windows SDK, while the package supplies a prebuilt `win32-x64`
binary. The GenesisBlock pin ships only the Linux addon. Its Windows addon is
built in that pinned checkout with `npm ci --ignore-scripts`, then
`npm run build:debug` in a Visual Studio 2022 x64 developer environment with
`vcvars64.bat` active. The build produces `index.win32-x64-msvc.node` and
rewrites tracked `index.js` and `index.d.ts`; restore those files with
`git checkout -- index.js index.d.ts` so the checkout remains at the pin.

A local Ollama at `127.0.0.1:11434` serving `qwen2.5:0.5b` is required by the
TASK-ZAI-094 LINE grounding cases.

**Result:** 3 files, **42 passed, 0 failed, 0 skipped**, about 610 seconds:

| Suite | Result |
|---|---:|
| `genesisrag17-e2e` (including TASK-ZAI-094) | 29/29; TASK-ZAI-094 4/4 |
| `genesisrag17-smartgift` | 11/11 |
| `genesisrag17-smartgift-merged-fixture` | 2/2 |

The focused `-t "TASK-ZAI-094"` selection alone passed 4/4. Before zuri.ai PR
#791, the same full run was 40/42: both TASK-ZAI-094 LINE cases failed with
`LINE_GKS_AUTHORITY_REVOKED`. The RCA is
`.brain/rca/2026-11-08-line-gks-citation-fence-generation-type.md`.

This is a native Windows developer run. It does not replace the G-3 Linux image
gate or exact-image acceptance before a production promotion. A run rewrites
tracked evidence files under `.brain/reports`: `genesisrag17-*.json`,
`fr252-computed-catalog-native.json`, and `task-zai-094-line-grounding.json`.

## Production MSP evidence and limits

MSP `docs/IMPLEMENTATION-PLAN-MSP-GENESISRAG17-ALIGNMENT.md` §6, at MSP
`origin/main` commit `520ac71`, records that production was upgraded on
2026-10-24 to embed MSP `d0d48c1` via zuri PR #733 (merge `7d6a80e0`). The
document reports web image digest `sha256:325eea24…3c0`, worker image digest
`sha256:9bee2c31…7e3`, and production run
`4a69d6bf-423e-4a04-8e78-d6b7346f756d`: 17/17 stages, one publication receipt,
both relay hops, query/citation checks, and denial checks passed.

The lead did not inspect production directly; production is not on host
`freshair`. README wording therefore attributes this to the MSP document and
does not present it as a fresh host observation.

## FR-187 / FR-188 status disposition

The reported evidence supporting a deployed and accepted status is:

- [GENESISRAG17-EDGE-DEPLOYMENT.md §9.1](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md):
  G-3 Linux acceptance, 35/35, on 2026-09-16.
- [The same document §9.2](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md):
  production probe on 2026-09-24 found 22 published SmartGift ingestions; the
  §9.2 history also records the 2026-09-28 release.
- MSP implementation plan §6: the 2026-10-24 production run described above.
- This 2026-11-08 native run: 42/42, including SmartGift 11/11 and
  `ontology_v2` Stage 17 PASS.

The canonical source records remain at
`docs/features/FEAT-026/requirements/FR-187.md` and
`docs/features/FEAT-026/requirements/FR-188.md`. Their current status cells
still say FR-187 is "implemented locally (tests), not deployed" and FR-188 is
"implemented locally (PR #327, tests) ... not deployed; four-process acceptance
run pending". The cells were not changed. These are `source-preserved` records
whose row hashes are pinned; the [canonical format](../../docs/migrations/document-reintegration/CANONICAL-FORMAT.md)
requires an approved source-row migration document for an existing FR row
change. The current task's allowed paths do not include the required
`docs/change-requests/` migration document, and no existing approved migration
for these rows was found in the migration inventory. The result is recorded as
a blocker caused by the allowed write scope rather than a direct row/hash edit. The
PRD/FEATURES exports were not hand-edited.

## FR-189 owner question

The deployment-plan §9.3 addition asks whether FR-189 remains applicable after
ADR-110 retired the edge-device worker connection. FR-189 was not superseded or
re-statused; that disposition remains an owner decision.

## Files changed and why

- `apps/server/deploy/ki17/README.md` — adds the native Windows acceptance
  recipe, expected results and evidence side effects; replaces the stale
  production MSP statement with the MSP §6 evidence and its source caveat; marks
  the 2026-09-28 deployment record and old MSP G-3 tuple as historical.
- `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md` — adds §9.3 with the 42/42
  native result and FR-189 owner question; increments the version and changelog.
- `.brain/reports/2026-11-08-ki17-native-acceptance.md` — records the supplied
  facts, provenance, scope blocker and change disposition.

The requested generators and governance command have now run; their results are
listed below.

## Verification

- `npm.cmd run docs:registry` — PASS; wrote 557 canonical records and
  compatibility projections. No additional tracked or untracked diff appeared.
- `npm.cmd run docs:graph` — FAIL; Node 24.20.0 failed to spawn `git` with
  `EPERM` while running `git --no-replace-objects ls-tree --name-only
  b6fbbaadc5599bd8034968f35973dfe1a3f9fd13 -- docs/FEATURES.md` during applied
  receipt validation.
- `npm.cmd run docs:views` — PASS; generated 96 views for 46 features using
  graph 2.0.0. The generated outputs did not add tracked or untracked diffs.
- `npm.cmd run govern` — FAIL at its `docs:graph` step with the same `spawnSync
  git EPERM`. The preceding registry, inventory, and identity checks passed;
  `docs:views:check`, `docs:check`, and `docs:preflight` were not reached.
- `git diff --check` — PASS.

Only the two listed tracked docs and this new report appear as modified or
untracked paths; no generated tracked output changed. No native acceptance
command was run in this documentation task.

## Unplaced fact

The requested FR-187/FR-188 canonical status update is not yet reflected in the
source rows. To complete it, the allowed write scope must include an approved
source-row migration document under `docs/change-requests/`; its exact revised
rows must preserve both statements and subject anchors while changing only the
status cells. Until then, the report and §9.3 cite the new evidence without
claiming that the canonical requirement lifecycle has changed.
