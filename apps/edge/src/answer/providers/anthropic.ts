import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';

import type { ModelPort, ModelPortConfig, ModelReply, ModelRequest } from '../model-port.js';

/**
 * The hosted Anthropic path, unchanged in behaviour from when it lived inside
 * `answerWithModel`. It is lifted rather than rewritten on purpose: this is the path
 * currently answering real customers, and the point of the port was to make room for
 * a second provider, not to re-litigate the first.
 *
 * `toolRunner` is why the port hands over a whole turn instead of a single completion
 * — the SDK owns the tool loop here, and reimplementing that to share a loop with
 * OpenAI-compatible servers would mean rewriting working code for symmetry alone.
 */
export function createAnthropicPort(config: ModelPortConfig): ModelPort {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY_REQUIRED');

  return {
    id: 'anthropic',
    model: config.model,

    async generate(request: ModelRequest): Promise<ModelReply> {
      /*
       * This adapter has no image channel wired, and the one caller that sends images —
       * edge-executed evidence extraction — must not reach a hosted API anyway: the whole
       * reason that lane exists is that a business's evidence bytes stay on its own device
       * (ADR-041 D3). Silently dropping the images would leave the model describing a
       * document it never saw, which is worse than no answer, so this refuses instead.
       */
      if (request.images?.length) throw new Error('MODEL_IMAGES_UNSUPPORTED');

      const client = new Anthropic({
        apiKey: config.apiKey,
        timeout: request.timeoutMs,
        maxRetries: 0,
      });

      const runner = client.beta.messages.toolRunner(
        {
          model: config.model,
          max_tokens: 2000,
          output_config: { effort: config.effort },
          system: request.system,
          tools: request.tools.map((tool) =>
            betaTool({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema as never,
              run: async (input: unknown) => tool.run(input as Record<string, never>),
            })
          ),
          messages: request.messages,
        },
        { signal: request.signal }
      );

      let last: Awaited<ReturnType<typeof runner.done>> | undefined;
      let iterations = 0;
      for await (const message of runner) {
        last = message;
        if (++iterations >= request.maxIterations) break;
      }
      if (!last) return { text: '' };

      return {
        text: last.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text || '')
          .join('\n')
          .trim(),
      };
    },
  };
}
