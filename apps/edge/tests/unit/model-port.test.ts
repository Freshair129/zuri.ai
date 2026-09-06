import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createModelPort, createOpenAiCompatiblePort } from '../../src/answer/providers/index.js';
import type { ToolSpec } from '../../src/answer/model-port.js';

/**
 * The point of the port is that a business can run its own model. Before it existed,
 * `LlmOptions.apiKey` was required, so "local LLM" was not expressible — these pin
 * that it now is, and that choosing a provider cannot go wrong quietly.
 */

const tool = (name: string, run: ToolSpec['run']): ToolSpec => ({
  name,
  description: 'test tool',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run,
});

const request = (over: Partial<Parameters<ReturnType<typeof createOpenAiCompatiblePort>['generate']>[0]> = {}) => ({
  system: 'system',
  messages: [{ role: 'user' as const, content: 'ราคาเท่าไร' }],
  tools: [] as ToolSpec[],
  maxIterations: 4,
  timeoutMs: 10000,
  signal: AbortSignal.timeout(10000),
  ...over,
});

const reply = (message: unknown) =>
  new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

describe('model port selection', () => {
  it('picks the local provider from a base URL, with no key at all', () => {
    // the case the port exists for: a model on the business's own hardware
    const port = createModelPort({
      provider: 'openai-compatible',
      model: 'llama3.1',
      effort: 'low',
      baseUrl: 'http://localhost:11434/v1',
    });
    assert.strictEqual(port.id, 'openai-compatible');
    assert.strictEqual(port.model, 'llama3.1');
  });

  it('refuses an unknown provider instead of falling back to the hosted API', () => {
    // a typo in a local deployment's config must never quietly start sending a
    // business's conversations to a cloud endpoint
    assert.throws(
      () => createModelPort({ provider: 'gpt5' as never, model: 'm', effort: 'low' }),
      /MODEL_PROVIDER_UNSUPPORTED/
    );
  });

  it('refuses each provider that is missing what it actually needs', () => {
    assert.throws(
      () => createModelPort({ provider: 'anthropic', model: 'm', effort: 'low' }),
      /ANTHROPIC_API_KEY_REQUIRED/
    );
    assert.throws(
      () => createModelPort({ provider: 'openai-compatible', model: 'm', effort: 'low' }),
      /MODEL_BASE_URL_REQUIRED/
    );
  });
});

