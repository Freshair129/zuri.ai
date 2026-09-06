import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  attachInboundMessageId,
  OutboxOptions,
  QUESTION_REDACTED,
  claim,
  enqueue,
  idempotencyKeyFor,
  listIntents,
  markDelivered,
  markFailed,
  pendingIntents,
  reclaimStale,
  sweep,
  withClaimLock,
  stealStaleLock,
} from '../../src/delivery/outbox.js';
import { drainOnce } from '../../src/delivery/worker.js';
import { handleDirectMessages } from '../../src/history/webhook-server.js';
import { approve, hashUserId, requestAccess } from '../../src/identity/registry.js';
import { splitForLine } from '../../src/line-poc/client.js';

// @tested BR-008 — an outbound reply is reported as a delivery receipt, and says why when it cannot be.
// @tested SDD-011 — the outbox queue and its CR-012 state machine.
// @tested AC-006 — a rejected or offline delivery settles as failed rather than retrying forever.
// @tested NFR-004 — the attempt cap is enforced, not merely declared.
// @tested BR-005 — one response per idempotency key.
// @tested BR-010 — the recorder fires on a delivered reply and stays silent on a failed one.

let root = '';
let options: OutboxOptions;

const QUESTION = { conversationKey: 'conv-a', recipientId: 'U0123456789abcdef', role: 'sales' as const };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-outbox-'));
  options = { root, leaseMs: 60_000, maxAttempts: 3, retentionHours: 48 };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function queue(eventId: string, question = 'TJS23-2 300 ชุด') {
  return enqueue(options, { ...QUESTION, lineEventId: eventId, question });
}

describe('Accepting a question for later', () => {
  it('queues it as pending', () => {
    const { created, intent } = queue('evt-1');
    assert.strictEqual(created, true);
    assert.strictEqual(intent.status, 'PENDING');
    assert.strictEqual(intent.revision, 1);
    assert.strictEqual(intent.attempts, 0);
  });

  it('accepts the same LINE event twice without queueing it twice', () => {
    queue('evt-1');
    const again = queue('evt-1');
    assert.strictEqual(again.created, false);
    assert.strictEqual(listIntents(options).length, 1);
  });

  it('keys on the event, so a repeated question is still a new question', () => {
    queue('evt-1');
    queue('evt-2');
    assert.strictEqual(listIntents(options).length, 2);
  });

  it('derives the same key from the same event, and a different one otherwise', () => {
    assert.strictEqual(idempotencyKeyFor('c', 'e'), idempotencyKeyFor('c', 'e'));
    assert.notStrictEqual(idempotencyKeyFor('c', 'e'), idempotencyKeyFor('c', 'e2'));
  });
});

describe('Claiming work', () => {
  it('moves it to dispatching and counts the attempt', () => {
    const { intent } = queue('evt-1');
    const taken = claim(options, intent.idempotencyKey, intent.revision);
    assert.ok(taken.claimed);
    assert.strictEqual(taken.intent.status, 'DISPATCHING');
    assert.strictEqual(taken.intent.attempts, 1);
  });

  it('refuses a stale revision, so two workers cannot both take it', () => {
    const { intent } = queue('evt-1');
    claim(options, intent.idempotencyKey, intent.revision);

    const second = claim(options, intent.idempotencyKey, intent.revision);
    assert.strictEqual(second.claimed, false);
    assert.strictEqual(second.claimed === false && second.code, 'REVISION_CONFLICT');
  });

  it('keeps one person to one answer at a time', () => {
    const first = queue('evt-1').intent;
    const second = queue('evt-2').intent;
    claim(options, first.idempotencyKey, first.revision);

    const blocked = claim(options, second.idempotencyKey, second.revision);
    assert.strictEqual(blocked.claimed, false);
    assert.strictEqual(blocked.claimed === false && blocked.code, 'CONVERSATION_BUSY');
  });

  it('lets a different person through while one is busy', () => {
    const mine = queue('evt-1').intent;
    claim(options, mine.idempotencyKey, mine.revision);

    const theirs = enqueue(options, {
      conversationKey: 'conv-b',
      lineEventId: 'evt-9',
      recipientId: 'Ufedcba9876543210',
      role: 'sales',
      question: 'ร่ม',
    }).intent;
    assert.strictEqual(claim(options, theirs.idempotencyKey, theirs.revision).claimed, true);
  });
});

