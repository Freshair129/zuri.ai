// @req FR-223 — the Supabase Vault store: the SecretStorePort for the hosted
//   product, where encryption happens in the database and the app never holds a key.
// @spec ADR-089 D1, D5; SDD-097; SEC-030
// @tested tests/unit/integration/supabase-vault-secret-store.test.js, tests/integration/credential-vault.postgres.test.js
//
// This adapter holds no lifecycle logic of its own. Each method is one call to a
// SECURITY DEFINER function in 20260914140200_channel_secret_vault_functions.sql,
// made inside `set local role` of the NOLOGIN role that alone may execute it —
// writer for write/activate/revoke, reader for resolve — so a stray query elsewhere
// on the same connection never holds execute rights. The functions re-prove
// Tenant, Business, connection and destination from the rows (ADR-089 D5); an app
// bug that passes another Tenant's connection id is refused by the database.
//
// Every parameter is bound, never interpolated. The bundle is a parameter, which is
// why Prisma query logging must stay off on this path (SEC-030); `src/lib/db.js`
// configures none.

import prisma from '@/lib/db'
import {
  SecretStoreError,
  normalizeSecretStoreError,
  parseCreatedVia,
  parseRevokeReason,
  parseSecretBundle,
  parseStoreScope,
  parseValidationCode,
  parseVersionNumber,
  secretIdFromRef,
  serializeSecretBundle,
} from './secret-store-port'

export const CHANNEL_VAULT_WRITER_ROLE = 'zuri_channel_vault_writer'
export const CHANNEL_VAULT_READER_ROLE = 'zuri_channel_vault_reader'
const ROLES = new Set([CHANNEL_VAULT_WRITER_ROLE, CHANNEL_VAULT_READER_ROLE])

export const CHANNEL_SECRET_SQL = Object.freeze({
  write: 'select secret_ref, version_number from zuri_core.channel_secret_write($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7, $8)',
  activate: 'select secret_ref, version_number, superseded_count, purge_failed_count from zuri_core.channel_secret_activate($1, $2, $3, $4::int, $5)',
  revoke: 'select credential_status, revoked_count, purged_count, purge_failed_count from zuri_core.channel_secret_revoke($1, $2, $3, $4, $5::int)',
  resolve: 'select secret_material, version, expires_at from zuri_core.channel_secret_resolve($1, $2, $3, $4, $5)',
})

/**
 * Run one statement as a NOLOGIN role through the application's Prisma client
 * (the Postgres client in production). `set local` ends with the transaction.
 */
export function createPrismaRoleSql(db = prisma) {
  return {
    async run(role, text, params) {
      if (!ROLES.has(role)) throw new SecretStoreError('SECRET_STORE_CONFIGURATION_INVALID')
      return db.$transaction(async tx => {
        await tx.$executeRawUnsafe(`set local role ${role}`)
        return tx.$queryRawUnsafe(text, ...params)
      }, { timeout: 15000, maxWait: 5000 })
    },
  }
}

/** The same executor over a `pg` Pool — the disposable-cluster test and operator scripts. */
export function createPgRoleSql(pool) {
  return {
    async run(role, text, params) {
      if (!ROLES.has(role)) throw new SecretStoreError('SECRET_STORE_CONFIGURATION_INVALID')
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(`set local role ${role}`)
        const { rows } = await client.query(text, params)
        await client.query('commit')
        return rows
      } catch (error) {
        await client.query('rollback').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  }
}

function single(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length !== 1) throw new SecretStoreError('CHANNEL_SECRET_STORE_UNAVAILABLE')
  return list[0]
}

const int = value => Number(value ?? 0)

export function createSupabaseVaultSecretStore({ sql } = {}) {
  if (typeof sql?.run !== 'function') throw new SecretStoreError('SECRET_STORE_CONFIGURATION_INVALID')

  async function call(role, text, params) {
    try {
      return await sql.run(role, text, params)
    } catch (error) {
      throw normalizeSecretStoreError(error)
    }
  }

  return Object.freeze({
    store: 'SUPABASE_VAULT',

    async write({ tenantId, businessId, connectionId, kind, bundle, expiresAt = null, actorPersonId = null, createdVia }) {
      parseStoreScope({ tenantId, businessId, connectionId })
      const parsed = parseSecretBundle(kind, bundle)
      parseCreatedVia(createdVia)
      const row = single(await call(CHANNEL_VAULT_WRITER_ROLE, CHANNEL_SECRET_SQL.write, [
        connectionId, tenantId, businessId, kind, serializeSecretBundle(parsed),
        expiresAt ? new Date(expiresAt).toISOString() : null, actorPersonId, createdVia,
      ]))
      return { secretRef: row.secret_ref, versionNumber: int(row.version_number) }
    },

    async activate({ tenantId, businessId, connectionId, versionNumber, validationCode }) {
      parseStoreScope({ tenantId, businessId, connectionId })
      parseVersionNumber(versionNumber)
      parseValidationCode(validationCode)
      const row = single(await call(CHANNEL_VAULT_WRITER_ROLE, CHANNEL_SECRET_SQL.activate, [
        connectionId, tenantId, businessId, versionNumber, validationCode,
      ]))
      return {
        secretRef: row.secret_ref,
        versionNumber: int(row.version_number),
        supersededCount: int(row.superseded_count),
        purgeFailedCount: int(row.purge_failed_count),
      }
    },

    async revoke({ tenantId, businessId, connectionId, reason, versionNumber = null }) {
      parseStoreScope({ tenantId, businessId, connectionId })
      if (versionNumber !== null) parseVersionNumber(versionNumber)
      const row = single(await call(CHANNEL_VAULT_WRITER_ROLE, CHANNEL_SECRET_SQL.revoke, [
        connectionId, tenantId, businessId, parseRevokeReason(reason), versionNumber,
      ]))
      return {
        credentialStatus: row.credential_status,
        revokedCount: int(row.revoked_count),
        purgedCount: int(row.purged_count),
        purgeFailedCount: int(row.purge_failed_count),
      }
    },

    async resolve(secretRef, { tenantId, businessId, connectionId, destination } = {}) {
      if (!secretIdFromRef(secretRef, 'SUPABASE_VAULT') || typeof destination !== 'string' || !destination) {
        throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
      }
      parseStoreScope({ tenantId, businessId, connectionId })
      const rows = await call(CHANNEL_VAULT_READER_ROLE, CHANNEL_SECRET_SQL.resolve, [
        secretRef.trim(), tenantId, businessId, connectionId, destination,
      ])
      // The function returns no row for every refusal — wrong scope, wrong status,
      // expired, purged — so a caller cannot tell them apart.
      if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].secret_material !== 'string') {
        throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
      }
      const result = { version: String(rows[0].version), expiresAt: new Date(rows[0].expires_at) }
      Object.defineProperty(result, 'material', { value: rows[0].secret_material, enumerable: false })
      return result
    },
  })
}
