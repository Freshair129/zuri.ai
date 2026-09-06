import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_CANDIDATE_FIELDS,
  MAX_FAIL_REASON_LENGTH,
  UNVERIFIED_FIELD_CONFIDENCE,
  buildClaimPayload,
  buildCompletePayload,
  buildFailPayload,
  computeBackoffMs,
  normaliseCandidate,
  scrubSecrets,
} from '../../src/evidence/extraction-contract.js';

/**
 * The payload rules, tested without a network or a model.
 *
 * Each of these is a rule the cloud enforces with a 400 that also FAILS the job, so a
 * mistake here does not show up as a retry — it shows up as a customer's document marked
 * unreadable. That is why the shapes are pinned rather than trusted to review.
 */

describe('edge extraction payload builders', () => {
  it('sends an empty claim body, because scope comes from the credential', () => {
    // The cloud rejects a non-empty claim body with 400 on purpose: a device that could
    // name a businessId or a jobId could reach work that is not its own.
    assert.deepStrictEqual(buildClaimPayload(), {});
    assert.strictEqual(Object.keys(buildClaimPayload()).length, 0);
  });

  it('sends the candidate and the model name on complete', () => {
    const candidate = normaliseCandidate({ documentType: 'RECEIPT', fields: [] });
    assert.deepStrictEqual(buildCompletePayload(candidate, 'qwen3-vl:8b'), {
      candidate,
      model: 'qwen3-vl:8b',
    });
  });

  it('clips a fail reason to the contract length', () => {
    const { reason } = buildFailPayload('x'.repeat(MAX_FAIL_REASON_LENGTH + 500));
    assert.strictEqual(reason.length, MAX_FAIL_REASON_LENGTH);
  });

  it('never posts an empty fail reason, because minLength is 1 and an empty one fails the call', () => {
    assert.ok(buildFailPayload('').reason.length > 0);
    assert.ok(buildFailPayload(undefined).reason.length > 0);
    assert.ok(buildFailPayload('   ').reason.length > 0);
  });

  it('strips a credential out of a fail reason before it reaches the cloud', () => {
    // A reason is stored on the job and shown in the console. A key that got in here would
    // be persisted, displayed, and impossible to recall.
    const { reason } = buildFailPayload('daemon refused Authorization: Bearer edgk_live_abc123DEF');
    assert.ok(!reason.includes('edgk_'), reason);
    assert.ok(!reason.includes('abc123DEF'), reason);
  });
});

describe('backoff', () => {
  it('doubles from the base and stops at the cap', () => {
    assert.strictEqual(computeBackoffMs(1), 1000);
    assert.strictEqual(computeBackoffMs(2), 2000);
    assert.strictEqual(computeBackoffMs(3), 4000);
    assert.strictEqual(computeBackoffMs(6), 30000);
    assert.strictEqual(computeBackoffMs(50), 30000);
  });

  it('treats a zero or negative attempt as the first one rather than waiting no time at all', () => {
    // A caller passing 0 must not produce a hot loop against a cloud that is already failing.
    assert.strictEqual(computeBackoffMs(0), 1000);
    assert.strictEqual(computeBackoffMs(-4), 1000);
  });

  it('honours a caller-supplied base and cap', () => {
    assert.strictEqual(computeBackoffMs(3, 250, 10000), 1000);
    assert.strictEqual(computeBackoffMs(9, 250, 4000), 4000);
  });
});

describe('candidate normalisation', () => {
  it('emits only the keys the cloud schema allows', () => {
    const candidate = normaliseCandidate({
      documentType: 'INVOICE',
      note: 'the model added a key nobody asked for',
      fields: [{ field: 'totalAmount', value: 18750, confidence: 0.99, explanation: 'chatty' }],
    });
    assert.deepStrictEqual(Object.keys(candidate).sort(), ['documentType', 'fields', 'schemaVersion', 'status']);
    assert.deepStrictEqual(Object.keys(candidate.fields[0]).sort(), ['confidence', 'field', 'value']);
  });

  it('overrides whatever confidence the model claimed with the documented unverified value', () => {
    // The model's own 0.99 is not evidence of anything; a reviewer reading it as certainty
    // is the exact harm. See UNVERIFIED_FIELD_CONFIDENCE for why this number and not a higher one.
    const candidate = normaliseCandidate({
      documentType: 'RECEIPT',
      fields: [
        { field: 'a', value: '1', confidence: 0.99 },
        { field: 'b', value: '2', confidence: 0.01 },
      ],
    });
    assert.deepStrictEqual(
      candidate.fields.map((f) => f.confidence),
      [UNVERIFIED_FIELD_CONFIDENCE, UNVERIFIED_FIELD_CONFIDENCE]
    );
    assert.ok(UNVERIFIED_FIELD_CONFIDENCE < 0.5, 'an unverified field must never read as more likely right than wrong');
  });

  it('drops bounds entirely rather than passing on a rectangle the model invented', () => {
    const candidate = normaliseCandidate({
      documentType: 'RECEIPT',
      fields: [{ field: 'vendorName', value: 'x', bounds: { x: 0, y: 0, width: 1, height: 1 } }],
    });
    assert.ok(!('bounds' in candidate.fields[0]));
  });

  it('keeps a page number only when it is a real page', () => {
    const candidate = normaliseCandidate({
      documentType: 'RECEIPT',
      fields: [
        { field: 'a', value: '1', page: 2 },
        { field: 'b', value: '2', page: 0 },
        { field: 'c', value: '3', page: 'front' },
      ],
    });
    assert.strictEqual(candidate.fields[0].page, 2);
    assert.ok(!('page' in candidate.fields[1]));
    assert.ok(!('page' in candidate.fields[2]));
  });

  it('coerces an unknown document type to OTHER instead of letting the cloud reject the candidate', () => {
    // The enum lives in the cloud. A device that passed through "ใบเสร็จ" would lose the
    // whole extraction to a 400; OTHER keeps a reviewable candidate.
    assert.strictEqual(normaliseCandidate({ documentType: 'ใบเสร็จ', fields: [] }).documentType, 'OTHER');
    assert.strictEqual(normaliseCandidate({ fields: [] }, 'DELIVERY').documentType, 'DELIVERY');
    assert.strictEqual(normaliseCandidate({ documentType: 'receipt', fields: [] }).documentType, 'RECEIPT');
  });

  it('prefers what the model read over the uploader\'s label', () => {
    const candidate = normaliseCandidate({ documentType: 'INVOICE', fields: [] }, 'RECEIPT');
    assert.strictEqual(candidate.documentType, 'INVOICE');
  });

  it('drops a field with no name, and a value that is an object', () => {
    const candidate = normaliseCandidate({
      documentType: 'RECEIPT',
      fields: [
        { value: 'orphan' },
        { field: '  ', value: 'blank' },
        { field: 'lineItems', value: [{ sku: 'A' }] },
      ],
    });
    assert.strictEqual(candidate.fields.length, 1);
    assert.deepStrictEqual(candidate.fields[0], {
      field: 'lineItems',
      // An array is the model answering a different question; it becomes null rather than
      // a stringified blob a reviewer would read as a value.
      value: null,
      confidence: UNVERIFIED_FIELD_CONFIDENCE,
    });
  });

  it('caps the field count at the contract maximum', () => {
    const fields = Array.from({ length: MAX_CANDIDATE_FIELDS + 25 }, (_, i) => ({ field: `f${i}`, value: i }));
    assert.strictEqual(normaliseCandidate({ documentType: 'OTHER', fields }).fields.length, MAX_CANDIDATE_FIELDS);
  });

  it('survives a model that returned nothing shaped like a candidate', () => {
    const candidate = normaliseCandidate('sorry, I cannot read this');
    assert.deepStrictEqual(candidate, {
      schemaVersion: '1.0',
      status: 'CANDIDATE',
      documentType: 'OTHER',
      fields: [],
    });
  });
});

