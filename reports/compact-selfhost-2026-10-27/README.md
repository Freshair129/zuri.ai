---
doc_type: code-requirements-assessment
status: reviewed
version: "0.1.0"
assessed_at: "2026-10-27"
code_revision: "2b424364c709f5c5522bd29c3713becc2eab5854"
---

# Compact self-host source reconciliation

This is a bounded packaging and capability assessment at the revision above.
It informs [candidate ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md)
and its [proposed plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md).
It creates no requirement, changes no canonical lifecycle and proves no runtime
or production readiness. The owner selected one host with AI qualified separately.

## Sources, method and limits

Enumerated tracked documents and the hidden/ignored filesystem before adding
these documents; inspected existing plan/report indexes, templates and current
source/test paths. The registry has553 records:288FR,25NFR,44BR,113SDD,37SEC and
46FEAT. This inventory is not553 independently verified behaviors.

The retained census commit `0cf272cefb694ea7694e2b3ea5d4e0458e1e4043` is kept
in the local `checkpoint/20261027/codex/compact-selfhost-readiness-20261027` tag
and verified consolidation bundle. Read it with
`git show checkpoint/20261027/codex/compact-selfhost-readiness-20261027:reports/compact-selfhost-readiness-2026-10-27/source-scan.json`;
no remote publication of that tag is assumed. It is bound to the same
application revision:1,428 runtime files and1,263 test
files. Its keyword/literal-import candidates do not prove defects, dead code,
absence of dynamic consumers or permission to delete anything. External
MSP/GKS/Genesis internals are outside that census.

Re-read the [2026-10-23 assessment](../gap-analysis-2026-10-23/README.md),
[application-fix disposition](../gap-analysis-2026-10-23/application-fixes.md),
[Knowledge assessment](../knowledge-readiness-2026-10-26/README.md), current PM
plan/source and the retained consolidation audit leads. Old reports stay bound
to their own revisions. No old result is promoted to a fresh execution result.

## Canonical applicability

These are links to source requirements, not a second statement registry.

| Selected authority | Application to Compact |
|---|---|
| [PRODUCT](../../docs/PRODUCT.md), [ADR-058](../../docs/decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md), [ADR-114](../../docs/decisions/ADR-114-ZURI-AI-PRODUCTION-TARGETS.md) | Preserve the product; distinguish deployment profile from environment and database target. |
| [FR-030](../../docs/requirements/FR-030.md), [FR-013](../../docs/requirements/FR-013.md) | PostgreSQL and snapshot interfaces are inputs; reference metadata alone does not recover object/native bytes. |
| [FR-075](../../docs/requirements/FR-075.md), [FR-107](../../docs/requirements/FR-107.md), [FR-120](../../docs/requirements/FR-120.md) | Existing operator bootstrap, scoped authorization and unprivileged signup. |
| [FR-142](../../docs/requirements/FR-142.md), [FR-145](../../docs/requirements/FR-145.md) | Health/public origin and database connection behavior, not a complete installer specification. |
| [FR-137](../../docs/features/FEAT-016/requirements/FR-137.md), [FR-173](../../docs/features/FEAT-013/requirements/FR-173.md), [FR-254](../../docs/features/FEAT-013/requirements/FR-254.md) | Private evidence/admission/serving retain their authorization and integrity contracts. |
| [FR-281](../../docs/requirements/FR-281.md), [FR-282](../../docs/requirements/FR-282.md), [FR-283](../../docs/requirements/FR-283.md) | External Marketing report authority, atomic intake and private reads remain governed; a SQLite path does not qualify PostgreSQL. |
| [FEAT-007](../../docs/features/FEAT-007/feature.md), [FEAT-043](../../docs/features/FEAT-043/feature.md) | Pipeline and inference pool are different capabilities with different current evidence. |

## Revalidated findings and disposition

`SOURCE` means inspected implementation/configuration. Test paths below are
bindings, **not tests executed in this task**. A conditional gate applies only
when the package claims/selects that capability; it is not permission to erase it.

