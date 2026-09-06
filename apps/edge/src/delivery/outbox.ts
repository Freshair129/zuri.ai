import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Role } from '../identity/registry.js';

// @req SDD-011 — the delivery outbox: a durable push queue and its CR-012 state machine.
// @req AC-006 — a rejected or offline delivery ends in an explicit failed state rather than an endless retry.
// @req NFR-004 — the same bound stated as a non-functional one: attempts are capped and an exhausted intent stops.
// @req BR-005 — one response per idempotency key, derived from the conversation and the LINE event.

/**
 * The queue that stands between a message arriving and an answer going out.
 *
 * It exists because answering got slow. A LINE reply token lives about thirty seconds and is
 * single-use; the headless layer needs eight seconds for a trivial question and forty for a real
 * one. So the webhook can no longer hold the request open until an answer exists — it has to
 * accept the work, say so, and deliver later by push.
 *
 * That trade buys latency and costs a guarantee. Today a reply that throws leaves the event id out
 * of the seen set, so LINE re-delivers it and nothing is lost. Once the `200` goes out first, LINE
 * considers the message handled and will never send it again — this file is now the only thing
 * standing between a crash and a customer who never got an answer.
 *
 * The state machine is deliberately the one from SPEC-CR-012's outbox
 * (`line-copilot-runtime/src/outbox.mjs` on the SmartGift repo): content-hash idempotency keys,
 * revision-based optimistic claims, quarantine as a real terminal state rather than a log line.
 * The record shape here is this agent's, because CR-012's is Zuri's — but the vocabulary matches
 * exactly, so when that runtime ships the two can be merged by renaming rather than by argument.
 */

export type IntentStatus = 'PENDING' | 'DISPATCHING' | 'DELIVERED' | 'QUARANTINED';

