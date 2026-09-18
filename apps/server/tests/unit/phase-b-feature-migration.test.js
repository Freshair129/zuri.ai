import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest 2's Vite resolver strips the node: prefix from static imports. Keep
// this native module lookup at runtime, matching the repository's migration
// test convention.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

// @req FR-252 — the six Phase B authority records have one additive SQLite
// migration and one matching provider migration with bounded fields, ordinary
// parent FKs, unconditional tombstone keys and a reviewed RLS/grant boundary.
// @spec ADR-097; docs/architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md
// @tested tests/unit/phase-b-feature-migration.test.js

const root = process.cwd()
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8')
const postgresSchema = readFileSync(resolve(root, 'prisma/schema.postgres.prisma'), 'utf8')
const sqliteMigration = readFileSync(
  resolve(root, 'prisma/migrations/20260917041000_add_phase_b_feature_authority/migration.sql'),
  'utf8',
)
const postgresMigration = readFileSync(
  resolve(root, 'supabase/migrations/20260917041000_add_phase_b_feature_authority.sql'),
  'utf8',
)

const records = [
  'GovernanceSnapshot',
  'ProjectFeature',
  'FeatureContribution',
  'FeatureWorkLink',
  'RequirementBinding',
  'ProjectFeatureMutationReceipt',
]

const ids = {
  tenant: '11111111-1111-4111-8111-111111111111',
  business: '22222222-2222-4222-8222-222222222222',
  otherTenant: '33333333-3333-4333-8333-333333333333',
  otherBusiness: '44444444-4444-4444-8444-444444444444',
  workspace: '55555555-5555-4555-8555-555555555555',
  otherWorkspace: '66666666-6666-4666-8666-666666666666',
  project: '77777777-7777-4777-8777-777777777777',
  otherProject: '88888888-8888-4888-8888-888888888888',
  workstream: '99999999-9999-4999-8999-999999999999',
  workItem: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repository: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  otherRepository: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  projectRepository: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  otherProjectRepository: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  audit: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  snapshot: '10101010-1010-4010-8010-101010101010',
  otherSnapshot: '12121212-1212-4212-8212-121212121212',
  feature: '13131313-1313-4313-8313-131313131313',
  featureTwo: '14141414-1414-4414-8414-141414141414',
  contribution: '15151515-1515-4515-8515-151515151515',
  workLink: '16161616-1616-4616-8616-161616161616',
  binding: '17171717-1717-4717-8717-171717171717',
  receipt: '18181818-1818-4818-8818-181818181818',
  principal: '19191919-1919-4919-8919-191919191919',
  utf8Snapshot: '27272727-2727-4727-8727-272727272727',
}

const sha = 'a'.repeat(64)
const commitSha = 'b'.repeat(40)
const now = '2026-09-17 00:00:00'

