#!/usr/bin/env node
// Derive a benchmark corpus (the input of build-smartgift-benchmark.mjs) from REAL
// SmartGift catalog files, instead of the Phase 2 test fixture.
//
// Why: the worker scores exact chunk text (`relevantTexts`), and scopes each
// benchmark to the candidate generation. A benchmark derived from the test corpus
// never matches a real record's chunks, so a real upload can never pass the
// retrieval dimension. Here every gold text is produced by the same code path
// production uses: splitSmartGiftCatalogRecords -> renderStructuredCatalogDocument,
// one record per source, sections joined by one blank line.
//
// Queries are natural phrasings (name / code / relation words), never the chunk
// text itself, so the benchmark still measures retrieval rather than an echo.
//
// Run with vite-node from apps/server (the modules use extensionless imports and
// the `@/` alias, so the vitest config is needed):
//   npx vite-node --config vitest.config.js deploy/ki17/build-smartgift-real-corpus.mjs -- \
//     --fixture-version smartgift-real-catalog-v1 --out <corpus.json> <catalog.json>...
// then derive the worker fixture from that corpus:
//   node deploy/ki17/build-smartgift-benchmark.mjs --corpus <corpus.json> --out <benchmark.json>
//
// Regenerate whenever the catalog changes: the worker scopes the benchmark to
// each candidate's exact chunks, so a changed record with no matching gold text
// fails Stage 16 with BENCHMARK_NO_APPLICABLE_QUERIES.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { splitSmartGiftCatalogRecords } from '../../src/modules/knowledge/smartgift-catalog-adapter.js'
import { renderStructuredCatalogDocument } from '../../src/modules/knowledge/genesisrag17-structured-record.js'

function descriptiveQuery(record) {
  if (record.entityType === 'ProductMaster') {
    return [record.nameEn, record.nameTh, record.code, 'product specification and price'].filter(Boolean).join(' ')
  }
  if (record.entityType === 'BundleOffer') {
    return [record.nameTh, record.nameEn, record.code, 'gift set offer'].filter(Boolean).join(' ')
  }
  return [record.productExternalId, `qty ${record.qty}`, 'price list entry'].join(' ')
}

function claimQuery(text) {
  const claim = JSON.parse(text)
  return [claim.subject, claim.predicate, claim.object].join(' ')
}

export function deriveRealCorpus(files, { fixtureVersion }) {
  const benchmarks = []
  const sources = []
  for (const file of files) {
    const raw = readFileSync(file)
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const fileName = path.basename(file)
    sources.push({ file: fileName, sha256 })
    const split = splitSmartGiftCatalogRecords({ content: raw.toString('utf8'), fileAssetId: 'benchmark-derivation', fileSha256: sha256, fileName })
    if (split.denied.length) throw new Error(`${fileName}: ${split.denied.length} record(s) denied by the adapter; fix the source first`)
    for (const item of split.records) {
      const { sections } = renderStructuredCatalogDocument(item.content)
      const queries = sections.map((section) => ({
        query: section.kind === 'descriptive' ? descriptiveQuery(item.record) : claimQuery(section.text),
        relevantTexts: [section.text],
        kind: section.kind,
      }))
      benchmarks.push({
        externalId: item.externalId,
        entityType: item.entityType,
        fixtureVersion: `${fixtureVersion}:${item.externalId}`,
        queries,
      })
    }
  }
  return {
    fixtureVersion,
    ontologyVersion: 'ontology_v2',
    purpose: 'Retrieval benchmark derived from the real SmartGift catalog files uploaded to GenesisRAG17.',
    generatedFrom: sources,
    benchmarks,
  }
}

function main(argv) {
  let out = null
  let fixtureVersion = null
  const files = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--') continue
    if (argv[i] === '--out') { out = argv[++i]; continue }
    if (argv[i] === '--fixture-version') { fixtureVersion = argv[++i]; continue }
    files.push(argv[i])
  }
  if (!out || !fixtureVersion || files.length === 0) throw new Error('usage: --fixture-version <v> --out <corpus.json> <catalog.json>...')
  const corpus = deriveRealCorpus(files, { fixtureVersion })
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(corpus, null, 2)}\n`)
  const queryCount = corpus.benchmarks.reduce((n, b) => n + b.queries.length, 0)
  process.stdout.write(`real corpus  ${corpus.benchmarks.length} records, ${queryCount} queries -> ${out}\n`)
}

// Only vite-node can run this file (the imported modules need the `@/` alias),
// and it puts its own entry in argv[1], not this file. Importing the module
// from a test (vitest) must not run main().
const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
const invokedDirectly = path.basename(entry) === 'vite-node.mjs'
  || entry === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  }
}
