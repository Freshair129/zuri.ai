---
id: ZAI:COMPACT-SELF-HOST-PLAN-20261027
title: Compact self-host implementation plan
doc_type: implementation-plan
status: approved
approved_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
selected_task: 6
version: "0.1.14"
source_revision: "2b424364c709f5c5522bd29c3713becc2eab5854"
relations:
  - type: references
    target: ZAI:ADR-115
  - type: references
    target: ZAI:FR-030
  - type: references
    target: ZAI:FR-142
---

# Compact Self-host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> or superpowers:subagent-driven-development. The owner approved this plan at
> e5fcfd4b on 2026-10-27, completed Task1, then selected Task2 with disposable
> PostgreSQL and independent review. The subsequent delegated owner instruction
> selects safe Compact continuation before domain follow-up, beginning with Task3.
> Steps use checkbox syntax. Disposable TEST credentials/fixtures only; no
> production, persistent credential/security expansion, live LINE, publication or
> new worktree is authorized by routine continuation.

**Goal:** Deliver a repeatable single-host package while qualifying AI separately
and preserving existing product authority and capabilities.

**Architecture:** Existing Server/PostgreSQL/private storage under Compose, with
explicit LINE and pinned Knowledge profiles. Build from source centrally; install
from immutable artifacts without a checkout, sibling source or automatic migration.

**Tech Stack:** Existing Node/JavaScript, Compose, Prisma/PostgreSQL, private
S3/Supabase ports, Vitest, Node test runner and Playwright. Images are
`linux/amd64`; the proposed first host is Windows Docker Desktop with Linux
containers. Linux-host support needs its own qualification. Primary DB/object
storage stay on the same host; off-host backup does not expand runtime scope.

**Spec:** [Accepted ADR-115](../decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md).
The [dated assessment](../../reports/compact-selfhost-2026-10-27/README.md)
binds source findings and old-audit dispositions to the baseline above.

## Global Constraints

- One host; AI parts separately qualified, as selected by the owner. No reduced
  canonical feature registry or inferred requirement retirement.
- Initial implementation is fresh-install only; nonempty/foreign targets fail
  closed. Existing-data imports/upgrades/production apply are separate operations.
- Runtime startup does not build, pull mutable tags, resolve sibling checkouts,
  run `db push`, download unpinned models or create privileged product identities.
- Preserve ADR-114's distinct self-hosted PostgreSQL/cloud Supabase targets. No
  sync, replication, failover or dual writes are implied.
- Private credentials/key custody stay outside image/artifact/log output. Existing
  FR-107 bootstrap and FR-120 unprivileged signup remain authoritative.
- Use branches in the primary checkout. Disposable test targets require explicit
  owned project/database/volume identities; never use main-dev or production data.
- No GPU/inference-pool prerequisite, Edge revival, new service split, DDC task
  record or replacement developer admission controller.
- Package, core, selected business flows, LINE, Knowledge and production are
  distinct evidence claims. Keep failures, skips and unexecuted gates explicit.

## Review Focus

1. An existing/foreign database or volume must survive install/retry untouched
   (Task2 negative fixtures and exact before/after identity checks).
2. A secret, absent component or mutable image must never become a plausible
   success report (Tasks1–3 hostile-manifest/redaction tests).
3. An S3 ref from another bucket/Business or a lost version must fail closed
   without cloud fallback (Task4 authority/version/routing tests).
4. Policy disable or credential revoke racing PostgreSQL replay must serialize
   with acceptance and audit commit (Task5 two-session tests).
5. Web recreation, offline model bootstrap or partial restore must not claim
   LINE/Knowledge readiness (Tasks6–7 interruption and recovery tests).

## File and interface map

Paths marked **new** below are implementation outputs relative to the planning baseline.
Deployment stays in `apps/server/deploy/compact/`; orchestration helpers in
`apps/server/scripts/lib/compact/` separate manifest, target and execution concerns.
Tasks1–5 execute the approved safe continuation. Tasks6–7 remain pending execution
under their specific capability gates.
Application paths in task file lists are relative to `apps/server/`; workflow
paths are relative to the repository root.