function createBaseTables(db) {
  db.exec(`
    CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Workspace" (
      "id" TEXT PRIMARY KEY, "scopeType" TEXT, "portfolioId" TEXT,
      "tenantId" TEXT, "businessId" TEXT
    );
    CREATE TABLE "Project" (
      "id" TEXT PRIMARY KEY, "workspaceId" TEXT, "businessId" TEXT,
      "deletedAt" DATETIME
    );
    CREATE TABLE "Repository" ("id" TEXT PRIMARY KEY, "businessId" TEXT);
    CREATE TABLE "ProjectRepository" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT, "repoId" TEXT
    );
    CREATE TABLE "Workstream" (
      "id" TEXT PRIMARY KEY, "projectId" TEXT, "deletedAt" DATETIME
    );
    CREATE TABLE "WorkContainer" (
      "id" TEXT PRIMARY KEY, "workstreamId" TEXT
    );
    CREATE TABLE "WorkItem" (
      "id" TEXT PRIMARY KEY, "workstreamId" TEXT, "containerId" TEXT,
      "deletedAt" DATETIME
    );
    CREATE TABLE "AuditEvent" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT, "businessId" TEXT
    );
  `)
  db.prepare('INSERT INTO "Tenant" ("id") VALUES (?)').run(ids.tenant)
  db.prepare('INSERT INTO "Tenant" ("id") VALUES (?)').run(ids.otherTenant)
  db.prepare('INSERT INTO "Business" ("id") VALUES (?)').run(ids.business)
  db.prepare('INSERT INTO "Business" ("id") VALUES (?)').run(ids.otherBusiness)
  db.prepare('INSERT INTO "Workspace" ("id","scopeType","tenantId","businessId") VALUES (?,?,?,?)')
    .run(ids.workspace, 'BUSINESS', ids.tenant, ids.business)
  db.prepare('INSERT INTO "Workspace" ("id","scopeType","tenantId","businessId") VALUES (?,?,?,?)')
    .run(ids.otherWorkspace, 'BUSINESS', ids.otherTenant, ids.otherBusiness)
  db.prepare('INSERT INTO "Project" ("id","workspaceId","businessId") VALUES (?,?,?)')
    .run(ids.project, ids.workspace, ids.business)
  db.prepare('INSERT INTO "Project" ("id","workspaceId","businessId") VALUES (?,?,?)')
    .run(ids.otherProject, ids.otherWorkspace, ids.otherBusiness)
  db.prepare('INSERT INTO "Repository" ("id","businessId") VALUES (?,?)')
    .run(ids.repository, ids.business)
  db.prepare('INSERT INTO "Repository" ("id","businessId") VALUES (?,?)')
    .run(ids.otherRepository, ids.otherBusiness)
  db.prepare('INSERT INTO "ProjectRepository" ("id","projectId","repoId") VALUES (?,?,?)')
    .run(ids.projectRepository, ids.project, ids.repository)
  db.prepare('INSERT INTO "ProjectRepository" ("id","projectId","repoId") VALUES (?,?,?)')
    .run(ids.otherProjectRepository, ids.otherProject, ids.otherRepository)
  db.prepare('INSERT INTO "Workstream" ("id","projectId") VALUES (?,?)')
    .run(ids.workstream, ids.project)
  db.prepare('INSERT INTO "WorkItem" ("id","workstreamId") VALUES (?,?)')
    .run(ids.workItem, ids.workstream)
  db.prepare('INSERT INTO "AuditEvent" ("id","tenantId","businessId") VALUES (?,?,?)')
    .run(ids.audit, ids.tenant, ids.business)
}

