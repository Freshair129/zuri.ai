// @req FR-223 — the SecretStorePort vocabulary: references name their store, bundles
//   are validated without echoing a value, and errors carry a code and nothing else.
// @req FR-242 — OAUTH_CLIENT and MODEL_PROVIDER_KEY bundle schemas, dispatched by
//   an explicit map keyed by kind; a kind absent from the map is refused.
// @spec SDD-097, SEC-030
// @tested tests/unit/integration/secret-store-port.test.js
import { describe, expect, it } from 'vitest'
import {
  RESOLVABLE_SECRET_KINDS,
  SecretStoreError,
  assertSecretStorePort,
  displayHintFor,
  normalizeSecretStoreError,
  parseSecretBundle,
  secretIdFromRef,
  secretRefFor,
  secretStoreForRef,
  serializeSecretBundle,
} from '@/platform/integrations/core/secret-store/secret-store-port'
import {
  errorTrace,
  generateLineChannelBundle,
  generateModelProviderKeyBundle,
  generateOauthClientBundle,
} from '../../helpers/credential-vault-fixtures'

const UUID = '3f1c2a9e-6b7d-4c8e-9a1f-2b3c4d5e6f70'

describe('secret references name their store by prefix (SDD-097)', () => {
  it('maps each prefix to exactly one store and refuses anything else', () => {
    expect(secretStoreForRef(`supabase-vault:${UUID}`)).toBe('SUPABASE_VAULT')
    expect(secretStoreForRef(`envelope:${UUID}`)).toBe('ENVELOPE')
    expect(secretStoreForRef('deployment-secret:main_line-1')).toBe('DEPLOYMENT_MOUNT')
    for (const ref of ['vault:' + UUID, `envelope:${UUID}x`, 'supabase-vault:not-a-uuid', 'deployment-secret:', '', null, 42]) {
      expect(secretStoreForRef(ref)).toBeNull()
    }
  })

  it('builds and reads the opaque id only for its own store, never for the mount', () => {
    expect(secretRefFor('ENVELOPE', UUID)).toBe(`envelope:${UUID}`)
    expect(secretIdFromRef(`envelope:${UUID}`, 'ENVELOPE')).toBe(UUID)
    expect(secretIdFromRef(`envelope:${UUID}`, 'SUPABASE_VAULT')).toBeNull()
    expect(() => secretRefFor('DEPLOYMENT_MOUNT', 'main')).toThrow(SecretStoreError)
  })
})

