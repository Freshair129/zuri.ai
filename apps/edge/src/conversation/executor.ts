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
import { createGenesisRag17Runtime, wrapAnswerRag, type GenesisRag17Runtime } from '../rag/genesisrag17/published-rag.js';
import { ConversationError, type ConversationAnswer, type ConversationJob, isLoopbackUrl } from './contract.js';

// @spec ADR-061 — the local-computation boundary: a job may not name an executable, URL, query,
//   recipient, filesystem location or business scope, and LOCAL_ONLY stays local.
// @req FR-150 — a `rules` answer produced against an empty catalogue is a holding message with no
//   data behind it; the executor refuses to complete the job rather than let it record as a
//   verified answer (see the post-answer check below).

// @req FR-189 — the answer's RAG door follows ZURI_EDGE_GENESISRAG17_MODE (ADR-075 D7): `off` (the default)
//   hands the answer the v4 door itself; `shadow`/`primary` refuse to start without their prerequisites.
// @tested tests/unit/genesisrag17-edge.test.ts

export type { ConversationAnswer };

export function headlessProviderHome(
  config: Pick<Partial<AgentConfig>, 'managedProviderHome'>,
  bin: string,
): Pick<HeadlessOptions, 'codexHome' | 'claudeConfigDir'> {
  const home = config.managedProviderHome?.trim() || undefined;
  return path.basename(bin).toLowerCase().startsWith('codex')
    ? { codexHome: home }
    : { claudeConfigDir: home };
}

/** Floor for the model budget on leased jobs; an explicit larger `ZURI_LLM_TIMEOUT_MS` still wins. */
export const JOB_MODEL_BUDGET_MS = 30000;

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
  /** FR-189: injected in tests; otherwise read once from the environment, here, at start-up. */
  genesisRag17?: GenesisRag17Runtime | null;
} = {}): (job: ConversationJob) => Promise<ConversationAnswer> {
  const ragUrl = options.ragUrl || process.env.GENESIS_RAG_API_URL || 'http://127.0.0.1:8888';
  const headlessBin = config.headlessBin || 'claude';
  const managedHome = headlessProviderHome(config, headlessBin);
  // FR-189: read once, before the first job. `off` yields null and v4 is used unchanged; any other mode
  // with a missing prerequisite throws here, so the worker refuses to start instead of degrading.
  const genesisRag17 = options.genesisRag17 !== undefined ? options.genesisRag17 : createGenesisRag17Runtime();
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
      // Read here so the post-answer check below can see whether there was ever any data to
      // read, and so a malformed catalogue file's thrown error still hits the `finally` cleanup.
      const catalog = loadCatalog(config.catalogRoot || 'state/catalog');
      const local = Boolean(config.llmBaseUrl);
      const llm = config.llmEnabled ? {
        port: createModelPort({
          provider: local ? 'openai-compatible' : 'anthropic',
          model: config.llmModel || 'llama3.1',
          ...(local ? { baseUrl: config.llmBaseUrl, numCtx: config.llmNumCtx } : { apiKey: config.anthropicApiKey }),
          effort: config.llmEffort || 'low',
        }, { fetchFn: noRedirectFetch }),
        /*
         * A job's answer is pushed by the server after completion (ADR-061; the account's
         * allowDelayedPush), so LINE's ~30 s reply-token window — the reason `llmTimeoutMs`
         * defaults to 12 s for the legacy direct-reply path — does not bound this call. Measured
         * on qwen3.5:9b: a product question is three model rounds (two tool calls + the reply)
         * and lands anywhere from 3 s to past 12 s, so the 12 s default failed one run in three
         * with `model call failed: timeout`. The lease (`remaining`) is still the hard ceiling.
         */
        timeoutMs: Math.min(timeoutMs, Math.max(config.llmTimeoutMs || 0, JOB_MODEL_BUDGET_MS)),
        maxIterations: config.llmMaxIterations || 4,
      } : null;
      const result = await (options.answer || answerConversation)(job.question, {
        catalog, role: 'sales',
        exchangeRate: config.exchangeRateThbPerRmb || 5,
        rag: wrapAnswerRag(new GenesisLocalRag({ apiUrl: ragUrl, fetchImpl: noRedirectFetch }), genesisRag17),
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
      /*
       * A `rules` answer read against an empty catalogue is a holding message produced by a reader
       * that had no data — the pattern reader cannot honestly say a product does not exist when it
       * never loaded any products (item 2). Completing the job would record that as a verified
       * answer, so the turn fails instead. A `rules` answer against a POPULATED catalogue is a real,
       * checked answer (including a legitimate "code not found") and must still complete normally;
       * a `model` answer is fine even with an empty local catalogue, since the model answers from
       * the RAG index, which has the products.
       */
      if (result.source === 'rules' && catalog.products.length === 0) {
        throw new ConversationError('EXECUTION_FAILED');
      }
      return { text: result.text, source: result.source, ...(result.reason ? { reason: result.reason } : {}) };
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  };
}
