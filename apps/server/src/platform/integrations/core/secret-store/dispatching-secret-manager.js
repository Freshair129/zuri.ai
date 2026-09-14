// @req FR-223 — the dispatching secret manager: the one resolver the LINE runtime,
//   its health probe, rich menu jobs and ENABLE_SERVER validation compose, routing
//   a reference to the store its prefix names.
// @spec SDD-097, ADR-089 D1, D8, SEC-030
// @tested tests/unit/integration/dispatching-secret-manager.test.js
//
// SDD-097 in three rules:
//
//   1. A reference's prefix names its store, and only that store's adapter is asked.
//   2. An adapter exists only when configured: the mount when ZURI_LINE_SECRET_FILE
//      is set, and exactly one writable store chosen by ZURI_SECRET_STORE
//      (`supabase-vault` or `envelope`). An installation never has both.
//   3. A prefix with no configured adapter resolves `Unavailable`. Cross-store
//      resolution is refused, never attempted: an `envelope:` reference on a Vault
//      installation is not tried against the Vault, and vice versa.
//
// The Phase-1 model-credential resolver (resolve_phase1_line_secret) is not part of
// this manager and is not touched (SDD-097).

import prisma from '@/lib/db'
import { SecretManagerError, createSecretManagerPort } from '../secret-manager'
import { createServerLineSecretManagerFromEnv } from '../../providers/line/server-line-transport'
import { SecretStoreError, WRITABLE_STORE_BY_SETTING, assertSecretStorePort, secretStoreForRef } from './secret-store-port'
import { createEnvelopeSecretStore } from './envelope-secret-store'
import { createPrismaRoleSql, createSupabaseVaultSecretStore } from './supabase-vault-secret-store'

/**
 * @param {object} options
 * @param {{resolve: Function}|null} [options.mount]  the deployment-secret mount manager
 * @param {object|null} [options.writableStore]      the one SecretStorePort this installation writes to
 */
export function createDispatchingSecretManager({
  runtimeSource = 'PRODUCTION_LINE',
  mount = null,
  writableStore = null,
  now = () => new Date(),
} = {}) {
  if (writableStore) assertSecretStorePort(writableStore)
  const resolvers = new Map()
  if (mount) resolvers.set('DEPLOYMENT_MOUNT', mount)
  if (writableStore) resolvers.set(writableStore.store, writableStore)

  return Object.freeze({
    runtimeSource,
    stores: Object.freeze([...resolvers.keys()]),
    writableStore,
    async resolve(secretRef, scope) {
      const store = secretStoreForRef(secretRef)
      const resolver = store ? resolvers.get(store) : null
      if (!resolver) throw new SecretManagerError('Unavailable')
      if (store === 'DEPLOYMENT_MOUNT') return resolver.resolve(secretRef, scope)
      // Normalised exactly as every other runtime secret: fail-closed codes,
      // expiry enforced, material non-enumerable. A fresh port per call means no
      // process cache — a revoked credential stops resolving on the next request.
      const port = createSecretManagerPort({
        runtimeSource,
        now,
        adapter: {
          kind: store === 'ENVELOPE' ? 'envelope' : 'supabase-vault',
          async resolve() {
            try {
              return await resolver.resolve(secretRef, scope)
            } catch (error) {
              if (error instanceof SecretStoreError && error.status === 503) throw new SecretManagerError('Unavailable')
              throw new SecretManagerError('NotFound')
            }
          },
        },
      })
      return port.resolve(secretRef, scope)
    },
    invalidate() {},
  })
}

/**
 * The writable store ZURI_SECRET_STORE selects, or null when none is selected.
 * An unknown value is a configuration error, not "no store".
 */
export function createWritableSecretStoreFromEnv(env = process.env, { db = prisma, sql = null, now } = {}) {
  const setting = env.ZURI_SECRET_STORE
  if (setting === undefined || setting === '') return null
  const store = WRITABLE_STORE_BY_SETTING[setting]
  if (!store) throw new SecretStoreError('SECRET_STORE_CONFIGURATION_INVALID')
  if (store === 'ENVELOPE') return createEnvelopeSecretStore({ db, env, now })
  return createSupabaseVaultSecretStore({ sql: sql ?? createPrismaRoleSql(db) })
}

/** The configured writable store, or 503 CHANNEL_SECRET_STORE_UNAVAILABLE. */
export function requireWritableSecretStore(env = process.env, deps = {}) {
  const store = createWritableSecretStoreFromEnv(env, deps)
  if (!store) throw new SecretStoreError('CHANNEL_SECRET_STORE_UNAVAILABLE')
  return store
}

/**
 * Compose the LINE runtime's dispatching manager from the deployment. Throws
 * LINE_SECRET_MANAGER_NOT_CONFIGURED (503) when neither the mount nor a writable
 * store is configured, so a misconfigured deployment fails at composition.
 */
export function createLineSecretManagerFromEnv(env = process.env, {
  db = prisma, sql = null, readFileFn, cwd, now = () => new Date(),
} = {}) {
  const mount = typeof env.ZURI_LINE_SECRET_FILE === 'string' && env.ZURI_LINE_SECRET_FILE.trim()
    ? createServerLineSecretManagerFromEnv(env, { ...(readFileFn ? { readFileFn } : {}), ...(cwd ? { cwd } : {}), now })
    : null
  const writableStore = createWritableSecretStoreFromEnv(env, { db, sql, now })
  if (!mount && !writableStore) {
    const error = new Error('LINE_SECRET_MANAGER_NOT_CONFIGURED')
    error.code = 'LINE_SECRET_MANAGER_NOT_CONFIGURED'
    error.status = 503
    throw error
  }
  return createDispatchingSecretManager({ runtimeSource: 'PRODUCTION_LINE', mount, writableStore, now })
}