| Unit | Responsibility / interface |
|---|---|
| New `deploy/compact/release-manifest.schema.json`, `compose.yml`, `README.md`, `env.example` | Strict artifact metadata, portable runtime topology and nonsecret operator inputs |
| New `scripts/lib/compact/manifest.mjs` | `validateCompactManifest(value)` returns validated manifest or safe error; no subprocess/I/O |
| New `scripts/compact-package.mjs` | `packageCompactRelease({manifest,outputDirectory,imageExporter})` emits the validated package; build-time CLI only, separate from runtime installation |
| New `scripts/lib/compact/target.mjs` | `planCompactInstall({manifest,target,observed})` returns a redacted immutable plan; pure, no mutation |
| New `scripts/lib/compact/executor.mjs`, `scripts/compact-self-host.mjs` | Explicit `inspect`, `plan`, `install`, `status`, `stop` commands over argument-array subprocesses; no arbitrary shell/eval |
| New `scripts/compact-baseline.mjs`, `scripts/lib/compact/baseline.mjs`, `security.mjs`, `database.mjs`, `docker.mjs` | Exact-source schema-diff producer, reviewed fresh security snapshot, atomic SQL/marker/catalog observation and explicit local Docker transport; packaged bare-Node CLI |
| Existing `src/platform/storage/supabase-object-storage.js`; new `private-business-object-storage.js` | Preserve public factory exports/default Supabase behavior; explicit S3 Asset/catalog adapter and strict managed-reference dispatch |
| Existing Marketing report database/receiver/operator; new `marketing-report-lock.js` | Qualified PostgreSQL client selection and shared policy/binding lock order |
| New `scripts/lib/compact/qualify.mjs` and isolated acceptance harness | Owned target lifecycle and separate profile evidence; no production admission |

Manifest v1 fields: `schemaVersion`, `releaseId`, `sourceRevision`,
`platform: "linux/amd64"`, `images` (component→digest), `files` (path→SHA256),
`schemaBaseline` (file/hash), `profiles` (`core`, `line`, `knowledge`, `public`),
`storageQualification` (provider/digest/command/capability evidence),
`componentPins`, `modelArtifacts` (revision/files/hashes), and `capabilities`.
Reject unknown fields, duplicate paths, traversal, floating tags and absent
selected dependencies. Paths are package-relative; runtime secrets are references
to explicitly supplied private files and never manifest values.

## Task1: Produce and validate a portable immutable package

**Files:** New manifest/Compose/README/env example, `manifest.mjs` and
`scripts/compact-package.mjs`; new `tests/node/compact-manifest.test.mjs` and
`tests/node/compact-package.test.mjs`; modify `.github/workflows/docker-image.yml`
only after defining an opt-in package job, plus Server package scripts.

**Consumes:** ADR-115D1–D4; existing Dockerfile targets and KI17 pin manifests.
**Produces:** Validated manifest v1; `compact:package` invokes
`packageCompactRelease({manifest,outputDirectory,imageExporter})` to emit an
artifact directory and optional OCI archive with identical image identities.

- [x] Write tests: a core manifest requires web/tools/PostgreSQL and a qualified
  private-storage selection; no AI images are mandatory. LINE/Knowledge selection
  requires their exact components. Floating tag, changed hash, `../`, unknown
  profile or unqualified storage selection is rejected without subprocess calls.
- [x] Run `node --test tests/node/compact-manifest.test.mjs tests/node/compact-package.test.mjs` from Server; observe
  failures for missing validation, not a zero-test pass.
- [x] Implement `validateCompactManifest(value)` and a package builder using the
  existing image targets. Package canonical docs/registry/generated graph inputs
  inside the release; installed Compose uses packaged content, not host source.
  Keep provider image/command qualification explicit; do not substitute AIStor,
  MinIO and RustFS by name. Reuse the existing MinIO fixture for TEST evidence only.
- [x] Verify tests pass, inspect package inventory for secrets/absolute paths,
  and prove a package can be unpacked at a different path without source access.
  Publishing to a registry is opt-in; an OCI archive is a supported transport.
- [x] Commit the bounded package change with its source/pin/hash evidence.

Task1's [delivery evidence](../../reports/compact-selfhost-2026-10-27/task1-packaging.md)
distinguishes synthetic package/OCI tests from actual release and runtime gates.
`manifest` is a prepared manifest file path. Optional `expectedRevision` binds
validation and packaging to one loaded snapshot. Image production uses the existing
Dockerfile targets separately; the packager's trusted `imageExporter` returns a
local OCI layout and has no default Docker/network or installation operation.
Storage/license inputs are redacted assertions bound to exact hashes/identities,
not qualification performed by the packager. No real provider was selected here.

