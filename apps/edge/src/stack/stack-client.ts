import { resolveSecret } from '../config/secret.js';

// @req SEC-005 — the binding bearer may come from a secret file rather than the process environment.
// @req SDD-017 — the Zuri V2 stack transport: a binding-only forward and report client.
// @spec FR-052, NFR-017, FR-093 — zuri-ai's, referenced but not owned here.

/**
 * Zuri V2 stack client — forwards a signature-verified LINE batch through the
 * FR-052 server-owned binding contract. The bridge never selects Tenant/Business
 * scope and never forwards a LINE reply token.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StackTurnResult {
  handled: number;
  results: Array<Record<string, unknown>>;
  /**
   * The correlation id the stack actually used (NFR-017). Normally the one we sent
   * back verbatim. It differs when the stack rejected ours as malformed and minted
   * its own — which is exactly when we need to know, because our logs would
   * otherwise point at an id that appears nowhere on the other side.
   */
  correlationId?: string;
}

/**
 * What the transport tells the stack it actually sent (FR-093).
 *
 * `text` is what the CUSTOMER received, which is not always what the stack produced:
 * when the stack cannot answer we send our own fallback, and that is the message that
 * exists in the world. Recording the stack's version would record something nobody
 * read — which is the whole reason this report comes from here rather than from there.
 */
export interface ZuriDeliveryReceipt {
  inboundMessageId: string;
  text: string;
  source: 'STACK' | 'TRANSPORT_FALLBACK';
}

export interface ZuriStackClientOptions {
  baseUrl: string;
  bindingId: string;
  bindingBearer: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

interface LegacyObserveOptions {
  baseUrl: string;
  transportToken: string;
  tenantId: string;
  businessId?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedEvents(events: unknown[]): unknown[] {
  return events.map((value) => {
    if (!value || typeof value !== 'object') return value;
    const event = value as Record<string, unknown>;
    const source = event.source && typeof event.source === 'object'
      ? event.source as Record<string, unknown>
      : undefined;
    const message = event.message && typeof event.message === 'object'
      ? event.message as Record<string, unknown>
      : undefined;
    return {
      ...(typeof event.webhookEventId === 'string' ? { webhookEventId: event.webhookEventId } : {}),
      ...(typeof event.type === 'string' ? { type: event.type } : {}),
      ...(source ? {
        source: {
          ...(typeof source.type === 'string' ? { type: source.type } : {}),
          ...(typeof source.userId === 'string' ? { userId: source.userId } : {}),
          ...(typeof source.groupId === 'string' ? { groupId: source.groupId } : {}),
          ...(typeof source.roomId === 'string' ? { roomId: source.roomId } : {}),
        },
      } : {}),
      ...(message ? {
        message: {
          ...(typeof message.id === 'string' ? { id: message.id } : {}),
          ...(typeof message.type === 'string' ? { type: message.type } : {}),
          ...(typeof message.text === 'string' ? { text: message.text } : {}),
        },
      } : {}),
      ...(typeof event.timestamp === 'number' ? { timestamp: event.timestamp } : {}),
    };
  });
}

async function postBatch({
  baseUrl, bearer, body, correlationId, timeoutMs = 15000, fetchFn = fetch, path = '/api/agent/line-webhook',
}: {
  baseUrl: string;
  bearer: string;
  body: Record<string, unknown>;
  correlationId?: string;
  path?: string;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}): Promise<StackTurnResult> {
  const url = new URL(path, baseUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        // NFR-017 — a header, deliberately not a body field: the FR-052 request body
        // is a fixed contract the stack validates strictly, and correlation is
        // transport metadata rather than something the binding authorizes.
        ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new Error('ZURI_STACK_NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
  }
  const responseBody = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new Error('ZURI_STACK_BINDING_UNAUTHORIZED');
  }
  if (!response.ok) throw new Error(`ZURI_STACK_HTTP_${response.status}`);
  try {
    return JSON.parse(responseBody) as StackTurnResult;
  } catch {
    throw new Error('ZURI_STACK_INVALID_JSON');
  }
}

export class ZuriStackClient {
  constructor(private readonly options: ZuriStackClientOptions) {
    if (!UUID.test(options.bindingId) || options.bindingBearer.length < 32) {
      throw new Error('ZURI_STACK_BINDING_CONFIGURATION_INVALID');
    }
  }

  async forwardLineEvents(
    events: unknown[],
    destination: string,
    correlationId?: string
  ): Promise<StackTurnResult> {
    if (!destination?.trim()) throw new Error('ZURI_STACK_DESTINATION_REQUIRED');
    return postBatch({
      baseUrl: this.options.baseUrl,
      bearer: this.options.bindingBearer,
      timeoutMs: this.options.timeoutMs,
      fetchFn: this.options.fetchFn,
      correlationId,
      body: {
        bindingId: this.options.bindingId,
        destination,
        events: normalizedEvents(events),
      },
    });
  }

