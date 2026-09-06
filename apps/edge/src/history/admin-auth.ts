import crypto from 'node:crypto';
import type http from 'node:http';

// @req BR-009 — the operator key that gates the configuration surface.

/**
 * Authentication for the edge device's own configuration surface.
 *
 * The GUI is the product's config surface — an operator sets the LINE credentials there, not by
 * editing `.env` on a warehouse PC — so it has to be reachable from wherever that operator is.
 * Until this existed it was reachable and unauthenticated: `GET /api/config` returned the channel
 * token and device token to anyone who asked, and `POST /api/command/dispatch` took a recipient
 * and a message body and sent as the OA, with no credential of any kind. Both were briefly
 * published to the public internet, because the Tailscale Funnel was configured for the whole port
 * rather than the one path LINE needs.
 *
 * Narrowing the tunnel closed the exposure but not the hole: anything that can reach port 8787 —
 * another machine on the warehouse LAN, anyone on the tailnet — still had those endpoints. This
 * module is what makes reaching the port insufficient.
 *
 * Deliberately not a user system. There is one operator role on one appliance, so this is one key,
 * held as a SHA-256 hash, exchanged for an in-memory session. Sessions do not survive a restart,
 * which is correct for an appliance: a device that has just been restarted should not still be
 * carrying someone's login.
 */

export const ADMIN_KEY_PREFIX = 'zadm';
const KEY_BYTES = 24;
const SESSION_BYTES = 32;
export const SESSION_COOKIE = 'zuri_admin';

/** Mint a new operator key. Returned once, in the clear, and never stored in this form. */
export function generateAdminKey(): string {
  return `${ADMIN_KEY_PREFIX}_${crypto.randomBytes(KEY_BYTES).toString('base64url')}`;
}

/**
 * SHA-256, not scrypt.
 *
 * The same reasoning the cloud applies to its device credentials: this is a high-entropy generated
 * secret, not a human-chosen password, so there is no dictionary to slow down and a memory-hard KDF
 * would only make every request more expensive.
 */
export function hashAdminKey(key: string): string {
  return crypto.createHash('sha256').update(key.trim(), 'utf8').digest('hex');
}

/** Compare without letting response time describe how much of the key was right. */
export function keyMatches(candidate: string, expectedHash: string): boolean {
  if (!candidate?.trim() || !expectedHash?.trim()) return false;
  const a = Buffer.from(hashAdminKey(candidate), 'utf8');
  const b = Buffer.from(expectedHash.trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface AdminSessions {
  issue(now?: number): string;
  verify(token: string | undefined, now?: number): boolean;
  revoke(token: string | undefined): void;
  size(now?: number): number;
}

/**
 * In-memory sessions with an absolute lifetime.
 *
 * Absolute rather than sliding: a sliding window on an appliance nobody logs out of is a session
 * that never ends. Twelve hours covers a working day and expires overnight.
 */
export function createAdminSessions(ttlMs = 12 * 60 * 60 * 1000): AdminSessions {
  const issued = new Map<string, number>();
  const sweep = (now: number): void => {
    for (const [token, expiry] of issued) if (expiry <= now) issued.delete(token);
  };
  return {
    issue(now = Date.now()) {
      sweep(now);
      const token = crypto.randomBytes(SESSION_BYTES).toString('base64url');
      issued.set(token, now + ttlMs);
      return token;
    },
    verify(token, now = Date.now()) {
      if (!token) return false;
      const expiry = issued.get(token);
      if (expiry === undefined) return false;
      if (expiry <= now) {
        issued.delete(token);
        return false;
      }
      return true;
    },
    revoke(token) {
      if (token) issued.delete(token);
    },
    // Takes a clock like the others: a counter that reads the wall clock while its neighbours
    // accept an injected one cannot be tested against the sweep it is meant to describe.
    size(now = Date.now()) {
      sweep(now);
      return issued.size;
    },
  };
}

/** Pull one cookie out of a request without pulling in a parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim()) || undefined;
  }
  return undefined;
}

export function sessionCookie(token: string, ttlMs = 12 * 60 * 60 * 1000): string {
  // No `Secure`: this is reached over http on a Tailscale address, and WireGuard already encrypts
  // that hop. Setting Secure would make the cookie silently undeliverable and lock the operator out.
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

/**
 * Is this request allowed to touch the configuration surface?
 *
 * A configured key is required. When none is configured the surface is closed rather than open:
 * an appliance that has not been given a key has not been set up, and an unset password has meant
 * "no password" in enough products to be worth refusing here.
 */
export function isAuthorized(
  request: Pick<http.IncomingMessage, 'headers'>,
  options: { keyHash: string; sessions: AdminSessions },
): boolean {
  if (!options.keyHash?.trim()) return false;
  const cookie = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (options.sessions.verify(cookie)) return true;
  // A bearer key is accepted directly so an operator can drive the surface with curl without
  // holding a cookie jar. Same key, same check.
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return keyMatches(auth.slice(7), options.keyHash);
  return false;
}
