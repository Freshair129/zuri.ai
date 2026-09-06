import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ModelPort, ModelRequest } from '../../src/answer/model-port.js';
import { createOpenAiCompatiblePort } from '../../src/answer/providers/index.js';
import {
  ExtractionUnsupportedError,
  createLocalEvidenceExtractor,
  parseJsonObject,
} from '../../src/evidence/extraction-extractor.js';
import { ExtractionJob, UNVERIFIED_FIELD_CONFIDENCE } from '../../src/evidence/extraction-contract.js';

/**
 * What the local extractor will and will not claim to have read.
 *
 * The tests that matter most here are the refusals. A candidate is reviewed by a Human who
 * reads it as what a machine saw in the document, so a device that cannot see must say so
 * rather than produce a plausible receipt — the fabrication is the failure mode that gets
 * approved, and the failed job is the one that gets fixed.
 */

const job: ExtractionJob = {
  id: 'j1',
  businessId: 'b1',
  evidenceId: 'e1',
  status: 'CLAIMED',
  attempts: 1,
  version: 2,
  createdAt: '2026-09-04T03:11:02.000Z',
  evidence: { mime: 'image/jpeg', byteSize: 4, documentType: 'RECEIPT' },
};

function fixtureModel(text: string, capture?: (request: ModelRequest) => void): ModelPort {
  return {
    id: 'openai-compatible',
    model: 'qwen3-vl:8b-fixture',
    async generate(request) {
      capture?.(request);
      return { text };
    },
  };
}

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe('the extractor refuses rather than invents', () => {
  it('fails every job when no vision model is configured', async () => {
    // The default state of this repository. `qwen3.5:9b` and `pathumma-thaillm-8b` are text
    // models; handed no picture they would still write a confident receipt.
    const extract = createLocalEvidenceExtractor({ port: null, timeoutMs: 1000 });
    const error = await extract({ bytes: jpeg, mime: 'image/jpeg', job }).then(() => null, (e) => e);

    assert.ok(error instanceof ExtractionUnsupportedError);
    assert.match(error.message, /vision/i);
  });

  it('carries a caller-supplied reason so the console can say which setting is missing', async () => {
    const extract = createLocalEvidenceExtractor({
      port: null,
      timeoutMs: 1000,
      unavailableReason: 'ZURI_LLM_BASE_URL is not set, so there is no local daemon to call',
    });
    const error = await extract({ bytes: jpeg, mime: 'image/jpeg', job }).then(() => null, (e) => e);
    assert.match((error as Error).message, /ZURI_LLM_BASE_URL/);
  });

  it('fails a PDF instead of guessing at it', async () => {
    // A local chat daemon takes images, not PDFs, and this repository has no rasteriser.
    const extract = createLocalEvidenceExtractor({ port: fixtureModel('{"fields":[]}'), timeoutMs: 1000 });
    const error = await extract({ bytes: Buffer.from('%PDF-1.7'), mime: 'application/pdf', job }).then(() => null, (e) => e);

    assert.ok(error instanceof ExtractionUnsupportedError);
    assert.match(error.message, /PDF/);
  });

  it('fails an undeclared MIME type', async () => {
    const extract = createLocalEvidenceExtractor({ port: fixtureModel('{"fields":[]}'), timeoutMs: 1000 });
    const error = await extract({ bytes: jpeg, mime: 'image/tiff', job }).then(() => null, (e) => e);
    assert.ok(error instanceof ExtractionUnsupportedError);
    assert.match(error.message, /image\/tiff/);
  });

  it('fails on zero bytes rather than reporting an empty document as read', async () => {
    const extract = createLocalEvidenceExtractor({ port: fixtureModel('{"fields":[]}'), timeoutMs: 1000 });
    const error = await extract({ bytes: Buffer.alloc(0), mime: 'image/png', job }).then(() => null, (e) => e);
    assert.ok(error instanceof ExtractionUnsupportedError);
  });

  it('fails when the model returns nothing parseable, instead of posting an empty candidate', async () => {
    // An empty candidate would be a COMPLETED job with no fields — the console would show a
    // successful read of a document nobody read.
    const extract = createLocalEvidenceExtractor({ port: fixtureModel('I am sorry, I cannot help with that.'), timeoutMs: 1000 });
    const error = await extract({ bytes: jpeg, mime: 'image/jpeg', job }).then(() => null, (e) => e);

    assert.ok(error instanceof ExtractionUnsupportedError);
    assert.match(error.message, /JSON/);
  });

  it('turns a port with no image channel into a readable failure', async () => {
    const blind: ModelPort = {
      id: 'anthropic',
      model: 'claude-opus-5',
      async generate() {
        throw new Error('MODEL_IMAGES_UNSUPPORTED');
      },
    };
    const extract = createLocalEvidenceExtractor({ port: blind, timeoutMs: 1000 });
    const error = await extract({ bytes: jpeg, mime: 'image/jpeg', job }).then(() => null, (e) => e);

    assert.ok(error instanceof ExtractionUnsupportedError);
    assert.match(error.message, /MODEL_IMAGES_UNSUPPORTED/);
  });
});

