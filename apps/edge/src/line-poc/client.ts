import { requireLegacyTransport } from '../conversation/contract.js';
import { isRawLineId } from '../safety/redact.js';
import { FetchLike } from '../zuri-api/client.js';

// @req SDD-013 — the bounded local LINE POC transport.

export interface LinePocReceipt {
  provider: 'line';
  status: 'ACCEPTED_BY_LINE';
  acceptedAt: string;
  groupAlias: string;
  requestId?: string;
}

/**
 * Break a long answer into the parts LINE will accept.
 *
 * A push is rejected above 5,000 characters, so an over-long answer is split rather than
 * truncated: dropping the tail of a business answer is worse than sending two bubbles. Split on a
 * line break where one is close enough to the limit, so a price ladder does not get cut mid-row.
 */
export function splitForLine(text: string, limit = 4800): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit);
    const at = cut > limit / 2 ? cut : limit;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  parts.push(rest);
  return parts;
}

export interface LinePocReplyReceipt {
  provider: 'line';
  status: 'ACCEPTED_BY_LINE';
  acceptedAt: string;
  requestId?: string;
}

interface LineBotInfo {
  userId: string;
  basicId: string;
  displayName: string;
}

/**
 * Local, explicit POC-only LINE transport. The group ID may only enter via a
 * local alias mapping; the CLI never accepts it. A 2xx push response proves
 * acceptance by LINE, not client-side rendering or recipient acknowledgement.
 */
export class LinePocClient {
  constructor(
    private readonly options: {
      channelAccessToken: string;
      /** Explicit legacy-only transport; otherwise use the process owner setting. */
      transportOwner?: 'SERVER' | 'LEGACY_EDGE';
      groupAliases: Record<string, string>;
      fetchFn?: FetchLike;
    }
  ) {}

  async verifyGroupAlias(alias: string): Promise<{ groupAlias: string; bot: Pick<LineBotInfo, 'userId' | 'basicId' | 'displayName'> }> {
    this.resolveGroup(alias);
    const bot = await this.request<LineBotInfo>('https://api.line.me/v2/bot/info', { method: 'GET' });
    return { groupAlias: alias, bot: { userId: bot.userId, basicId: bot.basicId, displayName: bot.displayName } };
  }

  async pushFlex(groupAlias: string, altText: string, contents: Record<string, unknown>): Promise<LinePocReceipt> {
    const target = this.resolveGroup(groupAlias);
    const response = await this.requestResponse('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      body: JSON.stringify({
        to: target,
        messages: [{ type: 'flex', altText, contents }],
      }),
    });

    return {
      provider: 'line',
      status: 'ACCEPTED_BY_LINE',
      acceptedAt: new Date().toISOString(),
      groupAlias,
      requestId: response.headers.get('x-line-request-id') || undefined,
    };
  }

  /**
   * Push a plain text message.
   *
   * The Flex templates are fixed-shape — the information-request card, for instance, forces every
   * item's value to "พร้อมใช้" or "ยังต้องเติม" — so they cannot carry an ordinary written answer.
   * A question asked in words deserves an answer in words.
   *
   * LINE rejects a push above 5,000 characters, so an over-long message is split into numbered
   * parts rather than truncated: dropping the tail of a business answer is worse than sending two
   * bubbles.
   */
  async pushText(groupAlias: string, text: string): Promise<LinePocReceipt> {
    return this.pushTextTo(this.resolveGroup(groupAlias), text, groupAlias);
  }

  /**
   * Push to one person who wrote to the bot directly.
   *
   * Every other recipient in this client is an owner-configured alias, never an id. This method is
   * the exception, for the same reason `replyText` is: the id came out of a webhook event whose
   * signature was verified, so it is the sender LINE says it is rather than anything a caller
   * chose. It is guarded to `U…` ids so a group id cannot be smuggled through the direct path.
   */
  async pushTextToUser(userId: string, text: string): Promise<LinePocReceipt> {
    if (!isRawLineId(userId) || !userId.toLowerCase().startsWith('u')) {
      throw new Error('A direct push needs the LINE user id from a signed event.');
    }
    return this.pushTextTo(userId, text, 'direct');
  }

  private async pushTextTo(
    target: string,
    text: string,
    label: string
  ): Promise<LinePocReceipt> {
    const messages = splitForLine(text).map((body, i, all) => ({
      type: 'text' as const,
      text: all.length > 1 ? `(${i + 1}/${all.length})\n${body}` : body,
    }));

    // LINE accepts at most five message objects per push.
    const response = await this.requestResponse('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      body: JSON.stringify({ to: target, messages: messages.slice(0, 5) }),
    });

    return {
      provider: 'line',
      status: 'ACCEPTED_BY_LINE',
      acceptedAt: new Date().toISOString(),
      groupAlias: label,
      requestId: response.headers.get('x-line-request-id') || undefined,
    };
  }

  /**
   * POC-only direct reply. The reply token is supplied by a signed LINE event
   * and is intentionally the only recipient value this method accepts.
   */
  async replyText(replyToken: string, text: string): Promise<LinePocReplyReceipt> {
    const message = text.trim();
    if (!replyToken.trim()) throw new Error('LINE reply token is missing.');
    if (!message || message.length > 5000) throw new Error('LINE reply text must be between 1 and 5,000 characters.');

    const response = await this.requestResponse('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text: message }],
      }),
    });

    return {
      provider: 'line',
      status: 'ACCEPTED_BY_LINE',
      acceptedAt: new Date().toISOString(),
      requestId: response.headers.get('x-line-request-id') || undefined,
    };
  }

  /**
   * Display name for a user, used only so a person can tell who they are approving.
   *
   * Returns null rather than throwing when LINE declines — a profile is unavailable if the user
   * has not added the official account as a friend, and an access request should still be
   * recorded in that case.
   */
  async getDisplayName(userId: string): Promise<string | null> {
    try {
      const profile = await this.request<{ displayName?: string }>(
        `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
        { method: 'GET' }
      );
      return profile.displayName || null;
    } catch {
      return null;
    }
  }

  private resolveGroup(alias: string): string {
    const target = this.options.groupAliases[alias];
    if (!target || !isRawLineId(target) || !target.toLowerCase().startsWith('c')) {
      throw new Error(`LINE POC group alias "${alias}" is absent or invalid in local configuration.`);
    }
    return target;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.requestResponse(url, init);
    const body = await response.text();
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error('LINE API returned a non-JSON response.');
    }
  }

  private async requestResponse(url: string, init: RequestInit): Promise<Response> {
    requireLegacyTransport(this.options.transportOwner ? { ZURI_LINE_TRANSPORT_OWNER: this.options.transportOwner } : process.env);
    const fetchFn = this.options.fetchFn || fetch;
    let response: Response;
    try {
      response = await fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.options.channelAccessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      throw new Error(`LINE API network request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LINE API request failed (${response.status}): ${body || response.statusText}`);
    }
    return response;
  }
}
