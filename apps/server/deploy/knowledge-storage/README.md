# TASK-ZAI-049 knowledge storage target

This directory contains the **deployment contract**, not a production receipt.
`target.json.example` is deliberately `PENDING`: the repository does not know the
production host, volume, image digest, Business scope, key custody or backup host.
Those values must be filled in an operator-owned copy after review.

The local Docker engine currently has the AIStor candidate image pulled as
`quay.io/minio/aistor/minio@sha256:afcfb54652c40c973012da19f924ebd591d7115d74ea5b75bcb6dc7edaf06c04`
(`RELEASE.2026-09-07T08-39-31Z`). This is an image-provenance observation, not a
production approval or a license receipt.

## Primary endpoint overlay

1. Copy `storage-admin.env.example` to an absolute path outside the checkout and
   fill the provider-admin values documented by the pinned image. Obtain the
   provider license separately and keep both files outside the checkout. AIStor
   requires an active license for production; the license file is not a secret
   to paste into `.env` or a commit.
2. Set these private `.env` values on the host:

   ```text
   COMPOSE_FILE=docker-compose.yml;docker-compose.knowledge-storage.yml
   COMPOSE_PROFILES=knowledge-storage
   ZURI_KNOWLEDGE_STORAGE_IMAGE=<approved-provider-image>@sha256:<digest>
   ZURI_KNOWLEDGE_STORAGE_DATA_DIR_HOST=<dedicated-primary-data-path>
   ZURI_KNOWLEDGE_STORAGE_ADMIN_ENV_FILE_HOST=<absolute-admin-env-path>
   ZURI_KNOWLEDGE_STORAGE_LICENSE_FILE_HOST=<absolute-license-file-path>
   ```

3. Fill the TASK-ZAI-049 section in `.env.knowledge`. For an isolated local
   profile the endpoint can be `http://knowledge-storage:9000`; production must
   use a private HTTPS origin and a least-privilege application credential. The
   base stack already passes `.env.knowledge` to `web` when it is present.
4. Keep the object API and admin console private. The overlay uses `expose`, not
   `ports`, and must never be added to the ngrok public path.

The overlay has no default image or host path. Do not start it until the target
manifest is `READY`, the provider capability/licence probe is recorded, and the
primary volume has a capacity and recovery receipt. `docker compose config` is the
first read-only check on the deployment host. Docker is installed on this machine
and the candidate AIStor image is pulled. Its disposable `minio --version` smoke
check passed, but its container remains stopped because no license file was found
in the standard local secret paths. Keep the production target `PENDING` until an
operator supplies the license outside the checkout.

## Local Community source smoke profile

The official Community source path was exercised separately for local testing:
`go install github.com/minio/minio@latest` resolved to source commit
`7aac2a2c5b7c` and produced a `DEVELOPMENT.GOGET` Linux binary with Go 1.24.13.
It runs in the local image `zuri-minio-community:source-7aac2a2c5b7c` as
`zuri-minio-community-local`, with API `127.0.0.1:19000`, console
`127.0.0.1:19001`, and named data volume `zuri-minio-community-local-data`.
The endpoint is loopback-only and is not wired into `.env.knowledge`, the web
container, ngrok, or the production target. The Community repository is archived;
this profile is smoke-test evidence only and does not replace the AIStor production
candidate or provide a production support/SLA claim.

## Backup target

`backup-target.env.example` names the separate target contract. A second bucket or
container on this host is not a disaster-recovery copy. The backup target must have
its own credential, location identity and retention, and the operator must record
the measured RPO/RTO and a clean-restore receipt. The current TASK-ZAI-049 branch
does not include an object-copy runner, so filling this file alone must not be
reported as a completed backup or production activation. Keep the target manifest
`PENDING` until that runner and the separate-host restore evidence exist.

Runtime admission remains separately gated by TASK-ZAI-050; creating this endpoint
does not make the `/files` page populate or activate the seventeen-stage pipeline.
