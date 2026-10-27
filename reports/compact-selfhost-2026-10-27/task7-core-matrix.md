---
doc_type: implementation-evidence
status: reviewed
version: "0.3.0"
recorded_at: "2026-10-27"
implementation_base: "05c62592da91cc6087b29adafab2ccf6c690514a"
qualification_revision: "4061f5112cf9f336d1a089785738f4975d305a08"
---

# Compact Task7 core matrix

The core-only local TEST milestone passed on an immutable OCI package built
from clean source `4061f5112cf9f336d1a089785738f4975d305a08`. Core browser
acceptance passed 1/1 on its first attempt; bounded recovery passed 2/2 with
eight completed postconditions. Both observations report cleanup PASS. This is
not release, production, hosted CI, Linux-host support, operator-supported
restore or optional-AI acceptance. Task6 AI profiles remain unselected/unqualified.

## Exact source and artifact

Source archive SHA256:
`cae18974a4b59ca8ca23a8f246b57f3f275a8d8d66fdfb62d87d4684a540459f`.
Web/tools were built from that extracted Git archive, not the working tree or
sibling sources. Their actual image configs carry the exact qualification
revision. The committed test checkout stayed clean through packaging and tests.

| Identity | SHA256 / value |
|---|---|
| Manifest | `de0aa18d3dbe460b99d031307c3e9701f7173d34f7372f33d2476199bda776b4` |
| Inventory (`SHA256SUMS` bytes) | `cca160a9deedd67e190e23d13c6dc4994a24c19c0f618b303a234d277cd2eb11` |
| Bundled host CLI | `3768d1c713896a019b6986f3304df1d93aa649413d9db2d5f339c3c14c14f7c4` |
| Baseline SQL | `20d359177719a67cb378c40a400ecba4b4589d5aa0c3eb2196f413e23dcc31de` |
| OCI archive | `c2f2436c9f655526418940b9dd1bf3f21e7ec59a86ad6f9a563ba83b368e76f1` |
| Payload / complete package | 1,602 payload files / 925,780,009 bytes |

The selected base linux/amd64 image manifests are web `0e5c990255f2…`, tools
`7eb02491399c…`, PostgreSQL `1a66d744c1b4…`, storage `c256d3e46c78…`.
Full pinned references and actual IDs are in the [core observation](task7-core-observation.json)
and [recovery observation](task7-recovery-observation.json). Parent indexes,
attestations, original exports and previous candidates remain private evidence.
The strict existing OCI verifier checked all 45 reachable blobs. Config, child
manifest and parent-index digests are distinct identities; none is substituted
for another. New TEST namespace aliases were imported without modifying original
tags or publishing a registry artifact.

The CI-input reader verified source/core/OCI and every payload/archive hash
before importing this package's actual archive. Source and destination recovery
targets consumed the same supplied package, comparing manifest, inventory, CLI
and baseline hashes. Acceptance entrypoints require an explicit existing package;
they cannot silently generate a purported HEAD artifact from dirty source.
`ARTIFACT_INSPECTED_NOT_QUALIFIED` and `ARTIFACT_VERIFIED_NOT_QUALIFIED` remain
inspection results, not operational authority or overall qualification.

## Actual checks

| Check | Result | Scope / bound |
|---|---|---|
| `npm run compact:test` at qualification revision | PASS 181/181; no skips | Manifest/path/hash/OCI, target, baseline, CLI/bootstrap, profile, qualification and workflow contracts |
| Immutable web/tools builds | PASS | Existing Dockerfile targets; unchanged application build inputs reuse the tested build cache; exact source labels inspected |
| `npm run test:compact:core` | PASS 1/1, first attempt; about 1.5 minutes | Exact supplied OCI artifact, explicit `desktop-linux`, real pinned HTTPS/browser and owned PostgreSQL/storage |
| `npm run test:compact:recovery` | PASS 2/2; 109.43 seconds | Missing-artifact refusal plus eight synthetic recovery postconditions on that same artifact |
| Selected provider probe after context correction | PASS 1/1; 9.56 seconds | Actual selected storage image with `server /data`; versioning, conflict, pinned read, exact erase preserving replacement |
| Default business-storage regression | PASS 7/7; 15.33 seconds | Pre-context-correction run, own disposable SQLite DB/provider; no current-head claim for this older run |
| Serial fresh PostgreSQL suite | PASS 11/11; 266.44 seconds | Earlier composed host patch; alias, 210-model catalog/RLS/ACL, rollback, populated/foreign/drift refusals and relocated bare-Node CLI |
| Server build/lint/types | PASS | Same application inputs before test-only context correction; no app source changed afterward |
| Document readers/migration | PASS 146/146; no skips | Current reader implementation; no canonical row, identity or membership edit |
| Governance / views / corpus | PASS at code milestones | 0 critical / 0 warning / 43 info; 553 records, 96 views; final closeout freshness also passed |
| Independent GPT-6 Luna Max review | No actionable code findings | Full Task7 code plus bounded CI-context correction; reviewer did not run tests or Docker |
| Hosted exact-head CI / Linux-host acceptance | NOT_RUN | Workflow configuration and Windows Docker Desktop evidence do not establish these |

Core acceptance drove real private operator login, unprivileged signup,
Business/PM CRUD, all seven execution-view renderings, cross-Business denial,
restart, actual web recreation and safe installed retry with `initialized:false`.
It observed 210 model tables and persistent project/workstream data. This is a
bounded core matrix, not acceptance of every canonical product behavior.

