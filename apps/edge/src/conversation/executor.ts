import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentConfig } from '../config/index.js';
import { answerConversation } from '../answer/respond.js';
import { requireHeadlessPolicy, type HeadlessOptions } from '../answer/headless.js';
import { createModelPort } from '../answer/providers/index.js';
import { loadCatalog } from '../catalog/store.js';
import { GenesisLocalRag } from '../rag/genesis-rag.js';
import { ConversationError, type ConversationJob, isLoopbackUrl } from './contract.js';

// @spec ADR-061 — the local-computation boundary: a job may not name an executable, URL, query,
//   recipient, filesystem location or business scope, and LOCAL_ONLY stays local.

export function headlessProviderHome(
  config: Pick<Partial<AgentConfig>, 'managedProviderHome'>,
  bin: string,
): Pick<HeadlessOptions, 'codexHome' | 'claudeConfigDir'> {
  const home = config.managedProviderHome?.trim() || undefined;
  return path.basename(bin).toLowerCase().startsWith('codex')
    ? { codexHome: home }
    : { claudeConfigDir: home };
}

export function validateExecutionPolicy(job: ConversationJob, config: Partial<AgentConfig>, ragUrl: string): void {
  const headlessBin = config.headlessBin || 'claude';
  const managedHome = headlessProviderHome(config, headlessBin);
  if (config.headlessEnabled) requireHeadlessPolicy(headlessBin, true, managedHome.codexHome);
  // The RAG adapter is a local capability, never an arbitrary endpoint from a job.
  if (!isLoopbackUrl(ragUrl)) throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
  if (job.policy.modelAccess === 'LOCAL_ONLY' &&
      (config.headlessEnabled || (config.llmEnabled && !isLoopbackUrl(config.llmBaseUrl || '')))) {
    throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
  }
  if (config.llmEnabled && !config.llmBaseUrl && !config.llmAllowCloud) {
    throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
  }
}

/** Same local answer tools, server-bound scope, and no durable conversation/session retention. */
export function createConversationExecutor(config: Partial<AgentConfig>, options: {
  ragUrl?: string; answer?: typeof answerConversation; fetchFn?: typeof fetch;
} = {}): (job: ConversationJob) => Promise<string> {
  const ragUrl = options.ragUrl || process.env.GENESIS_RAG_API_URL || 'http://127.0.0.1:8888';
  const headlessBin = config.headlessBin || 'claude';
  const managedHome = headlessProviderHome(config, headlessBin);
  // Prevent a local daemon from redirecting a LOCAL_ONLY question to an external origin.
  const noRedirectFetch: typeof fetch = (input, init) => (options.fetchFn || fetch)(input, { ...init, redirect: 'error' });
  return async job => {
    validateExecutionPolicy(job, config, ragUrl);
    const remaining = Date.parse(job.leaseExpiresAt) - Date.now() - 15000;
    if (remaining <= 0) throw new ConversationError('LEASE_EXPIRED');
    const timeoutMs = Math.min(remaining, 240000);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-conversation-'));
    // An opaque server identity is not a filesystem path, even if a future caller gets it wrong.
    const key = crypto.createHash('sha256').update(job.conversationKey).digest('hex');
    try {
      const local = Boolean(config.llmBaseUrl);
      const llm = config.llmEnabled ? {
        port: createModelPort({
          provider: local ? 'openai-compatible' : 'anthropic',
          model: config.llmModel || 'llama3.1',
          ...(local ? { baseUrl: config.llmBaseUrl, numCtx: config.llmNumCtx } : { apiKey: config.anthropicApiKey }),
          effort: config.llmEffort || 'low',
        }, { fetchFn: noRedirectFetch }),
        timeoutMs: Math.min(timeoutMs, config.llmTimeoutMs || 12000),
        maxIterations: config.llmMaxIterations || 4,
      } : null;
      const result = await (options.answer || answerConversation)(job.question, {
        catalog: loadCatalog(config.catalogRoot || 'state/catalog'), role: 'sales',
        exchangeRate: config.exchangeRateThbPerRmb || 5,
        rag: new GenesisLocalRag({ apiUrl: ragUrl, fetchImpl: noRedirectFetch }),
        conversationKey: key,
        memory: { root: path.join(scratch, 'memory'), hashKey: '', retentionHours: 0 },
        retainHistory: false,
        llm,
        headless: config.headlessEnabled ? {
          bin: headlessBin, ...managedHome, model: config.headlessModel || 'claude-sonnet-5',
          timeoutMs: Math.min(timeoutMs, config.headlessTimeoutMs || 120000),
          maxTurns: config.headlessMaxTurns || 8,
          mcpServerPath: fileURLToPath(new URL('../mcp/pricing-server.js', import.meta.url)),
          sandboxRoot: path.join(scratch, 'sandbox'), sessionRoot: path.join(scratch, 'sessions'),
          sessionRetentionHours: 0, catalogRoot: config.catalogRoot || 'state/catalog',
          exchangeRate: config.exchangeRateThbPerRmb || 5,
          webSearch: false, fileAuthoring: false, stateless: true,
        } : null,
      });
      return result.text;
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  };
}
