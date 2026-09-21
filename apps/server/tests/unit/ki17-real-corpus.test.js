// @req FR-187 — the retrieval benchmark for real SmartGift uploads is derived
// through the production render path, so every gold text is an exact chunk the
// worker will hold, and its queries never echo that chunk.
// @tested tests/unit/ki17-real-corpus.test.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { deriveRealCorpus } from '../../deploy/ki17/build-smartgift-real-corpus.mjs'
import { deriveSmartgiftBenchmark } from '../../deploy/ki17/build-smartgift-benchmark.mjs'
import { splitSmartGiftCatalogRecords } from '@/modules/knowledge/smartgift-catalog-adapter'
import { renderStructuredCatalogDocument } from '@/modules/knowledge/genesisrag17-structured-record'

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/genesisrag17/smartgift-catalog')
const files = ['products.json', 'bundles.json'].map((name) => path.join(fixtureDir, name))

describe('deriveRealCorpus', () => {
  const corpus = deriveRealCorpus(files, { fixtureVersion: 'test-real-v1' })

  it('makes one benchmark per record with a per-record fixture version', () => {
    expect(corpus.benchmarks.map((b) => b.externalId)).toEqual([
      ...JSON.parse(readFileSync(files[0], 'utf8')).map((r) => r.externalId),
      ...JSON.parse(readFileSync(files[1], 'utf8')).map((r) => r.externalId),
    ])
    for (const b of corpus.benchmarks) expect(b.fixtureVersion).toBe(`test-real-v1:${b.externalId}`)
    expect(corpus.generatedFrom.map((s) => s.file)).toEqual(['products.json', 'bundles.json'])
  })

  it('uses exactly the chunks the production render path produces as gold texts', () => {
    const content = readFileSync(files[0], 'utf8')
    const split = splitSmartGiftCatalogRecords({ content, fileAssetId: 'x', fileSha256: 'a'.repeat(64), fileName: 'products.json' })
    const first = split.records[0]
    const sections = renderStructuredCatalogDocument(first.content).sections.map((s) => s.text)
    const benchmark = corpus.benchmarks.find((b) => b.externalId === first.externalId)
    expect(benchmark.queries.map((q) => q.relevantTexts[0])).toEqual(sections)
  })

  it('never uses a chunk text as its own query', () => {
    for (const b of corpus.benchmarks) {
      for (const q of b.queries) expect(q.query).not.toBe(q.relevantTexts[0])
    }
  })

  it('is accepted by the worker fixture builder', () => {
    const fixture = deriveSmartgiftBenchmark(corpus, { sourceFile: 'corpus.json', sourceSha256: 'b'.repeat(64) })
    expect(fixture.benchmarks).toHaveLength(corpus.benchmarks.length)
    expect(fixture.derivedFrom.sourceQueryCount).toBe(corpus.benchmarks.reduce((n, b) => n + b.queries.length, 0))
  })
})
