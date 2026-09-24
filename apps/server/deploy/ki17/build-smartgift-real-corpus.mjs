#!/usr/bin/env node
// Derive a benchmark corpus (the input of build-smartgift-benchmark.mjs) from REAL
// SmartGift catalog files, instead of the Phase 2 test fixture.
//
// Why: the worker scores exact chunk text (`relevantTexts`), and scopes each
// benchmark to the candidate generation. A benchmark derived from the test corpus
// does not match real records' chunks: checked on 2026-09-24, 20 of the 22 real
// records have no applicable query and the other 2 share only one category claim
// with it, so a real upload cannot be judged by it. Here every gold text is produced by the same code path
// production uses: splitSmartGiftCatalogRecords -> renderStructuredCatalogDocument,
// one record per source, sections joined by one blank line.
//
// Queries are natural phrasings (name / code / relation words), never the chunk
// text itself, so the benchmark still measures retrieval rather than an echo.
//
// Run with vite-node from apps/server (the modules use extensionless imports and
// the `@/` alias, so the vitest config is needed):
//   npx vite-node --config vitest.config.js deploy/ki17/build-smartgift-real-corpus.mjs -- \
//     --fixture-version smartgift-real-catalog-v2 --base <deployed.json> --out <corpus.json> <catalog.json>...
// then derive the worker fixture from that corpus:
//   node deploy/ki17/build-smartgift-benchmark.mjs --corpus <corpus.json> --out <benchmark.json>
// and prove every record you are about to upload is covered before installing it:
//   npx vite-node --config vitest.config.js deploy/ki17/build-smartgift-real-corpus.mjs -- \
//     --check <benchmark.json> <catalog.json>...
//
// Regenerate whenever the catalog changes: the worker scopes the benchmark to
// each candidate's exact chunks, so a changed record with no matching gold text
// fails Stage 16 with BENCHMARK_NO_APPLICABLE_QUERIES. That is the per-record
// publish condition ADR-073's 2026-09-24 amendment keeps; the operator procedure
// is GENESISRAG17-EDGE-DEPLOYMENT.md §10.1.
//
// Why `--base` exists. The worker boots with exactly one fixture file, and a
// candidate generation holds only the record being published, so the file has
// to be cumulative: every record that may ever be re-published (a new revision,
// a re-upload) needs its entry. Deriving from only the new catalog file would
// silently drop every record published before it. `--base` starts from the
// fixture that is deployed today, in either shape (this script's corpus, or
// the derived worker fixture that sits on the ki17-state volume), and applies
// the new files on top of it:
//
//   added      — a record the base does not have
//   replaced   — a record whose rendered sections changed; its old gold texts
//                no longer match anything the worker will hold
//   unchanged  — a record whose queries are identical; it keeps its original
//                per-record fixtureVersion, because nothing about it changed
//
// A merge that adds or replaces anything must name a new `--fixture-version`:
// the per-record version is what Stage 16's metrics record, and two different
// gold texts under one version string would make a verdict unattributable.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { splitSmartGiftCatalogRecords } from '../../src/modules/knowledge/smartgift-catalog-adapter.js'
import { renderStructuredCatalogDocument } from '../../src/modules/knowledge/genesisrag17-structured-record.js'

function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

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

function readCatalogFile(file) {
  const raw = readFileSync(file)
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const fileName = path.basename(file)
  const split = splitSmartGiftCatalogRecords({ content: raw.toString('utf8'), fileAssetId: 'benchmark-derivation', fileSha256: sha256, fileName })
  if (split.denied.length) throw fail('KI17_CATALOG_DENIED', `${fileName}: ${split.denied.length} record(s) denied by the adapter; fix the source first`)
  return { fileName, sha256, records: split.records }
}

// The gold texts are the sections production renders for a record — the exact
// chunk texts the worker will hold for it.
function renderedSections(item) {
  return renderStructuredCatalogDocument(item.content).sections
}

