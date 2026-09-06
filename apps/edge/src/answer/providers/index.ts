import type { ModelPort, ModelPortConfig } from '../model-port.js';
import { createAnthropicPort } from './anthropic.js';
import { createOpenAiCompatiblePort } from './openai-compatible.js';

/**
 * Build the port for the configured provider.
 *
 * Fails closed on an unknown provider rather than defaulting to the hosted one: a
 * typo in a local deployment's config must not quietly start sending a business's
 * conversations to a cloud API.
 */
export function createModelPort(
  config: ModelPortConfig,
  options: { fetchFn?: typeof fetch } = {}
): ModelPort {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicPort(config);
    case 'openai-compatible':
      return createOpenAiCompatiblePort(config, options);
    default:
      throw new Error(`MODEL_PROVIDER_UNSUPPORTED: ${String((config as ModelPortConfig).provider)}`);
  }
}

export { createAnthropicPort, createOpenAiCompatiblePort };