describe('Claim exclusivity across processes', () => {
  /*
   * `claim`'s revision check reads-then-writes, which is only safe against two callers in the
   * same process — sync fs calls serialize them by accident of the single-threaded event loop.
   * A second worker *process* sharing this same directory is not serialized by anything JS does;
   * only the filesystem's exclusive-create lock (`.claiming`) stands between them. These tests
   * exercise that lock directly by putting one in place exactly as a live or dead concurrent
   * process would leave it, rather than trying to race two real processes.
   */
  function lockPathFor(key: string): string {
    return path.join(root, `${key.replace(/[^a-z0-9]/gi, '_')}.claiming`);
  }

  it('refuses to claim while another process is inside the critical section', () => {
    const { intent } = queue('evt-1');
    fs.writeFileSync(lockPathFor(intent.conversationKey), 'another-worker');

    const attempt = claim(options, intent.idempotencyKey, intent.revision);
    assert.strictEqual(attempt.claimed, false);
    assert.strictEqual(attempt.claimed === false && attempt.code, 'REVISION_CONFLICT');
    assert.strictEqual(listIntents(options)[0].status, 'PENDING', 'the contested record must not move');
  });

  it('releases its own lock so the next claim is unobstructed', () => {
    const { intent } = queue('evt-1');
    const taken = claim(options, intent.idempotencyKey, intent.revision);
    assert.ok(taken.claimed);
    assert.strictEqual(fs.existsSync(lockPathFor(intent.conversationKey)), false);
  });

  it('steals a lock abandoned by a process that died holding it', () => {
    const { intent } = queue('evt-1');
    // Conversation-scoped: one person is held to one claim, so the lock is named after the
    // conversation rather than the record.
    const lockPath = lockPathFor(intent.conversationKey);
    fs.writeFileSync(lockPath, '');
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, longAgo, longAgo);

    const taken = claim(options, intent.idempotencyKey, intent.revision);
    assert.ok(taken.claimed);
    assert.strictEqual(fs.existsSync(lockPath), false, 'the stolen lock is cleaned up like any other');
  });
});

describe('Settling', () => {
  it('clears the raw LINE id once delivered', () => {
    const { intent } = queue('evt-1');
    assert.strictEqual(intent.recipientId, 'U0123456789abcdef');

    claim(options, intent.idempotencyKey, intent.revision);
    const settled = markDelivered(options, intent.idempotencyKey);

    assert.strictEqual(settled?.status, 'DELIVERED');
    assert.strictEqual(settled?.recipientId, null);
    assert.strictEqual(settled?.recipientRedacted, true);
    /* Belt and braces: the id must be gone from the file, not just from the object. */
    assert.ok(!fs.readFileSync(path.join(root, fs.readdirSync(root)[0]), 'utf8').includes('U0123456789abcdef'));
  });

  it('sends a failure back to pending while attempts remain', () => {
    const { intent } = queue('evt-1');
    claim(options, intent.idempotencyKey, intent.revision);
    const failed = markFailed(options, intent.idempotencyKey, 'network');

    assert.strictEqual(failed?.status, 'PENDING');
    assert.strictEqual(failed?.lastError, 'network');
    assert.strictEqual(pendingIntents(options).length, 1);
  });

  it('quarantines rather than retrying forever, and keeps the reason', () => {
    let current = queue('evt-1').intent;
    for (let i = 0; i < options.maxAttempts; i++) {
      const taken = claim(options, current.idempotencyKey, current.revision);
      assert.ok(taken.claimed);
      current = markFailed(options, current.idempotencyKey, `attempt ${i + 1} failed`)!;
    }

    assert.strictEqual(current.status, 'QUARANTINED');
    assert.strictEqual(current.recipientId, null);
    assert.ok(current.lastError?.includes('failed'));
  });
});

