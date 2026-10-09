<!-- @spec ADR-107 - standalone FilePort setup, operation and evidence boundary. -->
# File Management service

This process owns file records, immutable version receipts, object mappings and original-byte reads. It does not import the web app, Prisma, Knowledge, CRM, LINE webhook, Pipeline, Work Management, Conversation Runtime, Edge, MSP or GKS code.

## Local commands

Run `npm ci`, then `npm test` and `npm run check` from this directory. Apply schema changes with `npm run migrate` using a dedicated `FILE_MIGRATION_DATABASE_URL`. The runtime process uses `FILE_DATABASE_URL`, which must be the restricted `zuri_file_runtime` role. After DBA role provisioning and migration, apply `runtime-role-grants.sql`; the runtime can update only the current pointer and operation receipt, and can only select/insert versions, audit events and `FILE_VERSION_READY` outbox events. The outbox row is committed with the file version; a dispatcher/consumer integration is a later tranche. Migrations are append-only and checksum-verified.

`compose.yml` builds this directory alone and does not start or mount MinIO. MinIO/S3, PostgreSQL and the authority endpoint must be supplied separately. `.env.example` contains placeholders only. Do not copy production credentials or protected storage data into this directory.

## FilePort v1

The contract is in `contracts/file-port.v1.schema.json`. Uploads are raw bytes with declared size, SHA-256, file name and provenance headers. `X-Operation-Id` stays stable across a retry, `X-Correlation-Id` traces the request chain, and `X-Deadline` bounds its remaining work. The caller repeats the same `Idempotency-Key` after an uncertain response. A retry first resolves the deterministic operation object and cannot silently create a second version. The service bounds upload size, concurrent requests and total body duration (`FILE_UPLOAD_TIMEOUT_MS`). Content reads always include a recorded provider version ID and re-check byte length and SHA-256 while streaming.

The caller provides a requested tenant/business pair, but the authority adapter must independently derive the actor and current permissions from the bearer token. System provenance (`LINE_CAPTURE`, `GIT_SNAPSHOT`, `KNOWLEDGE_EXPORT`, and `API_IMPORT`) requires a separate source-specific authority permission; a normal Business upload cannot label itself as a trusted provider capture or canonical snapshot. An unavailable or malformed authority response fails closed. Until the owning authority service implements and verifies `authority-authorization.v1.schema.json`, readiness stays false and protected calls are unavailable.

New bytes are immediately retrievable as an attachment with `UNSCANNED` safety status. Provider object keys remain internal and are omitted from HTTP metadata responses. No inline rendering, Knowledge admission, LINE fetch, SOT publication, deletion, retention purge, or cross-domain reference is implied by `STORED`.

## Provider evidence boundary

The implementation pins AWS SDK for JavaScript v3 `@aws-sdk/client-s3` 3.1136.0 and `pg` 8.23.0. Each operation and immutable version pins the S3-compatible protocol, a required non-secret `FILE_STORAGE_BINDING_ID`, bucket, key and version ID. The binding ID must remain stable for the same provider instance and bucket; changing provider instances requires a new ID, which prevents a retry or read from silently resolving against a same-named bucket elsewhere. The S3 adapter requires bucket versioning, uses conditional `If-None-Match: *` writes, preserves the returned version ID, and requests that exact version on read. AWS documents conditional `PutObject` and `VersionId` retrieval; MinIO documents bucket versioning and lists `If-None-Match` support in its S3 API compatibility table. The production MinIO server version/configuration and real bucket state have not been verified; provider conformance remains `NOT_RUN` until tested against the declared disposable endpoint.

Provider references reviewed 2026-09-24: [MinIO S3 API compatibility](https://docs.min.io/aistor/developers/s3-api-compatibility/), [MinIO object versioning](https://min.io/docs/minio/kubernetes/upstream/administration/object-management/object-versioning.html), [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), and [AWS GetObject versionId](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

LINE capture provenance carries the stable channel binding, provider message ID, attachment ordinal and content-provider type to authority and into immutable version metadata. Files does not verify webhook signatures or fetch provider media; the LINE and Integration owner remains responsible for that acquisition boundary.