export interface DeliveryIntent {
  idempotencyKey: string;
  /** Keyed hash of the sender — the durable half of the identity. */
  conversationKey: string;
  /**
   * The raw LINE id, which a push cannot be addressed without.
   *
   * Everything else on disk in this project stores only the hash. This is the exception, and it is
   * bounded rather than excused: the field is cleared the moment the record reaches a terminal
   * state, so a raw id exists only for the seconds a delivery is actually in flight. `redacted`
   * records that it was cleared rather than never set.
   */
  recipientId: string | null;
  recipientRedacted: boolean;
  role: Role;
  /** The question, kept because a retry after a crash has nothing else to work from. */
  /**
   * LINE's id for the event that produced this. Kept so a delivery receipt can be matched back to
   * it: the cloud's reply to a forwarded batch names events by this id, and it arrives after the
   * record was queued.
   */
  lineEventId: string;
  question: string;
  /**
   * The cloud's `Message.id` for the inbound message this answers, when it has one.
   *
   * Required to report a delivery receipt (FR-093): the cloud identifies the conversation by the
   * row it created when it ingested the event, not by LINE's event id. Null when this device is
   * not bound to a cloud, which is also when there is nobody to report to — so the worker treats
   * its absence as "no receipt to send" rather than as an error.
   */
  inboundMessageId: string | null;
  status: IntentStatus;
  revision: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface OutboxOptions {
  root: string;
  /** How long a claim is honoured before another worker may take the work back. */
  leaseMs: number;
  maxAttempts: number;
  /** How long a settled record is kept for inspection before it is swept. */
  retentionHours: number;
  /**
   * How long a quarantined record's question text is kept before it is redacted in place (G12).
   *
   * A quarantined record is deliberately never deleted — it is the only record that a person
   * asked something and never got an answer. But "kept forever" and "kept as customer message
   * content forever" are different promises, and only the first one is the point: `outbox list`
   * needs the failure — status, attempts, `lastError`, timestamps — not the question itself past
   * some bound. Defaults to a week (168h) when unset, so existing callers need no changes.
   */
  quarantineQuestionRetentionHours?: number;
}

export type ClaimFailure =
  | 'INTENT_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'OUTBOX_NOT_PENDING'
  | 'CONVERSATION_BUSY';

export function idempotencyKeyFor(conversationKey: string, lineEventId: string): string {
  return `sha256:${crypto
    .createHash('sha256')
    .update(`${conversationKey}:${lineEventId}`)
    .digest('hex')}`;
}

function fileFor(options: OutboxOptions, key: string): string {
  // The key carries a colon, which is not a legal filename character on Windows.
  return path.join(options.root, `${key.replace(/[^a-z0-9]/gi, '_')}.json`);
}

function claimLockFor(options: OutboxOptions, key: string): string {
  return path.join(options.root, `${key.replace(/[^a-z0-9]/gi, '_')}.claiming`);
}

/**
 * How long a claim lock may stand before it is treated as abandoned rather than contested.
 *
 * The guarded section is not free: it reads the record, then `listIntents()` reads every record in
 * the directory to answer the conversation-busy question. That is O(queue depth) of small reads, so
 * on a deep queue behind a slow disk it is milliseconds, not microseconds, and this threshold is
 * chosen with room to spare rather than as a tight bound.
 *
 * Getting it wrong in the impatient direction used to mean losing exclusivity. It no longer does:
 * stealing is itself exclusive (see `withClaimLock`), so a lock declared stale while its holder was
 * merely slow costs one caller a retry, not two callers the same record.
 */
const CLAIM_LOCK_STALE_MS = 5_000;

/**
 * Run `fn` as the only process anywhere inside this conversation's claim step.
 *
 * `claim()`'s own revision check is a compare against a value already read from disk, and two
 * processes can read the same revision, both pass the check, and both write — the second write
 * wins on disk, but the first caller never learns it lost, and both would go on to push the same
 * answer twice. Exclusive file creation (`wx`) is the primitive that actually serializes them:
 * only one `openSync` can succeed before the file is removed, on every OS this runs on.
 *
 * Two properties this has to get right, both of which it previously did not:
 *
 * **Stealing must be exclusive too.** The old steal was `rm` then `create`, which is not one
 * operation. Two processes that both judged a lock stale would both remove it — the second
 * removing the *live* lock the first had just created — and both walk in. The steal is now a
 * `rename` of the stale lock out of the way: `rename` fails once the source is gone, so exactly
 * one contender can carry it out, and the loser backs off instead of trampling the winner.
 *
 * **A holder must only release its own lock.** The old `finally` removed whatever was at the path,
 * so a process that had been (wrongly) stolen from went on to delete its successor's lock on the
 * way out. Each holder now stamps a token into the file and removes it only if that token is still
 * there.
 *
 * What it deliberately does not promise is that a lock can never be taken from a live holder.
 * Staleness is judged by mtime, and mtime cannot tell a dead process from a slow one; a heartbeat
 * would settle it, but `fn` is synchronous and nothing can refresh the file while it runs. So the
 * holder is handed `stillOwned()` and is expected to check it immediately before the one write
 * that matters. Being stolen from then costs a retry instead of a duplicate.
 */
export function withClaimLock<T>(
  options: OutboxOptions,
  key: string,
  fn: (stillOwned: () => boolean) => T,
): T | { claimed: false; code: 'REVISION_CONFLICT' } {
  fs.mkdirSync(options.root, { recursive: true });
  const lockPath = claimLockFor(options, key);
  const token = crypto.randomUUID();

  const acquire = (): number | null => {
    try {
      const handle = fs.openSync(lockPath, 'wx');
      fs.writeSync(handle, token);
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return null;
    }
  };

  let fd = acquire();
  if (fd === null) {
    const age = Date.now() - safeMtimeMs(lockPath);
    if (age < CLAIM_LOCK_STALE_MS) {
      // Genuinely contested: another live process is mid-claim right now. Losing this race is
      // exactly what REVISION_CONFLICT already means to a caller, so no new outcome is needed.
      return { claimed: false, code: 'REVISION_CONFLICT' };
    }
    // Older than any real claim step should take, so its holder is likely gone. Claim the *right*
    // to steal before stealing: whoever renames the stale file away is the only one who can, and
    // everyone else's rename fails on a source that no longer exists.
    if (!stealStaleLock(lockPath, token)) return { claimed: false, code: 'REVISION_CONFLICT' };
    fd = acquire();
    if (fd === null) return { claimed: false, code: 'REVISION_CONFLICT' };
  }

  const stillOwned = (): boolean => {
    try {
      return fs.readFileSync(lockPath, 'utf8') === token;
    } catch {
      return false;
    }
  };

  try {
    return fn(stillOwned);
  } finally {
    fs.closeSync(fd);
    releaseIfOwned(lockPath, token);
  }
}

/**
 * Take an abandoned lock out of the way, and report whether this caller was the one who did it.
 *
 * The move is a rename rather than a remove, and that is the whole point: `rename` needs its
 * source to exist, so once one contender has carried the stale file off, every other contender's
 * rename fails on a path that is no longer there and they back off. A remove would have succeeded
 * for all of them — including the ones removing the *live* lock the winner had just created in its
 * place — and they would all have walked in together.
 *
 * Returns false when someone else got there first. The scratch file is unlinked immediately, so a
 * winner that dies before acquiring leaves nothing behind but a free lock path.
 */
export function stealStaleLock(lockPath: string, token: string): boolean {
  const stolen = `${lockPath}.stale-${token}`;
  try {
    fs.renameSync(lockPath, stolen);
  } catch {
    return false;
  }
  fs.rmSync(stolen, { force: true });
  return true;
}

/** Remove the lock only while it is still the one this caller created. */
function releaseIfOwned(lockPath: string, token: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf8') === token) fs.rmSync(lockPath, { force: true });
  } catch {
    // Already gone, or unreadable. Either way there is nothing of ours left to release.
  }
}

