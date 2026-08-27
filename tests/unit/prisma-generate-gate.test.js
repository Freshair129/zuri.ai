import path from 'path'
import { describe, it, expect } from 'vitest'
import {
  schemaFingerprint,
  recordedFingerprint,
  recordFingerprint,
  withGenerateLock,
} from '../global-setup.js'

// Test databases are per-run, but node_modules/.prisma/client is one directory
// every run writes into. Two concurrent `prisma db push` calls lose a rename race
// with "EPERM … query_engine-windows.dll.node.tmp…" — reported on stdout while the
// command still exits 0, so the loser would carry on against whichever client
// survived. Generation is gated on the schema fingerprint and serialised by a lock.
// See .brain/rca/2026-08-16-test-harness-stale-client-and-unverified-reset.md.

const SCHEMA = 'datasource db {\n  provider = "sqlite"\n}\n'

describe('schema fingerprint', () => {
  it('is stable for identical content', () => {
    const read = () => SCHEMA
    expect(schemaFingerprint('schema.prisma', { read })).toBe(schemaFingerprint('schema.prisma', { read }))
  })

  it('ignores line endings, so a CRLF checkout does not force a regeneration', () => {
    const lf = schemaFingerprint('s', { read: () => SCHEMA })
    const crlf = schemaFingerprint('s', { read: () => SCHEMA.replace(/\n/g, '\r\n') })
    expect(crlf).toBe(lf)
  })

  it('separates two checkouts that share one node_modules, even with identical schema text', () => {
    // The generated client bakes its schema directory in and resolves a relative
    // `file:` datasource against THAT directory. A client generated for a sibling
    // checkout therefore opens a database in the wrong tree — silently, because the
    // schema text is byte-identical. Junctioning node_modules between checkouts is
    // what puts the two in contact.
    const read = () => SCHEMA
    const here = schemaFingerprint(path.join('/zuri-ai', 'prisma', 'schema.prisma'), { read })
    const sibling = schemaFingerprint(path.join('/zuri-ai-deploy', 'prisma', 'schema.prisma'), { read })
    expect(sibling).not.toBe(here)
  })

  it('does not move when the same schema is named by a relative and an absolute path', () => {
    const read = () => SCHEMA
    const relative = schemaFingerprint(path.join('prisma', 'schema.prisma'), { read })
    const absolute = schemaFingerprint(path.resolve('prisma', 'schema.prisma'), { read })
    expect(relative).toBe(absolute)
  })

  it('changes when the schema changes', () => {
    const changed = SCHEMA.replace('sqlite', 'postgresql')
    expect(schemaFingerprint('s', { read: () => changed })).not.toBe(schemaFingerprint('s', { read: () => SCHEMA }))
  })
})

describe('recorded fingerprint', () => {
  it('is null when no client has been generated yet', () => {
    expect(recordedFingerprint('stamp', { read: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) } })).toBeNull()
  })

  it('is null when the stamp is empty rather than returning a blank match', () => {
    expect(recordedFingerprint('stamp', { read: () => '  \n' })).toBeNull()
  })

  it('round-trips through the stamp file', () => {
    let written
    recordFingerprint('abc123', 'stamp', { write: (_p, v) => { written = v } })
    expect(recordedFingerprint('stamp', { read: () => written })).toBe('abc123')
  })
})

const held = () => Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })

describe('generation lock', () => {
  it('runs the work and releases the lock', () => {
    const events = []
    const result = withGenerateLock(() => { events.push('work'); return 'done' }, {
      acquire: () => events.push('acquire'),
      release: () => events.push('release'),
    })
    expect(result).toBe('done')
    expect(events).toEqual(['acquire', 'work', 'release'])
  })

  it('releases the lock even when the work throws', () => {
    let released = false
    expect(() =>
      withGenerateLock(() => { throw new Error('generate failed') }, {
        acquire: () => {},
        release: () => { released = true },
      }),
    ).toThrow('generate failed')
    expect(released).toBe(true)
  })

  it('waits for a live lock and proceeds once it clears', () => {
    let attempts = 0
    let slept = 0
    const result = withGenerateLock(() => 'ours', {
      acquire: () => { if (++attempts < 3) throw held() },
      release: () => {},
      heldForMs: () => 500,
      sleep: (ms) => { slept += ms },
    })
    expect(result).toBe('ours')
    expect(attempts).toBe(3)
    expect(slept).toBeGreaterThan(0)
  })

  it('fails loudly rather than generating alongside another run', () => {
    let clock = 0
    expect(() =>
      withGenerateLock(() => 'must not run', {
        acquire: () => { throw held() },
        release: () => {},
        heldForMs: () => 100,
        waitMs: 1000,
        now: () => clock,
        sleep: (ms) => { clock += ms },
      }),
    ).toThrow(/Timed out .* waiting for another test run to finish regenerating/)
  })

  it('reclaims a lock left behind by a run that was killed', () => {
    let attempts = 0
    let reclaimed = 0
    const result = withGenerateLock(() => 'ours', {
      acquire: () => { if (++attempts < 2) throw held() },
      release: () => { reclaimed++ },
      heldForMs: () => 10 * 60 * 1000, // older than any live run
      staleMs: 60 * 1000,
      sleep: () => { throw new Error('a stale lock must be reclaimed, not waited on') },
    })
    expect(result).toBe('ours')
    expect(reclaimed).toBe(2) // once to clear the stale lock, once to release our own
  })

  it('retries immediately when the lock disappears between the failed acquire and the stat', () => {
    let attempts = 0
    const result = withGenerateLock(() => 'ours', {
      acquire: () => { if (++attempts < 2) throw held() },
      release: () => {},
      heldForMs: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
      sleep: () => { throw new Error('a vanished lock must not be waited on') },
    })
    expect(result).toBe('ours')
    expect(attempts).toBe(2)
  })

  it('propagates an unexpected filesystem failure instead of looping', () => {
    expect(() =>
      withGenerateLock(() => 'ours', {
        acquire: () => { throw Object.assign(new Error('read-only filesystem'), { code: 'EROFS' }) },
        release: () => {},
      }),
    ).toThrow(/read-only filesystem/)
  })
})
