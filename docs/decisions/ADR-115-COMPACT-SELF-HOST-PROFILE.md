---
id: ZAI:ADR-115
title: Compact single-host deployment profile and qualification boundaries
version: "0.1.2"
status: accepted
approved_on: "2026-10-27"
approved_artifact_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
approval_scope: architecture-and-plan; Tasks1–2 selected; Task2 disposable TEST only; no production action
created_at: "2026-10-27"
last_update: "2026-10-27"
author: Codex
superseded_by: null
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "Accepted portable single-host profile; Tasks1–2 package and TEST database foundation; no production activation or canonical requirement migration"
relations:
  - type: relates_to
    target: ZAI:ADR-058
  - type: relates_to
    target: ZAI:ADR-089
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-105
  - type: relates_to
    target: ZAI:ADR-110
  - type: relates_to
    target: ZAI:ADR-112
  - type: relates_to
    target: ZAI:ADR-114
  - type: references
    target: ZAI:FR-030
  - type: references
    target: ZAI:FR-142
---

# ADR-115 — Compact single-host deployment profile and qualification boundaries

**Status:** Accepted. On 2026-10-27 the owner approved ADR-115 and the
implementation plan at `e5fcfd4b599d328c1b1210b310746e6a573f2c25`, and selected
Task1 on the existing primary-checkout branch. The owner subsequently selected
Task2 with disposable PostgreSQL isolated from main-dev/UAT and independent
review. Tasks3–7 and production operations remain unselected.

## Context

At source revision `2b424364c709f5c5522bd29c3713becc2eab5854`, Zuri already has
a non-root standalone Server image, Compose, PostgreSQL clients, operator
bootstrap, Server-owned LINE and pinned Knowledge build contracts. It does not
yet have a qualified portable Compact package. Local image tags, source mounts,
sibling repository build contexts and automatic `db push` are deployment inputs,
not a redistributable installation contract.

The [source assessment](../../reports/compact-selfhost-2026-10-27/README.md)
separates packaging gaps, selected capability gaps and old audit claims.
Pipeline C1–C4 already exist; the inference-pool design is a separate unfinished
capability. Neither rebuilding Pipeline nor implementing every roadmap feature
is a prerequisite merely because a smaller deployment is requested.

[PRODUCT](../PRODUCT.md), canonical records and domain charters retain product
scope. Compact describes a deployment footprint; it does not define a second
product, seven separate applications or a reduced requirement registry.

## Decision

### D1 — One host, existing application authority

Use a versioned Docker Compose release whose image platform is `linux/amd64`.
The proposed first host qualification is Windows Docker Desktop with Linux
containers, matching the owner's current environment. Qualify a Linux host
separately before claiming host support; the image platform alone proves neither
host. A successful development preview does not qualify the new package.
Keep the existing Server, PostgreSQL and primary private object storage on this
one host. An external primary storage endpoint is outside v1. Off-host backup is
a separate failure domain, not an exception allowing remote runtime storage.

Keep domain writers, authorization and the selected existing service boundaries.
Do not introduce Kubernetes, a second business database, a replacement agent
framework or a new Knowledge authority to make the installation smaller.
No hardware minimum or GPU requirement is asserted before measurement.

### D2 — A release artifact, not a checkout-dependent deployment

The proposed package contains Compose/templates, a strict release manifest,
the exact fresh-install schema baseline, operator tooling, documentation and
content hashes. Manifest images use immutable digests and name source revision,
platform, selected profiles and component pins. Publication and an OCI archive
are transport alternatives for the same identities; a registry is not mandatory.

Installed startup must not build, resolve sibling repositories, read another
checkout, download an unpinned model or silently run a migration. The builder
may use the existing pinned multi-context build, but exports its results into
the release artifact. Package the exact canonical docs/registry/graph inputs
needed by Knowledge Studio; do not mount the developer checkout at installation.

### D3 — Separate installation and capability evidence

The following are reporting milestones, not new domain lifecycle values:

| Milestone | Required evidence | Does not establish |
|---|---|---|
| Package ready | Digests/hashes, complete artifact, strict validation, no host/sibling dependencies | A running installation |
| Core installable | Fresh isolated PostgreSQL, explicit private storage configuration, health, operator/login, scoped Business/PM smoke, restart persistence and an honest capability report | LINE delivery, all business-feature acceptance or Knowledge recovery |
| LINE ready | Core plus actual ingress/job/model/tool/delivery and account/secret authorization evidence | Knowledge or inference-pool readiness |
| Knowledge ready | Selected pinned stack, admission/serving authorization, exact-version object/DB/native-store recovery and failure cases | Every parser/provider or a complete product audit |
| Selected profile qualified | All gates applicable to the selected profiles, including their exposed business flows | Production activation or features outside that selection |

Preserve existing features and UI contracts. A core installation may report a
capability as unavailable/unqualified; it must not advertise that capability as
working or silently treat a failed gate as optional. The implementation plan
includes Asset/catalog storage and PostgreSQL report-intake portability before
claiming those flows have self-host parity. Any later decision to remove, hide
or redefine canonical behavior requires its own reviewed record migration.

### D4 — AI profiles are opt-in and fail closed

`core` installs the web/database/storage foundation. `line` adds existing
Server-owned LINE execution after credentials, origin and model policy are
configured. `knowledge` adds the pinned MSP/GKS/Genesis/model components only
after their profile passes qualification. Public ingress is separately selected
and serves web only. Missing configuration gives an explicit unavailable state;
it must not create a grant, select a hosted fallback or simulate an answer.