function safeMtimeMs(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    // Removed between the failed open and this stat — whoever held it just finished normally.
    return Date.now();
  }
}

/** Write through a temporary file, so a crash mid-write cannot leave a half-parsed record. */
function writeIntent(options: OutboxOptions, intent: DeliveryIntent): void {
  fs.mkdirSync(options.root, { recursive: true });
  const target = fileFor(options, intent.idempotencyKey);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(intent, null, 2), 'utf8');
  fs.renameSync(temp, target);
}

function readIntent(options: OutboxOptions, key: string): DeliveryIntent | null {
  const file = fileFor(options, key);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as DeliveryIntent;
  } catch {
    return null;
  }
}

export function listIntents(options: OutboxOptions): DeliveryIntent[] {
  if (!fs.existsSync(options.root)) return [];
  const intents: DeliveryIntent[] = [];
  for (const name of fs.readdirSync(options.root).filter((f) => f.endsWith('.json'))) {
    try {
      intents.push(JSON.parse(fs.readFileSync(path.join(options.root, name), 'utf8')));
    } catch {
      // A record that cannot be parsed is left alone rather than deleted: it is evidence.
    }
  }
  return intents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface EnqueueInput {
  conversationKey: string;
  lineEventId: string;
  recipientId: string;
  role: Role;
  question: string;
  /** Set when the event was forwarded to the cloud and it named the row it created. */
  inboundMessageId?: string;
}

/**
 * Accept a message for answering.
 *
 * Idempotent by construction: LINE retries a webhook it did not get a `200` for, and the same
 * event arriving twice must not produce two answers. The second call finds the record and reports
 * `created: false` rather than queueing again.
 */
export function enqueue(
  options: OutboxOptions,
  input: EnqueueInput
): { created: boolean; intent: DeliveryIntent } {
  const idempotencyKey = idempotencyKeyFor(input.conversationKey, input.lineEventId);
  const existing = readIntent(options, idempotencyKey);
  if (existing) return { created: false, intent: existing };

  const now = new Date().toISOString();
  const intent: DeliveryIntent = {
    idempotencyKey,
    conversationKey: input.conversationKey,
    recipientId: input.recipientId,
    recipientRedacted: false,
    role: input.role,
    lineEventId: input.lineEventId,
    question: input.question,
    inboundMessageId: input.inboundMessageId?.trim() || null,
    status: 'PENDING',
    revision: 1,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeIntent(options, intent);
  return { created: true, intent };
}

/**
 * Take ownership of one intent.
 *
 * The revision check is what makes two workers safe against each other: both read revision 3, both
 * try to claim, and the second one's write is rejected because the first already moved it to 4.
 * `CONVERSATION_BUSY` is the separate rule that one person never has two answers in flight — a
 * follow-up should queue behind its own predecessor, not race it.
 */
/**
 * Attach the cloud's inbound message id to an intent that was queued without one.
 *
 * The forward to the cloud and the local answer run independently — deliberately, so a slow or
 * absent cloud never delays a customer's acknowledgement — which means the id can arrive after the
 * record exists. Returns false when there is no such record or it already carries one; neither is
 * an error, and neither should stop a delivery.
 *
 * No revision bump: this is an annotation on a record somebody else may be about to claim, and
 * making it participate in the claim's optimistic-concurrency check would let a late receipt id
 * cause a lost delivery. A missing receipt is a worse outcome than none, but a lost answer is
 * worse than both.
 */
export function attachInboundMessageId(
  options: OutboxOptions,
  lineEventId: string,
  inboundMessageId: string
): boolean {
  const id = inboundMessageId?.trim();
  const eventId = lineEventId?.trim();
  if (!id || !eventId) return false;
  // A scan rather than a keyed read, because the record's key is a hash of the sender and this
  // caller has only the event. The set is bounded by what is in flight, which is a handful.
  for (const intent of listIntents(options)) {
    if (intent.lineEventId !== eventId || intent.inboundMessageId) continue;
    writeIntent(options, { ...intent, inboundMessageId: id });
    return true;
  }
  return false;
}

export function claim(
  options: OutboxOptions,
  key: string,
  expectedRevision: number
): { claimed: true; intent: DeliveryIntent } | { claimed: false; code: ClaimFailure } {
  // Which lock to take is decided from the record, so read it once up front. This read proves
  // nothing on its own — a competitor can change the record between here and the lock — which is
  // why everything the decision rests on is read again inside. All it does is route this caller to
  // the right lock file.
  const routing = readIntent(options, key);
  if (!routing) return { claimed: false, code: 'INTENT_NOT_FOUND' };

  // Locked per conversation, not per record. The invariant below is "one conversation, one claim
  // in flight", and a lock taken per idempotencyKey cannot enforce it: a person's two messages are
  // two records with two different lock files, so both workers pass the busy check in the window
  // before either writes DISPATCHING, and the customer gets answered twice at once.
  return withClaimLock(options, routing.conversationKey, (stillOwned): { claimed: true; intent: DeliveryIntent } | { claimed: false; code: ClaimFailure } => {
    const intent = readIntent(options, key);
    if (!intent) return { claimed: false, code: 'INTENT_NOT_FOUND' };
    if (intent.revision !== expectedRevision) return { claimed: false, code: 'REVISION_CONFLICT' };
    if (intent.status !== 'PENDING') return { claimed: false, code: 'OUTBOX_NOT_PENDING' };

    const busy = listIntents(options).some(
      (other) =>
        other.status === 'DISPATCHING' &&
        other.conversationKey === intent.conversationKey &&
        other.idempotencyKey !== intent.idempotencyKey
    );
    if (busy) return { claimed: false, code: 'CONVERSATION_BUSY' };

    const claimed: DeliveryIntent = {
      ...intent,
      status: 'DISPATCHING',
      revision: intent.revision + 1,
      attempts: intent.attempts + 1,
      updatedAt: new Date().toISOString(),
    };
    // The last thing before the only write. If this section ran long enough to look abandoned,
    // someone else now holds the lock and is doing this same work — committing here would be the
    // duplicate the lock exists to prevent, and losing the race is what REVISION_CONFLICT means.
    if (!stillOwned()) return { claimed: false, code: 'REVISION_CONFLICT' };
    writeIntent(options, claimed);
    return { claimed: true, intent: claimed };
  });
}

/** Delivered, and the raw recipient id goes away with it. */
export function markDelivered(options: OutboxOptions, key: string): DeliveryIntent | null {
  const intent = readIntent(options, key);
  if (!intent) return null;
  const settled: DeliveryIntent = {
    ...intent,
    status: 'DELIVERED',
    revision: intent.revision + 1,
    recipientId: null,
    recipientRedacted: true,
    updatedAt: new Date().toISOString(),
  };
  writeIntent(options, settled);
  return settled;
}

/**
 * A delivery attempt failed.
 *
 * Back to PENDING while attempts remain, because most failures here are a network blip. Past the
 * limit it is quarantined rather than retried forever or dropped — someone has to be able to find
 * out that a person asked a question and never got an answer, and a silent drop makes that
 * impossible.
 */
export function markFailed(
  options: OutboxOptions,
  key: string,
  error: string
): DeliveryIntent | null {
  const intent = readIntent(options, key);
  if (!intent) return null;

  const exhausted = intent.attempts >= options.maxAttempts;
  const settled: DeliveryIntent = {
    ...intent,
    status: exhausted ? 'QUARANTINED' : 'PENDING',
    revision: intent.revision + 1,
    ...(exhausted ? { recipientId: null, recipientRedacted: true } : {}),
    lastError: error.slice(0, 300),
    updatedAt: new Date().toISOString(),
  };
  writeIntent(options, settled);
  return settled;
}

/**
 * Return work abandoned by a process that died holding it.
 *
 * This is the crash-recovery path the `200`-first change made necessary. Without it a message
 * caught mid-answer by a restart sits in DISPATCHING forever, and nobody notices.
 */
export function reclaimStale(options: OutboxOptions): DeliveryIntent[] {
  const cutoff = Date.now() - options.leaseMs;
  const reclaimed: DeliveryIntent[] = [];
  for (const intent of listIntents(options)) {
    if (intent.status !== 'DISPATCHING') continue;
    if (Date.parse(intent.updatedAt) > cutoff) continue;

    const exhausted = intent.attempts >= options.maxAttempts;
    const next: DeliveryIntent = {
      ...intent,
      status: exhausted ? 'QUARANTINED' : 'PENDING',
      revision: intent.revision + 1,
      ...(exhausted ? { recipientId: null, recipientRedacted: true } : {}),
      lastError: 'lease expired — the worker holding this did not finish',
      updatedAt: new Date().toISOString(),
    };
    writeIntent(options, next);
    reclaimed.push(next);
  }
  return reclaimed;
}

/** What a quarantined record's `question` becomes once its retention window has passed. */
export const QUESTION_REDACTED = '[redacted after quarantine retention]';

const DEFAULT_QUARANTINE_QUESTION_RETENTION_HOURS = 168;

/**
 * Settled records past their retention. Quarantined ones stay — they are the record of a
 * failure — but past its own, longer retention (G12) the question text inside one is redacted in
 * place rather than the record being deleted: `attempts`, `lastError`, and the timestamps survive
 * for as long as anyone needs to know what failed, without the customer's message content living
 * on disk indefinitely just because nobody happened to look at the quarantine list in time.
 */
export function sweep(options: OutboxOptions): number {
  const cutoff = Date.now() - options.retentionHours * 3600_000;
  const quarantineQuestionCutoff =
    Date.now() -
    (options.quarantineQuestionRetentionHours ?? DEFAULT_QUARANTINE_QUESTION_RETENTION_HOURS) * 3600_000;
  let removed = 0;
  for (const intent of listIntents(options)) {
    if (intent.status === 'QUARANTINED') {
      if (intent.question !== QUESTION_REDACTED && Date.parse(intent.updatedAt) <= quarantineQuestionCutoff) {
        writeIntent(options, { ...intent, question: QUESTION_REDACTED });
      }
      continue;
    }
    if (intent.status !== 'DELIVERED') continue;
    if (Date.parse(intent.updatedAt) > cutoff) continue;
    fs.rmSync(fileFor(options, intent.idempotencyKey), { force: true });
    removed++;
  }
  return removed;
}

export function pendingIntents(options: OutboxOptions): DeliveryIntent[] {
  return listIntents(options).filter((i) => i.status === 'PENDING');
}
