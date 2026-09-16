// @req FR-223 — the dispatching secret manager routes a reference to the store its
//   prefix names, only when that store is configured, and never tries another.
// @spec SDD-097, ADR-089 D1 and proof 3, SEC-030
// @tested tests/unit/integration/dispatching-secret-manager.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createDispatchingSecretManager,
  createLineSecretManagerFromEnv,
  createWritableSecretStoreFromEnv,
  requireWritableSecretStore,
} from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { SecretStoreError } from '@/platform/integrations/core/secret-store/secret-store-port'
import { errorTrace, generateLineChannelBundle } from '../../helpers/credential-vault-fixtures'

vi.mock('@/lib/db', () => ({ default: {} }))

const SCOPE = { tenantId: 't1', businessId: 'b1', connectionId: 'c1', destination: `U${'a'.repeat(32)}`, accountId: 'a1' }
const future = () => new Date(Date.now() + 60_000)

function fakeStore(store, material) {
  return {
    store,
    calls: [],
    write: vi.fn(), activate: vi.fn(), revoke: vi.fn(),
    resolve: vi.fn(async function resolve(ref, scope) {
      this.calls.push([ref, scope])
      const result = { version: 'credential-v1', expiresAt: future() }
      Object.defineProperty(result, 'material', { value: material, enumerable: false })
      return result
    }),
  }
}

describe('routing by prefix', () => {
  const material = JSON.stringify(generateLineChannelBundle())
  const envelope = fakeStore('ENVELOPE', material)
  const mount = { resolve: vi.fn(async () => ({ material: 'mounted', version: 'm1', expiresAt: future() })) }
  const manager = createDispatchingSecretManager({ mount, writableStore: envelope })

  it('asks only the store the prefix names and returns material that does not enumerate', async () => {
    const ref = `envelope:${randomUUID()}`
    const resolved = await manager.resolve(ref, SCOPE)
    expect(resolved.material).toBe(material)
    expect(JSON.stringify(resolved)).not.toContain(material)
    expect(envelope.resolve).toHaveBeenCalledWith(ref, SCOPE)
    expect(mount.resolve).not.toHaveBeenCalled()
    await manager.resolve('deployment-secret:main', SCOPE)
    expect(mount.resolve).toHaveBeenCalledTimes(1)
  })

  it('refuses a prefix with no configured store as Unavailable and asks no other store (proof 3)', async () => {
    envelope.resolve.mockClear()
    mount.resolve.mockClear()
    for (const ref of [`supabase-vault:${randomUUID()}`, 'nonsense:ref', '']) {
      await expect(manager.resolve(ref, SCOPE)).rejects.toMatchObject({ code: 'Unavailable' })
    }
    expect(envelope.resolve).not.toHaveBeenCalled()
    expect(mount.resolve).not.toHaveBeenCalled()
    expect(manager.stores).toEqual(['DEPLOYMENT_MOUNT', 'ENVELOPE'])
  })

  it('reports a store refusal as NotFound and a store outage as Unavailable, without its text', async () => {
    const secret = generateLineChannelBundle().channelSecret
    const refusing = { ...fakeStore('SUPABASE_VAULT', ''), resolve: async () => { throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH') } }
    const down = { ...fakeStore('SUPABASE_VAULT', ''), resolve: async () => { throw Object.assign(new SecretStoreError('CHANNEL_SECRET_STORE_UNAVAILABLE'), { detail: secret }) } }
    await expect(createDispatchingSecretManager({ writableStore: refusing }).resolve(`supabase-vault:${randomUUID()}`, SCOPE)).rejects.toMatchObject({ code: 'NotFound' })
    const error = await createDispatchingSecretManager({ writableStore: down }).resolve(`supabase-vault:${randomUUID()}`, SCOPE).catch(e => e)
    expect(error).toMatchObject({ code: 'Unavailable' })
    expect(errorTrace(error)).not.toContain(secret)
  })

  it('refuses an expired resolution (the SecretManagerPort bound still applies)', async () => {
    const stale = { ...fakeStore('ENVELOPE', material), resolve: async () => ({ material, version: 'credential-v1', expiresAt: new Date(Date.now() - 1) }) }
    await expect(createDispatchingSecretManager({ writableStore: stale }).resolve(`envelope:${randomUUID()}`, SCOPE)).rejects.toMatchObject({ code: 'Expired' })
  })
})

describe('composition from the deployment', () => {
  it('selects one writable store by ZURI_SECRET_STORE and treats an unknown value as a configuration error', () => {
    expect(createWritableSecretStoreFromEnv({})).toBeNull()
    expect(createWritableSecretStoreFromEnv({ ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: randomBytes(32).toString('hex') }, { db: {} }).store).toBe('ENVELOPE')
    expect(createWritableSecretStoreFromEnv({ ZURI_SECRET_STORE: 'supabase-vault' }, { sql: { run: async () => [] } }).store).toBe('SUPABASE_VAULT')
    expect(() => createWritableSecretStoreFromEnv({ ZURI_SECRET_STORE: 'both' })).toThrow('SECRET_STORE_CONFIGURATION_INVALID')
    expect(() => requireWritableSecretStore({})).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
  })

  it('fails at composition when neither the mount nor a writable store is configured', () => {
    expect(() => createLineSecretManagerFromEnv({})).toThrow('LINE_SECRET_MANAGER_NOT_CONFIGURED')
    const manager = createLineSecretManagerFromEnv({ ZURI_SECRET_STORE: 'envelope', NODE_ENV: 'test' }, { db: {} })
    expect(manager.stores).toEqual(['ENVELOPE'])
    expect(manager.runtimeSource).toBe('PRODUCTION_LINE')
  })

  it('an envelope installation in production without a KEK fails at composition', () => {
    expect(() => createLineSecretManagerFromEnv({ ZURI_SECRET_STORE: 'envelope', NODE_ENV: 'production' }, { db: {} })).toThrow('CHANNEL_SECRET_STORE_UNAVAILABLE')
  })
})