## Task2: Fresh-only target planning and schema initialization

**Files:** New `target.mjs`, `executor.mjs`, `database.mjs`, `docker.mjs`,
`baseline.mjs`, `security.mjs`, `compact-baseline.mjs`, `compact-self-host.mjs`,
Node target/baseline/executor tests, disposable helper and
`tests/postgres/compact-fresh-install.test.js`; modify compact Compose/tools and
packaged CLI wiring. Add `.github/workflows/compact-postgres.yml` and explicit
PostgreSQL selection without expanding the existing embedded-only default.

**Consumes:** Task1 manifest; an explicit target descriptor with environment,
Compose project, local endpoint, explicit private network subnet, volume names and private secret-file locations,
with separate bootstrap/runtime database credential references.
**Produces:** `planCompactInstall({manifest,target,observed})`; CLI `plan` is
read-only. `install` rechecks that exact target before executing the fresh baseline.

- [x] Write negative tests for populated DB, existing foreign volume, changed
  observation, remote/unrecognized target, missing digest/file and paths with
  spaces/metacharacters. Assert no DDL, volume removal or shell interpolation.
- [x] Run new Node tests; observe the expected failures before implementation.
- [x] Implement pure target validation and argument-array execution. Local fresh
  initialization uses a reviewed schema baseline artifact generated from the exact
  release PostgreSQL schema, applied transactionally to an empty application DB.
  Never replay Supabase history, fabricate its ledger or reset existing data.
- [x] Against an owned disposable PostgreSQL target, verify current schema/catalog
  parity, rollback on an injected DDL error and a nonempty-target retry refusal.
  Prove web/workers use a non-owner, non-superuser, non-bypass runtime role and
  that the exact fresh-target grants/policies satisfy the existing contracts.
  `status`/retry reads the installed state without reinitializing it. Package
  startup must not invoke the legacy tools image's default `db push` command.
- [x] Run `npm run test:postgres -- tests/postgres/compact-fresh-install.test.js`
  after wiring it into the explicit disposable-target configuration; record real
  executed test count, target identity and before/after catalog results.

Task2's [delivery evidence](../../reports/compact-selfhost-2026-10-27/task2-fresh-install.md)
records the executed checks and target/catalog observations. This increment
accepts explicit TEST targets only. It does not launch web/storage/AI or perform
product bootstrap. Baseline generation uses current schema-diff DDL and the
reviewed current security snapshot, with build-time source hashes requiring
reconciliation on drift. No historical migration file or Supabase ledger is
applied. `INSTALLED` means database baseline state; core qualification is Task3.
The bounded delivery commit follows independent review and composed validation.

## Task3: Private bootstrap, installation diagnostics and core qualification

**Files:** New `scripts/lib/compact/bootstrap.mjs`,
`tests/node/compact-bootstrap.test.mjs`, `tests/e2e/compact-core.spec.js`;
modify CLI/Compose and package runbook. Reuse `scripts/bootstrap-operator.mjs`
and identity services; do not add a second bootstrap authority.

**Consumes:** Installed Task2 target and existing FR-107/120 authority contracts.
**Produces:** `bootstrapCompactOperator({target,privateOutput})` and
`inspectCompactCapabilities({manifest,observed})` returning nonsecret states.

- [x] Write tests asserting the initial password is handed to an explicit private
  destination and never generic stdout/stderr/report logs; signup still has no
  membership/operator grant; missing KEK/storage configuration stays unavailable.
- [x] Observe RED, then implement private wrapping of the existing bootstrap,
  envelope-store selection and sanitized capability diagnostics. Do not alter
  provider grants, Business provisioning rules or browser credential ownership.
- [x] On the isolated package, verify health, operator/login, unprivileged signup,
  authorized Business/PM create-read-update, cross-Business refusal, all seven
  execution-view smoke paths and persistence across app restart. Use existing
  viewer factories and current weighted-progress/import contracts.
  Browser authentication uses an operator-provided valid HTTPS origin or an
  isolated trusted HTTPS fixture; HTTP health alone does not qualify login.
