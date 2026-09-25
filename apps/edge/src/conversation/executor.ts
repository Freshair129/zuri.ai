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
import { remainingConversationBudget, withinConversationBudget } from './deadline.js';
import type { InvocationReceipt } from '../answer/context-injection.js';
import type { ConversationClient } from './client.js';
import { createProgressReporter, type ExecutionProgress } from './progress.js';

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
  // Corpus-bound answers require the instrumented tool path. Neither a local
  // catalog fallback nor a headless CLI is bound to this authorized generation.
  if ('corpusContext' in job && job.corpusContext
      && (config.headlessEnabled || !config.llmEnabled || !config.llmBaseUrl)) {
    throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
  }
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
  client?: ConversationClient;
  onProgress?: (event: ExecutionProgress) => void | Promise<void>;
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
  return async job => {
    const contextReceipts: InvocationReceipt[] = [];
    const progress = createProgressReporter(job, config.llmModel, options.onProgress);
    try { return await withinConversationBudget(job, async signal => {
    const noRedirectFetch: typeof fetch = (input, init) => {
      signal.throwIfAborted();
      return (options.fetchFn || fetch)(input, { ...init, redirect: 'error',
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    };
    validateExecutionPolicy(job, config, ragUrl);
    const remaining = Date.parse(job.leaseExpiresAt) - Date.now() - 15000;
    if (remaining <= 0) throw new ConversationError('LEASE_EXPIRED');
    const budget = remainingConversationBudget(job);
    const memory = 'memoryContext' in job ? job.memoryContext : undefined;
    const corpus = 'corpusContext' in job ? job.corpusContext : undefined;
    if (memory && (config.headlessEnabled || !config.llmEnabled || !config.llmBaseUrl)) {
      throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
    }
    if (memory && Date.parse(memory.expiresAt) <= Date.now()) throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
    const timeoutMs = Math.min(remaining, budget === null ? 240000 : Math.max(1, budget - 2000));
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-conversation-'));
    // An opaque server identity is not a filesystem path, even if a future caller gets it wrong.
    const key = crypto.createHash('sha256').update(job.conversationKey).digest('hex');
    try {
      // Read here so the post-answer check below can see whether there was ever any data to
      // read, and so a malformed catalogue file's thrown error still hits the `finally` cleanup.
      const catalog = corpus ? { products: [], byCode: new Map() } : loadCatalog(config.catalogRoot || 'state/catalog');
      const local = Boolean(config.llmBaseUrl);
      const llm = config.llmEnabled ? {
        port: createModelPort({
          provider: local ? 'openai-compatible' : 'anthropic',
          model: config.llmModel || 'llama3.1',
          ...(local ? { baseUrl: config.llmBaseUrl, numCtx: config.llmNumCtx } : { apiKey: config.anthropicApiKey }),
          effort: config.llmEffort || 'low',
        }, { fetchFn: noRedirectFetch }),
        // v2 charges retrieval, all model rounds and completion against one server
        // budget. Legacy v1 keeps its lease ceiling without a Reply timing guarantee.
        timeoutMs: Math.min(timeoutMs, budget === null ? Math.max(config.llmTimeoutMs || 0, JOB_MODEL_BUDGET_MS) : 24000),
        maxIterations: budget === null ? config.llmMaxIterations || 4 : Math.min(config.llmMaxIterations || 3, 3),
        signal,
        onProgress: progress,
        ...(budget === null ? {} : { context: {
          authorized: true, threadId: memory?.threadId, audienceKind: memory?.audienceKind,
          mspSlices: memory?.slices ?? [], maxBudgetBytes: 32768,
          onReceipt: (receipt: InvocationReceipt) => { contextReceipts.push(receipt); },
          beforeInvocation: async () => {
            progress({ phase: 'CONTEXT', state: 'STARTED' });
            try { if (memory) {
              if (Date.parse(memory.expiresAt) <= Date.now() || !options.client?.validateContext)
                throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
              await options.client.validateContext(job);
            } } catch (error) { progress({ phase: 'CONTEXT', state: 'FAILED' }); throw error; }
          },
          lifecycle: async (receipt: InvocationReceipt, state: 'RESOLVED' | 'SUBMITTED' | 'COMPLETED' | 'FAILED') => {
            if (state === 'RESOLVED') progress({ phase: 'CONTEXT', state: 'COMPLETED' });
            else progress({ phase: 'MODEL', state: state === 'SUBMITTED' ? 'STARTED' : state });
            if (!memory) return;
            if (!options.client?.recordInjection) throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
            await options.client.recordInjection(job, receipt, state, `openai-compatible:${config.llmModel || 'llama3.1'}`);
          },
        } }),
        ...(budget === null ? {} : { maxOutputTokens: 512 }),
      } : null;
      const result = await (options.answer || answerConversation)(job.question, {
        catalog, role: 'sales',
        exchangeRate: config.exchangeRateThbPerRmb || 5,
        rag: wrapAnswerRag(new GenesisLocalRag({ apiUrl: ragUrl, fetchImpl: noRedirectFetch }), genesisRag17,
          corpus, signal),
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
      if (corpus && !['PUBLISHED_CATALOG_EVIDENCE', 'CURRENT_WORK_RECORDS_VERIFIED', 'WORK_PREVIEW_VERIFIED',
        'WORK_CONFIRMATION_REQUIRED', 'CURRENT_WORK_RECORDS_REQUIRED'].includes(result.reason ?? '')) {
        // A populated legacy catalog must never turn a bound-corpus outage or
        // skipped tool into an inferred price, quote, or model-only product claim.
        return { text: 'ยังตรวจสอบข้อมูลจากแคตตาล็อกที่เชื่อมไว้ไม่ได้ กรุณาลองใหม่ ยังไม่สามารถยืนยันราคาหรือแนะนำสินค้าได้',
          source: 'rules', reason: 'PUBLISHED_CATALOG_UNAVAILABLE',
          ...(contextReceipts.length ? { contextReceipts } : {}) };
      }
      /*
       * A `rules` answer read against an empty catalogue is a holding message produced by a reader
       * that had no data — the pattern reader cannot honestly say a product does not exist when it
       * never loaded any products (item 2). Completing the job would record that as a verified
       * answer, so the turn fails instead. A `rules` answer against a POPULATED catalogue is a real,
       * checked answer (including a legitimate "code not found") and must still complete normally;
       * a `model` answer is fine even with an empty local catalogue, since the model answers from
       * the RAG index, which has the products.
       */
      if (result.source === 'rules' && catalog.products.length === 0
        && !['WORK_CONFIRMATION_REQUIRED', 'CURRENT_WORK_RECORDS_REQUIRED', 'PUBLISHED_CATALOG_EVIDENCE'].includes(result.reason ?? '')) {
        throw new ConversationError('EXECUTION_FAILED');
      }
      return { text: result.text, source: result.source, ...(result.reason ? { reason: result.reason } : {}),
        ...(contextReceipts.length ? { contextReceipts } : {}) };
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    }); } catch (error) {
      const failure = error instanceof ConversationError ? error
        : new ConversationError(error instanceof Error && error.message === 'MSP_INJECTION_RECEIPT_UNKNOWN'
          ? 'MSP_INJECTION_RECEIPT_UNKNOWN' : 'EXECUTION_FAILED');
      if (contextReceipts.length) failure.contextReceipts = [...contextReceipts];
      throw failure;
    }
  };
}
