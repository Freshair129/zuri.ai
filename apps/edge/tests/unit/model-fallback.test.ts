import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createFallbackPort } from '../../src/answer/providers/fallback.js';
import type { ModelPort, ModelRequest } from '../../src/answer/model-port.js';

/**
 * Measured on the target box at num_ctx 8192: pathumma-thaillm-8b takes 6.1GB and
 * qwen3.5:9b takes 5.7GB, of a 12GB card. Pinning the second evicted the first, so
 * only one model is resident and the fallback always pays a cold load.
 *
 * That is what these pin: the fallback is for a broken core model, not for speed,
 * and it must never be reached in a way that wastes a turn the caller could have
 * answered from rules.
 */

const port = (id: string, impl: () => Promise<{ text: string }>): ModelPort => ({
  id,
  model: id,
  generate: impl,
});

const request = (signal = AbortSignal.timeout(10000)): ModelRequest => ({
  system: 'system',
  messages: [{ role: 'user', content: 'ราคาเท่าไร' }],
  tools: [],
  maxIterations: 4,
  timeoutMs: 10000,
  signal,
});

describe('core model with fallback', () => {
  it('never touches the fallback when the core answers', async () => {
    let fallbackCalls = 0;
    const p = createFallbackPort({
      core: port('core', async () => ({ text: 'ราคา 450 บาท' })),
      fallback: port('spare', async () => { fallbackCalls += 1; return { text: 'spare' }; }),
    });

    assert.strictEqual((await p.generate(request())).text, 'ราคา 450 บาท');
    // the fallback is cold; reaching it when the core worked would cost a turn
    assert.strictEqual(fallbackCalls, 0);
  });

  it('falls back when the core throws', async () => {
    const seen: Array<{ from: string; to: string; reason: string }> = [];
    const p = createFallbackPort({
      core: port('core', async () => { throw new Error('MODEL_HTTP_500'); }),
      fallback: port('spare', async () => ({ text: 'คำตอบสำรอง' })),
      onFallback: (info) => seen.push(info),
    });

    assert.strictEqual((await p.generate(request())).text, 'คำตอบสำรอง');
    assert.deepStrictEqual(seen, [{ from: 'core', to: 'spare', reason: 'MODEL_HTTP_500' }]);
  });

  it('falls back on an empty answer, which is a real outcome and not an error', async () => {
    // the core ran out of iterations or produced nothing usable; the alternative is
    // the deterministic reply either way, so a second opinion costs nothing extra
    const seen: string[] = [];
    const p = createFallbackPort({
      core: port('core', async () => ({ text: '   ' })),
      fallback: port('spare', async () => ({ text: 'คำตอบสำรอง' })),
      onFallback: (info) => seen.push(info.reason),
    });

    assert.strictEqual((await p.generate(request())).text, 'คำตอบสำรอง');
    assert.deepStrictEqual(seen, ['CORE_EMPTY']);
  });

  it('does not start a cold load once the turn deadline has passed', async () => {
    // the whole point: the fallback is not resident, so starting it after the clock
    // has run out wins nothing and delays the rules answer the customer will get
    let fallbackCalls = 0;
    const expired = AbortSignal.abort();
    const p = createFallbackPort({
      core: port('core', async () => { throw new Error('MODEL_HTTP_503'); }),
      fallback: port('spare', async () => { fallbackCalls += 1; return { text: 'late' }; }),
    });

    assert.strictEqual((await p.generate(request(expired))).text, '');
    assert.strictEqual(fallbackCalls, 0);
  });

  it('returns empty when both are gone, so the caller uses rules', async () => {
    const p = createFallbackPort({
      core: port('core', async () => { throw new Error('down'); }),
      fallback: port('spare', async () => { throw new Error('also down'); }),
    });

    // empty is answerWithModel's signal for the deterministic reply, which is always
    // available — a customer still gets an answer
    assert.strictEqual((await p.generate(request())).text, '');
  });

  it('reports both models in its id, and the core as the model in use', () => {
    const p = createFallbackPort({
      core: port('pathumma', async () => ({ text: 'x' })),
      fallback: port('qwen', async () => ({ text: 'y' })),
    });
    assert.strictEqual(p.id, 'pathumma+qwen');
    assert.strictEqual(p.model, 'pathumma');
  });

  it('tells the diagnostic hook nothing about what was said', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const p = createFallbackPort({
      core: port('core', async () => { throw new Error('MODEL_HTTP_500'); }),
      fallback: port('spare', async () => ({ text: 'ราคาลับเฉพาะ 450 บาท' })),
      onFallback: (info) => seen.push(info as unknown as Record<string, unknown>),
    });
    await p.generate(request());

    const serialized = JSON.stringify(seen);
    assert.ok(!serialized.includes('ราคาลับเฉพาะ'));
    assert.ok(!serialized.includes('ราคาเท่าไร'));
  });
});
