import { ConversationError, conversationEnvelope, type ConversationJob, type FailureCode, isLoopbackUrl } from './contract.js';

// @spec ADR-061 — the pull lane their decision describes: jobs fetched over HTTPS with the
//   registered edgk_ credential, which stays closure-only and never reaches an error body.

export interface ConversationClient {
  claim(): Promise<ConversationJob | null>;
  complete(job: ConversationJob, text: string): Promise<void>;
  fail(job: ConversationJob, code: FailureCode): Promise<void>;
}

/** Device credential is closure-only. Redirects, server error bodies and raw fetch errors never escape. */
export function createConversationClient(options: {
  baseUrl: string; deviceKey: string; fetchFn?: typeof fetch; timeoutMs?: number;
}): ConversationClient {
  let origin: URL;
  try { origin = new URL(options.baseUrl); } catch { throw new ConversationError('INVALID_CLOUD_ORIGIN'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !isLoopbackUrl(options.baseUrl))) {
    throw new ConversationError('HTTPS_CLOUD_ORIGIN_REQUIRED');
  }
  if (!/^edgk_[A-Za-z0-9_-]+$/.test(options.deviceKey)) throw new ConversationError('DEVICE_KEY_REQUIRED');
  const send = async (path: string, body: unknown): Promise<Response> => {
    let response: Response;
    try {
      response = await (options.fetchFn || fetch)(new URL(path, origin), {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${options.deviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs || 15000),
      });
    } catch { throw new ConversationError('CONVERSATION_NETWORK_FAILED'); }
    if (!response.ok) throw new ConversationError('CONVERSATION_HTTP_FAILED', response.status);
    return response;
  };
  return {
    async claim() {
      const response = await send('/api/edge/conversation-jobs/claim', {});
      if (response.status === 204) return null;
      // Bound the claim body before parsing; unexpected content is never printed as diagnostics.
      const reader = response.body?.getReader();
      if (!reader) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 100000) { await reader.cancel(); throw new ConversationError('INVALID_CONVERSATION_CONTRACT'); }
        chunks.push(value);
      }
      let value: unknown;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ConversationError('INVALID_CONVERSATION_CONTRACT'); }
      const parsed = conversationEnvelope.safeParse(value);
      if (!parsed.success) throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      return parsed.data.job;
    },
    async complete(job, text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 5000) throw new ConversationError('INVALID_ANSWER');
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/complete`, { version: job.version, text });
    },
    async fail(job, code) {
      await send(`/api/edge/conversation-jobs/${encodeURIComponent(job.id)}/fail`, { version: job.version, code });
    },
  };
}
