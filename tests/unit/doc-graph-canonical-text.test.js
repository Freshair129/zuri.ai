import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  normalizeNewlines,
  readCanonical,
  stripTrailingNulls,
  interiorNullCount,
} from '../../scripts/canonical-text.mjs'

// @req docs governance — a file's identity in the doc graph must describe its
// content, not how git materialized it on this checkout (core.autocrlf).
// @spec .brain/rca/2026-08-16-doc-graph-line-ending-hash-drift.md — hashing raw
// bytes reported 133 of 160 nodes as drifted for content that never changed.

const dir = mkdtempSync(path.join(tmpdir(), 'canonical-text-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8)

function writeAs(name, body, eol) {
  const p = path.join(dir, name)
  writeFileSync(p, body.replace(/\r\n/g, '\n').replace(/\n/g, eol))
  return p
}

const SOURCE = '# Title\n\nline one\nline two\n'

describe('canonical text reader (doc governance)', () => {
  it('reads the same content identically whether the file is LF or CRLF', () => {
    const lf = readCanonical(writeAs('lf.md', SOURCE, '\n'))
    const crlf = readCanonical(writeAs('crlf.md', SOURCE, '\r\n'))
    expect(crlf).toBe(lf)
    expect(lf).toBe(SOURCE)
  })

  it('hashes a CRLF and an LF checkout of one file to the same node hash', () => {
    // The defect: sha(raw CRLF bytes) !== sha(raw LF bytes) for identical content.
    expect(sha(SOURCE.replace(/\n/g, '\r\n'))).not.toBe(sha(SOURCE))
    // The fix: both reach the digest through the canonical reader.
    expect(sha(readCanonical(writeAs('a.md', SOURCE, '\r\n'))))
      .toBe(sha(readCanonical(writeAs('b.md', SOURCE, '\n'))))
  })

  it('is idempotent, so re-normalizing never changes a hash', () => {
    const once = normalizeNewlines(SOURCE.replace(/\n/g, '\r\n'))
    expect(normalizeNewlines(once)).toBe(once)
  })

  it('leaves a lone carriage return alone (only \\r\\n pairs are line endings)', () => {
    expect(normalizeNewlines('a\rb')).toBe('a\rb')
    expect(normalizeNewlines('a\r\nb')).toBe('a\nb')
  })

  it('drops NUL padding at the end of a file', () => {
    // V1's product/roadmap/timeline.md ends in 22 of them. Git scans the whole
    // buffer when guessing text vs binary, so that one run made a markdown file
    // the only tracked document git classified as binary.
    expect(stripTrailingNulls('# Title\n' + '\0'.repeat(22))).toBe('# Title\n')
    expect(stripTrailingNulls('# Title\n')).toBe('# Title\n')
  })

  it('leaves a NUL in the middle alone — that is a damaged file, not padding', () => {
    const damaged = 'before\0after\n'
    expect(stripTrailingNulls(damaged)).toBe(damaged)
    expect(interiorNullCount(damaged)).toBe(1)
    expect(interiorNullCount('# Title\n' + '\0'.repeat(22))).toBe(0)
  })

  it('keeps line-anchored captures free of trailing \\r', () => {
    // What broke doc-preflight's control-block checks on a CRLF checkout.
    const crlf = readCanonical(writeAs('front.md', 'version: "0.1.0"\nstatus: "beta"\n', '\r\n'))
    expect(crlf.match(/^version:\s*"(.+)"$/m)[1]).toBe('0.1.0')
  })
})
