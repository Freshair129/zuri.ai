// @req FR-267 — the private runtime's address is operator configuration, and only a
//   safe origin is accepted: the server sends a Business's key to it.
// @spec ADR-100 D7; ADR-099 D10
// @tested tests/unit/platform/private-runtime-config.test.js
import { describe, expect, it } from 'vitest'
import {
  PRIVATE_RUNTIME_BASE_URL_ENV,
  PRIVATE_RUNTIME_MODEL_ENV,
  readPrivateRuntimeBaseUrl,
  readPrivateRuntimeSuggestedModel,
} from '@/platform/integrations/providers/model/private-runtime-config'

const read = (value) => readPrivateRuntimeBaseUrl({ [PRIVATE_RUNTIME_BASE_URL_ENV]: value })

describe('private runtime configuration', () => {
  it('means "no private runtime" when unset or blank, never a default address', () => {
    expect(readPrivateRuntimeBaseUrl({})).toBeNull()
    expect(read('')).toBeNull()
    expect(read('   ')).toBeNull()
  })

  it('accepts the operator’s HTTPS origin and normalises the trailing slash away', () => {
    expect(read('https://desktop-vetatmq.tail71c7d1.ts.net')).toBe('https://desktop-vetatmq.tail71c7d1.ts.net')
    expect(read('https://desktop-vetatmq.tail71c7d1.ts.net/')).toBe('https://desktop-vetatmq.tail71c7d1.ts.net')
    // A runtime mounted under a path prefix keeps the prefix, so `/v1/...` appends cleanly.
    expect(read('https://gpu.example.test/prp/')).toBe('https://gpu.example.test/prp')
  })

  it('refuses plain HTTP except on loopback, where the request never leaves the machine', () => {
    // The Business's key travels to this address.
    expect(read('http://desktop-vetatmq.tail71c7d1.ts.net')).toBeNull()
    expect(read('http://10.0.0.5:4000')).toBeNull()
    expect(read('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000')
    expect(read('http://localhost:4000')).toBe('http://localhost:4000')
  })

  it('refuses an address carrying credentials, a query or a fragment', () => {
    // Each is a way to smuggle a secret or a second destination into a plain origin.
    expect(read('https://user:pass@gpu.example.test')).toBeNull()
    expect(read('https://gpu.example.test/?to=elsewhere')).toBeNull()
    expect(read('https://gpu.example.test/#x')).toBeNull()
  })

  it('refuses something that is not a URL at all, or not HTTP', () => {
    expect(read('not a url')).toBeNull()
    expect(read('ftp://gpu.example.test')).toBeNull()
    expect(read('file:///etc/passwd')).toBeNull()
  })

  it('offers a suggested model only when the operator named one', () => {
    expect(readPrivateRuntimeSuggestedModel({})).toBeNull()
    expect(readPrivateRuntimeSuggestedModel({ [PRIVATE_RUNTIME_MODEL_ENV]: ' typhoon2.5-qwen3-4b ' })).toBe('typhoon2.5-qwen3-4b')
  })
})