describe('Surviving a crash', () => {
  it('takes back work whose claim outlived its lease', () => {
    const { intent } = queue('evt-1');
    claim(options, intent.idempotencyKey, intent.revision);

    /* The worker died here: the record still says DISPATCHING and nothing is coming. */
    const file = path.join(root, fs.readdirSync(root)[0]);
    const stranded = JSON.parse(fs.readFileSync(file, 'utf8'));
    stranded.updatedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(stranded));

    const reclaimed = reclaimStale(options);
    assert.strictEqual(reclaimed.length, 1);
    assert.strictEqual(reclaimed[0].status, 'PENDING');
    assert.strictEqual(pendingIntents(options).length, 1);
  });

  it('leaves a claim that is still within its lease alone', () => {
    const { intent } = queue('evt-1');
    claim(options, intent.idempotencyKey, intent.revision);
    assert.deepStrictEqual(reclaimStale(options), []);
  });

  it('quarantines work that has already used its attempts', () => {
    const { intent } = queue('evt-1');
    let current = intent;
    for (let i = 0; i < options.maxAttempts; i++) {
      claim(options, current.idempotencyKey, current.revision);
      if (i < options.maxAttempts - 1) current = markFailed(options, current.idempotencyKey, 'x')!;
    }

    const file = path.join(root, fs.readdirSync(root)[0]);
    const stranded = JSON.parse(fs.readFileSync(file, 'utf8'));
    stranded.updatedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(stranded));

    assert.strictEqual(reclaimStale(options)[0].status, 'QUARANTINED');
  });
});

describe('Sweeping', () => {
  it('keeps a quarantined record, because it is the evidence of a failure', () => {
    let current = queue('evt-1').intent;
    for (let i = 0; i < options.maxAttempts; i++) {
      claim(options, current.idempotencyKey, current.revision);
      current = markFailed(options, current.idempotencyKey, 'nope')!;
    }
    const aged = { ...current, updatedAt: new Date(Date.now() - 100 * 3600_000).toISOString() };
    fs.writeFileSync(path.join(root, fs.readdirSync(root)[0]), JSON.stringify(aged));

    assert.strictEqual(sweep(options), 0);
    assert.strictEqual(listIntents(options).length, 1);
  });

  it("redacts a quarantined record's question past its own retention, keeping the failure (G12)", () => {
    let current = queue('evt-1', 'ราคาลับ TJS23-2').intent;
    for (let i = 0; i < options.maxAttempts; i++) {
      claim(options, current.idempotencyKey, current.revision);
      current = markFailed(options, current.idempotencyKey, 'nope')!;
    }
    assert.strictEqual(current.status, 'QUARANTINED');

    const bounded = { ...options, quarantineQuestionRetentionHours: 24 };
    const file = path.join(root, fs.readdirSync(root)[0]);
    const aged = { ...current, updatedAt: new Date(Date.now() - 25 * 3600_000).toISOString() };
    fs.writeFileSync(file, JSON.stringify(aged));

    assert.strictEqual(sweep(bounded), 0, 'redacting a question is not the same as removing a record');
    const [redacted] = listIntents(bounded);
    assert.strictEqual(redacted.question, QUESTION_REDACTED);
    assert.strictEqual(redacted.status, 'QUARANTINED');
    assert.strictEqual(redacted.attempts, options.maxAttempts);
    assert.ok(redacted.lastError?.includes('nope'), 'the failure itself is not touched, only the question');
  });

  it('leaves a quarantined question alone before its own retention has passed', () => {
    let current = queue('evt-1', 'ราคาลับ TJS23-2').intent;
    for (let i = 0; i < options.maxAttempts; i++) {
      claim(options, current.idempotencyKey, current.revision);
      current = markFailed(options, current.idempotencyKey, 'nope')!;
    }

    const bounded = { ...options, quarantineQuestionRetentionHours: 24 };
    const file = path.join(root, fs.readdirSync(root)[0]);
    const aged = { ...current, updatedAt: new Date(Date.now() - 1 * 3600_000).toISOString() };
    fs.writeFileSync(file, JSON.stringify(aged));

    sweep(bounded);
    assert.strictEqual(listIntents(bounded)[0].question, 'ราคาลับ TJS23-2');
  });

  it('removes a delivered record once it is past retention', () => {
    const { intent } = queue('evt-1');
    claim(options, intent.idempotencyKey, intent.revision);
    const delivered = markDelivered(options, intent.idempotencyKey)!;
    const aged = { ...delivered, updatedAt: new Date(Date.now() - 100 * 3600_000).toISOString() };
    fs.writeFileSync(path.join(root, fs.readdirSync(root)[0]), JSON.stringify(aged));

    assert.strictEqual(sweep(options), 1);
    assert.strictEqual(listIntents(options).length, 0);
  });
});

