---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-29"
selection_base: "1dd72707d2d5bf3139c87a858d5d844fd70ecda0"
package_source: "bafe11aac924150ff442078dd92292c00101f10f"
acceptance_harness: "6aca5b08c0d309ac2074ac18c25d915345a88ecc"
---

# Task6 packaged scoped TEXT HTTP journey

This records the bounded TEST continuation under
[ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md) and the
[approved plan detail](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task6-continuation-scoped-http-admission-and-pending-work-resume).
It follows the [idle-cohort snapshot](task6-idle-cohort-20261028.md), which
established no Business or serving authority. The new lane uses real HTTPS
sessions, two self-provisioned Businesses and one synthetic inline TEXT source.
The corrected actual run passed 4/4 in 199.18 seconds with cleanup PASS.
Knowledge remains `NOT_QUALIFIED`; Task6 remains open. The
[safe observation](task6-scoped-text-observation-20261029.json) retains the
selected results and package/harness identities.

## Artifact and authority boundary

The immutable package still identifies `bafe11aa`. The test-only harness is
recorded separately; no image was rebuilt or relabelled. Manifest SHA-256 is
`0c56d22e2bd2108aae006cacfa863cda8aaf62aced34c6440fff19baf94e7ccb`, and package
inventory SHA-256 is
`81325ccb5502cce3806ed0465252edb29aeac03b10a5184972f171cf3b5d9150`.
All five pinned image references/actual IDs and linux/amd64 platforms are
reverified, along with retained model/package bytes before and after the run.
Windows Docker Desktop is the tested host; supported Linux-host/release
acceptance is separate.

Only newly owned disposable TEST resources and ephemeral credentials are used.
The bundled CLI bootstraps the first operator. Ordinary actors then sign up
through a fixture-generated CA and certificate-verified loopback HTTPS proxy;
cookies are actually issued with Secure/HttpOnly flags. Each has zero platform
grants and zero memberships after signup. Existing onboarding and `businessInGroup`
HTTP contracts create each Tenant/Business and its `TENANT OWNER SELF_PROVISION`
membership. Neither a viewer nor an application domain row is seeded through SQL.
SQL is used only to observe the fixture's actual state.

The second actor owns a different real Tenant/Business. Anonymous admission is
401; foreign-Business admission in both directions and foreign job/query/citation
reads are 404. The authorized owner gets 503 while Knowledge is disabled, then
admits the source after a private six-field binding is set to the HTTP-created
Business. This fixture-only binding configures the existing runtime; it does not
grant the user's authority. No live provider credentials, LINE, thread memory or Ollama
are selected. No production, main-dev, existing UAT or Visual Office operation
is part of this lane.

## Durable execution and current serving

The source is the generic synthetic corpus at the exact package Git revision.
Its bytes hash to
`6a5f4077a9ae7c67782c18f8994ec1cbb066f5c1f2f9f704de450debd614b5de`;
the native image's baked fixture must match. This corrects a review finding:
the corpus is baked in native, not in the web image. The harness selects this
already-baked generic fixture through `GENESIS_WORKER_BENCHMARK_FIXTURE`, replacing
the existing SmartGift default selection for this bounded test. Package, image,
model and fixture bytes are unchanged.

Duplicate HTTP admission must return the same admission ID with `unchanged=true`.
The test observes real status, attempts, claim presence, lease, execution run,
raw/parsed artifact and batch/Stage9 attempt identities before replacement.
Native is observed absent both before and after web recreation. The same
admission/source/version/content hash/run/raw/parsed identities must survive;
the post-replacement SQL state is sampled before native starts. Native then
binds the current web container namespace with the pinned image and readonly
model. No lease, retry backoff or queue value is written by this test.

Corrected run `c19de513-9021-4d45-aaf7-2f947aba2ed1` observed:

| Sample | Status | Attempts | Claim present | Lease raw text |
|---|---|---|---|---|
| Before web replacement | RUNNING | 1 | true | `2026-10-28 17:30:58.133` |
| After replacement, before native | RUNNING | 5 | false | null |
| Published | PUBLISHED | 14 | not sampled here | not sampled here |

