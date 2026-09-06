import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * The last few turns of one person's chat, so a follow-up like "แล้วถ้าสั่ง 500 ล่ะ" has something
 * to refer back to. Without this the bot answers every message as if it were the first, which is
 * exactly the thing that makes a bot feel like a form rather than a conversation.
 *
 * The trade this makes is deliberate and narrow:
 *
 * - The key is the same HMAC of the LINE user id the identity register and the archive use, so a
 *   raw LINE id is never written to disk here either.
 * - Message text *is* stored, because a conversation the bot cannot re-read is not a conversation.
 *   Retention is therefore hours rather than the archive's 30 days — long enough to finish a
 *   quote, short enough that it is not a second copy of the customer record.
 * - Files live under the git-ignored `state/` tree.
 *
 * Anything a person should not have typed into chat in the first place (a password, an ID number)
 * is still their own message, and this is one more place it would land. That is the reason the
 * agent refuses to ask for such things at all.
 */

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface ConversationOptions {
  root: string;
  hashKey: string;
  /** How long a conversation stays readable. */
  retentionHours?: number;
  /** How many turns are kept and replayed to the model. */
  maxTurns?: number;
}

const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_MAX_TURNS = 12;
/** One message cannot bloat the file or the prompt. LINE's own limit is far higher. */
const MAX_TURN_CHARS = 2000;

export function conversationKey(userId: string, hashKey: string): string {
  return crypto.createHmac('sha256', hashKey).update(userId).digest('hex').slice(0, 32);
}

function fileFor(options: ConversationOptions, key: string): string {
  return path.join(options.root, `${key}.json`);
}

function expired(updatedAt: string, retentionHours: number): boolean {
  const age = Date.now() - Date.parse(updatedAt);
  return !Number.isFinite(age) || age > retentionHours * 3600_000;
}

/**
 * The turns worth replaying. An expired or unreadable file reads as an empty conversation rather
 * than an error: losing context degrades the answer, it does not make the answer wrong.
 */
export function loadConversation(key: string, options: ConversationOptions): Turn[] {
  const retention = options.retentionHours ?? DEFAULT_RETENTION_HOURS;
  const file = fileFor(options, key);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      updatedAt?: string;
      turns?: Turn[];
    };
    if (!parsed.updatedAt || expired(parsed.updatedAt, retention)) {
      fs.rmSync(file, { force: true });
      return [];
    }
    return (parsed.turns || []).slice(-(options.maxTurns ?? DEFAULT_MAX_TURNS));
  } catch {
    return [];
  }
}

export function appendTurns(key: string, turns: Turn[], options: ConversationOptions): void {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const kept = [...loadConversation(key, options), ...turns]
    .map((t) => ({ ...t, text: t.text.slice(0, MAX_TURN_CHARS) }))
    .slice(-maxTurns);

  fs.mkdirSync(options.root, { recursive: true });
  fs.writeFileSync(
    fileFor(options, key),
    JSON.stringify({ key, updatedAt: new Date().toISOString(), turns: kept }, null, 2),
    'utf8'
  );
}

/** Drop every conversation past its retention window. Safe to call on a schedule. */
export function pruneConversations(options: ConversationOptions): number {
  const retention = options.retentionHours ?? DEFAULT_RETENTION_HOURS;
  if (!fs.existsSync(options.root)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(options.root).filter((f) => f.endsWith('.json'))) {
    const file = path.join(options.root, name);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { updatedAt?: string };
      if (!parsed.updatedAt || expired(parsed.updatedAt, retention)) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {
      fs.rmSync(file, { force: true });
      removed++;
    }
  }
  return removed;
}

export function forgetConversation(key: string, options: ConversationOptions): boolean {
  const file = fileFor(options, key);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}
