# FR-045 W1 task brief — additive schema

## Role

Schema lane owner. Use TDD and touch only the files below.

## Exclusive write scope

- `prisma/schema.prisma`
- generated `prisma/schema.postgres.prisma`
- one new additive migration directory for FR-045
- `tests/unit/fr045-schema-contract.test.js`
- `docs/.rwang-tasks/fr045-w1-report.md`

## Contract

Add, without removing or changing `ProjectFile`:

- `LocalWorkspaceMount`: UUID id, tenantId, businessId, deviceKey, rootPath,
  status, lastScanAt?, version, createdAt, updatedAt; one Business/device mapping.
- `FileAsset`: UUID id, unique human code, tenantId, businessId, projectId?,
  workItemId?, storageKind, relativePath?, externalUrl?, blobRef?, name, mime,
  size, sha256?, status, version, uploadedBy?, createdAt, updatedAt, deletedAt?.
- `FileLink`: UUID id, fileId, entityType, entityId, relationType, timestamps;
  unique file/entity/relation tuple and lookup index.

Add required inverse relations. Use strings for statuses/storage kinds. Regenerate
Postgres schema from the canonical SQLite schema. Migration is additive only; no
backfill or drop is part of W1.

## TDD / exit

RED schema contract test first. GREEN only after models, indexes, relations and
provider parity exist. Run focused test, Prisma validate for both schemas and
`npm run db:pg:schema`. Do not touch services, APIs, UI or external filesystem.
