---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
implementation_base: "8bcaae9f7b2975df8d68d65cdfc8ea3306619e09"
---

# Compact Task3 private bootstrap and core qualification

The owner's subsequent delegated instruction selected safe Compact continuation
before domain follow-up. This milestone executes Task3 of the approved
[plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md) on the same
primary-checkout branch. Only ephemeral TEST credentials/resources are used.
There is no production/main-dev/UAT mutation, new worktree, live LINE action,
persistent credential/security configuration, push, PR, merge or publication.
Tasks4–7 remain pending execution with their capability and release gates.

## Delivered boundary

The packaged bare-Node CLI now exposes explicit `bootstrap` and `diagnostics`.
The host validates the package, installed target, private output and credentials,
then rechecks the observation. A restricted transient tools container reuses the
existing FR-107 CLI/service under an advisory-locked transaction with physical DB
and installation-marker checks. It has no data-volume mount, uses the selected
digest and receives credentials through its child environment rather than argv.
Docker logging is disabled. Initial password output is captured privately and
written only to a new selected file; generic output contains status/IDs and
errors are fixed codes. Standing-operator refusal and credential non-overwrite
remain unchanged. A delivery failure after DB commit is not repaired implicitly.

New private outputs use POSIX mode0600; Windows relies on the supplied parent's
protected ACL. The tool does not change host ACLs. Existing destinations, links,
release-contained output and dot-dot-prefixed child-directory tricks are refused.
Private database references use the same corrected containment boundary.

Compose selects the existing envelope store; the private app file supplies the
key/version. Missing or invalid configuration stays unavailable without creating
a key or using a development fallback. Diagnostics reveal no secret material and
distinguish configuration from qualification. `storage` currently describes the
unqualified Asset/catalog port; the TEST provider-engine checks are a separate
claim. Runtime `core` always remains `NOT_QUALIFIED` in this diagnostic: the CLI
does not import qualification reports. The evidence below is a separate claim.

The native DB creator now supplies and verifies the `db` network alias required
by its runtime URL contract. New web containers carry explicit TEST target/project
labels. The first real documentation package also exposed an issued graph path
containing spaces: portable paths now allow interior ASCII spaces, while still
refusing edge whitespace, Windows device names, traversal and metacharacters.
The fixture packages every canonical registry record and every current graph
document path. Unsupported placeholder draft-template filenames are not selected;
the graph is not trimmed or rewritten to hide missing inputs.

## Actual isolated core run

The separate `playwright.compact.config.js` has no default E2E global setup,
shared seed or `:3100` server. The default E2E configuration excludes this profile.
The fixture uses exact local web/tools image digests, PostgreSQL16, an owned MinIO
container/volume and a certificate-pinned loopback HTTPS proxy. All credentials,
sessions, object bytes, certificate/key and people are generated for this run.
No host trust store is changed; browser certificate checks remain enabled with
only the fixture certificate's SPKI trusted. Browser-origin fetches use the same
real session and HTTPS trust as the UI. Traces, screenshots and video are disabled
to keep login material out of artifacts. Test-owned resources are removed only
after checking exact names/IDs and ownership labels; private temp cleanup checks
the resolved path. Locally built images and checkpoint evidence are retained.

The actual provider engine passes versioning, conditional-write refusal and exact
version read/erase before bootstrap/web. These do not qualify the Asset/catalog
bridge (Task4) or production provider/license selection. Prepared storage/license
metadata remains TEST fixture input, not independent release certification.

The composed browser test proves:

- Private bootstrap succeeds, returns no generic password, and refuses a second
  bootstrap while its single operator stands.
- Actual UI operator login creates a secure HttpOnly session over fixture HTTPS.
- Ordinary signup creates no platform grant or membership. Profile completion
  and actual self-provisioning create the domain owner's TENANT membership.
- Authorized Business and Project create/read/update, seven real execution views
  and progress-explanation affordances work through the packaged application.
- A different ordinary Business owner cannot read/update the first Project.
- The same Project data and seven Workstreams remain after web restart; a fresh
  table census checks the current210 public model tables.

The success path uses a distinct ordinary Business actor. The existing platform
viewer branch deliberately has empty Tenant/Business ownership sets, even after
self-provisioning creates a Membership. Expecting the installation operator to
PATCH that Business caused the first scope refusal. Independent source review
confirmed the policy; no authorization guard, operator grant or viewer was widened.
This leaves the combined operator/founder case as an explicit existing limitation:
FR-074's self-provisioning statement and the platform branch need reconciliation
before claiming that actor combination is accepted. This milestone qualifies the
ordinary owner's flow and does not close that broader requirement gap or authorize
an ownership expansion. The operating user follows the documented ordinary-account
path while platform administration remains separate.

