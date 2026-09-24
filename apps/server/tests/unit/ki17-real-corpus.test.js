// @req FR-187 — the retrieval benchmark for real SmartGift uploads is derived
// through the production render path, so every gold text is an exact chunk the
// worker will hold, and its queries never echo that chunk.
// @tested tests/unit/ki17-real-corpus.test.js
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { deriveRealCorpus, corpusFromDeployed, checkCoverage } from '../../deploy/ki17/build-smartgift-real-corpus.mjs'
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

// ADR-073 amendment 2026-09-24 keeps the per-record benchmark as the Stage 16/17
// publish condition, so adding a record is an operator step that starts from
// the fixture the worker boots with today (GENESISRAG17-EDGE-DEPLOYMENT.md
// §10.1). That file is the derived worker fixture, and it must stay cumulative:
// the worker boots with one file, and a record dropped from it can never be
// re-published.
describe('per-record merge onto the deployed fixture', () => {
  const [products, bundles] = files
  const productIds = JSON.parse(readFileSync(products, 'utf8')).map((r) => r.externalId)
  const bundleIds = JSON.parse(readFileSync(bundles, 'utf8')).map((r) => r.externalId)
  // What sits on the ki17-state volume after a first install of products only.
  const deployed = deriveSmartgiftBenchmark(
    deriveRealCorpus([products], { fixtureVersion: 'real-v1' }),
    { sourceFile: 'corpus-v1.json', sourceSha256: 'c'.repeat(64) },
  )

  it('adds a new record under the new version and keeps every deployed record exactly as it was', () => {
    const merged = deriveRealCorpus([bundles], { fixtureVersion: 'real-v2', base: deployed, baseSha256: 'd'.repeat(64) })
    expect(merged.fixtureVersion).toBe('real-v2')
    expect(merged.merge).toEqual({ basedOn: { fixtureVersion: 'real-v1', sha256: 'd'.repeat(64) }, added: bundleIds, replaced: [], unchanged: [] })
    expect(merged.benchmarks.map((b) => b.externalId)).toEqual([...productIds, ...bundleIds])
    for (const id of productIds) {
      const before = deployed.benchmarks.find((b) => b.externalId === id)
      const after = merged.benchmarks.find((b) => b.externalId === id)
      expect(after.fixtureVersion).toBe('real-v1:' + id)
      expect(after.queries.map((q) => [q.query, q.relevantTexts])).toEqual(before.queries.map((q) => [q.query, q.relevantTexts]))
    }
    for (const id of bundleIds) expect(merged.benchmarks.find((b) => b.externalId === id).fixtureVersion).toBe('real-v2:' + id)
    expect(merged.generatedFrom.map((s) => s.file)).toEqual(['products.json', 'bundles.json'])
  })

  it('reports nothing to install when every record in the files is already covered, and keeps the deployed version', () => {
    const merged = deriveRealCorpus([products], { fixtureVersion: 'real-v2', base: deployed })
    expect(merged.merge.added).toEqual([])
    expect(merged.merge.replaced).toEqual([])
    expect(merged.merge.unchanged).toEqual(productIds)
    expect(merged.fixtureVersion).toBe('real-v1')
  })

  it('replaces a record whose rendered sections changed, because its old gold texts can no longer match', () => {
    const changed = JSON.parse(readFileSync(products, 'utf8'))
    changed[0] = { ...changed[0], nameEn: `${changed[0].nameEn} (2027 edition)` }
    const dir = mkdtempSync(path.join(tmpdir(), 'ki17-merge-'))
    const changedFile = path.join(dir, 'products.json')
    writeFileSync(changedFile, JSON.stringify(changed))
    const merged = deriveRealCorpus([changedFile], { fixtureVersion: 'real-v2', base: deployed })
    expect(merged.merge.replaced).toEqual([changed[0].externalId])
    expect(merged.merge.unchanged).toEqual(productIds.slice(1))
    expect(merged.benchmarks.find((b) => b.externalId === changed[0].externalId).fixtureVersion).toBe(`real-v2:${changed[0].externalId}`)
    expect(merged.benchmarks).toHaveLength(productIds.length)
  })

  it('refuses to add or replace a record under the deployed fixture version', () => {
    expect(() => deriveRealCorpus([bundles], { fixtureVersion: 'real-v1', base: deployed })).toThrow(/KI17_FIXTURE_VERSION_REUSED/)
  })

  it('refuses the same record twice in one merge', () => {
    expect(() => deriveRealCorpus([products, products], { fixtureVersion: 'real-v2', base: deployed })).toThrow(/KI17_CATALOG_DUPLICATE/)
  })

  it('round-trips the worker fixture: the deployed file carries its catalog lineage into the next merge', () => {
    expect(deployed.derivedFrom.generatedFrom.map((s) => s.file)).toEqual(['products.json'])
    const merged = deriveRealCorpus([bundles], { fixtureVersion: 'real-v2', base: deployed })
    const next = deriveSmartgiftBenchmark(merged, { sourceFile: 'corpus-v2.json', sourceSha256: 'e'.repeat(64) })
    expect(next.derivedFrom.generatedFrom.map((s) => s.file)).toEqual(['products.json', 'bundles.json'])
    expect(next.derivedFrom.merge.added).toEqual(bundleIds)
    expect(corpusFromDeployed(next).benchmarks.map((b) => b.externalId)).toEqual([...productIds, ...bundleIds])
  })
})

describe('checkCoverage — the pre-upload check', () => {
  const [products, bundles] = files
  const productsOnly = deriveSmartgiftBenchmark(deriveRealCorpus([products], { fixtureVersion: 'real-v1' }))

  it('says a record the deployed fixture has never seen is missing, which is what Stage 16 would fail with BENCHMARK_NO_APPLICABLE_QUERIES', () => {
    const result = checkCoverage(productsOnly, [products, bundles])
    expect(result.covered).toBe(false)
    expect(result.records.filter((r) => r.file === 'products.json').every((r) => r.status === 'covered')).toBe(true)
    expect(result.records.filter((r) => r.file === 'bundles.json').every((r) => r.status === 'missing')).toBe(true)
  })

  it('says every record is covered once the merged fixture is installed', () => {
    const merged = deriveSmartgiftBenchmark(deriveRealCorpus([bundles], { fixtureVersion: 'real-v2', base: productsOnly }))
    expect(checkCoverage(merged, [products, bundles]).covered).toBe(true)
  })
})