describe('The worker', () => {
  it('answers and pushes, then settles', async () => {
    queue('evt-1');
    const pushed: Array<{ to: string; text: string }> = [];

    const result = await drainOnce({
      outbox: options,
      answer: async () => '300 ชุด ชุดละ 500 บาท',
      push: async (to, text) => void pushed.push({ to, text }),
    });

    assert.strictEqual(result.delivered, 1);
    assert.deepStrictEqual(pushed, [{ to: 'U0123456789abcdef', text: '300 ชุด ชุดละ 500 บาท' }]);
    assert.strictEqual(listIntents(options)[0].status, 'DELIVERED');
  });

  // BR-010. The queue is the other way a message leaves this runtime; a send site the archive
  // cannot see is how the outbound half went unrecorded to begin with.
  it('offers the delivered answer to the archive, tied to the inbound event', async () => {
    queue('evt-archived');
    const recorded: Array<Record<string, unknown>> = [];

    await drainOnce({
      outbox: options,
      answer: async () => 'คำตอบจากคิว',
      push: async () => undefined,
      recordOutbound: (sent) => void recorded.push({ ...sent }),
    });

    assert.strictEqual(recorded.length, 1);
    assert.strictEqual(recorded[0].recipientId, 'U0123456789abcdef');
    assert.strictEqual(recorded[0].text, 'คำตอบจากคิว');
    assert.strictEqual(recorded[0].inReplyToEventId, 'evt-archived');
  });

  it('offers nothing when the push failed, so the archive cannot claim an undelivered answer', async () => {
    queue('evt-unsent');
    const recorded: unknown[] = [];

    const result = await drainOnce({
      outbox: options,
      answer: async () => 'never arrives',
      push: async () => {
        throw new Error('LINE API request failed (400)');
      },
      recordOutbound: (sent) => void recorded.push(sent),
    });

    assert.strictEqual(result.failed, 1);
    assert.deepStrictEqual(recorded, []);
  });

  // The archive being unavailable is bookkeeping about a message the customer already has.
  it('settles the delivery even when recording throws', async () => {
    queue('evt-archive-throws');

    const result = await drainOnce({
      outbox: options,
      answer: async () => 'delivered anyway',
      push: async () => undefined,
      recordOutbound: () => {
        throw new Error('disk full');
      },
    });

    assert.strictEqual(result.delivered, 1);
    assert.strictEqual(listIntents(options)[0].status, 'DELIVERED');
  });

  it('does not push when the answer throws, and keeps the work for a retry', async () => {
    queue('evt-1');
    let pushes = 0;

    const result = await drainOnce({
      outbox: options,
      answer: async () => {
        throw new Error('engine unavailable');
      },
      push: async () => void pushes++,
    });

    assert.strictEqual(result.failed, 1);
    assert.strictEqual(pushes, 0);
    assert.strictEqual(listIntents(options)[0].status, 'PENDING');
    assert.ok(listIntents(options)[0].lastError?.includes('engine unavailable'));
  });

  it('retries a failed push and reports it as delivered once it works', async () => {
    queue('evt-1');
    let attempts = 0;
    const deps = {
      outbox: options,
      answer: async () => 'answer',
      push: async () => {
        attempts++;
        if (attempts === 1) throw new Error('LINE 500');
      },
    };

    assert.strictEqual((await drainOnce(deps)).failed, 1);
    assert.strictEqual((await drainOnce(deps)).delivered, 1);
    assert.strictEqual(listIntents(options)[0].status, 'DELIVERED');
  });

  it('gives up into quarantine rather than pushing forever', async () => {
    queue('evt-1');
    const deps = {
      outbox: options,
      answer: async () => 'answer',
      push: async () => {
        throw new Error('LINE keeps refusing');
      },
    };

    for (let i = 0; i < options.maxAttempts; i++) await drainOnce(deps);
    assert.strictEqual(listIntents(options)[0].status, 'QUARANTINED');
  });

  it('reports what happened without ever carrying the question', async () => {
    queue('evt-1', 'ราคาลับเฉพาะ TJS23-2');
    const events: string[] = [];

    await drainOnce({
      outbox: options,
      answer: async () => 'answer',
      push: async () => undefined,
      onEvent: (event) => events.push(JSON.stringify(event)),
    });

    assert.ok(events.length > 0);
    assert.ok(!events.join(' ').includes('ราคาลับเฉพาะ'));
  });
});