## Recovery and secret boundaries

Two distinct owned TEST targets retained their own physical DB identity,
installation marker, roles/passwords and catalog. Their catalog hashes need not
be equal to one another: each must retain its own verified post-install catalog.
A consistent synthetic transfer compared 196 portable-table hashes before the
existing credential re-entry transition and fixture-only ref remap. Unknown
nonempty security families refused transfer. Protected Marketing report rows
survived and remained append-only. This is not legacy JSON import or a public
backup-service restore implementation.

SEC-030/FR-223/ADR-089 prohibit exporting envelope ciphertext or the KEK. The
source-only probe tested secret restart and missing/wrong KEK refusal. The
transfer excluded one source envelope row; the destination had zero envelope
rows and credential metadata became `REENTRY_REQUIRED`. Keys/ciphertext were
never copied into the SQL backup or destination. Private backups remain retained.

Asset/catalog backup contained actual exact bytes and hashes. Source fixtures
were removed before destination restoration. Metadata-only refs failed; the
TEST-only FileAsset remap preserved ID/Tenant/Business, incremented version and
recorded a TEST audit fact. Current authorized reads matched the bytes, while
unauthorized reads refused before provider I/O. This synthetic administrative
mapping does not establish a supported operator restore/rebind contract.
`operatorRecovery` remains `NOT_QUALIFIED`. Two containers/volumes or backup files
on this host do not establish an off-host/physical backup failure domain.

## Runtime sample, not minimum hardware

At the post-flow sample, the host exposed 12 logical CPUs / 34,317,889,536 bytes
RAM; Docker exposed 12 CPUs / 16,750,776,320 bytes. PostgreSQL used 61.43MiB /
0.02% CPU, web 287.3MiB / 30.05%, storage 70.36MiB / 0.04%. Database allocated
79,458,304 bytes; object volume 40,960 bytes. Package bytes include the OCI archive;
logical image sizes can share layers and are not unique disk allocation.

Measurement used read-only volume mounts, no network, no added capabilities and
the observed numeric volume owner. These single post-flow samples are not peaks,
load/capacity acceptance, recommendations or supported minimum hardware.

## First failures and review corrections retained

- The initial inspector and new assertion cases failed before implementation.
  Supplied-package loading/retention, cleanup refusal, setup cleanup and context
  binding/endpoint tests preserve their RED logs before the green suite.
- Historical `69ebf68` images predate the [Task5 correction](task5-policy-scope-correction.md).
  Historical `05c62592` app images were tested with separately bound host WIP;
  neither is promoted to the final qualification revision. `f6654411` was a clean
  reviewed code/build milestone; its images remain build evidence, not the final
  qualification package.
- An early producer flow failed its missing runtime-envelope assertion after
  retaining a package; no whole-E2E PASS was claimed. An early supplied run failed
  volume measurement and cleaned up. Read-only numeric-owner measurement fixed
  the permission boundary without adding capabilities.
- The integrator overlapped two Docker harnesses once. Core failed at network
  creation then passed on retry, so the wrapper correctly returned FAIL/flaky.
  The overlapping fresh suite had 10 passes/1 network-create failure. Original
  logs remain retained; raw daemon errno was not emitted. Subnet collision is
  likely, not a proven original diagnostic. Subsequent harnesses ran serially;
  the final exact-artifact run passed without retry. No flaky run is counted PASS.
- Independent review corrected dirty-source attribution, exact inventory/CLI/
  baseline comparisons, per-resource cleanup continuation, failed-setup temp
  cleanup and cleanup-failure propagation. Refused/unverified resources remain
  untouched; the first error remains a failure and other owned cleanup is attempted.
- The [Docker setup action](https://github.com/docker/setup-docker-action#inputs)
  creates a named context. A follow-up correction binds setup, image load and both
  fixtures to `compact-core-ci`, with local endpoint validation before engine
  inventory. Local defaults are preserved; no remote daemon is admitted. Hosted
  execution is still unrun despite the reviewed configuration.

## Remaining gates and handoff

Core-only local TEST is stable. Task7 release controls and full operational
recovery remain open: hosted exact-head CI, Linux-host support if selected,
provider/license/distribution content review, PM-owned operator managed-blob
restore/rebind contract, physical off-host recovery and load/minimum-hardware
qualification. A service cutover is not inferred as a prerequisite for PM-owned
FileAsset recovery. Selected LINE/Knowledge/KI17/native Stage9+/live LINE gates
remain separate; no AI profile is selected or qualified by this matrix.

No new domain implementation, persistent credential/security expansion,
production/main-dev/UAT operation, PR, push, merge, publication or activation
follows from this evidence. The primary checkout stays on the existing branch;
main, checkpoints, bundles, backups, original images and Visual Office are
preserved. Closing documentation is separate from the immutable code/artifact
revision above; it does not claim an image or hosted pass for a later docs commit.


Final documentation closeout: `docs:registry`, `docs:graph`, `docs:views`, `govern`,
`docs:llms` and `docs:llms:check` passed after the plan/observation update. Governance
reported 0 critical / 0 warning / 43 info with 553 records and 96 views. Independent
review found the plan/matrix/hash claims consistent and public JSONs sanitized;
its final missing-freshness note is resolved by these actual results. The
integrator additionally compared the public observation bytes to the private
originals. Domain-gap preparation was read-only and retained outside the repo;
no domain implementation was started.
