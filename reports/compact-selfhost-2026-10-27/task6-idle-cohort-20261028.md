---
doc_type: implementation-evidence
status: reviewed
version: "0.1.1"
recorded_at: "2026-10-28"
selection_base: "aa4f8c50aa4e9d2e28ea0db6bb66248087b3d305"
package_source: "bafe11aac924150ff442078dd92292c00101f10f"
acceptance_harness: "ec809e2bb6070ac3dbb33f99bae7dbc19d8d9e90"
---

# Task6 actual idle Knowledge cohort TEST

The packaged web/native cohort started and passed manual idle recreation on an
owned disposable TEST target: three actual tests passed with cleanup PASS.
Knowledge remains `NOT_QUALIFIED`; Task6 remains open. This follows
[ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md), the
[approved continuation](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task6-continuation-actual-idle-knowledge-cohort),
and the earlier [package/offline evidence](task6-knowledge-package-20261028.md).
It establishes no application Business authority or active-work recovery claim.

## Source lineage after rebase

The SHAs in this report identify the source that was actually packaged and
tested. They belong to the pre-rebase lineage `f63378be..848e422e`, retained at
tag `evidence/compact-task6-20261028`. On 2026-11-06 that lineage was rebased
onto main `46787958`. The rebased commits contain main's later changes, are not
tree-identical to the tested source and were not re-run:
`bafe11aa`→`ec6eae90`, `3b58fcc9`→`3726f5a9`, `aa4f8c50`→`b4f3f5e4`,
`ec809e2b`→`cc47d997`, `1dd72707`→`4c42f817`, `478a857f`→`ad59b5b8`,
`6aca5b08`→`3475fbff`, `848e422e`→`2b8b2d41`. Main's later schema contracts
change the baseline source-contract digest (`sourceContractsSha256`), so the rebased harness refuses `bafe11aa` packages;
any rerun needs a new package built from the rebased source.

## Artifact, environment and authority

The unchanged immutable package identifies `bafe11aa`; the new test-only
harness identifies clean commit `ec809e2b`. No image was rebuilt or relabelled
for this run. The [observation](task6-idle-cohort-observation-20261028.json) binds
all five package references/IDs/platforms, the manifest and inventory hashes,
and the actual web/native IDs before and after replacement. The manifest hash
is `0c56d22e2bd2108aae006cacfa863cda8aaf62aced34c6440fff19baf94e7ccb`;
the inventory hash is `81325ccb5502cce3806ed0465252edb29aeac03b10a5184972f171cf3b5d9150`.
The loader reverified the complete retained package before and after the run.

The host was Windows Docker Desktop with linux/amd64 images. The fixture created
its own PostgreSQL database, network, objects/native/shared volumes and private
files. App/session/envelope, DB bootstrap/runtime, storage-admin and MSP/native
credentials were generated only for this fixture; no checkout environment file
or persistent license was read. This lane refuses external-license selections.
Secret values, secret hashes, raw environment arrays and Compose config hashes
are excluded from the observation. The provider/license evidence remains the
same bounded TEST selection recorded by the earlier package report.

Only the packaged web and native Compose services were started alongside the
fixture-owned database. Storage, tools, LINE and public ingress were not started.
Web Knowledge admission/storage flags stayed disabled. Actual environment checks
confirmed no LINE/thread/Ollama inputs on web/native and no `DATABASE_URL`,
`POSTGRES_*`, session-secret or envelope-key variables on native. Other database
alias names were not part of that observed key check. Synthetic MSP source/worker principals shared
one new six-field scope; that scope has no application Tenant or Business.
This is fixture configuration, not a Business membership or serving grant.

## Observed startup and recreation