Keep [ADR-100](ADR-100-LINE-OA-RUNS-SERVER-EXECUTED-ON-BROWSER-PROVISIONED-API-KEYS.md)
provider policy and [ADR-089](ADR-089-BROWSER-WRITE-ONLY-CREDENTIAL-VAULT-AND-SELF-SERVE-LINE-OA-ONBOARDING.md)
secret ownership. The bounded main-dev Ollama exception does not become a
production provider. [ADR-099](ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md)
and FR-255–259 remain a separate design; no GPU pool is required by Compact.
Do not restore the retired Edge executor under another installer label.

### D5 — Fresh installation and persistent state

Initial implementation is **fresh-install only**. A read-only plan identifies
the explicit Compose project, local target, image/baseline hashes, volumes and
secret-file locations. Installation refuses a nonempty application database,
unknown volumes or conflicting project ownership. Do not repair or reset them.
Use a reviewed baseline transaction for an empty target; no startup `db push`.
Re-running against an installed target is inspection, not reinitialization.

Keep database, objects, native Knowledge stores, model artifacts and key custody
outside replaceable containers. A stopped container is not disposable data.
Existing-data import, upgrades and a production apply remain separately reviewed
operations under the appropriate target contract; this proposal does not invent
a ledger entry or extend ADR-104's Supabase authority to another target.

### D6 — Private storage is a capability contract

Reuse the existing S3 exact-version/hash semantics and provider identity checks.
Give Asset evidence, structured catalog and Knowledge distinct configured
namespaces and least-privilege credentials. Preserve no-upsert, opaque references,
authorization-before-read and exact-version deletion/restore. Never route an
unrecognized reference to an arbitrary endpoint or silently to cloud Supabase.

A provider digest, its startup command and capability/license evidence form one
qualified selection. The checked-in AIStor template, the isolated MinIO fixture
and a development RustFS instance are not interchangeable qualifications.
The package has no guessed provider image/license default; an absent qualified
selection prevents the storage-dependent milestone. A first isolated provider
test may reuse the existing MinIO fixture without selecting a production engine.

### D7 — Secrets, authority and environment boundaries

Use the existing envelope store for the selected self-host installation; keys
and credentials enter through private runtime files or the existing write-only
browser paths. Application images, manifests, logs and reports contain no secret
values. Bootstrap reuses FR-107; FR-120 signup still grants no operator or
Business membership. Do not manufacture a universal administrator account.
Separate one-shot schema/bootstrap database authority from the non-owner runtime
role; the web/worker role must not be superuser or bypass RLS. Qualify the actual
target's grants/policies rather than copying Supabase history by assumption.

Self-hosted PostgreSQL and cloud Supabase remain distinct production targets
under ADR-114. No shared data, sync, failover, dual writes or activation is
assumed. This work does not reconnect or modify main-dev, UAT, production or the
separate Visual Office repository. Future package tests use owned disposable
targets, not the existing development volume.

### D8 — Verification and adoption

The [implementation plan](../plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md)
defines independent package, PostgreSQL/storage, identity, LINE, Knowledge and
release gates. Record commands, exact artifact/source identities and first
failures. Synthetic checks, test references and old receipts do not establish
fresh installation, provider, live LINE or production acceptance.

The ADR, plan and any required semantic migrations must be reviewed before
application code. Runtime qualification follows implementation; production
selection/access/apply is a later explicit operation. Developer DDC procedures
remain retired by ADR-113; no replacement task ledger or admission receipt is
introduced by this package.

## Alternatives and consequences

1. **Selected: single-host Compose, AI separately qualified.** Reuses existing
   application boundaries and lowers mandatory setup. Capability reporting and
   independent profile tests are necessary to avoid overstating the result.
2. **Require the entire AI/GPU stack on first boot.** Adds provider/model/native
   recovery prerequisites to every installation and makes an unfinished pool a
   packaging blocker. Not selected by the owner.
3. **Replace persistence with SQLite or add an offline product fork.** Conflicts
   with the production PostgreSQL boundary and changes product behavior. Not
   selected; a fully offline/model-bundled offering needs a separate decision.

## Verification

This is an owner-approved design. The dated assessment records the planning
baseline. The [Task1 delivery evidence](../../reports/compact-selfhost-2026-10-27/task1-packaging.md)
records the implemented build-time packager, synthetic artifact tests, independent
review and governance. Those checks do not establish a qualified release image,
provider, installation, host, live LINE flow or production operation. The
[Task2 evidence](../../reports/compact-selfhost-2026-10-27/task2-fresh-install.md)
records the fresh-only TEST database implementation and actual PostgreSQL
acceptance separately. Its `INSTALLED` result is baseline state, not the
Task3 core-installable milestone. Tasks3–7 retain their separate selection and
qualification gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.2 | 2026-10-27 | accepted | Records subsequent Task2 selection for disposable TEST PostgreSQL and its bounded database evidence; Tasks3–7 remain unselected | working-tree | Codex |
| 0.1.1 | 2026-10-27 | accepted | Owner approved the exact e5fcfd4b ADR/plan and selected Task1 only; no installation or production authority | working-tree | Codex |
| 0.1.0b | 2026-10-27 | candidate | Proposes one-host packaging, fresh-only baseline and independent AI/business capability qualification after source reconciliation; no requirement lifecycle changes | uncommitted | Codex |
