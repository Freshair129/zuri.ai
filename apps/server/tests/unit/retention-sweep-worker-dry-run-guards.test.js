import { describe, expect, it, vi } from 'vitest'
import { resolveRetentionSweepWorkerConfig, runRetentionSweepOnce, runRetentionSweepSequence } from '../../scripts/retention-sweep-worker-run.mjs'

// @req FR-230, SEC-034 — configured worker endpoints cannot carry mode flags and dry-run calls require dry-run responses.
// @spec ADR-091 D2; ADR-093 D5; SEC-001
// @tested tests/unit/retention-sweep-worker-dry-run-guards.test.js

const token = 'retention-worker-token-'.padEnd(32, 'x')
const endpointFor = (suffix = '') => new URL(`http://127.0.0.1:3000/api/crm/retention-sweep${suffix}`)

describe('retention worker dry-run guards', () => {
  it.each([
    ['query', '?dry_run=true'],
    ['fragment', '#dry_run=true'],
  ])('rejects a configured URL with a %s', (_label, suffix) => {
    expect(() => resolveRetentionSweepWorkerConfig({
      ZURI_RETENTION_SWEEP_TOKEN: token,
      ZURI_RETENTION_SWEEP_URL: endpointFor(suffix).href,
    })).toThrow('RETENTION_SWEEP_URL_INVALID')
  })

  it.each([
    ['empty query delimiter', '?'],
    ['empty fragment delimiter', '#'],
  ])('accepts a configured URL with an empty %s', (_label, suffix) => {
    expect(() => resolveRetentionSweepWorkerConfig({
      ZURI_RETENTION_SWEEP_TOKEN: token,
      ZURI_RETENTION_SWEEP_URL: endpointFor(suffix).href,
    })).not.toThrow()
  })

  it('accepts a dry-run response only when the body confirms dryRun true', async () => {
    const endpoint = endpointFor('?dry_run=true')
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dryRun: true, countsByClass: {}, tenants: [] }),
    })

    await expect(runRetentionSweepOnce({ endpoint, token, fetchImpl })).resolves.toMatchObject({ ok: true, status: 200 })
  })

  it('requires an archive-expiry dry-run counts object and Tenant rows', async () => {
    const endpoint = new URL('http://127.0.0.1:3000/api/crm/archive-expiry?dry_run=true')
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dryRun: true, counts: {}, tenants: [] }),
    })

    await expect(runRetentionSweepOnce({ endpoint, token, fetchImpl })).resolves.toMatchObject({ ok: true, status: 200 })
  })

  it.each([
    ['missing dryRun flag', async () => ({ countsByClass: {} })],
    ['false dryRun flag', async () => ({ dryRun: false, countsByClass: {} })],
    ['missing tenants array', async () => ({ dryRun: true, countsByClass: {} })],
    ['missing counts object', async () => ({ dryRun: true, tenants: [] })],
    ['non-object counts', async () => ({ dryRun: true, tenants: [], countsByClass: [] })],
    ['unparsable body', async () => { throw new SyntaxError('invalid JSON') }],
    ['empty body', async () => { throw new SyntaxError('empty JSON body') }],
  ])('fails an HTTP 200 dry-run call with a %s', async (_label, json) => {
    const endpoint = endpointFor('?dry_run=true')
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json })

    await expect(runRetentionSweepOnce({ endpoint, token, fetchImpl })).resolves.toMatchObject({
      ok: false, status: 200,
    })
  })

  it('preserves real-run success semantics when dry_run is absent', async () => {
    const endpoint = endpointFor()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ countsByClass: {} }),
    })

    await expect(runRetentionSweepOnce({ endpoint, token, fetchImpl })).resolves.toMatchObject({ ok: true, status: 200 })
  })

  it('does not carry dry-run mode from a sequence into a later real call', async () => {
    const endpoint = endpointFor()
    const calls = [{ name: 'crm', path: endpoint.pathname, event: 'crm.retention-sweep.tick', usesConfiguredEndpoint: true, supportsDryRun: true }]
    const requestedUrls = []
    const fetchImpl = vi.fn(async (url) => {
      requestedUrls.push(new URL(url.href))
      return {
        ok: true,
        status: 200,
        json: async () => url.searchParams.has('dry_run')
          ? { dryRun: true, countsByClass: {}, tenants: [] }
          : {},
      }
    })

    await runRetentionSweepSequence({ endpoint, token, calls, fetchImpl, dryRun: true })
    expect(endpoint.search).toBe('')
    expect(requestedUrls[0].search).toBe('?dry_run=true')

    await runRetentionSweepSequence({ endpoint, token, calls, fetchImpl, dryRun: false })
    expect(endpoint.search).toBe('')
    expect(requestedUrls[1].search).toBe('')
  })
})
