import { describe, it } from 'node:test';
import assert from 'node:assert';
import { warmModel, releaseModel } from '../../src/answer/providers/model-warmer.js';

/**
 * Measured on the target hardware (RTX 3060 12GB, ollama 0.32.14):
 *
 *   qwen3.5:4b   cold 21.2s   warm 6.7s   pinned 2.4-3.0s
 *
 * A LINE reply token dies at about thirty seconds, so an unpinned first message does
 * not get a late reply — it gets none at all. These pin the mechanics that keep the
 * model resident, including the trap that made this a separate module.
 */

const options = { nativeBaseUrl: 'http://localhost:11434', model: 'qwen3.5:4b' };
const ok = () => new Response(JSON.stringify({ done: true }), { status: 200 });

describe('model warmer', () => {
  it('asks the NATIVE endpoint, because /v1 accepts keep_alive and ignores it', () => {
    // The trap this module exists for: POSTing keep_alive to /v1/chat/completions
    // returns 200 and the model is still evicted — verified against a live server,
    // `ollama ps` stayed empty. A success that does nothing is the worst failure
    // shape, so the call has to be aimed somewhere it is honoured.
    return (async () => {
      let url = '';
      let body: Record<string, unknown> = {};
      await warmModel({
        ...options,
        fetchFn: async (u, init) => {
          url = String(u);
          body = JSON.parse(String(init?.body));
          return ok();
        },
      });

      assert.strictEqual(url, 'http://localhost:11434/api/generate');
      assert.ok(!url.includes('/v1'));
      assert.strictEqual(body.keep_alive, -1);
    })();
  });

  it('strips a /v1 suffix, since that is what the model config holds', async () => {
    // ZURI_LLM_BASE_URL points at the OpenAI-compatible path for the adapter; the
    // warmer needs Ollama's root, and asking an operator to configure both would be
    // two values that can disagree.
    let url = '';
    await warmModel({
      ...options,
      nativeBaseUrl: 'http://localhost:11434/v1/',
      fetchFn: async (u) => { url = String(u); return ok(); },
    });
    assert.strictEqual(url, 'http://localhost:11434/api/generate');
  });

  it('turns thinking off and generates a single token', async () => {
    let body: Record<string, unknown> = {};
    await warmModel({
      ...options,
      fetchFn: async (_u, init) => { body = JSON.parse(String(init?.body)); return ok(); },
    });

    // A warm-up has nothing to reason about, and a Thinking model would spend the
    // whole budget doing it (SPEC--LOCAL-LLM-DISPATCH-V2 §5.4).
    assert.strictEqual(body.think, false);
    assert.deepStrictEqual(body.options, { num_predict: 1 });
    assert.strictEqual(body.stream, false);
  });

  it('reports failure instead of throwing, so a cold model beats a dead process', async () => {
    const down = await warmModel({
      ...options,
      fetchFn: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.strictEqual(down.pinned, false);
    assert.ok(typeof down.ms === 'number');

    const refused = await warmModel({
      ...options,
      fetchFn: async () => new Response('model not found', { status: 404 }),
    });
    assert.strictEqual(refused.pinned, false);
    assert.strictEqual(refused.reason, 'HTTP_404');
    // the upstream body stays upstream
    assert.ok(!String(refused.reason).includes('model not found'));
  });

  it('reports pinned only when the host actually accepted', async () => {
    const result = await warmModel({ ...options, fetchFn: async () => ok() });
    assert.strictEqual(result.pinned, true);
    assert.strictEqual(result.reason, undefined);
  });

  it('releases with keep_alive 0 and never throws', async () => {
    let body: Record<string, unknown> = {};
    await releaseModel({
      ...options,
      fetchFn: async (_u, init) => { body = JSON.parse(String(init?.body)); return ok(); },
    });
    assert.strictEqual(body.keep_alive, 0);

    await assert.doesNotReject(() =>
      releaseModel({ ...options, fetchFn: async () => { throw new Error('gone'); } })
    );
  });
});