describe('the extractor reads what it is given', () => {
  it('hands the model the bytes as an image, not a description of them', async () => {
    let seen: ModelRequest | undefined;
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"documentType":"RECEIPT","fields":[{"field":"totalAmount","value":100}]}', (request) => {
        seen = request;
      }),
      timeoutMs: 1000,
    });

    await extract({ bytes: jpeg, mime: 'image/jpeg', job });

    assert.strictEqual(seen?.images?.length, 1);
    assert.strictEqual(seen?.images?.[0].mime, 'image/jpeg');
    assert.strictEqual(seen?.images?.[0].base64, jpeg.toString('base64'));
    // No tools: a document reader has nothing to look up, and every tool offered is another
    // way for the turn to end without an answer.
    assert.deepStrictEqual(seen?.tools, []);
  });

  it('reports the model name the cloud will record on the job', async () => {
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"fields":[{"field":"totalAmount","value":100}]}'),
      timeoutMs: 1000,
    });
    const { model } = await extract({ bytes: jpeg, mime: 'image/jpeg', job });
    assert.strictEqual(model, 'qwen3-vl:8b-fixture');
  });

  it('gives every field the documented unverified confidence', async () => {
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"documentType":"RECEIPT","fields":[{"field":"totalAmount","value":100,"confidence":0.99}]}'),
      timeoutMs: 1000,
    });
    const { candidate } = await extract({ bytes: jpeg, mime: 'image/jpeg', job });
    assert.strictEqual(candidate.fields[0].confidence, UNVERIFIED_FIELD_CONFIDENCE);
  });

  it('falls back to the uploader\'s label when the model names no document type', async () => {
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"fields":[{"field":"totalAmount","value":100}]}'),
      timeoutMs: 1000,
    });
    const { candidate } = await extract({ bytes: jpeg, mime: 'image/jpeg', job });
    assert.strictEqual(candidate.documentType, 'RECEIPT');
  });
});

describe('parseJsonObject', () => {
  it('finds the object inside a fenced, prefaced, trailing-sentence reply', () => {
    const reply = 'Here it is:\n```json\n{"a": 1}\n```\nHope that helps.';
    assert.deepStrictEqual(parseJsonObject(reply), { a: 1 });
  });

  it('stops at the object\'s own closing brace, not at a later one in prose', () => {
    // A greedy `\{.*\}` would swallow the trailing sentence and fail to parse.
    assert.deepStrictEqual(parseJsonObject('{"a": 1} and then some {stuff}'), { a: 1 });
  });

  it('is not confused by a brace inside a string', () => {
    assert.deepStrictEqual(parseJsonObject('{"note": "totals } here", "b": 2}'), { note: 'totals } here', b: 2 });
  });

  it('handles nesting', () => {
    assert.deepStrictEqual(parseJsonObject('x {"a": {"b": [1,2]}} y'), { a: { b: [1, 2] } });
  });

  it('returns null for prose, a bare array, and unbalanced braces', () => {
    assert.strictEqual(parseJsonObject('no json here'), null);
    assert.strictEqual(parseJsonObject('[1,2,3]'), null);
    assert.strictEqual(parseJsonObject('{"a": 1'), null);
  });
});

