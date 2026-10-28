---
id: ZAI:COMPACT-SELF-HOST-PLAN-20261027
title: Compact self-host implementation plan
doc_type: implementation-plan
status: approved
approved_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
selected_task: 6
version: "0.1.13"
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

### Task6 continuation: selected Knowledge artifact boundary

Implementation detail under the approved Task6 scope, selected again by the
owner after PR757; baseline `f63378bee8b059b898960f287bfd3b8d0a9fdcb6`:

1. Add a separate read-only `knowledge-inspect` command/API for the exact profile
   set `core + knowledge`, with an explicit expected source revision. Preserve
   both existing core-only qualification guards. LINE/public selections are
   outside this first selected-artifact inspection lane.
2. Load and verify the entire package inventory, baseline and five pinned model
   files before Docker inspection. Bind all five image references, observed IDs
   and platforms; additionally require the web/tools/Genesis assembly source
   labels to match the manifest revision. Source labels identify the declared
   assembly, not a signed build attestation or proof of runtime contents. Return
   `ARTIFACT_INSPECTED_NOT_QUALIFIED`, never readiness or serving authority.
3. Build a clean-source TEST candidate using the accepted runtime tuple, actual
   model bytes, canonical documentation/registry/graph and fresh baseline. Carry
   pinned runtime layers only with their resolved pin receipt and explicit build
   provenance. Export the selected immutable OCI graph and retain the complete
   package; do not substitute the earlier acceptance images for shipped roles.
4. Verify a relocated package through its bundled CLI, then install its exact
   baseline only on a newly owned disposable TEST target. Probe packaged-image
   runtime contents/model mounts offline, separately from source-label checks.
   Existing TEST-only storage/license evidence is not production/legal approval.
5. Exercise selected TEST Compose startup and explicit web/Genesis recreation
   when the existing contracts make that operation safe. Preserve native/shared
   volumes and the readonly model mount. Existing durable lease/replay rules own
   work recovery; neither topology inspection nor manual recreation proves a
   global drain or recall of in-flight external sends. Do not invent a coordinator
   protocol or physical native-store restoration. Keep those acceptance gates
   open unless separately demonstrated, and do not select live LINE.
6. Run failing-first image/profile/source/corruption controls, the unchanged core
   regressions, actual selected-package TEST acceptance and independent review.
   Regenerate governance serially and record actual revisions, hashes, commands,
   failures and remaining gates. No publication/production activation follows.

Version 0.1.10 → 0.1.11 adds this bounded execution detail; ADR-115, canonical
records, profile lifecycle and the acceptance groups below are unchanged.

### Task6 continuation: actual idle Knowledge cohort

The next owner-selected continuation starts at `aa4f8c50` on the same primary
checkout branch. The [selected package evidence](../../reports/compact-selfhost-2026-10-27/task6-knowledge-package-20261028.md)
proves transport, baseline and offline contents only. Extend its TEST evidence
without changing product worker ownership, credentials or shutdown semantics:

1. Require an explicit verified `core + knowledge` OCI package, exact package
   revision/image map and fresh retained/output destinations. Reuse the immutable
   `bafe11aa` candidate while recording the new test harness revision separately;
   do not relabel its bytes. Refuse foreign resources before Compose mutations.
2. Add an explicit heavyweight cohort test lane, excluded from ordinary Server
   tests. Use a new owned disposable PostgreSQL target and the packaged Compose
   file for the actual web/native images. Use private run-generated TEST session,
   envelope and MSP/native credentials with a synthetic six-field scope. This
   scope has no application Tenant/Business/membership; it is not a serving grant.
   Keep web Knowledge admission disabled and LINE/thread-memory credentials unset.
   Do not start LINE/public ingress or point at existing runtime/store paths.
   Generate app/session/envelope, database bootstrap/runtime, storage-admin and
   Knowledge/MSP/native private files inside the new fixture root only; never
   reuse checkout `.env`/`.env.knowledge`. This lane refuses a package requiring
   an external storage license rather than importing a persistent license. Never
   log secret values/hashes, and remove only these fixture-created credential
   files through the existing verified temporary-root cleanup.
3. Start web/native only, using the fixture-owned database/network and labelled
   native/shared volumes. Observe actual web health, loopback native bearer
   refusal, ownership/images/current namespace and readonly packaged model mount.
   Verify missing native query-token configuration fails on a separate owned,
   network-disabled container before opening any shared native store.