describe('The webhook, once the queue is on', () => {
  let identityRoot = '';

  beforeEach(() => {
    identityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-ident-'));
  });
  afterEach(() => fs.rmSync(identityRoot, { recursive: true, force: true }));

  /** Stands in for the durable `ReplyDedupe` `handleDirectMessages` takes (G10). */
  function fakeDedupe() {
    const seen = new Set<string>();
    return {
      has: (id: string) => seen.has(id),
      remember: (id: string) => void seen.add(id),
      forget: (id: string) => void seen.delete(id),
    };
  }

  function payload(eventId: string, userId: string) {
    return {
      events: [
        {
          webhookEventId: eventId,
          type: 'message',
          replyToken: 'reply-token',
          source: { type: 'user', userId },
          message: { type: 'text', text: 'TJS23-2 300 ชุด' },
        },
      ],
    };
  }

  // BR-010. The recorder has to fire where delivery is known to have succeeded, and carry the id of
  // the question it answers — an outbound record that cannot be tied back to an inbound one is a
  // line of text with no conversation around it.
  it('hands the delivered reply to the outbound recorder, tied to the event it answers', async () => {
    const identity = { root: identityRoot, hashKey: 'k' };
    const userId = 'U0123456789abcdef';
    requestAccess(userId, 'PP', identity);
    approve(hashUserId(userId, identity.hashKey), 'sales', 'a@b.c', 'test', identity);

    const recorded: Array<Record<string, unknown>> = [];
    await handleDirectMessages(
      payload('evt-recorded', userId),
      {
        enabled: true,
        identity,
        replyText: async () => undefined,
        answer: () => 'inline answer',
      },
      fakeDedupe(),
      (sent) => void recorded.push({ ...sent })
    );

    assert.strictEqual(recorded.length, 1);
    assert.strictEqual(recorded[0].deliveryKind, 'reply');
    assert.strictEqual(recorded[0].inReplyToEventId, 'evt-recorded');
    assert.strictEqual(recorded[0].recipientId, userId);
    assert.ok(typeof recorded[0].text === 'string' && (recorded[0].text as string).length > 0);
  });

  it('records nothing when the reply never reached LINE', async () => {
    const identity = { root: identityRoot, hashKey: 'k' };
    const userId = 'U0123456789abcdef';
    requestAccess(userId, 'PP', identity);
    approve(hashUserId(userId, identity.hashKey), 'sales', 'a@b.c', 'test', identity);

    const recorded: unknown[] = [];
    await assert.rejects(() =>
      handleDirectMessages(
        payload('evt-failed', userId),
        {
          enabled: true,
          identity,
          // No pushText, so the reply failure has no fallback and propagates.
          replyText: async () => {
            throw new Error('LINE API request failed (400)');
          },
          answer: () => 'inline answer',
        },
        fakeDedupe(),
        (sent) => void recorded.push(sent)
      )
    );
    assert.deepStrictEqual(recorded, [], 'an archive must not claim a delivery that did not happen');
  });

  it('acknowledges on the token and queues the work, instead of answering inline', async () => {
    const identity = { root: identityRoot, hashKey: 'k' };
    const userId = 'U0123456789abcdef';
    requestAccess(userId, 'PP', identity);
    approve(hashUserId(userId, identity.hashKey), 'sales', 'a@b.c', 'test', identity);

    const replies: string[] = [];
    let answered = 0;
    const queued: unknown[] = [];

    const result = await handleDirectMessages(
      payload('evt-1', userId),
      {
        enabled: true,
        identity,
        replyText: async (_token, text) => void replies.push(text),
        answer: () => {
          answered++;
          return 'inline answer';
        },
        enqueue: (input) => {
          queued.push(input);
          return { created: true };
        },
      },
      fakeDedupe()
    );

    assert.strictEqual(result.queued, 1);
    assert.strictEqual(answered, 0, 'the slow path must not run inside the request');
    assert.strictEqual(replies.length, 1);
    assert.ok(replies[0].includes('ซูริรับคำถามแล้ว'));
  });

  it('still answers inline when no queue is configured', async () => {
    const identity = { root: identityRoot, hashKey: 'k' };
    const userId = 'U0123456789abcdef';
    requestAccess(userId, 'PP', identity);
    approve(hashUserId(userId, identity.hashKey), 'sales', 'a@b.c', 'test', identity);

    const replies: string[] = [];
    const result = await handleDirectMessages(
      payload('evt-1', userId),
      {
        enabled: true,
        identity,
        replyText: async (_token, text) => void replies.push(text),
        answer: () => 'inline answer',
      },
      fakeDedupe()
    );

    assert.strictEqual(result.queued, 0);
    assert.strictEqual(result.replied, 1);
    assert.deepStrictEqual(replies, ['inline answer']);
  });
});

