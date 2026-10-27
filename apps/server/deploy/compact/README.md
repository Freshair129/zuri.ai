# Compact package, fresh database and private core qualification

ADR-115 provides build-time packaging, a fresh-only PostgreSQL installer,
private first-operator wrapping and isolated core qualification for explicit TEST
targets. `INSTALLED` describes the database baseline. Asset/catalog, Marketing,
LINE/Knowledge and release qualification retain their separate gates. The Compose
template must be rendered by the packager; do not run it directly.

`compact:package` consumes a prepared `release-manifest.json`. All non-generated
payload paths resolve under that file's directory, never an ambient checkout.
Supply canonical docs, their generated graph, canonical registry and every record
it references; reviewed baseline SQL, storage/license evidence and any selected
Knowledge pins/model bytes. Packaging hashes the baseline; only the explicit host
installer applies it. A graph or
reference metadata alone does not recover object/native-store bytes.

Images use `repository@sha256:<64 lowercase hex>` references. Core requires
web/tools/postgres/storage only. LINE reuses the web image; Knowledge additionally
requires the worker, pinned MSP/GKS/Genesis identities and exact model files.
Public ingress requires a separate pinned ngrok image. The first image platform
is linux/amd64. Report host and exact-package acceptance separately: a local
Windows Docker Desktop probe does not certify Linux-host or release support.
No GPU pool is required.

The strict JSON schema is `release-manifest.schema.json`; the validator adds
portable path/case-collision and selected-profile/hash-reference invariants.
Interior ASCII spaces support issued graph-document filenames; edge whitespace,
Windows device names, traversal and shell metacharacters remain refused.
Unknown data is rejected, never coerced. Task1 capability fields remain
`NOT_QUALIFIED` for selected profiles and `NOT_SELECTED` otherwise. Supplied
qualification evidence binds image/command/platform/checks; this tool does not
perform or independently certify the claimed provider/license qualification.
The two qualification payloads must be distinct JSON files under `qualifications/`.
Storage evidence allows only `status: "PASS"`, `environment` (TEST/UAT/PRODUCTION),
`image`, `platform`, `command`, and `checks` containing exactly `versioning`,
`conditionalWrite`, `exactRead`, `exactErase` set to true. License evidence allows
only `status: "PASS"`, the same `environment` and `image`, `licenseRequired`,
and `reviewSha256` (SHA256 of the separately retained license review). This is a
redacted review assertion, never the provider license/key or its raw contents.
No additional qualification payload is accepted.

Build-time API (Node22+, Server dev dependencies from its lockfile):

```js
import { renderCompactRuntimeFiles, packageCompactRelease } from './scripts/compact-package.mjs'
// manifest is a JSON object with selected identities and prepared file hashes.
// Compute the five generated root file hashes from this exact packager version:
const rootFiles = await renderCompactRuntimeFiles(manifest)
// Put their SHA256 values into manifest.files, then save the prepared manifest.
await packageCompactRelease({ manifest: preparedManifestFilename, outputDirectory: newDirectory })
```

Generated roots are `compose.yml`, `env.example`, `README.md`, this JSON schema,
and the bundled `compact-self-host.mjs` host CLI (bare Node22+, Docker CLI).
Their declared hashes must match this tool's rendered bytes. No input version
can override the trusted runtime template. Other payloads are copied only after
all declared bytes, paths, registry coverage and evidence bindings pass preflight.
Forbidden `.env`/key paths, credential directories, symlinks/junctions and unknown
root payloads are rejected. Hashes and path validation do not certify that arbitrary
Markdown, model bytes or OCI image content is free of secrets. Prepared inputs and
images must receive content review before CI upload or release; retain actual
credentials/licenses outside the artifact. Historical examples in reviewed canonical
Markdown remain source text. The runtime template contains only package-relative
mounts and private file selectors. Metadata semantics and copied bytes use the same
hash-checked snapshot; an optional `expectedRevision` API argument or CLI
`--expected-revision` checks that same manifest snapshot.

```sh
npm run compact:test
npm run compact:package -- --manifest /prepared/release-manifest.json --output /new/package
npm run compact:package -- --manifest /prepared/release-manifest.json --output /new/package --oci-layout /prepared/oci
```