4. Stop the idle native worker through its existing SIGTERM/close path and check
   its exit. Recreate web explicitly, detect the stopped worker's stale namespace,
   then force-recreate native against the current web. Recheck health, refusal,
   pinned image bindings, the new native-to-current-web namespace, readonly
   model and retained native/shared state. This proves manual idle
   recreation only: no active job, queue drain/replay, send deduplication, current
   Business authority, full KI17 journey or physical native-store recovery claim.
5. Run failing-first guard/fixture tests and actual cohort acceptance; preserve
   first failures and record only safe IDs/hashes/status. Cleanup only run-created
   resources after ownership checks, independently attempt later cleanup actions,
   retain package/model/evidence, and compare existing runtime inventories.
   Complete independent review and serial documentation governance.

Version 0.1.11 → 0.1.12 adds this bounded TEST execution detail. AI remains
`NOT_QUALIFIED`; Task6 acceptance groups, native Stage9+, live LINE and release
gates remain unchanged. No publication or production activation follows.

### Task6 continuation: scoped HTTP admission and pending-work resume

The next owner-selected continuation starts at `1dd72707` on the same primary
branch. Reuse the immutable `bafe11aa` package with a separately committed clean
harness. The [idle-cohort evidence](../../reports/compact-selfhost-2026-10-27/task6-idle-cohort-20261028.md)
does not establish application authority or pending-work recovery.

1. Add a separate explicit TEST journey lane; retain both existing core-only and
   idle-cohort guards. Use a fresh disposable PostgreSQL target, private files,
   labelled volumes/network and the actual packaged web/native images. Reuse
   the existing bundled operator bootstrap and generated-key HTTPS fixture
   pattern. Trust only that fixture certificate; do not disable TLS validation.
2. Exercise actual signup/onboarding/Business self-provisioning through HTTPS
   sessions. Observe no Business/operator grant at signup, then the product's
   normal ownership membership after self-provisioning. Read the real resulting
   Tenant/Portfolio/Business IDs to configure the existing single Knowledge
   binding; never seed a hand-built viewer, membership or universal admin.
   Use a second ordinary signup/session and separately self-provisioned Business
   for actual cross-Business denial; nonexistent IDs are not that proof.
3. Configure the private MSP/native scope from that real Business, preserving
   the existing credentials, session/envelope keys and current scope/policy
   checks. Initially withhold the native process. Admit one immutable TEXT source
   through the existing HTTP service, assert a same-request retry returns the
   same admission, and capture actual non-published status, attempts, claim state,
   lease timestamp and admission/PipelineRun identity at replacement. The web
   poller may already have claimed work while native is absent; do not label this
   queue-only or lease recovery without observed expiry/reclaim evidence.
4. Replace web explicitly while native is absent, then start native in the new
   web namespace with the same labelled stores and readonly packaged model.
   Observe recovery of the same immutable job/run under existing leases, retry
   and ownership rules. Do not backdate leases, clear claim fields, lower
   backoff, fabricate receipts or add a coordinator/drain protocol.
5. Use the existing generic synthetic benchmark already baked into the native
   image. Require actual successful 17-stage evidence, receipt/publication and
   source lineage before calling the job published. Check scoped HTTP query and
   citation, foreign denial, then source withdrawal excluding current serving
   and citation access. This is one TEXT/session journey, not browser/MCP,
   managed-FILE, arbitrary crash-phase, LINE delivery or native-store DR proof.
6. Keep optional object storage disabled for this existing inline-TEXT lineage
   path, explicitly record that missing profile prerequisite, and do not qualify
   the full Knowledge profile. Object-backed FILE, object/DB remap, native
   Stage9+ loss recovery, off-host and release acceptance remain separate.
   No hosted fallback or external provider call is selected.
7. Use the existing native acceptance operation class (15-minute test,
   five-minute hook, 12-minute publication wait). Existing runtime/native stop,
   transport, lease and backoff defaults remain unchanged. Fail on terminal
   failure immediately; retain failures rather than extending deadlines.
   Complete failing-first tests, real journey acceptance, independent review,
   serial governance and owned cleanup; retain package/model/evidence.

Version 0.1.12 → 0.1.13 adds this bounded TEST execution detail without changing
canonical behavior, profile lifecycle or the unchecked Task6 groups. Knowledge
and LINE remain `NOT_QUALIFIED`; no live LINE, production, worktree or publication
operation follows from this continuation.

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
- [ ] Complete required hosted exact-head CI and normal PR/release controls when
  separately selected. The manual job is implemented but NOT_RUN. No merge,
  release publication or production activation follows from the local pass.
- [ ] Qualify supported operator managed-blob restore/rebind and an actual
  off-host backup failure domain under their owning contracts before claiming
  complete operational recovery. The TEST-only remap does not close these gates.

## Dependency and approval handoff

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