| Check | Actual result |
|---|---|
| Initial web health / wrong-bearer native query | HTTP 200 / 401 |
| Native model binding | Exact packaged model directory, readonly; no missing cohort bindings |
| Separate native container without query token | Exit 1 with the fixed required-token error; no network/shared-store mount |
| Idle native stop through existing SIGTERM/close | Exit 0, not OOM-killed |
| Explicit web replacement | New web ID; old stopped native retained its old namespace and was diagnosed `STALE_WORKER_NAMESPACE` |
| Explicit native force-recreation | New native ID; `container:<current-web-ID>` and package-pinned reference/actual image ID matched |
| Rebound web health / native bearer refusal | HTTP 200 / 401 |
| Native/shared stores | Same labelled volumes; both fixture markers survived; model remained readonly |
| Application state | Zero Tenant, Business, Membership, IntegrationCredential and KnowledgeIngestion rows |

The lexical store file was present in the initial running worker volume. Marker retention
proves retention of these existing volumes across idle replacement; it does not
prove a native snapshot/checkpoint restore or recovery of corpus objects after
store loss. HTTP 401 proves the loopback endpoint's wrong-bearer refusal, not an
authorized retrieval or successful serving decision. The raw harness field
`unauthenticatedNativeStatus` records that wrong-bearer request; a missing-header
case was not run. No ingestion, publication,
active job or outbound delivery was submitted by this lane.

## Guard corrections and verification

Independent source review caught a preflight that would reject the fixture's own
installed DB, and partial-create cleanup gaps. Project inventory now permits
only that exact already-owned DB ID/name/image/service and rejects extra,
duplicate, missing or foreign IDs. All Compose/probe mutations register intent
before creation. Cleanup checks owner, name, pinned reference and actual image
ID; the negative probe additionally requires network `none` and no shared mount.
Unknown outcomes or mismatches retain the unresolved intent and report failure
while independent cleanup actions continue. Private credential files leave
through the existing verified fixture-root cleanup.

The existing packager already adds the web shared-state mount when Knowledge is
selected; the actual retained Compose file was checked. No new mount, grant,
worker coordinator or product shutdown behavior was introduced. A clean source
tree is required before the lane can record its harness revision. Failed setup
reports admission as `NOT_VERIFIED` until actual web configuration is observed.

| Command/check | Actual result |
|---|---|
| Node owner/image/role/project/probe guards | Failing-first controls, then relevant suites 81/81 passed |
| Dedicated cohort command without inputs | Refused; zero tests was not PASS |
| Dedicated cohort command with dirty source | Refused before retention/Docker; neither output created |
| `npm run compact:test` at `ec809e2b` | 244/244 passed, zero skipped |
| `npm run test:compact:cohort` at `ec809e2b` | 3/3 passed on the first actual cohort run, zero skipped; 185.09 seconds total |
| `npm run govern` at frozen source `ec809e2b` | 0 critical, 0 warning, 43 information; PASS |
| Independent source review | No remaining blocker after the guard corrections |

An earlier governance run stopped with stale generated state after review edits
changed its inputs. It is retained as exit 1, not a pass; the frozen-source run
above regenerated and passed. No timeout, native pin, model file or runtime
guard was relaxed. The configured hooks/tests retain the existing 120-second
operation-class budgets; the native Docker stop grace was unchanged.

## Limits and retained evidence

The result closes this bounded actual idle-cohort TEST milestone only. Current
application bootstrap/Business authority, active-work drain/replay/no duplicate
send, full KI17 and serving authorization on shipped images, object/DB recovery,
native Stage9+ restoration after loss, supported Linux-host and off-host DR,
hosted CI/publication/release remain open. LINE remains unqualified and unselected
here; live LINE UAT remains NOT_RUN. No Task6 acceptance group was marked closed.

All owned target containers/volumes/networks were observed absent after cleanup.
There were no unresolved Compose/probe intents. The existing container ID/name/
state inventory matched before and after. The package, retained copy, images,
model, raw logs, failed controls and reviewed patches remain under local
`zuri-checkpoint-20261028/compact-task6-idle-cohort-aa4f8c50`. No production,
main-dev/UAT, live provider, separate Visual Office or worktree operation occurred.

Version 0.1.0 records this continuation without changing canonical requirements,
their lifecycle, previous evidence snapshots or release authority.

## Version diff

0.1.0 → 0.1.1 (2026-11-06): records the pre-rebase source lineage and the
rebased commit mapping; observed results and remaining gates are unchanged.
