// @req FR-223 — the vault's Prisma models hold references and lifecycle metadata
//   only, are identical in the SQLite and Postgres schemas, and the envelope table
//   stays out of backup export while version history travels with it.
// @spec ADR-089 D1, D2, D5; SEC-030; SDD-097
// @tested tests/unit/integration/credential-vault-schema-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SNAPSHOT_EXCLUDED_MODELS, SNAPSHOT_MODELS } from '@/modules/project-manager/application/backup-service'
import { INTEGRATION_CREDENTIAL_STATUSES, INTEGRATION_CREDENTIAL_VERSION_STATUSES, SECRET_STORES } from '@/lib/validation/enums'

vi.mock('@/lib/db', () => ({ default: {} }))

const schema = file => fs.readFileSync(path.join(process.cwd(), 'prisma', file), 'utf8')
const model = (text, name) => {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(text)
  expect(match, name).not.toBeNull()
  return match[1]
}
const fields = body => body.split('\n').map(line => /^\s+(\w+)\s+\w/.exec(line)?.[1]).filter(Boolean)

describe('vault models', () => {
  const sqlite = schema('schema.prisma')
  const postgres = schema('schema.postgres.prisma')

  it('are byte-identical in both provider schemas', () => {
    for (const name of ['IntegrationCredential', 'IntegrationCredentialVersion', 'IntegrationSecretEnvelope', 'NotionOAuthState', 'NotionWebhookVerificationToken', 'NotionWebhookReceipt']) {
      expect(model(postgres, name)).toBe(model(sqlite, name))
    }
  })

  it('carry no field that could hold material', () => {
    const forbidden = /^(secret|channelSecret|channelAccessToken|accessToken|token|material|plaintext|bundle|fingerprint)$/i
    for (const name of ['IntegrationCredential', 'IntegrationCredentialVersion', 'IntegrationSecretEnvelope']) {
      for (const field of fields(model(sqlite, name))) expect(field).not.toMatch(forbidden)
    }
    expect(fields(model(sqlite, 'IntegrationCredential'))).toEqual(expect.arrayContaining(['secretStore', 'secretKind', 'displayHint', 'lastValidatedAt', 'lastValidationCode', 'revokedAt', 'revokeReason']))
  })

  it('name their statuses from the enum registry', () => {
    expect(SECRET_STORES).toEqual(['DEPLOYMENT_MOUNT', 'SUPABASE_VAULT', 'ENVELOPE'])
    expect(INTEGRATION_CREDENTIAL_STATUSES).toContain('REENTRY_REQUIRED')
    expect(INTEGRATION_CREDENTIAL_VERSION_STATUSES).toEqual(['PENDING_VALIDATION', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'REVOKED', 'PURGED'])
  })

  it('excludes the envelope ciphertext from backup export by name, with its reason', () => {
    // That version history IS exported is asserted on a real export in
    // tests/integration/credential-vault-lifecycle.test.js.
    expect(SNAPSHOT_EXCLUDED_MODELS.integrationSecretEnvelope).toMatch(/never exported/)
    expect(SNAPSHOT_EXCLUDED_MODELS.integrationCredentialVersion).toBeUndefined()
  })

  it('keeps Notion ciphertext and short-lived state out of backups but exports receipt idempotency', () => {
    expect(SNAPSHOT_EXCLUDED_MODELS.notionWebhookVerificationToken).toMatch(/never exported/)
    expect(SNAPSHOT_EXCLUDED_MODELS.notionOAuthState).toMatch(/never exported/)
    expect(SNAPSHOT_MODELS).toContain('notionWebhookReceipt')
  })
})
