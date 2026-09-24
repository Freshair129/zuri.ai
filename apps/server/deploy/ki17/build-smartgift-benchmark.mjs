#!/usr/bin/env node
// ADR-075 Phase 3, prerequisite P-6 — derive the one benchmark fixture a
// long-running GenesisRAG17 worker can boot with from the SmartGift acceptance
// corpus.
//
// WHY THIS EXISTS — read before changing anything here.
//
// The worker takes exactly one `GENESIS_WORKER_BENCHMARK_FIXTURE`
// (genesisrag17-worker/src/cli.mjs), and validates it with
// `validateBenchmarkFixture`, which requires a root `fixtureVersion` and
// either a top-level legacy `queries` array or a non-empty `benchmarks[]` array.
// Each benchmark entry carries its own `fixtureVersion` and query rows. Anything
// else fails closed at start with BENCHMARK_FIXTURE_INVALID.
//
// `tests/fixtures/genesisrag17-smartgift-corpus-v1.json` is the larger Phase 2
// acceptance corpus: it carries records and harness metadata in addition to
// the per-record queries under `benchmarks[].queries`. This build step projects
// only the worker fixture fields, so one long-running container can still select
// the applicable record without flattening those queries into a global union.
//
// So this script writes a derived fixture that preserves the per-record
// `benchmarks[]` boundary. The worker scopes the selected entry to the candidate
// generation before computing metrics; it must never score an unrelated
// catalog-wide query union. Each row records exactly where it came from, so the
// derivation is auditable rather than implied:
//
//   derivedFrom: { file, sha256, fixtureVersion, benchmarkCount, sourceQueryCount }
//
// WHAT THIS DOES NOT DECIDE. Whether the ADR-073 thresholds (Recall@5 >= .80,
// MRR >= .65, citation correctness 1.00, cross-tenant leakage 0) hold for a
// particular candidate is an acceptance question, not a build question. Gate
// G-3 re-runs the Phase 2 acceptance inside these images and checks each
// candidate-scoped fixture entry.
//
// Node built-ins only; runs inside the image build before any npm install.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

function fail(code, message) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  return error
}

export function deriveSmartgiftBenchmark(corpus, { sourceFile = null, sourceSha256 = null } = {}) {
  if (!corpus || typeof corpus !== 'object' || Array.isArray(corpus)) throw fail('KI17_BENCHMARK_CORPUS_INVALID', 'corpus is not an object')
  if (typeof corpus.fixtureVersion !== 'string' || !corpus.fixtureVersion) throw fail('KI17_BENCHMARK_CORPUS_INVALID', 'corpus has no fixtureVersion')
  if (!Array.isArray(corpus.benchmarks) || corpus.benchmarks.length === 0) throw fail('KI17_BENCHMARK_CORPUS_INVALID', 'corpus has no benchmarks[]')

  let sourceQueryCount = 0
  const benchmarks = []
  for (const benchmark of corpus.benchmarks) {
    if (typeof benchmark?.externalId !== 'string' || benchmark.externalId.trim() === '') {
      throw fail('KI17_BENCHMARK_CORPUS_INVALID', 'benchmark has no externalId')
    }
    if (typeof benchmark?.fixtureVersion !== 'string' || benchmark.fixtureVersion.trim() === '') {
      throw fail('KI17_BENCHMARK_CORPUS_INVALID', `benchmark ${benchmark.externalId} has no fixtureVersion`)
    }
    if (!Array.isArray(benchmark?.queries) || benchmark.queries.length === 0) {
      throw fail('KI17_BENCHMARK_CORPUS_INVALID', `benchmark ${benchmark?.externalId ?? '(unnamed)'} has no queries[]`)
    }
    const queries = []
    for (const row of benchmark.queries) {
      if (typeof row?.query !== 'string' || row.query.trim() === '') throw fail('KI17_BENCHMARK_QUERY_INVALID', `benchmark ${benchmark.externalId} has a query that is not a non-empty string`)
      if (!Array.isArray(row.relevantTexts) || row.relevantTexts.length === 0 || row.relevantTexts.some((text) => typeof text !== 'string' || text.length === 0)) {
        throw fail('KI17_BENCHMARK_QUERY_INVALID', `benchmark ${benchmark.externalId} query ${JSON.stringify(row.query.slice(0, 60))} has no usable relevantTexts`)
      }
      sourceQueryCount += 1
      queries.push({ query: row.query, relevantTexts: [...row.relevantTexts], fromBenchmarks: [benchmark.externalId] })
    }
    benchmarks.push({
      externalId: benchmark.externalId,
      entityType: benchmark.entityType ?? null,
      fixtureVersion: benchmark.fixtureVersion,
      queries,
    })
  }

  return {
    fixtureVersion: corpus.fixtureVersion,
    derived: true,
    derivedBy: 'apps/server/deploy/ki17/build-smartgift-benchmark.mjs',
    derivedFrom: {
      file: sourceFile,
      sha256: sourceSha256,
      fixtureVersion: corpus.fixtureVersion,
      ontologyVersion: corpus.ontologyVersion ?? null,
      benchmarkCount: corpus.benchmarks.length,
      sourceQueryCount,
      shape: 'per-record benchmarks[].queries, scoped by candidate generation',
      // Carried through so the file the worker boots with can itself be the
      // `--base` of the next per-record merge (build-smartgift-real-corpus.mjs)
      // without losing which catalog files it came from. The worker reads
      // neither field.
      ...(Array.isArray(corpus.generatedFrom) ? { generatedFrom: corpus.generatedFrom } : {}),
      ...(corpus.merge ? { merge: corpus.merge } : {}),
    },
    benchmarks,
  }
}

function main(argv) {
  let corpusPath = null
  let outPath = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--corpus') { corpusPath = argv[index + 1]; index += 1; continue }
    if (argv[index] === '--out') { outPath = argv[index + 1]; index += 1; continue }
    throw fail('KI17_BENCHMARK_ARGS_INVALID', `unknown argument ${argv[index]}\n  usage: node build-smartgift-benchmark.mjs --corpus <corpus.json> --out <benchmark.json>`)
  }
  if (!corpusPath || !outPath) throw fail('KI17_BENCHMARK_ARGS_INVALID', 'both --corpus and --out are required')

  const raw = readFileSync(corpusPath)
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const fixture = deriveSmartgiftBenchmark(JSON.parse(raw.toString('utf8')), { sourceFile: path.basename(corpusPath), sourceSha256: sha256 })

  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`)
  process.stdout.write(`ki17 benchmark derived  ${fixture.derivedFrom.sourceQueryCount} per-record queries from ${fixture.derivedFrom.benchmarkCount} benchmarks -> ${outPath}\n`)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  }
}
