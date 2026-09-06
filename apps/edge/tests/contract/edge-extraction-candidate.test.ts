import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type { ModelPort, ModelRequest } from '../../src/answer/model-port.js';
import { createLocalEvidenceExtractor } from '../../src/evidence/extraction-extractor.js';
import { ExtractionJob, buildCompletePayload, buildFailPayload } from '../../src/evidence/extraction-contract.js';

/**
 * The cross-repository contract: a candidate this device's extractor actually produced,
 * validated against the cloud's own schema.
 *
 * The schema is a committed copy (`tests/fixtures/edge-extraction-job.schema.json`) of
 * `contracts/edge-extraction-job.schema.json` in the zuri-ai repository, taken on
 * 2026-09-04. It is copied rather than read across at runtime on purpose: a test that
 * reached into another checkout would pass or fail based on whether that checkout happened
 * to be present and on which branch it sat, and CI has neither. The cost is that a cloud
 * change lands here as a deliberate re-copy, which is the right kind of work to be visible.
 *
 * The model is a fixture, not a live daemon, for the same reason: this test asks whether
 * the *shape* is right, and a real model would make it a slow, flaky test of something else.
 */

const SCHEMA_PATH = path.join(import.meta.dirname, '..', 'fixtures', 'edge-extraction-job.schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as JsonSchema;

interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  definitions?: Record<string, JsonSchema>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  minItems?: number;
  format?: string;
}

/**
 * A draft-07 validator covering exactly the keywords this schema uses.
 *
 * Written out rather than pulled in: adding a validator dependency to an edge runtime that
 * ships on customer hardware, to check one shape in one test, is a poor trade. The keyword
 * list is asserted below, so a future schema that starts using something this cannot check
 * fails loudly instead of passing vacuously — which is the only real danger of a hand-rolled
 * validator.
 */
function validate(value: unknown, node: JsonSchema, at = '$'): string[] {
  const errors: string[] = [];

  if (node.$ref) {
    const key = node.$ref.replace('#/definitions/', '');
    const target = schema.definitions?.[key];
    if (!target) return [`${at}: unresolvable $ref ${node.$ref}`];
    return validate(value, target, at);
  }

  if (node.anyOf) {
    const ok = node.anyOf.some((branch) => validate(value, branch, at).length === 0);
    if (!ok) errors.push(`${at}: matched none of the anyOf branches`);
    return errors;
  }

  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${at}: expected ${types.join('|')}, got ${describeType(value)}`);
      return errors;
    }
  }

  if (node.enum && !node.enum.some((allowed) => allowed === value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(node.enum)}`);
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) errors.push(`${at}: shorter than ${node.minLength}`);
    if (node.maxLength !== undefined && value.length > node.maxLength) errors.push(`${at}: longer than ${node.maxLength}`);
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) errors.push(`${at}: below ${node.minimum}`);
    if (node.maximum !== undefined && value > node.maximum) errors.push(`${at}: above ${node.maximum}`);
  }

  if (Array.isArray(value)) {
    if (node.maxItems !== undefined && value.length > node.maxItems) errors.push(`${at}: more than ${node.maxItems} items`);
    if (node.minItems !== undefined && value.length < node.minItems) errors.push(`${at}: fewer than ${node.minItems} items`);
    if (node.items) value.forEach((entry, i) => errors.push(...validate(entry, node.items!, `${at}[${i}]`)));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of node.required ?? []) {
      if (!(key in record)) errors.push(`${at}: missing required "${key}"`);
    }
    for (const [key, entry] of Object.entries(record)) {
      const child = node.properties?.[key];
      if (child) {
        errors.push(...validate(entry, child, `${at}.${key}`));
      } else if (node.additionalProperties === false) {
        // The keyword that matters most here: the cloud rejects an unexpected key with a
        // 400 that also fails the job.
        errors.push(`${at}: additional property "${key}" is not allowed`);
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Every keyword the validator above understands. */
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', 'definitions', '$ref', 'type', 'enum', 'properties',
  'required', 'additionalProperties', 'items', 'anyOf', 'minLength', 'maxLength', 'minimum',
  'maximum', 'maxItems', 'minItems', 'format',
]);

function collectKeywords(node: unknown, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((entry) => collectKeywords(entry, found));
    return found;
  }
  for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
    found.add(key);
    // Under `properties` the keys are field names, not keywords; only recurse into values.
    if (key === 'properties' || key === 'definitions') {
      Object.values(entry as Record<string, unknown>).forEach((child) => collectKeywords(child, found));
    } else {
      collectKeywords(entry, found);
    }
  }
  return found;
}

/** A model that answers with whatever the test scripted, so no daemon is needed. */
function fixtureModel(text: string, model = 'qwen3-vl:8b-fixture'): ModelPort {
  return {
    id: 'openai-compatible',
    model,
    async generate(_request: ModelRequest) {
      return { text };
    },
  };
}