// Turn a previously deployed benchmark into corpus benchmarks. Accepts this
// script's own corpus or the derived worker fixture (`derived: true`) written
// by build-smartgift-benchmark.mjs, which is the file the worker actually boots
// with. The worker fixture drops each query's `kind` and adds `fromBenchmarks`;
// neither is part of what the worker scores, so the round trip loses nothing
// the gate reads.
export function corpusFromDeployed(deployed) {
  if (!deployed || typeof deployed !== 'object' || Array.isArray(deployed)) throw fail('KI17_BASE_INVALID', 'base is not an object')
  if (typeof deployed.fixtureVersion !== 'string' || !deployed.fixtureVersion) throw fail('KI17_BASE_INVALID', 'base has no fixtureVersion')
  if (!Array.isArray(deployed.benchmarks) || deployed.benchmarks.length === 0) throw fail('KI17_BASE_INVALID', 'base has no benchmarks[]')
  const seen = new Set()
  const benchmarks = deployed.benchmarks.map((benchmark) => {
    if (typeof benchmark?.externalId !== 'string' || !benchmark.externalId) throw fail('KI17_BASE_INVALID', 'a base benchmark has no externalId')
    if (seen.has(benchmark.externalId)) throw fail('KI17_BASE_INVALID', `base lists ${benchmark.externalId} twice`)
    seen.add(benchmark.externalId)
    if (typeof benchmark.fixtureVersion !== 'string' || !benchmark.fixtureVersion) throw fail('KI17_BASE_INVALID', `base benchmark ${benchmark.externalId} has no fixtureVersion`)
    if (!Array.isArray(benchmark.queries) || benchmark.queries.length === 0) throw fail('KI17_BASE_INVALID', `base benchmark ${benchmark.externalId} has no queries[]`)
    return {
      externalId: benchmark.externalId,
      entityType: benchmark.entityType ?? null,
      fixtureVersion: benchmark.fixtureVersion,
      queries: benchmark.queries.map((row) => ({
        query: row.query,
        relevantTexts: [...row.relevantTexts],
        ...(row.kind ? { kind: row.kind } : {}),
      })),
    }
  })
  const generatedFrom = deployed.derived
    ? (Array.isArray(deployed.derivedFrom?.generatedFrom) ? deployed.derivedFrom.generatedFrom : [])
    : (Array.isArray(deployed.generatedFrom) ? deployed.generatedFrom : [])
  return { fixtureVersion: deployed.fixtureVersion, generatedFrom, benchmarks }
}

// What the worker compares: the query string and its gold texts, in order.
function sameScoring(left, right) {
  if (left.queries.length !== right.queries.length) return false
  return left.queries.every((row, index) => {
    const other = right.queries[index]
    return row.query === other.query
      && row.relevantTexts.length === other.relevantTexts.length
      && row.relevantTexts.every((text, at) => text === other.relevantTexts[at])
  })
}

export function deriveRealCorpus(files, { fixtureVersion, base = null, baseSha256 = null } = {}) {
  if (typeof fixtureVersion !== 'string' || !fixtureVersion) throw fail('KI17_ARGS_INVALID', 'fixtureVersion is required')
  const derived = []
  const sources = []
  const derivedIds = new Set()
  for (const file of files) {
    const { fileName, sha256, records } = readCatalogFile(file)
    sources.push({ file: fileName, sha256 })
    for (const item of records) {
      if (derivedIds.has(item.externalId)) throw fail('KI17_CATALOG_DUPLICATE', `${item.externalId} appears in more than one input record; pass each record once`)
      derivedIds.add(item.externalId)
      const queries = renderedSections(item).map((section) => ({
        query: section.kind === 'descriptive' ? descriptiveQuery(item.record) : claimQuery(section.text),
        relevantTexts: [section.text],
        kind: section.kind,
      }))
      derived.push({
        externalId: item.externalId,
        entityType: item.entityType,
        fixtureVersion: `${fixtureVersion}:${item.externalId}`,
        queries,
      })
    }
  }

  if (!base) {
    return {
      fixtureVersion,
      ontologyVersion: 'ontology_v2',
      purpose: 'Retrieval benchmark derived from the real SmartGift catalog files uploaded to GenesisRAG17.',
      generatedFrom: sources,
      benchmarks: derived,
    }
  }

  const prior = corpusFromDeployed(base)
  const benchmarks = prior.benchmarks.map((benchmark) => ({ ...benchmark }))
  const indexById = new Map(benchmarks.map((benchmark, index) => [benchmark.externalId, index]))
  const added = []
  const replaced = []
  const unchanged = []
  for (const benchmark of derived) {
    const at = indexById.get(benchmark.externalId)
    if (at === undefined) {
      indexById.set(benchmark.externalId, benchmarks.length)
      benchmarks.push(benchmark)
      added.push(benchmark.externalId)
    } else if (sameScoring(benchmarks[at], benchmark)) {
      unchanged.push(benchmark.externalId)
    } else {
      benchmarks[at] = benchmark
      replaced.push(benchmark.externalId)
    }
  }
  const changed = added.length > 0 || replaced.length > 0
  if (changed) {
    // Every version already used in the base, not only its top-level one: an
    // unchanged record keeps the version it was first judged under, so a base
    // at v3 can still hold `v1:X`. Re-using v1 would recreate `v1:X` with
    // different gold texts — the unattributable verdict this guard prevents.
    // Its limit: a version whose every record was since replaced is no longer
    // in the base, so the guard cannot see it. That is why §10.1 only ever moves
    // to v<N+1> and step 8 records each version used.
    const usedVersions = new Set([prior.fixtureVersion])
    for (const benchmark of prior.benchmarks) {
      const suffix = `:${benchmark.externalId}`
      if (benchmark.fixtureVersion.endsWith(suffix)) usedVersions.add(benchmark.fixtureVersion.slice(0, -suffix.length))
    }
    if (usedVersions.has(fixtureVersion)) {
      throw fail('KI17_FIXTURE_VERSION_REUSED', `--fixture-version ${fixtureVersion} is already used in the deployed fixture (${[...usedVersions].join(', ')}); a merge that adds or replaces a record needs a new one`)
    }
  }
  // Lineage grows only when something is installed. A production fixture
  // written before --base existed carries no generatedFrom at all, so the
  // first merge onto it lists only the new files; the §10.1 step 8 record is
  // where the earlier sources are written down.
  const generatedFrom = [...prior.generatedFrom]
  if (changed) {
    for (const source of sources) {
      if (!generatedFrom.some((known) => known.sha256 === source.sha256 && known.file === source.file)) generatedFrom.push(source)
    }
  }
  return {
    fixtureVersion: changed ? fixtureVersion : prior.fixtureVersion,
    ontologyVersion: 'ontology_v2',
    purpose: 'Retrieval benchmark derived from the real SmartGift catalog files uploaded to GenesisRAG17.',
    generatedFrom,
    merge: {
      basedOn: { fixtureVersion: prior.fixtureVersion, sha256: baseSha256 },
      added,
      replaced,
      unchanged,
    },
    benchmarks,
  }
}