- [x] Run Node tests plus the scoped Playwright fixture after declaring its
  owned project/port/database; no existing `:3100` dev fixture. Fail on flaky
  retry and zero executed tests. Report core installable separately from each
  unqualified capability. Commit follows composed validation and review.

Task3's [delivery evidence](../../reports/compact-selfhost-2026-10-27/task3-core-qualification.md)
separates actual TEST core-flow and provider-engine checks from remaining
Asset/catalog, LINE/Knowledge and exact-release qualification. The existing
platform viewer carries no Tenant/Business ownership; the browser success path
uses a distinct ordinary account's real self-provisioning OWNER membership.
No authority guard was widened. The bare-Node host bootstrap writes only to a
new explicit private output; safe diagnostics do not import a passing test as
runtime readiness. The bounded milestone commit follows composed validation
and independent review.

## Task4: Private Asset/catalog storage parity

**Files:** Modify `src/platform/storage/supabase-object-storage.js`, add
`src/platform/storage/private-business-object-storage.js`; modify managed-ref
dispatch consumed by `file-asset-service.js` and `pricing-catalog-service.js`
only where necessary; add `tests/unit/private-business-object-storage.test.js`
and `tests/storage/compact-business-objects.test.js` with an owned provider fixture.

**Consumes:** Existing Asset `put/get/remove` port and S3 exact-version primitives.
**Produces:** Explicit `ZURI_ASSET_STORAGE_PROVIDER` and
`ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER` selection (`supabase` compatibility
default; `s3` explicitly configured); stable existing factory exports.

- [x] Write contract tests for S3 no-overwrite writes, opaque version-pinned refs,
  distinct Asset/catalog/Knowledge namespaces, current authorization before bytes,
  wrong bucket/version refusal, failed-DB-write cleanup and safe errors. Existing
  Supabase tests must retain their exact behavior.
- [x] Observe RED, then implement the S3 `put/get/remove` bridge using
  `putImmutable/readExact/eraseExactVersions`; explicit configured endpoint/bucket
  and least-privilege credentials only. Unknown refs/configuration fail closed;
  never resolve via cloud fallback or choose another purpose's bucket.
- [x] Qualify actual upload/read/extraction-read/structured-catalog/authorized
  FileAsset read and exact deletion against the selected TEST provider. Test
  object loss after DB metadata restore. A reference-only snapshot is not backup.
- [x] Run wrapped Vitest unit/consumer tests, the explicit isolated storage
  configuration, Server build and governance. Record exact provider image and
  license/capability limits; no production-provider approval is inferred. Commit
  follows the final governance/review reconciliation. The
  [Task4 evidence](../../reports/compact-selfhost-2026-10-27/task4-business-storage.md)
  distinguishes provider parity from complete restore, hosted and release gates.

## Task5: PostgreSQL Marketing report intake parity

**Files:** Modify `marketing/infrastructure/marketing-report-database.js`,
`marketing/application/marketing-report-receiver.js`, `marketing-report-operator.js`
and `app/api/growth/external-marketing-reports/route.js`; add
`marketing/application/marketing-report-lock.js`,
`tests/postgres/marketing-report-native.test.js`; extend existing wire/native tests.
Extend the fresh-only Compact security snapshot/baseline and its catalog/ACL tests
with the reviewed custody triggers and narrower report privileges. Do not change
or replay the issued Supabase migration or mutate an existing target.

**Consumes:** Current FR-281–283 credential, policy, replay and audit contracts.
**Produces:** `resolveMarketingReportDatabase({env,postgresDb})` returns
`{db,provider:'sqlite'|'postgresql'}` or null; retain the legacy DB-only wrapper.
The route passes the trusted provider into receiver/commands. Add
`lockMarketingReportScope(tx,{provider,businessId,bindingId})`; both policy and
credential mutators use the same policy-before-binding order and re-read authority.

