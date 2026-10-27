---
doc_type: implementation-evidence
status: draft
version: "0.2.1"
recorded_at: "2026-10-27"
implementation_base: "05c62592da91cc6087b29adafab2ccf6c690514a"
---

# Compact Task7 core matrix

This is work in progress for the core-only local TEST lane. It is not release,
production, hosted-CI, Linux-host or optional-AI acceptance. Actual Task6 AI gates
remain open/unselected. The [Task5 correction](task5-policy-scope-correction.md)
closes its two review findings separately; older images do not inherit that fix.

## Artifact and recreation evidence so far

The immutable app source archive at `69ebf68` has SHA-256
`040f2819fbb6f35eaf4a0f4dc7a629d008d4caef27c739dac8aa123d8d561f76`.
TEST web/tools images built from it carry that exact revision label. The working
host harness inspects the hashed package, actual image IDs/platforms and source
labels before mutation. Inspection returns `ARTIFACT_INSPECTED_NOT_QUALIFIED`;
it cannot qualify installation or silently consume a selected optional profile.

The initial 8-case Node failure preceded the inspector; the current inspector
cases pass **11/11**, including corrupted artifact, foreign/partial target,
old/missing source label, mismatched image/platform and secret-bearing raw error.
The actual core E2E initially failed on missing `candidate.status`. After wiring
the inspector and actual web recreation, it passed **1/1 without retry** against
the `69ebf68` app images and working host patch. Those images predate `05c62592`;
this is retained historical candidate evidence, not final corrected-artifact
qualification. A final source/image/host-tool matrix is still required.

## Recovery design before implementation

Independent GPT-6 Luna Max review identified a blocking flaw in an initial
whole-public-data dump proposal: SEC-030, FR-223 and ADR-089 prohibit exporting
IntegrationSecretEnvelope ciphertext or its KEK. No such dump was created. The
revised owned synthetic TEST harness must exclude that material and invoke the
existing credential-lifecycle re-entry transition on restored metadata. It may
test restart and missing/wrong-key refusal on the original throwaway credential;
it must not copy the source envelope or key into the destination.

The reviewer otherwise accepted a bounded harness design: two new owned targets
use the same verified artifact/baseline, with target-specific marker, roles,
passwords and physical DB identity retained. A consistent synthetic DB transfer
must preserve protected report/evidence rows; it is not legacy JSON import or
backup-service acceptance. Temporary trigger changes, if needed, are confined to
one atomic transaction in the verified empty TEST destination and must return to
the original catalog/privileges. Existing data and source runtime remain outside
the operation. Unknown nonempty security families must fail closed.

Actual object backup must contain verified exact bytes and hashes, not refs
alone. A direct fixture remap is limited to a synthetic FileAsset row: preserve
ID/Tenant/Business, increment version, record a clearly TEST-only audit fact and
exercise authorized and unauthorized reads through existing File Management.
There is no current managed-blob operator restore/rebind operation. Such a probe
can prove byte/ref/authorization behavior but must leave operator-supported
recovery **NOT_QUALIFIED** pending the owning contract. It adds no public API,
permission, production restore path or canonical lifecycle adoption.

Two volumes/containers or a private backup file on this host do not establish an
off-host backup failure domain. Physical recovery, provider/license, supported
operator restore, final hardware measurements, hosted exact-head CI and release
gates remain explicit. Actual recovery tests and final review are pending.

## Composed candidate and review follow-up

The corrected application source archive is `05c62592da91cc6087b29adafab2ccf6c690514a`,
SHA256 `11380e4859c36fbe9cb2fa137e5600748813dd28ae44eca7090ae0efe72dcb84`.
Its immutable web/tools images were built from that archive. The working host
harness is a separately reviewed patch; these are not final Task7 commit images.

The retained registry-transport package manifest is
`27c16bc845aea2a567cca7928209ca59658bbf0451b4787c794e8c2d12fce16a`.
An exact supplied-package core run passed 1/1 without retry (about 1.3 minutes),
with cleanup PASS. A separate supplied-package native recovery run passed 1/1
(93.69 seconds), eight completed recovery checks and cleanup PASS. These are
actual same-package reruns, distinct from a fresh package built by a harness.

First failures remain private evidence: a producer flow completed but failed its
new missing-envelope assertion; its retained artifact was not itself a whole-E2E
PASS. The first supplied core run failed the volume-measurement Docker command
and cleaned up successfully. The revised read-only measurement runs as the
observed numeric volume owner with no added capabilities; the later run passed.
No raw DB password, key, SQL dump or browser trace enters public evidence.

A selected-image Docker export was preserved, then a new OCI layout selected the
base linux/amd64 manifests and their 45 reachable blobs. Parent indexes and their
attestations remain in the original private export; no original tag was changed.
The existing strict OCI verifier and deterministic writer accepted this graph.
New TEST namespace aliases were imported without registry publication. Manifest
and config digests are different identities; no config digest is claimed to be
Docker's observed image ID.

The selected storage child manifest was actually tested with `server /data`:
non-null immutable version, conditional conflict, pinned read after replacement,
and exact erase preserving the replacement all passed in one composed provider
case. Cleanup completed before producing PASS. This is TEST provider capability
and a bounded TEST license review, not distribution or production legal approval.

The OCI package manifest is
`3b7894fd61445074fe2bfad8fa185eaa02e87e5e28cfd4b806be50e8b21beb75`.
It contains the four selected images, 1,602 payload files, hash inventory and the
verified baseline. The CI-input reader verified exact source/core/OCI and all
payload/archive hashes before loading this package's actual archive. The serial core run passed 1/1 without retry (about 1.5 minutes), and recovery
passed 2/2 (105.54 seconds), including the missing-artifact refusal and eight
recovery postconditions. Both reported cleanup PASS.

