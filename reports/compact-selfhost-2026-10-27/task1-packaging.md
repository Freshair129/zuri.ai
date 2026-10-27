---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
implementation_base: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
---

# Compact Task1 packaging evidence

The owner approved ADR-115 and the implementation plan at the exact commit above,
selecting Task1 on `codex/compact-selfhost-plan-20261027` in the primary checkout.
This record covers build-time package code and synthetic package verification.
It grants no installation, publication or production authority. Tasks2–7 remain
unselected. No new worktree, runtime operation or migration was performed.

## Delivered boundary

The [package contract](../../apps/server/deploy/compact/README.md), strict schema,
Compose template, nonsecret selectors, pure manifest validator and build-time CLI
produce a portable directory from explicit prepared inputs. Four runtime root
files come from this packager version. All other payloads require declared SHA256
hashes, portable paths and required registry/graph document coverage. The manifest
and semantic metadata are hash-bound snapshots; output never substitutes later
reads for validated bytes. Failed preflight creates no output or exporter call.

Core needs only digest-pinned web/tools/PostgreSQL/storage images. Selected LINE,
Knowledge and public profiles require their own exact image/pin/model dependencies.
No storage image, license, release baseline or model is guessed. Qualification
inputs are strict redacted assertions; the tool does not independently establish
their truth. Reviewed canonical docs/models/images remain a release-input trust
boundary. Hash/path checks are not generic secret detection; content review must
precede upload/release. Raw license bytes and private runtime secrets stay outside.

Optional OCI transport verifies the exact selected digest set, full referenced
blob graph, sizes, SHA256 and linux/amd64 config, then streams a deterministic
regular-file archive. Unreferenced files and links are refused. Registry-only
transport retains the same identities. Success emits the manifest, transport
metadata and sorted inventory; failures retain `.partial` without a success
inventory. Existing output is never overwritten or recursively removed.

The manual-only CI job is default-off, with contents/actions read permission.
Explicit prepared artifact/run IDs must originate in this repository and head
repository at the workflow commit, from a completed successful run. The same
commit is required by the loaded manifest snapshot. The job uploads a candidate
artifact only; existing build `push: false` containment is preserved. The selected
producer/content/qualification review remains the operator's responsibility.

## Executed verification

Local toolchain: Node24.20.0 on Windows; CI declares Node22. No hosted run is
claimed. Commands below ran from `apps/server/` unless marked repository root.

| Command / observation | Actual result and scope |
|---|---|
| Initial Node manifest/package suite | RED:49 executed,0 passed,49 failed because implementation was absent |
| Additional graph, OCI stream and manual-job cases | RED:53 executed,50 passed,3 failed; fixed before continuation |
| Output ancestor-junction guard | RED:56 executed,55 passed,1 failed; fixed |
| Independent-review snapshot/secret regressions | RED:60 executed,56 passed,4 failed; single-snapshot and strict evidence fixes passed all60 |
| CI artifact-origin regression | RED:2 executed,1 passed,1 failed before origin guard; fixed |
| Candidate upload hidden-graph regression | RED:2 executed,1 passed,1 failed before explicitly including the required hidden graph in artifact upload; fixed |
| OCI root/nested descriptor platform regressions | RED:68 executed,65 passed,3 failed; fixed to match descriptors/configs to the qualified base platform |
| `npm run compact:test` after composition | PASS:68 executed,68 passed,0 failed/skipped; manifest, package and workflow tests |
| Wrapped Vitest publication containment, CI selector and Knowledge Docker runtime files | PASS:29 tests across3 files; the first containment failure is retained separately |
| Current wrapped publication containment rerun | PASS:1 executed,1 passed,0 skipped against the final CI origin guard |
| `node --check` for the eight new MJS implementation/test files | PASS:8 files; no application bundle or image build is implied |
| `node --test tests/node/document-profile-validation.test.mjs tests/node/canonical-document-registry.test.mjs` | PASS:19 executed,19 passed,0 failed/skipped |
| Repository-root `npm run docs:registry`, `npm run docs:graph`, `npm run docs:views`, `npm run govern` | PASS:553 canonical records unchanged;96 views verified; strict preflight0 critical,0 warning,43 info. Final closeout regenerates/checks again after the evidence update |
| Repository-root `npm run docs:llms` and `npm run docs:llms:check` | PASS:415KB local corpus current; ignored output is not committed |

The Node suite builds real filesystem artifacts from clearly labelled synthetic
inputs. It verifies relocation after the source becomes unavailable, byte-for-byte
determinism, package-relative mounts, exact inventory, safe error output, path/link
refusal, selected dependencies and no overwrite. An independent `tar` process
lists/extracts the synthetic OCI archive and confirms blob hashes. These images
are synthetic empty-layer fixtures; the SQL/provider/license/model inputs are
test fixtures. They are not a real Zuri release or provider qualification.

Local raw logs, including first failures, are retained outside the public repo in
the operator's existing cleanup checkpoint under `compact-task1/`. The tests and
this tracked report carry the reproducible commands and bounded claims; no secret
value, machine-private transcript or replacement delivery ledger is committed.

## Independent review

An independent GPT-6 Luna Max reviewer inspected the same patch and ran the
initial56-test package suite. Review found metadata reread races and insufficient
qualification-content restrictions. Regression tests reproduced both before fixes.
The next delta found conflicting OCI descriptor platform metadata was accepted;
three failing regressions reproduced that gap and passed after the fix. The final
read-only delta review found no remaining Task1 blocker. The reviewer independently
ran the initial56-test suite; final68-test execution is the integrator's evidence,
not an independently rerun suite. Review covered the current fixes and their
regressions without runtime or production operations.
A security scan accidentally started on an earlier snapshot was stale/failed and
is excluded from current verification claims.

## Remaining gates

No actual Docker image build/export, qualified storage provider/license, current
schema baseline, installer/fresh PostgreSQL target, bootstrap, browser/business
flow, real LINE delivery, Knowledge/native-store recovery, host measurements,
hosted CI, release publication or production operation ran. The full Server build,
full application suite and E2E were not run locally: this patch changes build-time
packaging and CI candidate wiring, not an application route/model/business flow.
Their applicable hosted and later release gates remain in force.

The tools Compose profile fails closed until Task2 supplies reviewed fresh-only
initialization. All selected capabilities remain `NOT_QUALIFIED`; unselected AI
profiles remain `NOT_SELECTED`. Task1 completion does not make Compact installable.