The 2026-10-27 independent design reconciliation binds this step to a fresh
Compact TEST exception to the older PostgreSQL-disabled mirror. Require explicit
server-only `ZURI_MARKETING_REPORT_DATABASE_PROVIDER=postgresql` plus the canonical
selected PostgreSQL client. A PostgreSQL URL alone, an unknown selection or missing
client remains unavailable; no existing Supabase deployment is enabled implicitly.
Preserve issued append-only/audit/native-scope guards, forced RLS, fixed-search-path
trusted-owner definer guards with no direct execute grants. Replace generic report
CRUD with Policy/Binding SELECT+INSERT+UPDATE and ExternalReport SELECT+INSERT;
no report update/delete, external API role grant or runtime owner/BYPASSRLS.
Absent policy creation uses a transaction advisory lock; existing scopes lock
policy before binding and re-read all grants. SQLite retains its first-write guard.
Lock Business → hinted Plan → Initiative after the common scope locks, re-read
authority/target, and retry the whole order if the Plan hint changed. Qualify both
first-report/native-rebind orderings; FK key-share alone is not a scope recheck.
The [Task5 design/evidence](../../reports/compact-selfhost-2026-10-27/task5-marketing-postgres.md)
records the source conflict and this test binding before application code.

- [x] Reproduce current PostgreSQL-unavailable behavior, then add two independent
  session tests for acceptance vs policy-disable, credential-revoke, duplicate
  replay and concurrent revision writes; audit failure must roll back acceptance.
- [x] Observe RED. Use the canonical PostgreSQL client for the selected Server
  target, keep the bounded SQLite client and safe unavailable response for unknown
  providers. A null-guard deletion alone is insufficient.
- [x] Implement provider-safe shared locking/retry/transaction bounds. Preserve
  credentials and source-scope reauthorization before replay and return a receipt
  only after outer commit. Prove both observed lock orders with runtime roles;
  SQLite's installation-wide writer lock is not PostgreSQL concurrency evidence.
- [x] Run wrapped wire/native regressions and the selected PostgreSQL file,
  then Server build/governance. Native external-provider provisioning/live delivery
  remains separate. Milestone commit follows final governance/review reconciliation;
  this supplies no live Marketing integration or migration claim.

## Task6: Qualify optional LINE and Knowledge profiles

The [Task6 preparation evidence](../../reports/compact-selfhost-2026-10-27/task6-profile-prerequisites.md)
records strict offline model prerequisites and an owned inert Docker cohort
probe. This is not AI qualification: the core shipping lane keeps LINE/Knowledge
unselected, and the actual selected-profile gates below remain open. Diagnostics
never import a report as permission or assert current authority from env shape.
The owner's 2026-10-28 Task6 selection adds [source-bound verification and gap evidence](../../reports/compact-selfhost-2026-10-27/task6-requalification-20261028.md).
It corrects probe finalization and distinguishes native/provider acceptance from
the selected release package, actual cohort drain/replay and native-store-loss
recovery gates. The Task6 acceptance groups below remain open; live LINE UAT is
explicitly excluded from this selection.
The same report records the P2 found by the later full-range Task5 review; the
selected [Task5 scope correction](../../reports/compact-selfhost-2026-10-27/task5-policy-scope-correction.md)
tracks its separate correction/re-review. Task5's original local milestone checks
do not close that follow-up.

**Files:** Extend compact manifest/Compose/CLI diagnostics; add
`tests/node/compact-profile.test.mjs` and
`tests/integration/compact-profile-recovery.test.js`; package existing KI17/model
artifacts and Server worker scripts without changing MSP/GKS ownership.

**Consumes:** Core package and existing accepted LINE/Knowledge contracts/pins.
**Produces:** Profile-specific qualification reports bound to image/model/config
hashes; no domain lifecycle adoption or inference-pool implementation.

- [ ] Write failures for absent/unpinned model, partial bootstrap, stale worker
  namespace, missing secret, disabled profile and storage/native-state loss.
  Assert no silent hosted fallback, grant, live send or fake completion.
- [ ] Observe RED, then package selected images/model bytes and add explicit
  profile readiness checks. Startup uses no sibling sources/network model fetch.
  Web recreation must recreate/rebind its dependent worker cohort and drain
  pending work under existing contracts; retries must not duplicate LINE sends.
- [ ] Execute selected existing KI17 acceptance and actual-provider object/DB
  restore on owned disposable targets. Prove current source withdrawal/serving
  authorization, exact-version remapping and the native-store recovery boundary.
  Native Stage9+ recovery remains a gate until actually demonstrated.
- [ ] LINE live UAT requires separately authorized test-account credentials and
  a verified model/context/outbound receipt; do not run it during this plan task.
  Unselected profiles stay explicitly unqualified. Commit scoped changes/evidence.

## Task7: Install/restart/recovery matrix and release handoff