describe('Splitting a long answer', () => {
  it('leaves a short answer alone', () => {
    assert.deepStrictEqual(splitForLine('สั้น'), ['สั้น']);
  });

  it('breaks on a line end so a price ladder is not cut mid-row', () => {
    const ladder = Array.from({ length: 40 }, (_, i) => `${i * 10} ชุด  ${500 - i} บาท`).join('\n');
    const parts = splitForLine(ladder, 200);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((p) => p.length <= 200));
    assert.strictEqual(parts.join('\n'), ladder);
  });
});

describe('Claim exclusivity — the three ways it could still be lost', () => {
  function lockPathFor(key: string): string {
    return path.join(root, `${key.replace(/[^a-z0-9]/gi, '_')}.claiming`);
  }

  it('holds one conversation to one claim, even when the two records have different keys', () => {
    // CONVERSATION_BUSY is a claim about a *conversation*, so the lock has to be too. Keyed per
    // record it could not enforce it: one person's two messages are two records, and in the window
    // before either worker writes DISPATCHING both read a queue with nothing dispatching in it and
    // both take the same person.
    const first = queue('evt-1').intent;
    const second = queue('evt-2').intent;
    assert.strictEqual(first.conversationKey, second.conversationKey, 'fixture must share a conversation');

    fs.writeFileSync(lockPathFor(first.conversationKey), 'worker-a-is-inside');

    const attempt = claim(options, second.idempotencyKey, second.revision);
    assert.strictEqual(attempt.claimed, false, 'the conversation is already being claimed');
    assert.strictEqual(listIntents(options).filter((i) => i.status === 'DISPATCHING').length, 0);
  });

  it('does not steal a lock whose holder is still within the staleness window', () => {
    // The only stealing this can assert in-process. Two *contenders* racing to steal one abandoned
    // lock is what the rename in `withClaimLock` serialises, and that cannot be staged here: `fn`
    // is synchronous, so a second caller can only run while the first is inside, which makes it a
    // holder-vs-stealer case rather than stealer-vs-stealer. Correctness in that race does not rest
    // on the rename anyway — it rests on `stillOwned()`, which the next test covers.
    const key = 'conv-fresh-lock';
    const lockPath = lockPathFor(key);
    fs.writeFileSync(lockPath, 'live-holder');

    let entered = false;
    const attempt = withClaimLock(options, key, () => {
      entered = true;
      return 'ENTERED';
    });
    assert.notStrictEqual(attempt, 'ENTERED');
    assert.strictEqual(entered, false, 'a fresh lock belongs to someone');
    assert.strictEqual(fs.readFileSync(lockPath, 'utf8'), 'live-holder', 'and must be left untouched');
  });

  it('does not commit a claim it was stolen from while it worked', () => {
    // mtime cannot tell a dead holder from a slow one, and `fn` is synchronous so nothing can
    // refresh the lock while it runs. A slow holder can therefore be stolen from — what it must not
    // do is finish and write anyway. Ageing the lock from inside is the deterministic form of "this
    // section ran long enough to look abandoned".
    const { intent } = queue('evt-1');
    const lockPath = lockPathFor(intent.conversationKey);

    let sawTheft = false;
    const outcome = withClaimLock(options, intent.conversationKey, (stillOwned) => {
      const longAgo = new Date(Date.now() - 60_000);
      fs.utimesSync(lockPath, longAgo, longAgo);
      // A competitor takes the lock while we are still inside.
      withClaimLock(options, intent.conversationKey, () => 'thief');
      sawTheft = !stillOwned();
      return 'done';
    });

    assert.strictEqual(outcome, 'done');
    assert.strictEqual(sawTheft, true, 'a robbed holder must be able to detect it before committing');
  });

  it('leaves no lock behind after a contested steal, so the queue does not wedge', () => {
    const key = 'conv-cleanup';
    withClaimLock(options, key, () => {
      const lockPath = lockPathFor(key);
      const longAgo = new Date(Date.now() - 60_000);
      fs.utimesSync(lockPath, longAgo, longAgo);
      withClaimLock(options, key, () => 'thief');
      return null;
    });
    assert.strictEqual(fs.existsSync(lockPathFor(key)), false, 'no lock may survive its holder');
    const strays = fs.readdirSync(root).filter((f) => f.includes('.stale-'));
    assert.deepStrictEqual(strays, [], 'a steal must not leave its scratch file behind');
  });
});

