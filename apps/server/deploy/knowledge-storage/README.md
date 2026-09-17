# TASK-ZAI-049 knowledge storage target

This directory contains the **deployment contract**, not a production receipt.
`target.json.example` is deliberately `PENDING`: the repository does not know the
production host, volume, image digest, Business scope, key custody or backup host.
Those values must be filled in an operator-owned copy after review.

## Primary endpoint overlay

1. Copy `storage-admin.env.example` to an absolute path outside the checkout and
   fill the provider-admin values documented by the pinned image. Keep this file
   separate from the application access key and never commit it.
2. Set these private `.env` values on the host:

   ```text
   COMPOSE_FILE=docker-compose.yml;docker-compose.knowledge-storage.yml
   COMPOSE_PROFILES=knowledge-storage
   ZURI_KNOWLEDGE_STORAGE_IMAGE=<approved-provider-image>@sha256:<digest>
   ZURI_KNOWLEDGE_STORAGE_DATA_DIR_HOST=<dedicated-primary-data-path>
   ZURI_KNOWLEDGE_STORAGE_ADMIN_ENV_FILE_HOST=<absolute-admin-env-path>
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
first read-only check on the deployment host; no command was run from this
checkout because Docker is unavailable here.

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
