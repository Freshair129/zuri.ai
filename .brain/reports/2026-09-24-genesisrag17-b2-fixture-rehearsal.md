# GenesisRAG17 production benchmark fixture: source and B2 rehearsal (2026-09-24)

Read-only record for remediation-board items B1 and B2 of the 2026-09-24 GenesisRAG17
review. It backs two documents: the 2026-09-24 amendment of
[ADR-073](../../docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md)
and §10.1 of [GENESISRAG17-EDGE-DEPLOYMENT](../../docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md).
Nothing on the production host was changed to produce it. Commands ran against the live
containers with `docker exec`/`docker cp` out, and against copies in a scratch directory.
No payloads, credentials or environment values other than the one fixture path are recorded.

## Which fixture production's worker reads

| Fact | Value | How it was read |
|---|---|---|
| `GENESIS_WORKER_BENCHMARK_FIXTURE` in `zuri-ai-genesis-worker-1` | `/var/lib/zuri-ki17/state/smartgift-real-benchmark-v1.json` | `docker exec … printf %s "$GENESIS_WORKER_BENCHMARK_FIXTURE"` |
| Volume | `ki17-state` (the path is under its mount, `docker-compose.yml` `genesis-worker.volumes`) | compose file |
| File owner, mode, size | `node:node`, `444`, 35,530 bytes | `stat` in the container |
| File modified | 2026-09-21 02:57:58 UTC (09:57 +07) | `stat` in the container |
| File sha256 | `d2d40084a375e719c76a1da0d08680d4eef6cf5e7998fca0060920b22a3d0457` | `sha256sum` in the container |
| `fixtureVersion` | `smartgift-real-catalog-v1` | file content |
| `derivedFrom.sha256` (the corpus it was built from) | `8224d9f71c787e9d28a2d5e094fe77a1a384e3aa93ee9812d9759bf3e9e63eb9` | file content |
| Benchmarks / queries | 22 records (16 `ProductMaster`, 6 `BundleOffer`) / 61 queries; the same 22 external ids as the 22 published ingestions | file content, and the probe's published-ingestion count |
| `derivedFrom.generatedFrom` | absent: the file predates the field | file content |
| Worker process | started 2026-09-24 05:23:17 UTC, image `zuri-ai-genesis-worker:release-fad8ec62-msp-68e6169-genesis-5156f41` | `docker inspect` |

The worker reads this file once, in its constructor (GenesisBlock worker at the pinned
`5156f412`, `genesisrag17-worker/src/worker.mjs`, `fixtureFromOption` called at line 971).
It scores a candidate only on rows whose gold texts are byte-equal to that candidate's
chunks (`scopedBenchmarkFixture`, line 894), and a candidate's chunks are the published
record's own (`lexicalRows` built from `decision.chunks`, lines 1222–1240 and 2048).

The image-baked `/opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json`, which
`apps/server/.env.knowledge.example` names, is **not** what production reads. Its gold
texts come from the Phase 2 test corpus, so no real record could match them.

## Where the file came from

The same bytes sit in the SmartGift data-pipeline repository
(`Freshair129/TN001B01-SmartGift`), checked out at `C:\Users\pc\workspace\business-01-smart-gift`:

| File under `data-pipeline/05_genesisrag17/` | sha256 | Tracked |
|---|---|---|
| `ProductMaster.genesisrag17.json` | `8c7717140ccd0f9e58b544bc60b9582c968b1972575d5e3ad8259726451bc308` | yes, commit `40c9909` |
| `BundleOffer.genesisrag17.json` | `9d86ef357236ca8f8abea5e450631c0c0bd2ce71b310edc06dab4678085f6b5c` | yes, commit `40c9909` |
| `benchmark-corpus.genesisrag17.json` | `8224d9f71c787e9d28a2d5e094fe77a1a384e3aa93ee9812d9759bf3e9e63eb9` (equals the deployed `derivedFrom.sha256`) | **no, untracked** |
| `benchmark.genesisrag17.json` | `d2d40084a375e719c76a1da0d08680d4eef6cf5e7998fca0060920b22a3d0457` (equals the deployed file) | **no, untracked** |

So the 2026-09-21 install was: the two catalog exports, then
`build-smartgift-real-corpus.mjs`, then `build-smartgift-benchmark.mjs`, then a copy onto
the volume, then a worker restart. It was not written down anywhere. The two derived files
exist outside the volume only as untracked files in one working copy. §10.1 step 2 keeps
a copy of the deployed file with every future change, so the volume stops being the only
dependable copy.

Re-running both SmartGift exporters (`pipeline/export_genesisrag17_productmaster.py` and
`…_bundleoffer.py`, `--out` to a scratch directory) produced files byte-identical to the
two tracked exports. The canonical catalog has not changed since 2026-09-21. Every record in
it (16 products, 6 offers) is already published, and the exporter commit's own message says
the remaining 427 product and 1,110 offer rows are unpromoted supplier rows, "a catalog-owner
decision, not a transform". **No real record outside the fixture exists today.** That is why
B2's final proof, one new record publishing on production, is not in this record.

## Rehearsal of the §10.1 step, read-only

Run from `apps/server` on branch `feat/gr17-b2-per-record-benchmark-step`, with the deployed
file copied out by `docker cp`.

| Step | Command (abridged) | Result |
|---|---|---|
| Rebuild from scratch | `build-smartgift-real-corpus.mjs --fixture-version smartgift-real-catalog-v1 <both exports>`, then `build-smartgift-benchmark.mjs` | 22 records, 61 queries. The external id, per-record version, queries and gold texts of every record are identical to the deployed file. Today's render path still produces the chunks production published |
| Merge onto the deployed file | `--base deployed.json --fixture-version smartgift-real-catalog-v2 <both exports>` | `added 0  replaced 0  unchanged 22`, "nothing to install". The version stays `v1` |
| Pre-upload check, covered | `--check deployed.json <both exports>` | all 22 `covered`, exit 0 |
| Pre-upload check, not covered | `--check deployed.json tests/fixtures/genesisrag17/smartgift-catalog/bundles.json` | both test records `missing`, exit 2 |
| Install command | step 5's `sh -c` sequence in a throwaway `docker run --rm --user node` container of the worker image, over a mode-444 file in a `node`-owned directory | atomic replace succeeded, the backup kept the old bytes, the printed hash equalled the source file's hash |

The live file, the worker and the web container were not changed. The review gate
reproduced the check and the merge independently.

## Lineage to carry into the first real install

Because the deployed file has no `generatedFrom`, the first `--base` merge will list only the
new catalog files. The step 8 record of that install should copy the two tracked export
hashes above as the sources of `smartgift-real-catalog-v1`.