describe('Claim exclusivity — the two properties in-process tests could not reach', () => {
  /*
   * These were shipped in #16 as reasoned-but-unverified. Both guard races *between processes*,
   * and `fn` is synchronous, so a second caller inside one process can only ever run while the
   * first is still in its critical section — every in-process scenario is holder-vs-stealer, never
   * stealer-vs-stealer. That is why they went in uncovered, and it was the wrong place to stop:
   * one of them is deterministic from inside `fn` after all, and the other needs real processes.
   */
  function lockPathFor(key: string): string {
    return path.join(root, `${key.replace(/[^a-z0-9]/gi, '_')}.claiming`);
  }

  it('leaves a lock alone once it belongs to someone else', () => {
    // Deterministic after all: the theft can be staged from inside the critical section by
    // overwriting the file, which is exactly the state a holder wakes up to after being stolen
    // from. Before the token check, `finally` removed whatever was at the path — so the robbed
    // holder went on to delete its successor's lock on the way out, and the queue lost its
    // mutual exclusion one handoff later.
    const key = 'conv-not-mine';
    const lockPath = lockPathFor(key);

    const result = withClaimLock(options, key, () => {
      assert.ok(fs.existsSync(lockPath), 'we hold it while inside');
      fs.writeFileSync(lockPath, 'a-different-owner');
      return 'done';
    });

    assert.strictEqual(result, 'done');
    assert.strictEqual(fs.existsSync(lockPath), true, 'the successor keeps its lock');
    assert.strictEqual(fs.readFileSync(lockPath, 'utf8'), 'a-different-owner', 'and it is untouched');
  });

  it('removes the lock it does own, so the queue does not wedge', () => {
    const key = 'conv-mine';
    withClaimLock(options, key, () => null);
    assert.strictEqual(fs.existsSync(lockPathFor(key)), false);
  });

  it('lets only the contender that moved the file claim the steal', () => {
    /*
     * The steal is the half that needed more than one process to observe, so it is tested by its
     * contract instead. `stealStaleLock` answers exactly one question — did *this* caller carry the
     * abandoned lock away — and every contender that did not gets false and backs off.
     *
     * A race between real processes was tried first and dropped. It never failed spuriously, but
     * measured against the deliberately-broken rm-then-create version it caught the regression only
     * 1 to 2 times in 6: whichever contender reaches the staleness check first creates a fresh
     * lock, and everyone behind it correctly sees a fresh lock and backs off before reaching the
     * steal at all. The window where two callers both hold a stale mtime is microseconds wide. A
     * guard that misses five times in six is not a guard.
     */
    const lockPath = path.join(root, 'contended.claiming');
    fs.writeFileSync(lockPath, 'dead-holder');

    assert.strictEqual(stealStaleLock(lockPath, 'winner'), true, 'the one that moves it wins');
    assert.strictEqual(fs.existsSync(lockPath), false, 'and the path is free for it to take');

    // Every later contender meets exactly this world: the file it measured is already gone.
    assert.strictEqual(stealStaleLock(lockPath, 'loser'), false, 'nobody else may claim the steal');
    assert.strictEqual(stealStaleLock(lockPath, 'later'), false);
  });

  it('leaves no scratch file behind, whether it wins or loses', () => {
    const lockPath = path.join(root, 'scratch.claiming');
    fs.writeFileSync(lockPath, 'dead-holder');
    stealStaleLock(lockPath, 'winner');
    stealStaleLock(lockPath, 'loser');
    assert.deepStrictEqual(
      fs.readdirSync(root).filter((f) => f.includes('.stale-')),
      [],
      'a half-finished steal must not wedge the next one',
    );
  });
});