The [Task7 local TEST evidence](../../reports/compact-selfhost-2026-10-27/task7-core-matrix.md)
records exact-artifact core/recreation/recovery checks at code revision
`4061f5112cf9f336d1a089785738f4975d305a08`, plus independent code review.
This closes the bounded local TEST milestone; hosted/release and supported
operator/off-host recovery gates remain open.
SEC-030/FR-223 exclude envelope ciphertext/KEK from export; restored credential
metadata must use the existing re-entry transition. Synthetic fixture remapping
cannot qualify a missing managed-blob operator recovery contract. Keep those
support/release gates explicit while executing the owned TEST matrix below.

**Files:** New `scripts/lib/compact/qualify.mjs`,
`tests/node/compact-qualification.test.mjs`, isolated install harness and compact
runbook; modify appropriate CI configuration with scoped job selection preserved.

**Consumes:** Versioned artifact plus explicit owned disposable test-target inputs.
**Produces:** Exact-artifact package/core/selected-capability evidence and recovery
instructions; no production access or permission token.

- [x] Add failing tests for corrupted/foreign artifact, storage-version loss,
  interrupted initialization, app recreation, missing KEK/model and retry against
  an existing target. Cleanup may remove only resources created by that run;
  test missing ownership labels as a refusal. Never prune Docker globally.
- [x] Implement the harness with injected targets, sanitized logs and retained
  first failures. A second volume on the same host is not a backup failure domain.
  App rollback may reuse compatible persistent data; it must not reverse a schema
  change implicitly. Existing-data upgrade remains outside fresh-only v1.
- [x] Run selected local consumer/build checks and exact-artifact isolated
  install/restart/bounded-recovery/browser tests. Report unselected/unrun profiles
  and all skipped/flaky checks explicitly. Measure the CPU/RAM/disk envelope;
  do not invent minimum hardware from image startup alone.
- [x] Obtain independent review of the composed code and CI-context correction;
  update runbook and sanitized local evidence. The final artifact is bound to the
  clean qualification revision above, not a later documentation-only commit.
