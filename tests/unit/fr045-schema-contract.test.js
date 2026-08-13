// @req FR-045 - W1 adds the additive SQLite/Postgres file-metadata contract.
// @spec SDD-023, ADR-016, docs/changes/ZV2-CR-001-MANAGED-LOCAL-FILES-AND-CACHE.md
// @tested tests/unit/fr045-schema-contract.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const sqliteSchema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8')
const postgresSchema = readFileSync(resolve(root, 'prisma/schema.postgres.prisma'), 'utf8')
const migration = readFileSync(resolve(root, 'prisma/migrations/20260814010000_add_managed_local_file_metadata/migration.sql'), 'utf8')

function model(schema, name) {
  const match = schema.match(new RegExp(`model\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  expect(match, `${name} model`).not.toBeNull()
  return match?.[1] ?? ''
}

function expectFields(schema, name, fields) {
  const body = model(schema, name)
  for (const field of fields) {
    expect(body, `${name}.${field}`).toMatch(new RegExp(`^\\s*${field}\\s+`, 'm'))
  }
  return body
}

describe('FR-045 W1 additive file metadata schema contract', () => {
  it('adds a single device-local mount per Business/device without making rootPath an identity key', () => {
    const body = expectFields(sqliteSchema, 'LocalWorkspaceMount', [
      'id', 'tenantId', 'businessId', 'deviceKey', 'rootPath', 'status',
      'lastScanAt', 'version', 'createdAt', 'updatedAt', 'tenant', 'business',
    ])

    expect(body).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/)
    expect(body).toMatch(/lastScanAt\s+DateTime\?/)
    expect(body).toMatch(/@@unique\(\[businessId, deviceKey\]\)/)
    expect(body).not.toMatch(/@@unique\(\[[^\]]*rootPath/)
  })

  it('adds FileAsset metadata and preserves ProjectFile as the legacy compatibility model', () => {
    const body = expectFields(sqliteSchema, 'FileAsset', [
      'id', 'code', 'tenantId', 'businessId', 'projectId', 'workItemId',
      'storageKind', 'relativePath', 'externalUrl', 'blobRef', 'name', 'mime',
      'size', 'sha256', 'status', 'version', 'uploadedBy', 'createdAt',
      'updatedAt', 'deletedAt', 'tenant', 'business', 'project', 'workItem', 'links',
    ])

    expect(body).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/)
    expect(body).toMatch(/code\s+String\s+@unique/)
    expect(body).toMatch(/projectId\s+String\?/)
    expect(body).toMatch(/workItemId\s+String\?/)
    expect(body).toMatch(/relativePath\s+String\?/)
    expect(body).toMatch(/externalUrl\s+String\?/)
    expect(body).toMatch(/blobRef\s+String\?/)
    expect(body).toMatch(/sha256\s+String\?/)
    expect(body).toMatch(/deletedAt\s+DateTime\?/)
    expect(body).toMatch(/@@index\(\[tenantId\]\)/)
    expect(body).toMatch(/@@index\(\[businessId\]\)/)
    expect(body).toMatch(/@@index\(\[projectId\]\)/)
    expect(body).toMatch(/@@index\(\[workItemId\]\)/)

    expectFields(sqliteSchema, 'ProjectFile', [
      'id', 'code', 'projectId', 'workItemId', 'name', 'mime', 'size', 'url',
      'blobRef', 'version', 'uploadedBy', 'createdAt', 'updatedAt', 'project', 'workItem',
    ])
  })

  it('adds typed FileLink lookup and tuple uniqueness', () => {
    const body = expectFields(sqliteSchema, 'FileLink', [
      'id', 'fileId', 'entityType', 'entityId', 'relationType', 'createdAt', 'updatedAt', 'file',
    ])

    expect(body).toMatch(/id\s+String\s+@id\s+@default\(uuid\(\)\)/)
    expect(body).toMatch(/@@unique\(\[fileId, entityType, entityId, relationType\]\)/)
    expect(body).toMatch(/@@index\(\[entityType, entityId\]\)/)
  })

  it('exposes required inverse relations and preserves the generated Postgres model parity', () => {
    expectFields(sqliteSchema, 'Tenant', ['localWorkspaceMounts', 'fileAssets'])
    expectFields(sqliteSchema, 'Business', ['localWorkspaceMounts', 'fileAssets'])
    expectFields(sqliteSchema, 'Project', ['fileAssets'])
    expectFields(sqliteSchema, 'WorkItem', ['fileAssets'])

    for (const name of ['LocalWorkspaceMount', 'FileAsset', 'FileLink', 'ProjectFile']) {
      expect(model(postgresSchema, name)).toBe(model(sqliteSchema, name))
    }
  })

  it('ships an additive migration without changing the legacy ProjectFile table', () => {
    expect(migration).toMatch(/CREATE TABLE "LocalWorkspaceMount"/)
    expect(migration).toMatch(/CREATE TABLE "FileAsset"/)
    expect(migration).toMatch(/CREATE TABLE "FileLink"/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX "LocalWorkspaceMount_businessId_deviceKey_key"/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX "FileAsset_code_key"/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX "FileLink_fileId_entityType_entityId_relationType_key"/)
    expect(migration).not.toMatch(/(?:ALTER|DROP)\s+TABLE\s+"ProjectFile"/)
  })
})