| Finding | Current source and observation | Disposition |
|---|---|---|
| P-01 Portable artifact missing | [image workflow](../../.github/workflows/docker-image.yml) builds `runner` with `push: false`; [Compose](../../apps/server/docker-compose.yml) permits local tags and source mounts. No Compact package was found in enumerated deployment/plan scope. | Package gate: digest manifest, archive/registry transport and packaged read-only docs. Publication itself is not mandatory. |
| P-02 Initialization is not an upgrade contract | [Compose](../../apps/server/docker-compose.yml) `db-migrate` invokes `db push`; [Dockerfile](../../apps/server/Dockerfile) tools defaults to that command. Existing [PostgreSQL DDL](../../apps/server/prisma/postgres/0001_init.sql) is not automatically proof of parity with the current generated schema. | Fresh empty-target baseline gate; refuse existing data. Production lineage remains separately controlled. |
| P-03 Knowledge build depends on siblings | [Compose](../../apps/server/docker-compose.yml) passes three external contexts; [pins](../../apps/server/deploy/ki17/pins.json) bind components and model revision; [Dockerfile](../../apps/server/Dockerfile) has separate targets. | Builder responsibility; installed package must contain exact images/model artifacts. Core does not need those contexts. |
| P-04 Web/worker lifetime coupling | [Compose](../../apps/server/docker-compose.yml) Genesis uses `network_mode: service:web`; readiness checks a socket. LINE image cadence does not prove delivery. | Selected AI gate: explicit cohort recreation, namespace, readiness and capability checks. Do not claim every process is application-ready from TCP alone. |
| P-05 Storage provider examples differ | [storage overlay](../../apps/server/docker-compose.knowledge-storage.yml) is an AIStor/MinIO command/license template; [target example](../../apps/server/deploy/knowledge-storage/target.json.example) has PENDING target fields; [restore harness](../../apps/server/tests/helpers/knowledge-restore-storage.js) pins a local TEST MinIO image ID. | One exact digest/command/capability/license selection per release; no guessed interchangeable RustFS/MinIO image. |
| B-01 Asset and structured-catalog factories still require Supabase | [configured factories](../../apps/server/src/platform/storage/supabase-object-storage.js), [Asset upload](../../apps/server/src/app/api/assets/evidence/route.js), [pricing consumer](../../apps/server/src/modules/commerce/application/pricing-catalog-service.js). Private Knowledge S3 dispatch exists but does not make these factories portable. | Selected business-flow parity gate. Reuse ports, add explicit S3 selection and exact managed-ref dispatch; preserve Supabase compatibility. |
| B-02 Marketing PostgreSQL receiver unavailable | [database factory](../../apps/server/src/modules/marketing/infrastructure/marketing-report-database.js) returns null for PostgreSQL; [route](../../apps/server/src/app/api/growth/external-marketing-reports/route.js) supplies that result to [receiver](../../apps/server/src/modules/marketing/application/marketing-report-receiver.js). The receiver's writer-lock comment and retry handling target SQLite. | Selected report-flow gate: provider-aware factory plus real PostgreSQL policy/revoke/replay/commit races. Do not merely remove the null guard. |
| B-03 Operator/secret primitives exist | [bootstrap](../../apps/server/scripts/bootstrap-operator.mjs), [operator service](../../apps/server/src/modules/identity/operator-bootstrap.js), [secret dispatch](../../apps/server/src/platform/integrations/core/secret-store/dispatching-secret-manager.js). Bootstrap intentionally prints an initial password once; envelope and Vault are distinct writable stores. | Reuse with private bootstrap handover and a sanitized install result; never capture that password in general logs or invent signup grants. |
| K-01 S3 exact-version primitives exist | [S3 port](../../apps/server/src/platform/storage/s3-object-storage.js) uses conditional immutable writes, exact versions and identity-bound ports. [Knowledge report](../knowledge-readiness-2026-10-26/README.md) retains actual-provider attempts and limitations. | Reuse primitives; rerun selected provider/restore qualification on the new artifact. No general end-to-end recovery claim. |

### Reconciled old audit claims