- [x] Record the separately selected hosted TEST continuation at
  `5b5131a0f5bf8706baf52b9dd0ec8b786df00972`: ordinary main CI and manual
  [producer](https://github.com/Freshair129/zuri.ai/actions/runs/40818222990) /
  [package/core/recovery](https://github.com/Freshair129/zuri.ai/actions/runs/40819105575)
  passed. This is source-bound package/core and bounded synthetic recovery
  evidence; normal release approval, production and the remaining operator/
  off-host gates do not follow from it. Earlier NOT_RUN evidence remains historical.
- [ ] Qualify supported operator managed-blob restore/rebind and an actual
  off-host backup failure domain under their owning contracts before claiming
  complete operational recovery. The TEST-only remap does not close these gates.

The owner selected planning for the Asset/catalog managed-blob portion on
2026-10-29. The [source assessment](../../reports/compact-selfhost-2026-10-27/operator-restore-rebind-assessment-20261029.md)
and [candidate OR0–OR5 plan](COMPACT-MANAGED-BLOB-RECOVERY-20261029.md) propose a
supported per-file application workflow with contract adoption before code.
PostgreSQL installation restore is a separate prerequisite, not part of that
planning selection. The candidate issues no route/model/permission or canonical
record, and neither the managed-blob nor aggregate operator gate is closed.

The later owner selection adds the
[backup transfer prerequisite](../change-requests/project-manager/compact-managed-blob-recovery-or0-20261029.md#backup-transfer-prerequisite--selected-design-not-implemented)
before enabling managed-blob recovery, to preserve normal backup capability.
That proposed versioned package and backup-orchestrator mapping extend only the
managed-blob transfer portion; existing installation authority/protected-family
guards and separate whole-PostgreSQL restore qualification remain unchanged.
No application implementation or activation follows from this planning update.

On 2026-10-30 the owner selected [canonical adoption](../change-requests/project-manager/compact-managed-blob-recovery-adoption-20261030.md)
of the reviewed OR0 recovery and transfer subjects. The sanctioned writer issued
[ZAI:FR-292](../requirements/FR-292.md) and [ZAI:FR-293](../requirements/FR-293.md)
as planned standalone records, without changing any existing subject or FEAT
membership. The linked recovery plan remains candidate with implementation
authorization false; this documentation issuance closes no runtime/provider,
installation restore, backup round-trip or AI qualification gate.

## Dependency and approval handoff

### Hosted prepared-input producer continuation (2026-10-29)

The owner selected a producer PR followed by qualification on a new commit.
The package/core jobs at `c82b6bb5b0d4df6c6b2e7ef40aacdc8df3e91018`
remain **NOT_RUN**: its successful main push supplied no prepared input artifact.
Its separate local Compact contract run passed 209/209 with no skips; this is
not package/core acceptance. No canonical behavior, AI qualification, production
selection or release/publication authority changes here.

**Design and alternatives.** Extend the existing manual `docker-image` workflow
with an opt-in producer job, default false. Two dispatches at the same reviewed
new revision preserve the existing explicit successful-run/artifact-origin guard.
A new workflow would first need default-branch registration; a consumer that
builds its own input would conflate provenance and acceptance. Neither is needed.
The producer uses an exact Git archive for web/tools build contexts, source labels,
the current schema baseline generator and current canonical docs/registry/graph.
It builds linux/amd64 OCI exports without attestations, validates their content
and exact source labels, and assembles only the four core image identities.

The former MinIO image was local-only. Add a TEST-only source recipe pinned to
the recorded full MinIO commit, a pinned mc commit and pinned Go/runtime images.
Run the existing real provider transport test before accepting its evidence.
This is a new measured TEST image, not the historical image or production license
approval. Keep the image's license notices and source pointers. All private
provider/bootstrap/recovery files stay outside the uploaded prepared directory.

**Implementation map and checks (execute inline with independent final review):**

- [ ] Add failing producer tests for foreign source labels, corrupt/unreachable
  OCI blobs, extra components and invalid provider evidence; assert no output
  success after refusal. Add manual opt-in/source/archive/no-publish workflow tests.
- [ ] Add `scripts/compact-prepare-input.mjs` for strict OCI assembly and prepared
  payload creation, reusing the existing validators, baseline and renderer.
  Unknown fields, dirty source, symlinks and existing outputs fail closed.
- [ ] Add `deploy/compact/Minio.test.Dockerfile` and the opt-in `compact-prepare`
  job in `.github/workflows/docker-image.yml`. Build from committed sources,
  load only the verified OCI images into a job-local engine, run the existing
  provider test, and upload only the prepared directory after successful checks.
- [ ] Run RED/GREEN and the whole Compact contract suite; govern and relevant
  document/runtime contracts. Obtain independent GPT-6 Luna Max patch review.
- [ ] Commit/push/open the authorized PR. At its exact new head, dispatch producer,
  verify its successful immutable artifact identity, then dispatch package/core
  using explicit run/artifact IDs. Preserve first failures and sanitized evidence.
  No guard relaxation, fabricated evidence, image publication, production access,
  local engine start, Knowledge checkout access or new worktree is involved.

AI profiles remain **NOT_QUALIFIED** overall and unselected in this core-only
manifest (`NOT_SELECTED` is the existing strict manifest value). Live LINE,
operator-supported restore/rebind and off-host recovery remain separate gates.

Tasks1→2→3 establish the package/core lane. Tasks4 and5 qualify the corresponding
exposed business flows after the common storage/DB contracts are fixed. Task6
is required only for selected AI profiles; Task7 composes the applicable gates.
The plan does not defer a required selected-profile failure by calling it optional.

Before code: review ADR-115 and this plan against the assessment. Any changed
canonical statement/membership needs the sanctioned reviewed migration; no such
row change is part of this patch. Exact provider digest/license, live credentials,
hardware measurements and production activation are release/environment inputs
to qualify later, not facts invented by the plan.

Future implementation should run inline in the primary checkout on a branch,
with an independent GPT-6 Luna Max reviewer under repository policy. Do not create
a worktree merely to execute this plan. The owner selected Task1 at the approved
planning commit, then Task2 for disposable TEST database acceptance. The newer
delegated owner instruction selects safe Compact continuation before domain
follow-up. Task3 precedes Tasks4–7. Only ephemeral TEST credentials and fixtures
are covered here; persistent credentials, expanded security/access, real-data
deletion, production, live LINE, merge/PR/publication/release actions remain
separately gated. Stop only a dependent gated step and continue safe work.