// FR-093 / BR-008. Every reply the outbox sent was absent from the cloud's record: the forward's
// answer, which is the only place the inbound row id appears, was discarded, and the worker had no
// way to report anything. These pin the path that closes it — and, just as importantly, that it
// stays quiet and harmless on a device with no cloud binding, which is most of them.
describe('Reporting what the customer received', () => {
  const receiptDeps = (sent: unknown[], fail = false) => ({
    outbox: options,
    answer: async () => 'คำตอบ',
    push: async () => undefined,
    reportDelivery: async (r: unknown) => {
      if (fail) throw new Error('cloud refused the receipt');
      sent.push(r);
      return undefined;
    },
  });

  it('quotes the inbound row id the cloud gave for this event', async () => {
    queue('evt-1');
    assert.strictEqual(attachInboundMessageId(options, 'evt-1', 'msg_row_9'), true);

    const sent: unknown[] = [];
    const result = await drainOnce(receiptDeps(sent));

    assert.strictEqual(result.delivered, 1);
    assert.deepStrictEqual(sent, [{ inboundMessageId: 'msg_row_9', text: 'คำตอบ', source: 'STACK' }]);
  });

  it('delivers and says why when the cloud never named a row for this event', async () => {
    queue('evt-1');
    const sent: unknown[] = [];
    const events: Array<{ type: string; reported?: boolean; reason?: string }> = [];

    const result = await drainOnce({ ...receiptDeps(sent), onEvent: (e) => events.push(e) });

    assert.strictEqual(result.delivered, 1, 'an unreportable delivery is still a delivery');
    assert.deepStrictEqual(sent, []);
    const receipt = events.find((e) => e.type === 'receipt');
    assert.strictEqual(receipt?.reported, false);
    assert.match(receipt?.reason ?? '', /not forwarded to the cloud/);
  });

  // The message is already with the customer by the time this runs. A bookkeeping failure that
  // reopened the record would send it again.
  it('does not undo or retry a delivery when the receipt itself fails', async () => {
    queue('evt-1');
    attachInboundMessageId(options, 'evt-1', 'msg_row_9');
    const events: Array<{ type: string; reported?: boolean; reason?: string }> = [];

    const result = await drainOnce({ ...receiptDeps([], true), onEvent: (e) => events.push(e) });

    assert.strictEqual(result.delivered, 1);
    assert.strictEqual(result.failed, 0);
    assert.strictEqual(listIntents(options)[0].status, 'DELIVERED');
    assert.match(events.find((e) => e.type === 'receipt')?.reason ?? '', /cloud refused/);
  });

  it('reports nothing at all, and logs nothing, when no cloud is bound', async () => {
    queue('evt-1');
    const events: Array<{ type: string }> = [];
    const result = await drainOnce({
      outbox: options,
      answer: async () => 'คำตอบ',
      push: async () => undefined,
      onEvent: (e) => events.push(e),
    });
    assert.strictEqual(result.delivered, 1);
    assert.ok(!events.some((e) => e.type === 'receipt'), 'an unbound device has nothing to report');
  });
});

describe('Attaching the cloud row id after the fact', () => {
  it('finds the queued record by the LINE event id', () => {
    queue('evt-1');
    assert.strictEqual(attachInboundMessageId(options, 'evt-1', 'msg_1'), true);
    assert.strictEqual(listIntents(options)[0].inboundMessageId, 'msg_1');
  });

  it('refuses to overwrite one that is already set', () => {
    queue('evt-1');
    attachInboundMessageId(options, 'evt-1', 'msg_1');
    assert.strictEqual(attachInboundMessageId(options, 'evt-1', 'msg_2'), false);
    assert.strictEqual(listIntents(options)[0].inboundMessageId, 'msg_1');
  });

  it('is a no-op for an event that was never queued, rather than an error', () => {
    assert.strictEqual(attachInboundMessageId(options, 'evt-unknown', 'msg_1'), false);
  });

  it('ignores an empty id on either side', () => {
    queue('evt-1');
    assert.strictEqual(attachInboundMessageId(options, 'evt-1', '   '), false);
    assert.strictEqual(attachInboundMessageId(options, '', 'msg_1'), false);
    assert.strictEqual(listIntents(options)[0].inboundMessageId, null);
  });
});