describe('openai-compatible transport', () => {
  it('sends no Authorization header when the model is local', async () => {
    let seen: RequestInit | undefined;
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'llama3.1', effort: 'low', baseUrl: 'http://localhost:11434/v1' },
      { fetchFn: async (_url, init) => { seen = init; return reply({ content: 'ตอบแล้ว' }); } }
    );

    const result = await port.generate(request());
    assert.strictEqual(result.text, 'ตอบแล้ว');
    assert.strictEqual(new Headers(seen?.headers).has('authorization'), false);
  });

  it('sends a key when one is configured, for a hosted compatible gateway', async () => {
    let seen: RequestInit | undefined;
    const port = createOpenAiCompatiblePort(
      {
        provider: 'openai-compatible', model: 'm', effort: 'low',
        baseUrl: 'https://gateway.example/v1', apiKey: 'sk-test',
      },
      { fetchFn: async (_url, init) => { seen = init; return reply({ content: 'ok' }); } }
    );
    await port.generate(request());
    assert.strictEqual(new Headers(seen?.headers).get('authorization'), 'Bearer sk-test');
  });

  it('strips a trailing slash so the URL never doubles up', async () => {
    let url = '';
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://localhost:11434/v1/' },
      { fetchFn: async (u) => { url = String(u); return reply({ content: 'ok' }); } }
    );
    await port.generate(request());
    assert.strictEqual(url, 'http://localhost:11434/v1/chat/completions');
  });

  it('runs a tool call and feeds the result back for a second turn', async () => {
    const calls: string[] = [];
    let round = 0;
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      {
        fetchFn: async (_u, init) => {
          const body = JSON.parse(String(init?.body));
          calls.push(...body.messages.map((m: { role: string }) => m.role));
          round += 1;
          return round === 1
            ? reply({
                content: null,
                tool_calls: [{ id: 'c1', type: 'function', function: { name: 'quote_price', arguments: '{"sku":"A"}' } }],
              })
            : reply({ content: 'ราคา 450 บาท' });
        },
      }
    );

    let ran = '';
    const result = await port.generate(request({
      tools: [tool('quote_price', async (input) => { ran = JSON.stringify(input); return '{"price":450}'; })],
    }));

    assert.strictEqual(ran, '{"sku":"A"}');
    assert.strictEqual(result.text, 'ราคา 450 บาท');
    // the assistant's tool-call turn must be kept, or the server has no record of
    // what it asked for and the tool result is orphaned
    assert.ok(calls.includes('assistant'));
    assert.ok(calls.includes('tool'));
  });

  it('tells the model about a tool it invented rather than failing the turn', async () => {
    let round = 0;
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      {
        fetchFn: async (_u, init) => {
          round += 1;
          if (round === 1) {
            return reply({
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'does_not_exist', arguments: '{}' } }],
            });
          }
          const body = JSON.parse(String(init?.body));
          const toolMsg = body.messages.find((m: { role: string }) => m.role === 'tool');
          assert.match(String(toolMsg.content), /unknown tool/);
          return reply({ content: 'ขอโทษค่ะ' });
        },
      }
    );
    const result = await port.generate(request({ tools: [tool('real_tool', async () => 'x')] }));
    assert.strictEqual(result.text, 'ขอโทษค่ะ');
  });

  it('hands a failing tool back as an error instead of throwing away the turn', async () => {
    let round = 0;
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      {
        fetchFn: async (_u, init) => {
          round += 1;
          if (round === 1) {
            return reply({
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'boom', arguments: '{}' } }],
            });
          }
          const body = JSON.parse(String(init?.body));
          const toolMsg = body.messages.find((m: { role: string }) => m.role === 'tool');
          assert.match(String(toolMsg.content), /catalog unavailable/);
          return reply({ content: 'ตอบจากที่มี' });
        },
      }
    );
    const result = await port.generate(request({
      tools: [tool('boom', async () => { throw new Error('catalog unavailable'); })],
    }));
    assert.strictEqual(result.text, 'ตอบจากที่มี');
  });

  it('returns empty text when the model keeps calling tools, so the caller falls back', async () => {
    // no trustworthy answer exists after the ceiling; empty is the signal for the
    // deterministic reply, which is always available
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      {
        fetchFn: async () => reply({
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 't', arguments: '{}' } }],
        }),
      }
    );
    const result = await port.generate(request({
      tools: [tool('t', async () => 'again')],
      maxIterations: 2,
    }));
    assert.strictEqual(result.text, '');
  });

  it('does not echo a provider error body, only its status', async () => {
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1', apiKey: 'sk-secret' },
      { fetchFn: async () => new Response('upstream detail sk-secret', { status: 502 }) }
    );
    await assert.rejects(
      () => port.generate(request()),
      (error: Error) =>
        error.message === 'MODEL_HTTP_502' &&
        !error.message.includes('sk-secret') &&
        !error.message.includes('upstream detail')
    );
  });
});

describe('openai-compatible — the last pass has to produce an answer', () => {
  /**
   * A model that keeps calling tools until the iteration budget runs out used to yield an empty
   * reply, which the caller turns into a pattern answer. Observed on qwen3.5:9b: four tool calls,
   * no text, `source=rules`. The evidence was already gathered by then — what was missing was a
   * turn to speak in.
   */
  it('withholds the tools on the final iteration so the model must answer', async () => {
    const sentTools: boolean[] = [];
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      {
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String((init as RequestInit).body));
          sentTools.push(Array.isArray(body.tools) && body.tools.length > 0);
          // Always ask for another tool call, which is the behaviour that exhausted the budget.
          if (sentTools.length < 4) {
            return reply({
              content: '',
              tool_calls: [{ id: `c${sentTools.length}`, type: 'function', function: { name: 'search', arguments: '{}' } }],
            });
          }
          return reply({ content: 'ชุดของขวัญราคา 630 บาท/ชุด' });
        },
      },
    );

    const result = await port.generate(
      request({ tools: [tool('search', async () => '{"ok":true}')], maxIterations: 4 }),
    );

    assert.deepStrictEqual(sentTools, [true, true, true, false], 'tools offered until the last pass');
    assert.strictEqual(result.text, 'ชุดของขวัญราคา 630 บาท/ชุด');
  });

  it('still returns empty when the model says nothing even with no tools to hide behind', async () => {
    const port = createOpenAiCompatiblePort(
      { provider: 'openai-compatible', model: 'm', effort: 'low', baseUrl: 'http://x/v1' },
      { fetchFn: async () => reply({ content: '' }) },
    );
    const result = await port.generate(request({ tools: [tool('search', async () => '{}')] }));
    assert.strictEqual(result.text, '', 'an empty answer is still empty; the caller falls back');
  });
});
