# Compact package contract (Task1)

This is build-time packaging under ADR-115. It is not an installer, a runnable
release qualification, permission to publish, or production activation. Tasks2–7
still own installation, schema parity, business-flow and runtime qualification.
The template in this directory must be rendered by the packager; do not run it.

`compact:package` consumes a prepared `release-manifest.json`. All non-generated
payload paths resolve under that file's directory, never an ambient checkout.
Supply canonical docs, their generated graph, canonical registry and every record
it references; reviewed baseline SQL, storage/license evidence and any selected
Knowledge pins/model bytes. The baseline is hashed, never executed. A graph or
reference metadata alone does not recover object/native-store bytes.

Images use `repository@sha256:<64 lowercase hex>` references. Core requires
web/tools/postgres/storage only. LINE reuses the web image; Knowledge additionally
requires the worker, pinned MSP/GKS/Genesis identities and exact model files.
Public ingress requires a separate pinned ngrok image. The first image platform
is linux/amd64; Windows Docker Desktop host and real package acceptance are later
qualifications. No GPU pool is required.

The strict JSON schema is `release-manifest.schema.json`; the validator adds
portable path/case-collision and selected-profile/hash-reference invariants.
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
// Compute the four generated root file hashes from this exact packager version:
const rootFiles = await renderCompactRuntimeFiles(manifest)
// Put their SHA256 values into manifest.files, then save the prepared manifest.
await packageCompactRelease({ manifest: preparedManifestFilename, outputDirectory: newDirectory })
```

Generated roots are `compose.yml`, `env.example`, `README.md` and this JSON schema.
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
`tools` profile deliberately fails closed until Task2. Selected AI services are
rendered only when requested; no unselected image/environment interpolation is
required. Database/object-store ports are not public. Separate credentials and
future baseline/runtime-role setup remain mandatory; Task1 does not configure
them. Never point package tests at existing main-dev/UAT/production volumes.

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