## Executed verification and retained failures

Local host: Windows Docker Desktop, Node24.20.0; images use Node22/linux-amd64.
No hosted CI or Linux-host qualification is claimed.

| Check | Actual result and scope |
|---|---|
| New bootstrap/diagnostics tests | RED:12 failed for missing implementation; then12 passed |
| Private output/reference descendant guards | RED regressions demonstrated inside-release `..private` acceptance; fixed before continuation |
| Native tools transport and CLI/Compose wiring | RED:2 missing-transport cases, then3 missing CLI/store cases; green after implementation |
| Runtime `db` alias on real PostgreSQL | Focused RED:1 failed/10 unselected; focused GREEN:1 passed/10 unselected; full run below has no skips |
| Issued graph filename with spaces | RED:42 executed,41 passed/1 failed; GREEN:42/42 with reserved/metacharacter negatives retained |
| Explicit E2E selection | RED:4 executed,3 passed/1 failed; GREEN:4/4; default profile cannot accidentally start the Compact fixture |
| `npm run compact:test` | PASS:136 executed,136 passed,0 skipped at the composed checkpoint |
| `npm run test:postgres -- tests/postgres/compact-fresh-install.test.js` | PASS:11 executed,11 passed,0 skipped; final run240.42s after ownership-label/timeout changes; actual catalog/roles, rollback, refusal, drift, alias and portable CLI |
| `npm run test:compact:core` | PASS:1 composed browser test, first attempt, no retry/flaky result; final run1.6min with manifest/CLI hashes and actual table census; all listed core assertions executed |
| Wrapped existing identity/config regressions | PASS:9 files,93 tests,0 skipped across operator/bootstrap CLI, signup service/route, onboarding routes, envelope/dispatch stores, default Playwright DB isolation and publication containment |
| Docker `tools` and `runner` builds | PASS: locally named immutable TEST images; runner includes Next compilation/lint/type/static-generation build |
| Current checkout `npm run build` | PASS: Next compilation, lint/types,94 static pages and build traces after generated runtime evidence reconciliation |
| Document readers | PASS:19 tests,0 skipped |
| Serial registry → graph → views; `npm run govern` | PASS:553 canonical records,96 feature views; strict preflight0 critical/0 warning/43 info |
| Generated corpus build/freshness | PASS; ignored outputs retained locally, not staged |

Retained core failures are distinguished from success: a missing fixture, an
uninstalled SDK assumption (replaced with the existing dependency-free S3 port),
Playwright CJS/ESM loading (explicit `.mjs` implementation with the old import
shim), nonportable documentation input, Node API transport's certificate refusal
(replaced with browser-origin requests), and the operator actor mismatch. The
original failures and failed target observations remain in the private checkpoint.
No setup failure, retry pass, earlier focused skip or source reference is counted
as final acceptance.

The [redacted core observation](task3-core-observation.json) binds TEST identities,
images, manifest/host-CLI/baseline hashes, native catalog identity and actual checks.
This is a TEST candidate built from the base plus the host-tool working patch;
it is not a production release at that source revision. The tools image's scope,
bootstrap service and scope-route source bytes were separately compared with the
checkout and matched. Broader exact-release and hardware/recovery evidence belongs
to Task7.

## Review and remaining gates

Independent GPT-6 Luna Max diagnostic review confirmed the actor-policy mismatch
without running services or editing code. Final same-patch review found no concrete
implementation blocker in bootstrap, diagnostics, private output, Compose, E2E and
evidence. The reviewer did not execute tests or Docker. The integrator reconciled
the tracked generated runtime evidence through serial governance and built the
composed tree; the final PostgreSQL rerun above is integrator evidence.

Hosted core acceptance remains absent: the PostgreSQL workflow neither selects
core-helper/spec-only diffs nor runs this core E2E profile. Task7 must wire that
coverage before integration/release; local evidence cannot detect a future hosted
regression on those paths. Exact-head hosted CI is not claimed here.

Asset/catalog integration, Marketing PostgreSQL intake, selected LINE/Knowledge
qualification and the complete restart/restore/hardware/release matrix remain
Tasks4–7. Actual provider/license approval, persistent secrets/security expansion,
live LINE and production/release actions require their specific authority. A
passing local core test supplies no merge, publication or production permission.