  /**
   * Report replies that have already reached the customer (FR-093).
   *
   * Called AFTER the send, never before: the point of the report is to record what was
   * actually delivered, and before the send that is not yet a fact. Uses the same
   * binding credential as the forward, so the stack resolves the same Tenant/Business
   * scope and this transport can only ever report against its own binding.
   */
  async reportDelivery(
    deliveries: ZuriDeliveryReceipt[],
    destination: string,
    correlationId?: string
  ): Promise<StackTurnResult> {
    if (!destination?.trim()) throw new Error('ZURI_STACK_DESTINATION_REQUIRED');
    return postBatch({
      path: '/api/agent/line-delivery',
      baseUrl: this.options.baseUrl,
      bearer: this.options.bindingBearer,
      timeoutMs: this.options.timeoutMs,
      fetchFn: this.options.fetchFn,
      correlationId,
      body: {
        bindingId: this.options.bindingId,
        destination,
        deliveries,
      },
    });
  }
}

class LegacyObserveStackClient {
  constructor(private readonly options: LegacyObserveOptions) {}

  async forwardLineEvents(events: unknown[]): Promise<StackTurnResult> {
    return postBatch({
      baseUrl: this.options.baseUrl,
      bearer: this.options.transportToken,
      timeoutMs: this.options.timeoutMs,
      fetchFn: this.options.fetchFn,
      body: {
        tenantId: this.options.tenantId,
        ...(this.options.businessId ? { businessId: this.options.businessId } : {}),
        events: normalizedEvents(events),
      },
    });
  }
}

export function zuriStackFromEnv(
  env: NodeJS.ProcessEnv = process.env
): {
  replyEnabled: boolean;
  forward: (
    events: unknown[],
    destination?: string,
    correlationId?: string
  ) => Promise<StackTurnResult>;
  reportDelivery?: (
    deliveries: ZuriDeliveryReceipt[],
    destination?: string,
    correlationId?: string
  ) => Promise<StackTurnResult>;
} | null {
  const replyEnabled = env.ZURI_STACK_REPLY_ENABLED === 'true';
  // Resolved, not raw: a token supplied only via ZURI_STACK_TOKEN_FILE must be exactly as
  // "configured" as one set directly, or the _FILE form would silently fail this check.
  const legacyToken = resolveSecret(env, 'ZURI_STACK_TOKEN');
  const legacyConfigured = Boolean(legacyToken || env.ZURI_TENANT_ID || env.ZURI_BUSINESS_ID);

  if (replyEnabled && legacyConfigured) throw new Error('ZURI_STACK_LEGACY_SCOPE_FORBIDDEN');

  if (replyEnabled) {
    // SEC-005: the bearer may come from ZURI_STACK_BINDING_BEARER_FILE instead — a Docker
    // secret or an ACL-protected file — so it need not live in the process environment.
    const bindingBearer = resolveSecret(env, 'ZURI_STACK_BINDING_BEARER');
    const missing = [
      ['ZURI_STACK_URL', env.ZURI_STACK_URL],
      ['ZURI_STACK_BINDING_ID', env.ZURI_STACK_BINDING_ID],
      ['ZURI_STACK_BINDING_BEARER', bindingBearer],
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) throw new Error(`ZURI_STACK_BINDING_CONFIGURATION_MISSING: ${missing.join(', ')}`);
    const client = new ZuriStackClient({
      baseUrl: env.ZURI_STACK_URL!,
      bindingId: env.ZURI_STACK_BINDING_ID!,
      bindingBearer,
      timeoutMs: Number(env.ZURI_STACK_TIMEOUT_MS || 15000),
    });
    return {
      replyEnabled: true,
      forward: (events, destination, correlationId) =>
        client.forwardLineEvents(events, destination || '', correlationId),
      // Only in reply mode. Observe-only cannot own a reply, so it has none to report
      // — and a receipt from a transport that did not send the message would be a
      // claim about someone else's work.
      reportDelivery: (deliveries, destination, correlationId) =>
        client.reportDelivery(deliveries, destination || '', correlationId),
    };
  }

  // Preserve the pre-FR-052 forwarder only as observe-only compatibility. It cannot own replies.
  if (env.ZURI_STACK_URL && env.ZURI_TENANT_ID && legacyToken) {
    const client = new LegacyObserveStackClient({
      baseUrl: env.ZURI_STACK_URL,
      tenantId: env.ZURI_TENANT_ID,
      businessId: env.ZURI_BUSINESS_ID,
      transportToken: legacyToken,
      timeoutMs: Number(env.ZURI_STACK_TIMEOUT_MS || 15000),
    });
    return { replyEnabled: false, forward: (events) => client.forwardLineEvents(events) };
  }
  return null;
}