function makeSnapshotInsert(
  db,
  id,
  tenantId = ids.tenant,
  businessId = ids.business,
  repositoryId = ids.repository,
  projectRepositoryId = ids.projectRepository,
  snapshotCommitSha = commitSha,
  snapshotManifestHash = sha,
  sourceManifest = '{}',
) {
  db.prepare(`
    INSERT INTO "GovernanceSnapshot" (
      "id","tenantId","businessId","repositoryId","projectRepositoryId",
      "checkoutBindingId","commitSha","manifestHash","capturedAt","verifiedAt",
      "verifierId","verifierVersion","proofId","verificationProof",
      "validationStatus","sourceManifest"
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, tenantId, businessId, repositoryId, projectRepositoryId,
    'checkout-binding-1', snapshotCommitSha, snapshotManifestHash, now, now, 'local-git-verifier',
    '1.0.0', ids.principal, '{}', 'VALID', sourceManifest,
  )
}

function makeFeatureInsert(db, id, code, snapshotId = null, canonicalFeatureKey = null) {
  db.prepare(`
    INSERT INTO "ProjectFeature" (
      "id","tenantId","businessId","projectId","code","title","problem",
      "outcome","primaryDomainId","canonicalFeatureKey","governanceSnapshotId",
      "lifecycle","updatedAt"
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, ids.tenant, ids.business, ids.project, code, 'Feature title', 'Problem',
    'Outcome', 'DOM-SCM', canonicalFeatureKey, snapshotId, 'ACTIVE', now,
  )
}

function expectSqlFailure(operation) {
  expect(operation).toThrow()
}

describe('Phase B Feature authority migrations', () => {
  it('keeps the Prisma/provider models and migration twins aligned to six records', () => {
    for (const name of records) {
      expect(schema).toMatch(new RegExp(`model ${name} \\{`))
      expect(postgresSchema).toMatch(new RegExp(`model ${name} \\{`))
      expect(sqliteMigration).toContain(`CREATE TABLE "${name}"`)
      expect(postgresMigration).toContain(`CREATE TABLE IF NOT EXISTS "${name}"`)
    }

    expect(schema).toContain('verificationProof    String')
    expect(schema).toContain('sourceManifest       String')
    expect(schema).toContain('resourceId      String')
    expect(schema).not.toContain('graphAllocationState')
    expect(schema).not.toContain('WorkContainer.deletedAt')

    expect(postgresMigration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(6)
    expect(postgresMigration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(6)
    expect(postgresMigration).toContain('REVOKE ALL ON TABLE')
    expect(postgresMigration).toContain('FROM public, anon, authenticated, service_role')
    expect(postgresMigration).toContain('GRANT SELECT, INSERT ON TABLE')
    expect(postgresMigration).not.toMatch(/GRANT[^;]*service_role/i)
    expect(postgresMigration).not.toMatch(/CREATE ROLE|ALTER DEFAULT PRIVILEGES/i)
    expect(postgresMigration).not.toMatch(/USING \(true\)|WITH CHECK \(true\)/i)
    expect(postgresMigration).not.toMatch(/\bP_(?:PF|FC|FWL|RB|GS|RECEIPT)\b/)
    for (const indexMap of [
      'GovernanceSnapshot_business_repository_capturedAt_idx',
      'ProjectFeature_business_project_lifecycle_idx',
      'FeatureContribution_business_domain_idx',
      'FeatureWorkLink_business_work_item_idx',
      'RequirementBinding_business_requirement_idx',
    ]) {
      expect(schema).toContain(`map: "${indexMap}"`)
      expect(postgresSchema).toContain(`map: "${indexMap}"`)
      expect(sqliteMigration).toContain(`"${indexMap}"`)
    }
    expect(sqliteMigration).toContain('length(CAST("sourceManifest" AS BLOB)) BETWEEN 1 AND 1048576')
    expect(sqliteMigration).toContain('length(replace("id", \'-\', \'\')) = 32')
    expect(sqliteMigration.match(/typeof\("version"\) = 'integer'/g)).toHaveLength(5)
    expect(sqliteMigration).toContain('typeof("allocationBps") = \'integer\'')
  })

  it('applies the SQLite migration and enforces bounds, pair checks, FKs and replay keys', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys=ON;')
      createBaseTables(db)
      db.exec(sqliteMigration)

      const tableNames = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (${records.map(() => '?').join(',')})
        ORDER BY name
      `).all(...records).map((row) => row.name)
      expect(tableNames).toEqual([...records].sort())

      for (const name of records) {
        const fks = db.prepare(`PRAGMA foreign_key_list("${name}")`).all()
        expect(fks.length).toBeGreaterThan(0)
      }

      makeSnapshotInsert(db, ids.snapshot)
      makeSnapshotInsert(db, ids.otherSnapshot, ids.otherTenant, ids.otherBusiness, ids.otherRepository, ids.otherProjectRepository)
      expectSqlFailure(() => makeSnapshotInsert(
        db,
        ids.utf8Snapshot,
        ids.tenant,
        ids.business,
        ids.repository,
        ids.projectRepository,
        'c'.repeat(40),
        'd'.repeat(64),
        'é'.repeat(600_000),
      ))
      expect(db.prepare('SELECT "validationStatus" FROM "GovernanceSnapshot" WHERE "id" = ?').get(ids.snapshot).validationStatus)
        .toBe('VALID')

      makeFeatureInsert(db, ids.feature, 'PF-001')
      makeFeatureInsert(db, ids.featureTwo, 'PF-002', ids.snapshot, 'CANONICAL-001')
      expect(db.prepare('SELECT COUNT(*) AS count FROM "ProjectFeature"').get().count).toBe(2)

      expectSqlFailure(() => makeFeatureInsert(db, '20202020-2020-4020-8020-202020202020', 'PF-BAD', ids.snapshot, null))
      expectSqlFailure(() => makeFeatureInsert(db, '20202020-2020-4020-8020-2020-2020202', 'PF-UUID-BAD'))
      expectSqlFailure(() => db.prepare(`
        INSERT INTO "ProjectFeature" (
          "id","tenantId","businessId","projectId","code","title","problem","outcome",
          "primaryDomainId","lifecycle","updatedAt","deletedAt"
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        '21212121-2121-4121-8121-212121212121', ids.tenant, ids.business, ids.project,
        'PF-003', 'Title', 'Problem', 'Outcome', 'DOM-CRM', 'DRAFT', now, now,
      ))
      expectSqlFailure(() => db.prepare(`
        INSERT INTO "GovernanceSnapshot" (
          "id","tenantId","businessId","repositoryId","projectRepositoryId","checkoutBindingId",
          "commitSha","manifestHash","capturedAt","verifiedAt","verifierId","verifierVersion",
          "proofId","verificationProof","validationStatus","sourceManifest"
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        '23232323-2323-4323-8323-232323232323', ids.tenant, ids.business, ids.repository,
        ids.projectRepository, 'binding', 'c'.repeat(40), 'd'.repeat(64), now, now, 'verifier', '1', ids.principal,
        '{}', 'INVALID', '{}',
      ))
      expectSqlFailure(() => db.prepare('INSERT INTO "FeatureWorkLink" ("id","tenantId","businessId","featureId","workItemId","allocationBps","updatedAt") VALUES (?,?,?,?,?,?,?)')
        .run('24242424-2424-4424-8424-242424242424', ids.tenant, ids.business, ids.feature, ids.workItem, 10001, now))
      expectSqlFailure(() => db.prepare('INSERT INTO "FeatureWorkLink" ("id","tenantId","businessId","featureId","workItemId","allocationBps","updatedAt") VALUES (?,?,?,?,?,?,?)')
        .run('28282828-2828-4828-8828-282828282828', ids.tenant, ids.business, ids.feature, ids.workItem, 1.5, now))
      expectSqlFailure(() => db.prepare('INSERT INTO "FeatureWorkLink" ("id","tenantId","businessId","featureId","workItemId","allocationBps","updatedAt","version") VALUES (?,?,?,?,?,?,?,?)')
        .run('29292929-2929-4929-8929-292929292929', ids.tenant, ids.business, ids.feature, ids.workItem, 1, now, 1.5))
      expectSqlFailure(() => db.prepare('INSERT INTO "ProjectFeature" ("id","tenantId","businessId","projectId","code","title","problem","outcome","primaryDomainId","lifecycle","updatedAt","version") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('30303030-3030-4030-8030-303030303030', ids.tenant, ids.business, ids.project, 'PF-VERSION-FRACTION', 'Title', 'Problem', 'Outcome', 'DOM-SCM', 'DRAFT', now, 1.5))

      db.prepare('INSERT INTO "FeatureContribution" ("id","tenantId","businessId","featureId","domainId","responsibility","updatedAt") VALUES (?,?,?,?,?,?,?)')
        .run(ids.contribution, ids.tenant, ids.business, ids.feature, 'DOM-CRM', 'Support CRM', now)
      db.prepare('INSERT INTO "FeatureWorkLink" ("id","tenantId","businessId","featureId","workItemId","allocationBps","updatedAt") VALUES (?,?,?,?,?,?,?)')
        .run(ids.workLink, ids.tenant, ids.business, ids.feature, ids.workItem, null, now)
      db.prepare('INSERT INTO "RequirementBinding" ("id","tenantId","businessId","featureId","governanceSnapshotId","sourceNamespace","requirementKey","revisionHash","acceptanceRef","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(ids.binding, ids.tenant, ids.business, ids.featureTwo, ids.snapshot, 'zuri', 'FR-252', sha, 'tests/unit/phase-b-feature-migration.test.js', now)

      db.prepare(`
        INSERT INTO "ProjectFeatureMutationReceipt" (
          "id","tenantId","businessId","projectId","featureId","targetId","targetType",
          "httpMethod","principalId","operation","idempotencyKey","payloadHash","resourceId",
          "resourceType","version","etag","auditEventId"
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        ids.receipt, ids.tenant, ids.business, ids.project, ids.feature,
        ids.project, 'PROJECT', 'POST', ids.principal, 'CREATE_FEATURE',
        'idem-001', sha, ids.feature, 'PROJECT_FEATURE', 1, 'feature-etag-1', ids.audit,
      )
      expectSqlFailure(() => db.prepare(`
        INSERT INTO "ProjectFeatureMutationReceipt" (
          "id","tenantId","businessId","projectId","featureId","targetId","targetType",
          "httpMethod","principalId","operation","idempotencyKey","payloadHash","resourceId",
          "resourceType","version","etag","auditEventId"
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        '25252525-2525-4525-8525-252525252525', ids.tenant, ids.business, ids.project, ids.feature,
        ids.project, 'PROJECT', 'POST', ids.principal, 'CREATE_FEATURE', 'idem-001', sha,
        ids.feature, 'PROJECT_FEATURE', 1, 'feature-etag-1', ids.audit,
      ))
      expectSqlFailure(() => db.prepare(`
        INSERT INTO "ProjectFeatureMutationReceipt" (
          "id","tenantId","businessId","projectId","featureId","targetId","targetType",
          "httpMethod","principalId","operation","idempotencyKey","payloadHash","resourceId",
          "resourceType","version","etag","auditEventId"
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        '26262626-2626-4626-8626-262626262626', ids.tenant, ids.business, ids.project, ids.feature,
        ids.feature, 'FEATURE', 'PATCH', ids.principal, 'UPDATE_FEATURE', 'idem-002', sha,
        ids.feature, 'PROJECT_FEATURE', null, 'feature-etag-2', ids.audit,
      ))

      expectSqlFailure(() => db.prepare('DELETE FROM "ProjectFeature" WHERE "id" = ?').run(ids.feature))
      expectSqlFailure(() => db.prepare('DELETE FROM "GovernanceSnapshot" WHERE "id" = ?').run(ids.snapshot))
    } finally {
      db.close()
    }
  })

  it('keeps the reviewed scope, optional snapshot pin and nine receipt tuples in provider SQL', () => {
    const setting = "current_setting('zuri.pm_tenant_id', true)"
    expect(postgresMigration).toContain(setting)
    expect(postgresMigration).toContain("NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL")
    expect(postgresMigration).toContain('"ProjectFeature"."governanceSnapshotId" IS NULL')
    expect(postgresMigration).toContain('s."tenantId" = "ProjectFeature"."tenantId"')
    expect(postgresMigration).toContain('s."businessId" = "ProjectFeature"."businessId"')
    expect(postgresMigration).toContain('spr."projectId" = "ProjectFeature"."projectId"')
    expect(postgresMigration).toContain('sr."businessId" = "ProjectFeature"."businessId"')
    expect(postgresMigration).toContain('AND wi."deletedAt" IS NULL')
    expect(postgresMigration).toContain('AND ws."projectId" = f."projectId"')
    expect(postgresMigration).toContain('a."id" = "ProjectFeatureMutationReceipt"."auditEventId"')

    for (const operation of [
      'CREATE_FEATURE',
      'UPDATE_FEATURE',
      'REPLACE_CONTRIBUTIONS',
      'REPLACE_WORK_LINKS',
      'REPLACE_FEATURE_WORK_GRAPH',
      'REPLACE_REQUIREMENT_BINDINGS',
      'DELETE_FEATURE',
      'RESTORE_FEATURE',
      'CAPTURE_GOVERNANCE_SNAPSHOT',
    ]) {
      expect(postgresMigration).toMatch(new RegExp(
        `"ProjectFeatureMutationReceipt"\\."operation"\\s+(?:=|IN)[^\\n]*'${operation}'`,
      ))
    }

    expect(postgresMigration).toContain('"ProjectFeatureMutationReceipt"."operation" IN (\'REPLACE_CONTRIBUTIONS\', \'REPLACE_WORK_LINKS\', \'REPLACE_REQUIREMENT_BINDINGS\')')
    expect(postgresMigration).toContain('"ProjectFeatureMutationReceipt"."version" IS NOT NULL')
    expect(postgresMigration).toContain('"ProjectFeatureMutationReceipt"."version" IS NULL')
    expect(postgresMigration).toContain('COMMIT;')
  })
})