| Old lead | Current reconciliation | Compact consequence |
|---|---|---|
| Pipeline C2–C4 may still be missing | [PM plan](../../docs/plans/PM-PIPELINE-BUILDER-20261023.md) records C1–C4 merged and bounded UAT after PR745. [handoff recovery](../../apps/server/src/modules/project-manager/application/pipeline-handoff-recovery.js), [release policy](../../apps/server/src/modules/project-manager/application/work-release-policy.js), [structure interactions](../../apps/server/src/modules/project-manager/components/pipeline-structure-interactions.js) and [PostgreSQL tests](../../apps/server/tests/postgres/pipeline-canvas-adapter.test.js) exist. ADR-035's early staged wording and historical C1 paragraphs are not current absence evidence. Canonical row/lifecycle adoption and production evidence remain separate. | Preserve and regression-test existing implementation; no Pipeline rewrite task. |
| Inference pool must precede self-host | [ADR-099](../../docs/decisions/ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md) says design/documentation approved, implementation not started. FR-255–259 retain planned rows; enumerated [schema](../../apps/server/prisma/schema.prisma) does not declare the proposed pool models. [model provider](../../apps/server/src/modules/agent/model-provider.js) is not a capacity-lease pool. ADR-100's configured provider is a different path. | No mandatory pool/GPU task; do not claim the pool implemented because a private endpoint works. |
| Archive expiry has no scheduler | [expiry service](../../apps/server/src/modules/crm/chat-evidence-archive-expiry-service.js) exists; inspected runtime/scripts did not show a caller of its expiry exports. Retention sweep is a distinct worker and must not be counted as archive expiry. | Conditional archive-retention gate; no blanket installer blocker and no silent retention completion claim. |
| CRM campaign mockups, service-only invites, SmartGift tools | Retained as old leads. This bounded review does not establish the exact current product-wide gap or complete dynamic tool reachability; existing campaign and invitation code was enumerated. | Unresolved audit follow-up, not newly confirmed defects or authority to remove a feature. |
| SCM/Files/MI packages mean all consumers have cut over | [service index](../../docs/services/README.md) and [Server boundary](../../docs/services/server/SERVICE.md) retain adoption/consumer limits. | Ship only actually selected/qualified service topology; no mandatory service split. |

## Priority and acceptance map

1. **Package/core:** artifact identity, safe empty-target initialization, secrets,
   operator/scoped smoke, persistence/restart, no host paths and no hidden AI requirement.
2. **Exposed self-host business flows:** B-01 and B-02 before claiming their parity;
   otherwise explicit unavailable/unqualified disclosure, not an overall feature pass.
3. **Selected LINE/Knowledge:** exact runtime/profile/provider and recovery gates.
4. **Separate backlog:** new inference pool, unqualified service cutovers, general
   product gaps and a fully offline/model-bundled offering.

An installer pass does not close the product backlog. The previous release E2E
run40364815015 retained244passes/3failures/1flaky/4skips in the local handoff;
it was not rerun here and is not Compact acceptance. The lexical census does not
authorize dead-code deletion. No application or canonical requirement was edited.

## Checks for this documentation patch

| Check | Result | Limit |
|---|---|---|
| Filesystem/registry/source reconciliation | Performed at the source revision above | Selected scope, not a semantic audit of every record |
| `npm run docs:ids -- --write` | PASS; one ADR identity added | Sanctioned writer; no canonical FR/FEAT row or membership change |
| `npm run docs:registry`, `docs:graph`, `docs:views` | PASS |553 records,96 views; initial graph had zero dangling links |
| `npm run govern` | Final PASS:0critical,0warning,43info | First run's Status-formatting/untracked-doc warnings retained; corrected/staged before the final run |
| `npm run docs:llms`, `docs:llms:check` | PASS | Local ignored corpus only; not staged |
| `npm run docs:migration:test` | PASS:146tests,0failures,0skips | Existing registry/identity/view/profile/query readers; no application behavior tests |
| Independent document/plan review | PASS: GPT-6 Luna Max; no important builder blockers | Host/image and same-host storage clarification resolved; a document review is not implementation acceptance |
| Application tests, package build/install, provider/LINE/production | NOT_RUN | Planning-only task; no such acceptance is claimed |

Command logs and first warnings are retained in the local consolidation evidence.
The final handoff reports the post-review freshness run separately; a linked
future test in the plan is never counted among the146 executed reader tests.

## Version diff

0.1.0: introduces a dated Compact assessment and explicit disposition of prior
audit leads. Existing reports remain immutable historical evidence; canonical
IDs, rows, memberships and delivery state are unchanged.