// Preflight for an upload: would the worker holding `fixture` find gold texts
// for every section of every record in these files? A record passes only when
// every one of its rendered sections is a gold text somewhere in the fixture —
// one missing section already means Stage 16 scores that record on part of it,
// and none means BENCHMARK_NO_APPLICABLE_QUERIES.
export function checkCoverage(fixture, files) {
  if (!fixture || !Array.isArray(fixture.benchmarks)) throw fail('KI17_CHECK_INVALID', 'the fixture to check has no benchmarks[]')
  const gold = new Set()
  for (const benchmark of fixture.benchmarks) {
    for (const row of benchmark.queries ?? []) for (const text of row.relevantTexts ?? []) gold.add(text)
  }
  const records = []
  for (const file of files) {
    const { fileName, records: items } = readCatalogFile(file)
    for (const item of items) {
      const sections = renderedSections(item)
      const missing = sections.filter((section) => !gold.has(section.text)).length
      records.push({
        file: fileName,
        externalId: item.externalId,
        sections: sections.length,
        missing,
        status: missing === 0 ? 'covered' : (missing === sections.length ? 'missing' : 'partial'),
      })
    }
  }
  return { covered: records.every((record) => record.status === 'covered'), records }
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function main(argv) {
  let out = null
  let fixtureVersion = null
  let basePath = null
  let checkPath = null
  const files = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--') continue
    if (argv[i] === '--out') { out = argv[++i]; continue }
    if (argv[i] === '--fixture-version') { fixtureVersion = argv[++i]; continue }
    if (argv[i] === '--base') { basePath = argv[++i]; continue }
    if (argv[i] === '--check') { checkPath = argv[++i]; continue }
    files.push(argv[i])
  }
  if (files.length === 0) throw fail('KI17_ARGS_INVALID', 'usage: [--base <deployed.json>] --fixture-version <v> --out <corpus.json> <catalog.json>...  |  --check <benchmark.json> <catalog.json>...')

  if (checkPath) {
    const result = checkCoverage(JSON.parse(readFileSync(checkPath, 'utf8')), files)
    for (const record of result.records) process.stdout.write(`${record.status.padEnd(8)} ${record.externalId}  ${record.sections - record.missing}/${record.sections} sections  (${record.file})\n`)
    process.stdout.write(result.covered ? `OK  every record is covered by ${path.basename(checkPath)}\n` : `NOT COVERED  do not upload until the fixture covers every record above\n`)
    if (!result.covered) process.exitCode = 2
    return
  }

  if (!out || !fixtureVersion) throw fail('KI17_ARGS_INVALID', 'both --fixture-version and --out are required')
  const base = basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : null
  const corpus = deriveRealCorpus(files, { fixtureVersion, base, baseSha256: basePath ? sha256Of(basePath) : null })
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(corpus, null, 2)}\n`)
  const queryCount = corpus.benchmarks.reduce((n, b) => n + b.queries.length, 0)
  process.stdout.write(`real corpus  ${corpus.benchmarks.length} records, ${queryCount} queries -> ${out}\n`)
  if (corpus.merge) {
    const { added, replaced, unchanged, basedOn } = corpus.merge
    process.stdout.write(`merged onto ${basedOn.fixtureVersion}  added ${added.length} [${added.join(' ')}]  replaced ${replaced.length} [${replaced.join(' ')}]  unchanged ${unchanged.length}\n`)
    if (!added.length && !replaced.length) process.stdout.write('nothing changed: the deployed fixture already covers these files; there is nothing to install\n')
  }
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
