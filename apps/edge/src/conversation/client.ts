import { ConversationError, conversationEnvelope, type ConversationJob, type FailureCode, isLoopbackUrl } from './contract.js';
import { bindConversationBudget, remainingConversationBudget } from './deadline.js';
import type { InvocationReceipt } from '../answer/context-injection.js';
import { parseProjectWorkResult } from './project-work-tools.js';

// @spec ADR-061 — the pull lane their decision describes: jobs fetched over HTTPS with the
//   registered edgk_ credential, which stays closure-only and never reaches an error body.

export interface ConversationClient {
  claim(): Promise<ConversationJob | null>;
  complete(job: ConversationJob, text: string, contextReceipts?: InvocationReceipt[]): Promise<void>;
  fail(job: ConversationJob, code: FailureCode, contextReceipts?: InvocationReceipt[]): Promise<void>;
  callTool?(job: ConversationJob, toolName: string, args: Record<string, unknown>): Promise<string>;
  validateContext?(job: ConversationJob): Promise<void>;
  recordInjection?(job: ConversationJob, receipt: InvocationReceipt, state: 'RESOLVED' | 'SUBMITTED' | 'COMPLETED' | 'FAILED', modelRef: string): Promise<void>;
}

/** Device credential is closure-only. Redirects, server error bodies and raw fetch errors never escape. */
export function createConversationClient(options: {
  baseUrl: string; deviceKey: string; fetchFn?: typeof fetch; timeoutMs?: number; monotonicNow?: () => number;
}): ConversationClient {
  let origin: URL;
  try { origin = new URL(options.baseUrl); } catch { throw new ConversationError('INVALID_CLOUD_ORIGIN'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !isLoopbackUrl(options.baseUrl))) {
    throw new ConversationError('HTTPS_CLOUD_ORIGIN_REQUIRED');
  }
  if (!/^edgk_[A-Za-z0-9_-]+$/.test(options.deviceKey)) throw new ConversationError('DEVICE_KEY_REQUIRED');
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const send = async (path: string, body: unknown, timeoutMs = options.timeoutMs || 15000): Promise<Response> => {
    let response: Response;
    try {
      response = await (options.fetchFn || fetch)(new URL(path, origin), {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${options.deviceKey}`, 'Content-Type': 'application/json',
          'x-zuri-conversation-versions': '2,1' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
      });
    } catch { throw new ConversationError('CONVERSATION_NETWORK_FAILED'); }
    if (!response.ok) throw new ConversationError('CONVERSATION_HTTP_FAILED', response.status);
    return response;
  };
  return {
    async claim() {
      const startedAt = monotonicNow();
      const response = await send('/api/edge/conversation-jobs/claim', {});
      if (response.status === 204) return null;
      // Bound the claim body before parsing; unexpected content is never printed as diagnostics.
      const reader = response.body?.getReader();
      if (!reader) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        // A bounded published corpus can span hundreds of source snapshots.
        if (size > 1024 * 1024 + 65536) { await reader.cancel(); throw new ConversationError('INVALID_CONVERSATION_CONTRACT'); }
        chunks.push(value);
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ConversationError('INVALID_CONVERSATION_CONTRACT'); }
      const parsed = conversationEnvelope.safeParse(value);
      if (!parsed.success) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      bindConversationBudget(parsed.data.job, startedAt, monotonicNow);
      return parsed.data.job;
    },
    async complete(job, text, contextReceipts) {
      if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new ConversationError('INVALID_ANSWER');
      const remaining = remainingConversationBudget(job);
      if (remaining !== null && remaining <= 0) throw new ConversationError('REPLY_DEADLINE_MISSED');
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/complete`, {
        version: job.version, text, ...('executionId' in job ? { executionId: job.executionId } : {}),
        ...('executionId' in job && contextReceipts?.length ? { contextReceipts } : {}),
      }, Math.min(options.timeoutMs || 15000, remaining ?? Infinity));
    },
    async fail(job, code, contextReceipts) {
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/fail`, {
        version: job.version, code, ...('executionId' in job ? { executionId: job.executionId } : {}),
        ...('executionId' in job && contextReceipts?.length ? { contextReceipts } : {}),
      });
    },
    async callTool(job, toolName, args) {
      if (!('executionId' in job)) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      const remaining = remainingConversationBudget(job)! - 2000;
      if (remaining <= 0) throw new ConversationError('REPLY_DEADLINE_MISSED');
      if (!['search_project_work', 'propose_work_change'].includes(toolName)) throw new ConversationError('TOOL_NOT_ALLOWED');
      const response = await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/tools`, {
        version: job.version, executionId: job.executionId, toolName, args,
      }, Math.min(5000, remaining));
      const reader = response.body?.getReader();
      if (!reader) throw new ConversationError('INVALID_TOOL_RESULT');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 20000) { await reader.cancel(); throw new ConversationError('INVALID_TOOL_RESULT'); }
        chunks.push(value);
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return JSON.stringify(parseProjectWorkResult(toolName, body));
      } catch { throw new ConversationError('INVALID_TOOL_RESULT'); }
    },
    async validateContext(job) {
      if (!('executionId' in job) || !job.memoryContext) return;
      const remaining = remainingConversationBudget(job)! - 2000;
      if (remaining <= 0) throw new ConversationError('REPLY_DEADLINE_MISSED');
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/context`, {
        version: job.version, executionId: job.executionId, contextHash: job.memoryContext.contextHash,
      }, Math.min(3000, remaining));
    },
    async recordInjection(job, receipt, state, modelRef) {
      if (!('executionId' in job) || !job.memoryContext) return;
      const remaining = remainingConversationBudget(job)! - 2000;
      if (remaining <= 0) throw new ConversationError('REPLY_DEADLINE_MISSED');
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/context`, {
        version: job.version, executionId: job.executionId, contextHash: job.memoryContext.contextHash,
        injection: { id: receipt.receiptId, modelRef, state, mspRefs: receipt.refs.msp },
      }, Math.min(3000, remaining));
    },
  };
}
