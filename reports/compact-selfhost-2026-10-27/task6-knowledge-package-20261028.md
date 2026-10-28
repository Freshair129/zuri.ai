---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-28"
selection_base: "f63378bee8b059b898960f287bfd3b8d0a9fdcb6"
package_source: "bafe11aac924150ff442078dd92292c00101f10f"
acceptance_harness: "3b58fcc9c0d5d3dc541857070b482f9400b8b15b"
---

# Task6 selected Knowledge package and offline TEST evidence

A relocated `core + knowledge` OCI package passed four bounded artifact,
fresh-baseline and offline-runtime tests. Knowledge remains `NOT_QUALIFIED` and
Task6 remains open. This supplements the earlier [Task6 verification](task6-requalification-20261028.md)
under [ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md) and the
[approved plan continuation](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task6-continuation-selected-knowledge-artifact-boundary).
It issues no requirement, Business grant, release or production authority.

## Exact artifact and source boundaries

The primary-checkout branch started from `f63378be`. Package/API source and all
three application image assembly labels identify `bafe11aa`; the corrected
test-only harness identifies `3b58fcc9`. The latter did not rebuild or relabel
the packaged application bytes. These are separate, explicit revisions.

The candidate contains 1,608 declared payload files, canonical documentation,
registry and graph, the full fresh PostgreSQL baseline, five immutable images,
and all five pinned E5 model files. The [observation](task6-knowledge-package-observation-20261028.json)
records the complete image references/observed IDs/platforms, pins, model hashes,
manifest and inventory hashes, runtime results and cleanup outcome.

| Identity | SHA-256 |
|---|---|
| Canonical manifest | `0c56d22e2bd2108aae006cacfa863cda8aaf62aced34c6440fff19baf94e7ccb` |
| Package inventory | `81325ccb5502cce3806ed0465252edb29aeac03b10a5184972f171cf3b5d9150` |
| OCI archive, 1,261,082,624 bytes | `bc21bebb3927a75e632ce5d5887a806622dfcef98c12d5329b862c2819ad4cc7` |

Fresh tools/runner builds used an exported source tree with every file verified
against its Git blob. Git's Windows EOL attributes changed some archive files;
the first attempt stopped before building. The next export restored those files
from their exact Git blobs and verified every final file again.

The web/native assemblies carry pinned KI17 runtime bytes from immutable carrier
`sha256:9bee2c31dc0efee6f2564eab273f9c815961a1635c08a29805849524974163e7`.
Its prior Zuri source label is `bf48f2ff69dad33371ec3812ee45c29f44825ad6`;
that history is retained. Current assembly files and the existing pin-receipt
checker were applied from the exported source. This is recorded build provenance,
not a signed attestation or a claim that every carried byte was rebuilt.

This host's raw image export contained an OCI index/layout plus 98 blobs and no
legacy `layer.tar` entries. A separate selection step verified the exact
linux/amd64 base manifests, configurations and reachable layers, producing an
84-blob layout accepted by `verifyOciLayout`. Its first attempt refused an
uppercase repository name for the new role; lowercasing that helper-generated
name resolved the error without changing the validator. The package producer
verified that final layout and generated its own OCI transport archive. Raw
Docker export was not substituted for the verified package archive.

Storage/provider evidence was reused only for the same immutable vendor image.
The license review remains an explicit TEST-only assertion; this lane supplies
no production provider qualification or legal release approval.

## Implementation and executed checks

The new bundled `knowledge-inspect` accepts only the exact `core + knowledge`
selection and a mandatory expected revision. It verifies every payload/model
hash before Docker inspection, binds all five image references/IDs/platforms,
and checks web/tools/Genesis assembly labels. Vendor labels and image environment
values are omitted. It always returns `ARTIFACT_INSPECTED_NOT_QUALIFIED`;
`databaseInstallation` describes only the baseline marker. Both core-only
qualification guards continue to refuse optional profiles.

Independent review found two evidence gaps: the run record lacked inventory/image
bindings, and its output could overlap a package. The corrected lane records
those bindings and validates canonical, new output paths outside both packages
before retention. Finalization never writes an output rejected by that check.
Failed exclusive copy destinations remain available for inspection; retries use
a new destination. No retained evidence cleanup was added.

| Command/evidence | Actual result |
|---|---|
| `npm run compact:test`, harness `3b58fcc9` | 239 passed; zero failed/skipped |
| Dedicated lane without inputs | Failed closed; zero tests is not PASS |
| `npm run test:compact:knowledge`, package `bafe11aa`, harness `3b58fcc9` | 4/4 passed; fixture cleanup PASS |
| Source governance before artifact build | 0 critical, 0 warning, 43 information; PASS |
| Scoped `next lint` attempt | Unavailable: repository has no ESLint configuration; no configuration was added |

The actual acceptance relocated the package outside the checkout, exercised its
bundled CLI, installed only a fresh disposable PostgreSQL baseline, verified
idempotence, and observed zero Tenant, Business, IntegrationCredential and
KnowledgeIngestion rows. The corruption control changed only a run-created
retained model copy, proved refusal before Docker, restored the original bytes,
and reverified the package.

Three owned, network-disabled image probes used readonly roots and no anonymous
volumes. Web and native images exposed the selected Node24.18.0 runtime and
MSP/GKS/Genesis receipt; tools contained its Prisma CLI. The native probe loaded
the actual addon, verified all five readonly model files, and invoked its shipped
Python embedder offline, producing a finite normalized 384-dimensional vector.
This is low-level contents/inference evidence, not full KI17 serving acceptance.

The first real run used harness `bafe11aa`, passed three tests and failed before
runtime inspection with the wrapped `COMPACT_FIXTURE_DOCKER_FAILED`. A follow-up
owned diagnostic reproduced a SyntaxError from the generated JavaScript's newline
escape. Its FAIL and
successful cleanup remain recorded. The correction uses a shared `String.raw`
renderer and a real Node syntax check for all three roles. Independent review
found no remaining blocker; the fresh rerun above then passed. Runtime guards,
model pins, timeouts and profile lifecycle were unchanged.

## Remaining gates and retained evidence

No application cohort was started by this lane. Selected application bootstrap,
current Business/serving authority, actual web/native recreation with durable
drain/replay/no duplicate send, and full KI17 acceptance against the shipped
images remain open. Native Stage9+ restore after store loss is still unproven;
retained-store restart or non-serving object/DB remap cannot close it. Live LINE
UAT remains NOT_RUN and LINE is NOT_SELECTED in this package, while its overall
qualification remains NOT_QUALIFIED. Supported Linux-host, off-host DR, hosted
CI on this branch, publication, release and production activation are separate.

All owned probe/database resources were cleaned. The existing runtime container
ID/name/state inventory matched before and after. Packages, both retained copies,
models, images, failed attempts, source exports, review patches and raw logs remain
in local `zuri-checkpoint-20261028/compact-task6-selected-package-f63378be`.
No worktree, production/main-dev/UAT operation or live provider request occurred.

Version 0.1.0 records this bounded continuation; earlier snapshots and all
canonical statements, memberships, lifecycles and Task6 acceptance groups remain unchanged.