const job: ExtractionJob = {
  id: 'aej_01J9Q2M4X7K3B8T6R0V5N2C1D',
  businessId: 'biz_01J8ZK4Q7M2N5P9R3T6V8W1X0',
  evidenceId: 'aev_01J9Q1P8H4J2K6M0N3Q5R7T9V',
  status: 'CLAIMED',
  attempts: 1,
  version: 2,
  createdAt: '2026-09-04T03:11:02.000Z',
  evidence: { mime: 'image/jpeg', byteSize: 418233, documentType: 'RECEIPT' },
};

/** What a local vision model plausibly answers: fenced JSON with a sentence around it. */
const MODEL_REPLY = [
  'Here is what I could read:',
  '```json',
  JSON.stringify({
    documentType: 'RECEIPT',
    fields: [
      { field: 'vendorName', value: 'บริษัท สยามฮาร์ดแวร์ จำกัด', confidence: 0.97, page: 1, anchor: 'header' },
      { field: 'documentDate', value: '2026-08-29', page: 1, anchor: 'วันที่' },
      { field: 'totalAmount', value: 18750, page: 1, anchor: 'รวมทั้งสิ้น', bounds: { x: 0.1, y: 0.9, width: 0.2, height: 0.03 } },
      { field: 'taxId', value: null },
    ],
  }),
  '```',
  'Let me know if you need anything else.',
].join('\n');

describe('the candidate this device produces satisfies the cloud contract', () => {
  it('the committed schema copy only uses keywords this validator checks', () => {
    // Without this, a cloud schema that started using `patternProperties` or `oneOf` would
    // be silently unchecked and every candidate would "pass".
    const unsupported = [...collectKeywords(schema)].filter((keyword) => !SUPPORTED_KEYWORDS.has(keyword));
    assert.deepStrictEqual(
      unsupported,
      [],
      `the schema uses keywords this validator ignores: ${unsupported.join(', ')} — teach it, or the check is theatre`
    );
  });

  it('the validator rejects what it should, so a pass means something', () => {
    const candidateSchema = schema.definitions!.candidate;
    assert.ok(validate({ schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [] }, candidateSchema).length === 0);
    // Each of these is a real 400-and-fail-the-job on the cloud side.
    assert.ok(validate({ schemaVersion: '2.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [] }, candidateSchema).length > 0);
    assert.ok(validate({ schemaVersion: '1.0', status: 'APPROVED', documentType: 'RECEIPT', fields: [] }, candidateSchema).length > 0);
    assert.ok(validate({ schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [], extra: 1 }, candidateSchema).length > 0);
    assert.ok(
      validate(
        { schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [{ field: 'a', value: 'b', confidence: 1.4 }] },
        candidateSchema
      ).length > 0
    );
    assert.ok(
      validate(
        { schemaVersion: '1.0', status: 'CANDIDATE', documentType: 'RECEIPT', fields: [{ field: 'a', value: 'b' }] },
        candidateSchema
      ).length > 0,
      'confidence is required'
    );
  });

  it('validates a candidate produced by the real extractor from a fixture model reply', async () => {
    const extract = createLocalEvidenceExtractor({ port: fixtureModel(MODEL_REPLY), timeoutMs: 5000 });

    const { candidate, model } = await extract({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mime: 'image/jpeg',
      job,
    });

    assert.deepStrictEqual(validate(candidate, schema.definitions!.candidate), []);
    assert.strictEqual(candidate.fields.length, 4);
    // The model's `bounds` was dropped: it cannot measure a box, and a fabricated rectangle
    // points a reviewer at the wrong part of the page.
    assert.ok(candidate.fields.every((field) => !('bounds' in field)));
    assert.strictEqual(model, 'qwen3-vl:8b-fixture');
  });

  it('validates the complete request that carries it', async () => {
    const extract = createLocalEvidenceExtractor({ port: fixtureModel(MODEL_REPLY), timeoutMs: 5000 });
    const { candidate, model } = await extract({ bytes: Buffer.from('jpeg'), mime: 'image/jpeg', job });

    assert.deepStrictEqual(validate(buildCompletePayload(candidate, model), schema.definitions!.completeRequest), []);
  });

  it('validates the fail request the device sends when it cannot read the document', () => {
    assert.deepStrictEqual(
      validate(buildFailPayload('อุปกรณ์นี้ยังอ่านไฟล์ PDF ไม่ได้ (this device cannot rasterise PDF)'), schema.definitions!.failRequest),
      []
    );
  });

  it('validates the empty claim body', () => {
    assert.deepStrictEqual(validate({}, schema.definitions!.claimRequest), []);
    // And confirms the cloud would reject a body that named anything.
    assert.ok(validate({ businessId: 'b1' }, schema.definitions!.claimRequest).length > 0);
  });

  it('validates the job shape the client parses out of a claim response', () => {
    assert.deepStrictEqual(validate({ job }, schema.definitions!.claimResponse), []);
  });
});
