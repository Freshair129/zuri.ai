import { ConversationError, isLoopbackUrl } from './contract.js';

// @req FR-244 — the model-residency poll: one aggregate boolean, the same
//   device-credential auth as `createConversationClient`, and no LINE identity
//   on the wire either way (ADR-061).
// @spec ADR-094 D6 option A

export interface ResidencyClient {
  /** True unless every account with declared hours is currently closed. */
  shouldBeWarm(): Promise<boolean>;
}

/** Same origin/credential validation as `createConversationClient` — one device, one boundary. */
export function createResidencyClient(options: {
  baseUrl: string; deviceKey: string; fetchFn?: typeof fetch; timeoutMs?: number;
}): ResidencyClient {
  let origin: URL;
  try { origin = new URL(options.baseUrl); } catch { throw new ConversationError('INVALID_CLOUD_ORIGIN'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !isLoopbackUrl(options.baseUrl))) {
    throw new ConversationError('HTTPS_CLOUD_ORIGIN_REQUIRED');
  }
  if (!/^edgk_[A-Za-z0-9_-]+$/.test(options.deviceKey)) throw new ConversationError('DEVICE_KEY_REQUIRED');
  return {
    async shouldBeWarm() {
      let response: Response;
      try {
        response = await (options.fetchFn || fetch)(new URL('/api/edge/model-residency', origin), {
          method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${options.deviceKey}`, 'Content-Type': 'application/json' },
          body: '{}', signal: AbortSignal.timeout(options.timeoutMs || 15000),
        });
      } catch { throw new ConversationError('CONVERSATION_NETWORK_FAILED'); }
      if (!response.ok) throw new ConversationError('CONVERSATION_HTTP_FAILED', response.status);
      const body = await response.json().catch(() => null) as { shouldBeWarm?: unknown } | null;
      if (typeof body?.shouldBeWarm !== 'boolean') throw new ConversationError('INVALID_CONVERSATION_CONTRACT');
      return body.shouldBeWarm;
    },
  };
}