describe('bundles (ADR-089 D3)', () => {
  it('accepts a LINE bundle and returns a copy no enumeration can read', () => {
    const input = generateLineChannelBundle({ withToken: true })
    const parsed = parseSecretBundle('LINE_CHANNEL', input)
    expect(JSON.stringify(parsed)).toBe('{}')
    expect({ ...parsed }).toEqual({})
    expect(Object.keys(parsed)).toEqual([])
    expect(parsed.channelSecret).toBe(input.channelSecret)
    expect(JSON.parse(serializeSecretBundle('LINE_CHANNEL', parsed))).toEqual(input)
    expect(displayHintFor('LINE_CHANNEL', parsed)).toBe(input.channelId.slice(-4))
  })

  it('refuses an invalid bundle without naming the field or quoting the value', () => {
    const input = generateLineChannelBundle()
    const cases = [
      { ...input, channelSecret: input.channelSecret.toUpperCase() },
      { ...input, channelId: 'abc' },
      { ...input, extra: input.channelSecret },
      { channelId: input.channelId },
      { ...input, channelAccessToken: 'short' },
    ]
    for (const bundle of cases) {
      let error
      try { parseSecretBundle('LINE_CHANNEL', bundle) } catch (caught) { error = caught }
      expect(error).toBeInstanceOf(SecretStoreError)
      expect(error.code).toBe('CHANNEL_SECRET_BUNDLE_INVALID')
      expect(errorTrace(error)).not.toContain(input.channelSecret)
      expect(error.message).toBe('CHANNEL_SECRET_BUNDLE_INVALID')
    }
    // A LINE-shaped bundle handed to a different kind is a shape mismatch, not an
    // unsupported kind — OAUTH_CLIENT and MODEL_PROVIDER_KEY are both mapped now.
    expect(() => parseSecretBundle('OAUTH_CLIENT', input)).toThrow('CHANNEL_SECRET_BUNDLE_INVALID')
    expect(() => parseSecretBundle('MODEL_PROVIDER_KEY', input)).toThrow('CHANNEL_SECRET_BUNDLE_INVALID')
    // API_KEY is declared in the wider SECRET_KINDS registry but has no bundle
    // schema yet (fail closed, never default-permitted) — and a kind the
    // registry itself has never heard of reads as a malformed bundle, not a
    // supported-but-unimplemented one.
    expect(() => parseSecretBundle('API_KEY', generateModelProviderKeyBundle())).toThrow('CHANNEL_SECRET_KIND_UNSUPPORTED')
    expect(() => parseSecretBundle('NOT_A_REAL_KIND', generateModelProviderKeyBundle())).toThrow('CHANNEL_SECRET_BUNDLE_INVALID')
  })

  it('accepts an OAuth-client bundle (ADR-053 shape) and hints on the client id, never the secret', () => {
    const input = generateOauthClientBundle()
    const parsed = parseSecretBundle('OAUTH_CLIENT', input)
    expect(JSON.stringify(parsed)).toBe('{}')
    expect(parsed.clientSecret).toBe(input.clientSecret)
    expect(JSON.parse(serializeSecretBundle('OAUTH_CLIENT', parsed))).toEqual(input)
    expect(displayHintFor('OAUTH_CLIENT', parsed)).toBe(input.clientId.slice(-4))
  })

  it('refuses an invalid OAuth-client bundle the same way, without naming the field', () => {
    const input = generateOauthClientBundle()
    const cases = [
      { ...input, clientSecret: 'too-short' },
      { ...input, extra: 'x' },
      { clientId: input.clientId },
      { ...input, clientId: '' },
    ]
    for (const bundle of cases) {
      let error
      try { parseSecretBundle('OAUTH_CLIENT', bundle) } catch (caught) { error = caught }
      expect(error).toMatchObject({ code: 'CHANNEL_SECRET_BUNDLE_INVALID' })
      expect(errorTrace(error)).not.toContain(input.clientSecret)
    }
  })

  it('accepts a model-provider-key bundle and never hints on any part of the key', () => {
    const input = generateModelProviderKeyBundle()
    const parsed = parseSecretBundle('MODEL_PROVIDER_KEY', input)
    expect(JSON.stringify(parsed)).toBe('{}')
    expect(parsed.apiKey).toBe(input.apiKey)
    expect(JSON.parse(serializeSecretBundle('MODEL_PROVIDER_KEY', parsed))).toEqual(input)
    expect(displayHintFor('MODEL_PROVIDER_KEY', parsed)).toBeNull()
  })

  it('refuses an invalid model-provider-key bundle the same way, without naming the field', () => {
    const input = generateModelProviderKeyBundle()
    for (const bundle of [{ apiKey: 'too-short' }, { ...input, extra: 'x' }, {}]) {
      let error
      try { parseSecretBundle('MODEL_PROVIDER_KEY', bundle) } catch (caught) { error = caught }
      expect(error).toMatchObject({ code: 'CHANNEL_SECRET_BUNDLE_INVALID' })
      expect(errorTrace(error)).not.toContain(input.apiKey)
    }
  })

  it('declares exactly the kinds a store can write and resolve today', () => {
    expect(RESOLVABLE_SECRET_KINDS).toEqual(['LINE_CHANNEL', 'OAUTH_CLIENT', 'MODEL_PROVIDER_KEY'])
  })
})

describe('errors (SEC-030)', () => {
  it('keeps a known code found in a database message and drops the message itself', () => {
    const secret = generateLineChannelBundle().channelSecret
    const raised = new Error(`ERROR: CHANNEL_SECRET_SCOPE_MISMATCH at parameter ${secret}`)
    const normalized = normalizeSecretStoreError(raised)
    expect(normalized).toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH', status: 404 })
    expect(errorTrace(normalized)).not.toContain(secret)
    expect(normalized.cause).toBeUndefined()
    expect(normalizeSecretStoreError(new Error(`boom ${secret}`))).toMatchObject({ code: 'CHANNEL_SECRET_STORE_UNAVAILABLE', status: 503 })
  })

  it('accepts only an object that implements the whole port for a writable store', () => {
    const methods = { write() {}, activate() {}, revoke() {}, resolve() {} }
    expect(assertSecretStorePort({ store: 'ENVELOPE', ...methods }).store).toBe('ENVELOPE')
    expect(() => assertSecretStorePort({ store: 'DEPLOYMENT_MOUNT', ...methods })).toThrow('SECRET_STORE_CONFIGURATION_INVALID')
    expect(() => assertSecretStorePort({ store: 'ENVELOPE', write() {} })).toThrow('SECRET_STORE_CONFIGURATION_INVALID')
  })
})