Independent review found and corrected three evidence/cleanup issues: acceptance
must require a supplied immutable artifact rather than stamping dirty-tree bytes
with HEAD; recovery must compare inventory/CLI/baseline as well as manifest hashes;
and one refused cleanup resource must not skip other independently owned cleanup.
The first refusal remains an error and is covered by a regression test. Independent GPT-6 Luna Max review of the composed code patch now has no
remaining actionable code findings. This is code review; reported test results
remain integrator evidence, and no release or operational sign-off is inferred.

The final composed Node suite passes 179/179 with no skips. The manual dependent core
CI job is implemented and guarded by the same-run exact-source package producer.
It checks the OCI artifact before import and uploads only sanitized observation
JSON; hosted execution is NOT_RUN. Fresh PostgreSQL and final core/recovery,
build/governance/reader checks remain pending for this working patch.


## First concurrent-run failure and serial verification

An integrator orchestration error overlapped the fresh PostgreSQL suite with the
core OCI harness on the same daemon. The first core attempt failed at Docker
network creation; retry completed the flow, so the wrapped runner correctly
returned FAIL with one flaky test. The overlapping fresh suite had 10 passes and
one network-create failure. Both original logs and the core failure observation
remain retained. The original raw daemon diagnostic was intentionally not emitted;
subnet allocation collision is a likely explanation, not a proven original errno.
No application failure is hidden or relabelled as PASS.

The independently repeated serial fresh suite passed 11/11 (266.44 seconds).
Document reader/migration tests passed 146/146 with zero skips. Server build,
lint and types passed. Governance passed with 0 critical, 0 warning and 43 info;
553 canonical records and 96 views remain unchanged. The serial core/recovery runs above are now complete. A final composed
governance freshness run and immutable post-commit source/image rerun remain
pending. There is no final-head release claim.


For the serial OCI observation, inventory SHA256 is
`e247154bf9417e3fed0c96e206c08e379528032fff8bcd3adf4c40abcd310ae7`;
CLI SHA256 `3768d1c713896a019b6986f3304df1d93aa649413d9db2d5f339c3c14c14f7c4`;
baseline SHA256 `db15bb2c9632d07586fb07aaa0d173e00c62ddbb48b7ac1acfd84237b57c6d35`.
The package is 925,963,900 bytes. Post-flow samples: PostgreSQL 56.22MiB /
0.03% CPU, web 287.4MiB / 33.56%, storage 71.58MiB / 0.04%; database volume
79,458,304 allocated bytes, objects 40,960. Host has 12 logical CPUs / about
34.32GB RAM; engine exposes 12 CPUs / about 16.75GB RAM. These single samples
are not peaks, capacity/load acceptance or minimum hardware. Original observations
are retained privately and no unsupported hardware recommendation is inferred.


## Reviewed code milestone checks

The post-review provider probe passed 1/1 and the default business-storage
regression passed 7/7 (15.33 seconds), using its own disposable SQLite DB and
owned TEST provider. These runs cover the parameterized fixture's default and
explicit-image paths after cleanup/evidence corrections. The same shared
PostgreSQL fixture passed the serial 11-case fresh suite above. No foreign
resource, persistent credential, main-dev/UAT/production target or backup was
deleted. Private SQL/object backups and all first-failure logs remain retained.

The reviewed code milestone will be followed by a source-archive image build and
exact-package rerun at its actual commit. The historical 05c candidate includes
separately hash-bound host tools from the working patch; it is not described as
a final-head release. Hosted exact-head CI, final release content/provider/legal
review, supported operator managed-blob recovery, physical off-host recovery,
load/minimum-hardware acceptance and optional AI gates remain open. No PR, merge,
publication, deployment or production activation is authorized by this evidence.

The final code-milestone governance chain and corpus freshness check passed:
0 critical / 0 warning / 43 info, 553 records and 96 generated views. Only the
tracked runtime/feature verification projections are included; ignored graph,
reports/corpus, private targets, backups and session notes are not staged.


## Post-commit CI context correction

Code milestone `f6654411392407d98e510f54577d92457027fd34` passed Node179 and its
web/tools images built successfully from immutable archive SHA256
`bf6c5c50a7c66a23e3c976f6daf51e3ded3b28020dd968e660776e70b5e54fcf`.
Those build artifacts are retained; no final qualification is attributed to them.

A subsequent primary-source check of the [Docker action inputs](https://github.com/docker/setup-docker-action#inputs)
showed that the setup action creates its own named context. The first workflow
used that active context for image loading while the Linux fixtures selected
`default`, so the two could observe different daemons. The bounded correction
binds action setup, image load and both fixtures to `compact-core-ci`. Local
Windows/Linux defaults remain unchanged unless `COMPACT_TEST_DOCKER_CONTEXT` is
explicitly selected. Context names must be valid; endpoints must be a local
Docker Desktop Linux pipe or Unix socket before any engine inventory query.
The original current-state/identity/TEST ownership checks remain in force.

Missing context binding first failed two regression cases; local endpoint
validation then failed its own new case before implementation. The composed
Node suite now passes 181/181 with zero skips. Review caught and corrected the
pre-inventory remote-endpoint gap. Hosted CI remains NOT_RUN; configuration
inspection cannot establish a successful hosted run. The corrected source commit
must supply the final archive/images/package and serial acceptance below.

Independent GPT-6 Luna Max review of the bounded context correction is clean.
The explicit `desktop-linux` provider rerun passed 1/1 (9.56 seconds), and
correction governance passed with 0 critical / 0 warning / 43 info. No application
source/build input changed in this correction: the changed Server files are
under `tests/`, excluded by the existing Docker context policy. New source labels
and the final package still require their own immutable-commit rerun.