describe('scrubSecrets', () => {
  it('removes an edgk_ key and a bearer header', () => {
    // The cloud mints `edgk_` + base64url, whose alphabet is exactly A-Za-z0-9 plus `-` and `_`.
    assert.strictEqual(scrubSecrets('key=edgk_9Kx-2mQ_zA1b ok'), 'key=[REDACTED] ok');
    assert.strictEqual(scrubSecrets('Authorization: Bearer edgk_abc123'), 'Authorization: Bearer [REDACTED]');
    // A bearer header that is not a device key is still a credential.
    assert.strictEqual(scrubSecrets('Authorization: Bearer sk-live.99=='), 'Authorization: Bearer [REDACTED]');
  });

  it('leaves ordinary prose alone', () => {
    const reason = 'อ่านเอกสารไม่ได้ (the local model returned no parseable JSON object)';
    assert.strictEqual(scrubSecrets(reason), reason);
  });
});

describe('a model that answers with a label-keyed map', () => {
  // Recorded from a real run: olmOCR-7B-thai on Ollama read the whole receipt and
  // returned every value under its printed label instead of the contract's array. The
  // job COMPLETED with zero fields, so the reviewer saw an empty extraction of a
  // document the model had in fact transcribed line by line.
  const observed = {
    documentType: 'RECEIPT',
    fields: {
      'เลขที่ / Receipt No.': 'RC-2026-00418',
      'วันที่ / Date': '2026-09-04',
      'ผู้ขาย / Vendor': 'ACME Office Supply',
      'ราคารวม / Total Amount': '32,900.00',
    },
  };

  it('keeps every value, with the printed label as both name and anchor', () => {
    const candidate = normaliseCandidate(observed);
    assert.strictEqual(candidate.documentType, 'RECEIPT');
    assert.strictEqual(candidate.fields.length, 4);
    assert.deepStrictEqual(candidate.fields[0], {
      field: 'เลขที่ / Receipt No.',
      value: 'RC-2026-00418',
      confidence: UNVERIFIED_FIELD_CONFIDENCE,
      anchor: 'เลขที่ / Receipt No.',
    });
    assert.deepStrictEqual(
      candidate.fields.map((field) => field.value),
      ['RC-2026-00418', '2026-09-04', 'ACME Office Supply', '32,900.00']
    );
  });

  it('invents no English name for a Thai label', () => {
    // Translating "ผู้ขาย / Vendor" to `vendorName` would be this runtime guessing at
    // meaning. The reviewer reads the document's own words.
    const candidate = normaliseCandidate(observed);
    assert.ok(candidate.fields.every((field) => field.field === field.anchor));
    assert.ok(!candidate.fields.some((field) => field.field === 'vendorName'));
  });

  it('still caps the map at the contract ceiling', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < MAX_CANDIDATE_FIELDS + 20; i += 1) wide[`label ${i}`] = String(i);
    const candidate = normaliseCandidate({ documentType: 'INVOICE', fields: wide });
    assert.strictEqual(candidate.fields.length, MAX_CANDIDATE_FIELDS);
  });

  it('drops a nested value rather than stringifying it', () => {
    const candidate = normaliseCandidate({ documentType: 'RECEIPT', fields: { total: { amount: 1 } } });
    assert.deepStrictEqual(candidate.fields, [
      { field: 'total', value: null, confidence: UNVERIFIED_FIELD_CONFIDENCE, anchor: 'total' },
    ]);
  });
});