The lease storage type is `timestamp without time zone`. The database clock
samples are separately typed `timestamp with time zone`, with `+00` offsets;
JavaScript observation times remain separate. These samples prove retained
identity and observed retry progress, not expired-lease reclaim. The run ID
`bdc5119f-b63c-4f01-9ead-123fe119e245` and Stage9 attempt
`0c602c00-9913-4376-994e-a008597fd3e3` remain unchanged through publication.

Publication requires one SUCCEEDED PipelineRun, all 17 SUCCEEDED PipelineSteps,
ordered successful evidence for stages 1–17 and one schema-valid publication
receipt for the same run/Business/snapshot. The original batch and Stage9
attempt remain the same; one source has one admission row. The receipt records
model revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`.
The real owner queries Alice's employment and opens its citation. Withdrawal
uses the source's current CAS version through HTTP, excludes it from the current
query and makes the previous citation return 404. This tests current manifest
membership, not physical deletion of historical native bytes.

Object storage stays disabled. The existing inline TEXT PostgreSQL lineage is
the selected path; this is not managed FILE/S3 acceptance. Diagnostics must
report Knowledge `NOT_QUALIFIED`, prerequisites `UNAVAILABLE` and missing
`KNOWLEDGE_STORAGE_ENABLED`. There is no full profile or comprehensive KI17
acceptance claim from this one generic corpus and one owner-facing query.

## Verification and evidence corrections

The first actual run at clean harness `478a857f` passed 4/4 in 207.44 seconds,
with cleanup PASS. Its observation is retained verbatim. Evidence inspection
found a timestamp representation limitation: Node `pg` OID 1114 interprets
PostgreSQL `timestamp without time zone` using the host's Asia/Bangkok timezone.
Serializing that Date falsely attached a shifted UTC `Z` to the stored lease
wall value. A local parser reproduction confirms this. This is a harness
observation defect; no product lease-clock defect was established.

Harness `6aca5b08` reads `leaseExpiresAtRaw` with PostgreSQL `::text` and records
its storage type. It separately records the database clock as text and its type,
and JavaScript `observedAt`. The first result must not be used to infer lease
expiry or reclaim. Holding the TLS listener open before selecting web's host
port also closes the reviewer's port-reuse reliability nit. Existing native
15-minute test/5-minute hook/12-minute publication operation-class budgets are
retained; no timeout or guard is relaxed.

The missing-input and dirty-harness controls refuse before retention or Docker;
zero tests is not PASS. Failing-first helper tests precede the source/fixture
corrections. Relevant Node guards pass 49/49, and full Compact tests at
`6aca5b08` pass 248/248 with no skipped tests. Source governance at `478a857f`
passes with 0 critical, 0 warning and 43 information; document readers pass
38/38, and corpus build/check passes. The corrected actual lane at clean
`6aca5b08` passed 4/4 with zero skipped tests; its observation and cleanup are
PASS, with no unresolved Compose intent. Independent GPT-6 Luna Max review
found no remaining source blocker at either source revision and reviewed the
corrected observation/report. Final reviewed document validation is recorded
separately in the retained local verification.

Both targets' labelled containers, volumes and networks were observed absent
after cleanup. Existing container ID/name/state inventories remained identical:
38 before and 38 after both runs. The original package and both retained copies
remain available; fixture-private files were removed by owned cleanup.

## Remaining gates and retained material

This lane does not establish expired-lease reclaim, SIGKILL recovery,
active-work drain/no duplicate external sends, concurrent source-version or
withdrawal races, managed FILE/S3 and actual-provider restore, native Stage9+
store-loss restoration, supported operator/off-host DR, supported Linux-host,
hosted exact-head CI, publication or release readiness. LINE remains
`NOT_SELECTED` here and unqualified overall; live LINE UAT is `NOT_RUN`.
No Task6 acceptance group or canonical requirement lifecycle is closed.

Raw logs, both exclusive retained package copies, observations, runtime
inventories, parser reproduction, first stale-view governance failure and
independent-review patch hashes are kept outside Git under the local checkpoint's
`compact-task6-business-journey-1dd72707` directory. Fixture-private configuration,
cookies and keys are not report inputs. Existing checkpoints, bundles, source
repositories, images and packages remain intact.