describe('the openai-compatible adapter actually carries the image', () => {
  it('attaches images to the last user turn as data URLs', async () => {
    // The pairing that makes the extractor real: without this the port would take the
    // images and drop them, and the model would answer about nothing.
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"fields":[]}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'qwen3-vl:8b', effort: 'low', baseUrl: 'http://localhost:11434/v1' },
      { fetchFn }
    );

    await port.generate({
      system: 'read it',
      messages: [{ role: 'user', content: 'what does this say' }],
      tools: [],
      images: [{ mime: 'image/png', base64: 'AAEC' }],
      maxIterations: 1,
      timeoutMs: 1000,
      signal: AbortSignal.timeout(1000),
    });

    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const user = messages.find((message) => message.role === 'user');
    assert.deepStrictEqual(user?.content, [
      { type: 'text', text: 'what does this say' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAEC' } },
    ]);
  });

  it('leaves a text-only turn as a plain string, so nothing existing changes shape', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = (async (_url: unknown, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' },
      { fetchFn }
    );

    await port.generate({
      system: 's',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      maxIterations: 1,
      timeoutMs: 1000,
      signal: AbortSignal.timeout(1000),
    });

    const messages = body.messages as Array<{ role: string; content: unknown }>;
    assert.strictEqual(messages.find((message) => message.role === 'user')?.content, 'hello');
  });

  it('refuses images with no user turn to attach them to', async () => {
    const fetchFn = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://localhost:11434/v1' },
      { fetchFn }
    );

    await assert.rejects(
      port.generate({
        system: 's',
        messages: [],
        tools: [],
        images: [{ mime: 'image/png', base64: 'AAEC' }],
        maxIterations: 1,
        timeoutMs: 1000,
        signal: AbortSignal.timeout(1000),
      }),
      /MODEL_IMAGES_WITHOUT_USER_TURN/
    );
  });
});

describe('an empty candidate is a failure, not a result', () => {
  it('fails the job when the reply parses but yields no fields', async () => {
    // Completing here would set the evidence to EXTRACTED and show the reviewer an empty
    // extraction, which reads as "nothing is printed on this document" — a claim the
    // model never made. The reason names the shape mismatch so an operator can act.
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"documentType":"RECEIPT","fields":[]}'),
      timeoutMs: 1000,
    });
    await assert.rejects(
      extract({ bytes: jpeg, mime: 'image/jpeg', job }),
      (error: unknown) =>
        error instanceof ExtractionUnsupportedError && /no usable fields/.test((error as Error).message)
    );
  });

  it('completes when the same reply arrives as a label-keyed map', async () => {
    const extract = createLocalEvidenceExtractor({
      port: fixtureModel('{"documentType":"RECEIPT","fields":{"ผู้ขาย / Vendor":"ACME Office Supply"}}'),
      timeoutMs: 1000,
    });
    const result = await extract({ bytes: jpeg, mime: 'image/jpeg', job });
    assert.strictEqual(result.candidate.fields.length, 1);
    assert.strictEqual(result.candidate.fields[0].value, 'ACME Office Supply');
    assert.strictEqual(result.candidate.fields[0].anchor, 'ผู้ขาย / Vendor');
    assert.strictEqual(result.candidate.fields[0].confidence, UNVERIFIED_FIELD_CONFIDENCE);
  });
});