An optional trusted `imageExporter` callback returns `{layoutDirectory}`. The
CLI's `--oci-layout` is its local-filesystem implementation: no Docker, network,
build, pull or shell is invoked. The OCI index must contain exactly the selected
image digest set; every referenced blob, size, hash and image config platform is
verified. Any root or nested descriptor platform must also match linux/amd64.
Additional OS/CPU/variant constraints are outside this v1 platform qualification
and rejected in descriptors/configs. Extra/unreferenced files, links and foreign images are rejected. The
result is a deterministic regular-file USTAR `images.oci.tar` with the same OCI
identities. Individual tar entries are limited to8GiB; JSON metadata is bounded.
Registry-only output has no archive and retains the same manifest identities.

Build those inputs separately using the existing Dockerfile `runner`/`tools`
targets; selected Knowledge uses `runner-ki17`/`genesis-worker` and its existing
pinned contexts on the builder. Docker's OCI exporter can produce a local layout
with `--output type=oci,tar=false,dest=...`; publication is a separate opt-in.
See [Docker OCI export](https://docs.docker.com/build/exporters/oci-docker/) and
[OCI layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md).
Multiple images must be assembled into one index of the selected digest set.
Do not use `docker save` output as if it were an OCI layout.

The final output also contains the validated manifest, `transport.json` and
sorted `SHA256SUMS`. Inventory includes generated transport files but cannot hash
itself. Output creation is exclusive; an existing directory is never replaced.
Failures after creation retain `.partial` and have no success inventory. Preserve
that failed output for diagnosis; the tool never recursively deletes it or retries
over it. A successful package can move without its prepared input directory.

Core Compose declares no migration service/build contexts. The manual-only
`tools` profile exits with `COMPACT_USE_HOST_INSTALLER`, overriding its legacy
default `db push`. Selected AI services are rendered only when requested; no
unselected image/environment interpolation is required. The database port binds
to loopback; the object store has no published port. Never point package tests
at existing main-dev/UAT/production volumes.

## Build the reviewed fresh baseline

From Server with its locked build dependencies installed:

```sh
npm run compact:baseline -- --output /new/schema --source-revision <exact-HEAD-commit>
```

This produces `baseline.sql` and `baseline.json` in a new directory. Copy both
under the prepared package's `schema/` directory and declare their hashes before
rendering generated roots. The producer verifies the canonical schema at HEAD,
generates PostgreSQL DDL with Prisma `migrate diff --from-empty` without connecting
to a database, and appends the reviewed fresh security snapshot. It neither runs
Supabase history nor writes a migration ledger. The snapshot preserves current
grants, all 108 current CHECK constraints and eight Phase B scoped policies;
130 migration source hashes are build-time reconciliation inputs, never scripts
to execute. Changed source inventory/content requires reviewed reconciliation.
The generated shared PostgreSQL client is not regenerated or overwritten.

## Explicit TEST target and private inputs

Create a private JSON descriptor outside the package. Example identities below
are illustrative: choose a new UUID/project, a free loopback port and an explicit
RFC1918 /24–/28 subnet disjoint from Docker networks and host routes. The fixture
subnet is not a portable default. On Linux select a local Unix-socket context;
remote TCP/SSH contexts and non-TEST environments are refused.

```json
{
  "schemaVersion": "compact-target.v1",
  "environment": "TEST",
  "targetId": "11111111-1111-4111-8111-111111111111",
  "project": "zuri-compact-test-a1",
  "dockerContext": "desktop-linux",
  "network": "zuri-compact-test-a1-private",
  "networkSubnet": "10.252.16.0/28",
  "database": {
    "container": "zuri-compact-test-a1-db", "host": "127.0.0.1",
    "port": 35432, "name": "compact_test_a1",
    "bootstrapRole": "compact_bootstrap", "runtimeRole": "zuri_web_login"
  },
  "volumes": {
    "database": "zuri-compact-test-a1-database",
    "objects": "zuri-compact-test-a1-objects"
  },
  "secretFiles": {
    "bootstrapEnvironment": "C:/private/compact/bootstrap.env",
    "runtimeEnvironment": "C:/private/compact/runtime.env"
  }
}
```

Protect two distinct regular private files outside the package (no links). The
bootstrap file contains exactly `POSTGRES_USER=compact_bootstrap`,
`POSTGRES_DB=<descriptor database name>` and `POSTGRES_PASSWORD=<private value>`.
The runtime file contains exactly these six aliases, all with the same private
URL: `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `DATABASE_POSTGRES_URL`. Its URL is
`postgresql://zuri_web_login:<private value>@db:5432/<descriptor database name>`.
Generate two distinct cryptographically random 32-byte values encoded as
64 lowercase hexadecimal characters. Do not place them in command arguments,
manifests, reports or tracked files. No operator/product identity is bootstrapped.
Compose web/LINE worker read the runtime file last; only db reads the bootstrap
file. Map the nonsecret selectors in `env.example` to these same identities.

## Inspect, plan, initialize and stop

Preload the selected immutable images through a separately authorized transport.
The host tool verifies all selected local digests/platforms; it never pulls,
builds or imports images. It verifies the complete package inventory and every
hash (including optional OCI bytes) before contacting the explicit local daemon.
Run the bundled CLI from any working directory:

```sh
node /package/compact-self-host.mjs inspect --package /package --target /private/target.json
node /package/compact-self-host.mjs plan --package /package --target /private/target.json
node /package/compact-self-host.mjs install --package /package --target /private/target.json
node /package/compact-self-host.mjs status --package /package --target /private/target.json
node /package/compact-self-host.mjs stop --package /package --target /private/target.json
```

`plan` validates private inputs and emits a redacted immutable observation-bound
plan without mutation. `install` re-observes ownership, identity and emptiness,
creates only its named network/volumes/database container, then rechecks the DB
inside one atomic SQL transaction. DDL, roles and the installation marker roll
back together on failure. `zuri_web_login` inherits the scoped runtime group
without owner membership, superuser, bypass-RLS, database/schema creation or
grant authority. All tables enforce RLS; current pricing/immutable-table grants
and Phase B scope policies remain explicit.

An installed retry only inspects the target. The marker binds target, manifest,
baseline, physical database identity and native catalog hash, including relevant
ACLs. Populated/foreign/unproven targets, stale observations or schema/ACL drift
fail closed. There is no repair, reset, remove, import or upgrade command. Partial
owned resources remain for diagnosis. `status` and `stop` do not require private
file contents; stop preserves the network and volumes. A stopped database reports
`STOPPED_UNVERIFIED`, without starting it or claiming schema health.

The host installer does not automatically start web/storage/AI. Task3's isolated
fixture starts its owned web after database initialization and private bootstrap;
do not use `compose up` to bypass the fresh installer or infer release readiness.
The explicit disposable acceptance command is:

```sh
npm run test:postgres -- tests/postgres/compact-fresh-install.test.js
```

It uses unique TEST containers, networks and volumes plus a separate embedded
catalog reference, with exact ownership checks before fixture cleanup. Package
fixtures use synthetic component/qualification assertions and real PostgreSQL;
they are not a real Zuri image or storage-provider qualification. The separate
Linux CI job declares this acceptance; a local Windows pass does not qualify a
Linux host or constitute hosted CI evidence.

## Private first operator and configuration diagnostics

Prepare a private JSON identity file with exactly `email` and `displayName`.
Select a new absolute output filename in an already protected private directory,
outside the release. Run the packaged tool only against the initialized TEST
target:

```sh
node /package/compact-self-host.mjs bootstrap --package /package --target /private/target.json --operator /private/operator.json --private-output /private/initial-login.json
node /package/compact-self-host.mjs diagnostics --package /package --target /private/target.json --configuration /private/app.env
```

Bootstrap reuses `scripts/bootstrap-operator.mjs` and the existing FR-107 service.
The selected tools digest runs as a transient restricted container on the owned
network, with no data-volume mount and Docker logging disabled. Physical DB and
installation identity are checked inside an advisory-locked transaction. Its
bootstrap DB authority is separate from web's runtime role. A standing operator
refuses another bootstrap; no grant-only, credential overwrite or reset is exposed.

The initial password goes only into the exclusively created private JSON output.
Generic stdout returns status/IDs; errors use fixed codes. Existing files and
linked/inside-release destinations are refused. New files use POSIX mode0600;
Windows inherits the private parent's ACL. The caller must supply a protected
parent; the tool does not change host ACLs or trust settings. Keep this file out
of backups/reports intended for publication. If the DB commit succeeds but private
delivery fails, retain the failure and use separately authorized existing recovery
procedures; retry never overwrites an already-created credential. A reserved empty
output can remain after refusal/failure and is not a success report.

Supply `ZURI_SECRET_KEK` and its positive `ZURI_SECRET_KEK_VERSION` through the
private application env file. Compose explicitly selects the existing `envelope`
store. Missing/invalid key material stays unavailable; this tool never creates a
persistent key or enables a development fallback. The app env parser used by
diagnostics accepts blank/comment lines and unique `UPPER_CASE=value` assignments,
without quotes or multiline values. Do not print that file. Configuration reports
contain no key material: `CONFIGURED_NOT_QUALIFIED` is configuration shape, not a
crypto/provider/live qualification. `storage` describes the still-unqualified
Asset/catalog port, not merely the existence of an S3 engine. Runtime `core`
always remains `NOT_QUALIFIED`; this CLI does not import qualification reports.
Actual qualification evidence is recorded separately from these configuration checks.

The installation operator has the existing platform viewer, with no inferred
Tenant/Business ownership. The Business/PM success path uses an ordinary account,
profile completion and its actual self-provisioning OWNER membership. Signup
alone still grants no scope or platform authority. Compact does not change these
authorization rules.

For the separate core acceptance, supply `COMPACT_CORE_IMAGE_FILE`: a private JSON
map of exact locally loaded `web`, `tools`, `postgres`, `storage` digest references.
The first two are built from the selected Server source; PostgreSQL uses the
fixture's pinned image, and storage uses the reviewed existing TEST MinIO fixture.
No image is guessed, pulled or published by the test harness. Optional
`COMPACT_CORE_EVIDENCE_DIRECTORY` selects an existing private evidence directory.

```sh
npm run test:compact:core
```

This profile has its own owned ports/DB/volumes and certificate-pinned loopback
HTTPS browser. Its short-lived certificate changes no host trust store. Real
browser sessions perform operator login, signup without grants, Business/PM CRUD,
cross-Business refusals, seven execution views and restart persistence. Provider
checks cover versioning, conditional writes and exact-version read/erase only;
Asset/catalog integration has its separate Task4 provider profile below. Traces/screenshots/video are disabled
to keep login material out of artifacts. The default E2E profile excludes this
explicit fixture; no existing `:3100` stack or seed is used. A local TEST candidate
pass is separate from exact-release, Linux-host, LINE/Knowledge and production
qualification.

### Private Asset/catalog storage (Task4)

Existing factory exports and the `supabase` default remain compatible. Explicitly
select `ZURI_ASSET_STORAGE_PROVIDER=s3` and/or
`ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER=s3` in the private app environment to use
the S3 bridge. For each selected purpose, supply the following outside the release:

| Purpose | Configuration keys |
|---|---|
| Asset | `ZURI_ASSET_EVIDENCE_BUCKET`, `ZURI_ASSET_STORAGE_ENDPOINT`, `ZURI_ASSET_STORAGE_ACCESS_KEY`, `ZURI_ASSET_STORAGE_SECRET_KEY`, optional `ZURI_ASSET_STORAGE_REGION` |
| Catalog | `ZURI_KNOWLEDGE_CATALOG_BUCKET`, `ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT`, `ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY`, `ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY`, optional `ZURI_KNOWLEDGE_CATALOG_STORAGE_REGION` |

Buckets must be distinct from one another and the configured Knowledge bucket.
Enable versioning before use. Provision separate service credentials restricted
to each bucket's `asset-evidence/*` or `business-catalog/*` namespace. The TEST
provider required PutObject, GetObject, GetObjectVersion, DeleteObject and
DeleteObjectVersion; the app never administers users, buckets or policies.
Use credentials authorized for your selected provider; no root credential is
needed by the application. Explicit catalog selection takes precedence over the
older Knowledge-private writer; unselected compatibility behavior is preserved.

New `s3-business://` refs bind purpose, bucket, scoped key and immutable version.
They contain no endpoint or credential. FileAsset reads authorize current Business
visibility first and then check the stored Business/Tenant against the ref. Lost
versions, wrong scope, configuration and unknown refs fail closed without cloud
fallback. A failed metadata write attempts exact-version cleanup and never
reports success. Cleanup failure still needs operational reconciliation; the
existing service does not pretend that bytes and the DB share a transaction.
Selecting S3 does not migrate existing hosted objects or refs; fresh-only Compact
does not authorize a provider migration. Keep compatible hosted configuration for
existing hosted installations unless a separate migration is approved.

`npm run test:compact:storage` runs an owned local MinIO fixture and an isolated
application database. It does not use main-dev/UAT, a live extractor or existing
provider credentials. The provider image is an explicit cached TEST identity;
foreign-bucket credentials and exact-version loss are checked. The general CLI
diagnostic still reports storage unavailable: it does not qualify/import this
provider report or inspect these new business-port settings. Production provider,
license, complete backup/restore and exact release qualification remain separate.

### PostgreSQL reported Marketing (Task5)

The receiver keeps its dedicated report principal and revision1 wire contract.
An ambient PostgreSQL URL does not enable it. For a selected fresh Compact TEST
target only, set `ZURI_MARKETING_REPORT_DATABASE_PROVIDER=postgresql` in the private
app environment; the canonical app client must already select that target. An
unknown provider, absent client, unselected PG or generated-client provider
mismatch remains unavailable. The bounded SQLite default and DB-only wrapper are
retained. No existing Supabase mirror or runtime role is enabled by this setting.

New Compact baselines include the issued custody/audit/native-scope guards and
narrow server runtime grants: Policy/Binding SELECT+INSERT+UPDATE, ExternalReport
SELECT+INSERT. No report update/delete, API/public access, runtime owner/BYPASSRLS
or direct guard-function execution is granted. The issued migration is unchanged
and is never replayed as installation history. Trigger definitions/enable state
join the installed catalog fingerprint, so disabled custody guards refuse retry.

Receiver and operator mutations lock Policy before Binding and reread authority.
Absent policy creation uses a transaction advisory lock. Intake additionally locks
Business → hinted Plan → Initiative and rereads target scope; a changed Plan hint
retries the full order. SQLite retains its first-write writer lock. Both pool wait
and transaction execution fit the bounded retry budget; no receipt escapes an
aborted or failed outer commit. Provisioning/enabling real Businesses and handing
over persistent credentials remain separately authorized operations.

`npm run test:postgres -- tests/postgres/marketing-report-native.test.js` exercises
the actual owned TEST PostgreSQL runtime role, separate from existing stacks.
`node scripts/run-marketing-report-native.mjs` preserves the explicit historical
SQLite native fixture using its matching pinned private client, generated under
ignored app `.local`; it does not replace the shared Prisma client or certify all
current SQLite models. Both runners reject zero-test success. Paired Go cases need
their separately selected counterpart and remain skipped when absent; no live
Marketing transfer or production operation is part of this qualification.

### Optional profile prerequisites (Task6 preparation)

Keep the core qualification lane separate from optional AI profiles. The package
producer/loader require the reviewed stdio KI17 tuple and all five pinned E5
model files for selected Knowledge. They verify actual payload hashes; a model
descriptor alone cannot create a usable release. The runtime never downloads a
model or searches sibling repositories. New model/tuple support needs review.

`diagnostics` now includes non-authoritative profile prerequisites and read-only
cohort observations when LINE/Knowledge is selected. `CONFIGURATION_PRESENT`
means only that the listed selectors/key/token are present. It never establishes
Business authority, native model/runtime health, bootstrap, queue recovery or AI
acceptance. Secrets and their fingerprints are omitted. Selected profiles stay
`NOT_QUALIFIED`; unselected profiles stay `NOT_SELECTED`.

After an independently authorized web recreation, the dependent cohort must be
recreated: Genesis uses the current web container's network namespace. Stop the
dependent workers, recreate the selected web image, then force-recreate the
selected workers against that web. Retain the labelled native/shared state
volumes and the read-only packaged model mount. Re-run diagnostics and the actual
selected-profile acceptance before resuming work. The CLI only inspects this
cohort; it does not perform this recreation or drain pending jobs. Existing queue
lease/replay contracts still own draining; a cohort observation is not a receipt
for no duplicate sends. Live LINE remains separately authorized test-account UAT.

`npm run test:compact:profiles` explicitly selects an owned disposable Docker
namespace/state probe. It uses inert processes and synthetic bytes, not real AI
or a sender. It must not be counted as KI17, native Stage9+ recovery, object/DB
restore, source authorization or current release-image acceptance. The normal
Server suite excludes that Docker-dependent file; its dedicated wrapped runner
fails zero-test runs. Actual selected AI gates remain open in the approved plan.

CI packaging is manual-only and consumes an explicitly selected prepared input
artifact from this repository. It checks the manifest revision against the
workflow commit and checks that the artifact originated in a successful completed
run of this repository at that commit (including the head repository). The
explicit artifact/run IDs remain operator-selected; this does not certify the
producer's qualification claims or content review. It uploads a package candidate,
without publication/deployment. Origin API errors fail closed with a fixed code.
Prepared-input producers must preserve the required `docs/.doc-graph.json` hidden
file. Candidate upload explicitly includes hidden files from the validated output
directory so the graph and hash inventory stay together; it never uploads the
prepared source directory or an ambient checkout.
Without supplied exact inputs/evidence the job fails; there is no fake sample
release or fallback image/provider. Current automatic build/PR jobs remain active.

### Exact artifact core matrix and bounded recovery (Task7)

Core/recovery acceptance requires `COMPACT_PACKAGE_DIRECTORY` selecting an
already hashed package, and `COMPACT_CORE_IMAGE_FILE` containing exactly its
`web`, `tools`, `postgres`, `storage` pinned references. It never produces its own
acceptance artifact from a dirty checkout. The manifest source revision must
match the current test checkout; actual web/tools image source labels and
platforms must match. The harness binds manifest, inventory, CLI and baseline
hashes. `ARTIFACT_INSPECTED_NOT_QUALIFIED` is inspection only.

Use `npm run test:compact:core` with an existing private
`COMPACT_CORE_EVIDENCE_DIRECTORY`. It drives real HTTPS login/signup, Business/PM
flows, all seven views, cross-Business denial, restart, app recreation and safe
installed retry. It selects free loopback ports and a pinned ephemeral certificate;
it never uses the primary preview. Evidence records post-flow CPU/RAM, logical
image size, package size and owned-volume byte samples. These are neither peak
load measurements nor a minimum hardware recommendation.

For the selected TEST provider, `npm run test:compact:provider` takes a private
`COMPACT_PROVIDER_INPUT_FILE` JSON `{image,command}` and exclusive
`COMPACT_PROVIDER_EVIDENCE_FILE`. It runs real versioning, conditional write,
version-pinned read and exact erase while preserving the replacement version.
Provider evidence is valid only for that image/platform/command. TEST license
review does not establish production license or distribution permission.

`npm run test:compact:recovery` additionally requires an existing private
`COMPACT_RECOVERY_PRIVATE_DIRECTORY`. It creates two distinct owned targets from
the same artifact. Synthetic portable DB rows and actual Asset/catalog bytes are
backed up there before deleting only the source fixture. The destination retains
its own installation marker, roles, catalog and physical DB identity. Unknown
nonempty security families refuse transfer. Protected Marketing report rows stay
append-only after restoration. This is not the legacy snapshot importer.

SEC-030/FR-223/ADR-089 prohibit exporting envelope ciphertext or the KEK. This
harness tests missing/wrong KEK refusal only on the source, excludes the envelope
table from transfer, and invokes credential re-entry on destination metadata.
Never copy a source key/ciphertext into a backup or destination. Credentials must
be re-entered under the existing authority contract before use.

The object probe demonstrates missing-version refusal, exact recovered bytes,
current authorization and a clearly TEST-only FileAsset ref remap with preserved
scope/version/audit. There is no supported managed-blob operator restore/rebind
operation; operator recovery remains `NOT_QUALIFIED`. Keep the private backup
files for inspection. Never upload SQL, object backups, keys, env or traces as CI
evidence. A second volume or private file on this host does not establish an
off-host backup failure domain. Physical/off-host recovery remains unqualified.

Cleanup verifies all target/project/TEST labels before each deletion and continues
attempting other independently owned resources after a refusal. Missing labels or
an unavailable daemon produce `cleanup: FAIL`; preserve the refused resource for
inspection. No global prune is used. Run the disposable Docker harnesses serially on one
daemon: free-subnet discovery is an observation, not a reservation. Concurrent
fixture requests may be refused safely; do not treat a retry-only pass as green.
Failed initialization must roll back; retry
cannot repair partial, foreign, existing-data or drifted targets. Keep the first
failure. App rollback may reuse only compatible persistent data and cannot reverse
schema changes; existing-data upgrade is outside fresh-only v1.

The manual image workflow offers `compact_qualify_core` together with
`compact_package`. The dependent job consumes only that run's packaged candidate,
checks exact source/core/OCI hashes before image import, uses a job-local
containerd image store, then runs core and bounded recovery. It uploads only
sanitized observation JSON. See the official [Docker job-local image-store
example](https://docs.docker.com/build/ci/github-actions/multi-platform/).
No registry login, publication, deploy or production environment is used.
Workflow code and local fixtures do not prove a hosted run: exact-head hosted CI,
provider/legal review, supported operator recovery, physical backup recovery and
release approval remain separate gates. Unselected AI profiles remain unqualified.
