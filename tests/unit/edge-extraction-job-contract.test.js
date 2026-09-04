// @req FR-143 — the edge/cloud wire contract stays machine-valid for both sides of the pull model.
// @spec SDD-085, SEC-025, ADR-059
// @tested tests/unit/edge-extraction-job-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const schema = JSON.parse(fs.readFileSync('contracts/edge-extraction-job.schema.json', 'utf8'))
const example = JSON.parse(fs.readFileSync('contracts/examples/edge-extraction-job.json', 'utf8'))

// The shared candidate schema (SDD-085) is expected to live at this path once the
// asset-management job lane moves it out of the OpenAI adapter — see ADR-059 D-shared
// and the "SHARED CANDIDATE SCHEMA" section of the FR-143/FR-144 implementation
// contract. This lane (contract-poller-docs) never writes to src/modules, so it only
// imports the export read-only, wherever it lands.
const CANDIDATE_MODULE_CANDIDATES = [
  'src/modules/asset-management/infrastructure/asset-evidence-candidate-schema.js',
  'src/modules/asset-management/infrastructure/openai-asset-evidence-extractor.js',
]

async function loadZCandidate() {
  for (const relativePath of CANDIDATE_MODULE_CANDIDATES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const module = await import(pathToFileURL(path.resolve(relativePath)).href)
      if (module?.zCandidate) return { module, path: relativePath }
    } catch {
      // try the next candidate location
    }
  }
  return null
}

// Resolved once, at module load, so the test below can be skipped (not failed) when the
// shared module has not landed yet — this lane never writes to src/modules, so it cannot
// make that module appear, and a hard failure here would block on work outside this lane.
const loadedZCandidate = await loadZCandidate()
if (!loadedZCandidate) {
  // eslint-disable-next-line no-console
  console.warn(
    '[FR-143 contract test] no `zCandidate` export found yet at ' +
      `${CANDIDATE_MODULE_CANDIDATES.join(' or ')} — skipping the Zod round-trip assertion ` +
      'until the asset-management job lane lands the shared candidate schema module (SDD-085).',
  )
}

describe('FR-143/FR-144 edge extraction job contract', () => {
  it('validates the checked-in example against the draft-07 wire schema', () => {
    const ajv = new Ajv({ strict: true, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true)
  })

  it('keeps the schema self-consistent: every top-level example section matches its own $ref definition', () => {
    const ajv = new Ajv({ strict: true, allErrors: true })
    addFormats(ajv)
    for (const section of ['job', 'claimRequest', 'claimResponse', 'completeRequest', 'failRequest', 'jobResponse']) {
      const validate = ajv.compile({ ...schema.definitions[section], definitions: schema.definitions })
      expect(validate(example[section]), `${section}: ${JSON.stringify(validate.errors)}`).toBe(true)
    }
  })

  it('rejects a job payload that leaks a bucket URL, signed link or storage credential (SEC-025, ADR-041 D3)', () => {
    const ajv = new Ajv({ strict: true, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile({ ...schema.definitions.job, definitions: schema.definitions })
    const leaky = { ...example.job, evidence: { ...example.job.evidence, url: 'https://bucket.example/signed?sig=abc' } }
    expect(validate(leaky)).toBe(false)
  })

  it('rejects a claimRequest body that names a businessId or deviceId — identity comes only from the credential', () => {
    const ajv = new Ajv({ strict: true, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile({ ...schema.definitions.claimRequest, definitions: schema.definitions })
    expect(validate({ businessId: 'biz_x', deviceId: 'edge-1' })).toBe(false)
  })

  const itIfCandidateSchemaLanded = loadedZCandidate ? it : it.skip
  itIfCandidateSchemaLanded('the example candidate round-trips through the shared zCandidate schema the OpenAI extractor exports', () => {
    const parsed = loadedZCandidate.module.zCandidate.parse(example.completeRequest.candidate)
    expect(parsed).toEqual(example.completeRequest.candidate)
  })

  it('the JSON-schema candidate definition and the declared shape agree on the field union types', () => {
    const fieldValue = schema.definitions.candidate.properties.fields.items.properties.value
    expect(fieldValue.anyOf.map((entry) => entry.type)).toEqual(['string', 'number', 'boolean', 'null'])
  })
})
