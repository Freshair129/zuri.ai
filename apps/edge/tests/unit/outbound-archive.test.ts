// Contract for the outbound half of the LINE archive.
//
// Before this, the archive held every message the OA received and none of the ones it sent. That is
// enough to show what a customer asked and not what they were told — which is the half that matters
// when someone disputes what was said. These pin the properties that make the two halves one
// record: the same file, the same hashing, the same allow-list, and a link back to the question.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DIRECT_MESSAGE_DIR,
  archiveOutboundLineMessage,
  archiveLineWebhookPayload,
  conversationDirectory,
  directArchivePath,
  pruneExpiredArchives,
  weeklyArchivePath,
} from '../../src/history/archive.js';

// @tested BR-010 — a message the runtime sends is archived beside the ones it received.

const HASH_KEY = 'test-hash-key';
const GROUP_ID = 'Cffffffffffffffffffffffffffffffff';

const options = (root: string) => ({
  root,
  groupAliases: { test: GROUP_ID, team: 'Ceeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
  allowedGroupAliases: ['test'],
  hashKey: HASH_KEY,
  retentionDays: 30,
});

function withRoot(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'line-archive-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const readRecords = (file: string) =>
  fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('outbound archive', () => {
  it('writes the sent message into the same weekly file as the inbound ones', () => {
    withRoot((root) => {
      const sentAt = new Date('2026-09-06T05:23:04.548Z');
      archiveLineWebhookPayload(
        {
          events: [{
            webhookEventId: 'in-1',
            timestamp: sentAt.getTime(),
            type: 'message',
            source: { type: 'group', groupId: GROUP_ID, userId: 'Uaaaa' },
            message: { id: 'm1', type: 'text', text: 'ซูริ ราคาเท่าไหร่' },
          }],
        },
        { ...options(root), receivedAt: sentAt }
      );
      const result = archiveOutboundLineMessage(
        { recipientId: GROUP_ID, text: 'ราคา 120 บาท', deliveryKind: 'reply', inReplyToEventId: 'in-1', sentAt },
        options(root)
      );

      assert.ok(result.archived);
      assert.strictEqual(result.file, weeklyArchivePath(path.resolve(root), 'test', sentAt));

      const records = readRecords(result.file!);
      assert.strictEqual(records.length, 2, 'both halves belong in one file');
      assert.strictEqual(records[0].direction, undefined, 'an inbound record carries no direction');
      assert.strictEqual(records[1].direction, 'outbound');
      assert.strictEqual(records[1].inReplyToEventId, 'in-1');
      assert.strictEqual(records[1].text, 'ราคา 120 บาท');
      assert.strictEqual(records[1].deliveryKind, 'reply');
      assert.strictEqual(records[1].occurredAt, sentAt.toISOString());
    });
  });

  it('hashes the recipient with the same key the inbound side uses for the sender', () => {
    withRoot((root) => {
      const sentAt = new Date('2026-09-06T05:23:04.548Z');
      // The inbound record hashes the *sender*; here the same group id is the recipient. Feeding the
      // group id to both sides is what proves one key and one algorithm are in use.
      archiveLineWebhookPayload(
        {
          events: [{
            webhookEventId: 'in-2', timestamp: sentAt.getTime(), type: 'message',
            source: { type: 'group', groupId: GROUP_ID, userId: GROUP_ID },
            message: { id: 'm2', type: 'text', text: 'hi' },
          }],
        },
        { ...options(root), receivedAt: sentAt }
      );
      const out = archiveOutboundLineMessage(
        { recipientId: GROUP_ID, text: 'ok', deliveryKind: 'reply', sentAt }, options(root)
      );
      const records = readRecords(out.file!);
      assert.match(records[1].recipientHash, /^hmac-sha256:[a-f0-9]{64}$/);
      assert.strictEqual(records[1].recipientHash, records[0].senderHash);
      assert.ok(!JSON.stringify(records[1]).includes(GROUP_ID), 'no raw id reaches the file');
    });
  });

  it('refuses a group destination that is not allow-listed, however it was reached', () => {
    withRoot((root) => {
      // `team` is a configured alias but not an allowed one; the second is a group id nobody has
      // configured. Neither may be filed — and the second must not slip into the direct-message
      // tree just because no alias claims it.
      for (const recipient of ['Ceeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'C0123456789abcdef0123456789abcdef']) {
        const result = archiveOutboundLineMessage(
          { recipientId: recipient, text: 'should not be filed', deliveryKind: 'push' },
          options(root)
        );
        assert.strictEqual(result.archived, false, recipient);
        assert.strictEqual(result.file, undefined);
      }
      assert.ok(!fs.existsSync(path.join(root, 'team')));
      assert.ok(!fs.existsSync(path.join(root, '_dm')), 'a group is not a person');
    });
  });

  it('records an operator-initiated push, which answers no inbound event', () => {
    withRoot((root) => {
      const out = archiveOutboundLineMessage(
        { recipientId: GROUP_ID, text: 'ประกาศ', deliveryKind: 'push' }, options(root)
      );
      const record = readRecords(out.file!)[0];
      assert.strictEqual(record.deliveryKind, 'push');
      assert.strictEqual(record.inReplyToEventId, undefined);
      assert.strictEqual(record.messageType, 'text');
    });
  });

  it('gives every record its own id, so two identical sends stay two records', () => {
    withRoot((root) => {
      const send = () => archiveOutboundLineMessage(
        { recipientId: GROUP_ID, text: 'same text', deliveryKind: 'push' }, options(root)
      );
      const first = send();
      send();
      const records = readRecords(first.file!);
      assert.strictEqual(records.length, 2, 'a repeated delivery is a fact the archive should show');
      assert.notStrictEqual(records[0].outboundId, records[1].outboundId);
    });
  });

  it('carries the correlation id so a reply can be tied to the request that produced it', () => {
    withRoot((root) => {
      const out = archiveOutboundLineMessage(
        { recipientId: GROUP_ID, text: 'x', deliveryKind: 'reply' },
        { ...options(root), correlationId: 'cli-abc' }
      );
      assert.strictEqual(readRecords(out.file!)[0].correlationId, 'cli-abc');
    });
  });
});

describe('direct message archive', () => {
  const USER_ID = 'U0123456789abcdef0123456789abcdef';

  const inbound = (root: string, eventId: string, at: Date, text: string) =>
    archiveLineWebhookPayload(
      {
        events: [{
          webhookEventId: eventId,
          timestamp: at.getTime(),
          type: 'message',
          source: { type: 'user', userId: USER_ID },
          message: { id: 'm-' + eventId, type: 'text', text },
        }],
      },
      { ...options(root), receivedAt: at }
    );

  it('files both halves of one conversation in one file, under the sender hash', () => {
    withRoot((root) => {
      const at = new Date('2026-09-06T06:00:00.000Z');
      const received = inbound(root, 'dm-1', at, 'ราคาเท่าไหร่');
      assert.strictEqual(received.archived, 1, 'a direct message is no longer ignored');

      const sent = archiveOutboundLineMessage(
        { recipientId: USER_ID, text: 'ชิ้นละ 120 บาทค่ะ', deliveryKind: 'push', inReplyToEventId: 'dm-1', sentAt: at },
        options(root)
      );
      assert.ok(sent.archived);
      assert.strictEqual(sent.file, received.files[0], 'the answer belongs beside the question');

      const records = readRecords(sent.file!);
      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0].scope, 'dm');
      assert.strictEqual(records[1].scope, 'dm');
      assert.strictEqual(records[0].groupAlias, undefined, 'a direct message has no alias to claim');
      assert.strictEqual(records[0].conversationHash, records[1].conversationHash);
      assert.strictEqual(records[1].inReplyToEventId, 'dm-1');
      assert.strictEqual(records[0].text, 'ราคาเท่าไหร่');
      assert.strictEqual(records[1].text, 'ชิ้นละ 120 บาทค่ะ');
    });
  });

  it('names the directory from the hash, never from the LINE id', () => {
    withRoot((root) => {
      const at = new Date('2026-09-06T06:00:00.000Z');
      const file = inbound(root, 'dm-2', at, 'hi').files[0];
      const dir = path.basename(path.dirname(file));

      assert.match(dir, /^[a-f0-9]{16}$/);
      assert.strictEqual(path.basename(path.dirname(path.dirname(file))), DIRECT_MESSAGE_DIR);
      assert.ok(!file.includes(USER_ID));
      assert.strictEqual(file, directArchivePath(path.resolve(root), dir, at));

      const records = readRecords(file);
      assert.strictEqual(records[0].conversationHash, dir);
      assert.ok(records[0].senderHash.endsWith !== undefined);
      assert.ok(records[0].senderHash.includes(dir), 'the directory is the leading hex of the sender hash');
      assert.ok(!JSON.stringify(records[0]).includes(USER_ID));
    });
  });

  it('keeps a group message out of the direct tree, and vice versa', () => {
    withRoot((root) => {
      const at = new Date('2026-09-06T06:00:00.000Z');
      const group = archiveLineWebhookPayload(
        {
          events: [{
            webhookEventId: 'g-1', timestamp: at.getTime(), type: 'message',
            source: { type: 'group', groupId: GROUP_ID, userId: USER_ID },
            message: { id: 'mg', type: 'text', text: 'in a group' },
          }],
        },
        { ...options(root), receivedAt: at }
      );
      assert.strictEqual(group.files[0], weeklyArchivePath(path.resolve(root), 'test', at));
      assert.strictEqual(readRecords(group.files[0])[0].scope, 'group');
      assert.ok(!fs.existsSync(path.join(root, DIRECT_MESSAGE_DIR)));
    });
  });

  it('still refuses a group the owner configured but did not allow-list', () => {
    withRoot((root) => {
      // Without this, such an id would fall through to the direct-message branch and be filed under
      // a hash — quietly archiving the one destination the allow-list exists to exclude.
      const result = archiveOutboundLineMessage(
        { recipientId: 'Ceeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', text: 'nope', deliveryKind: 'push' },
        options(root)
      );
      assert.strictEqual(result.archived, false);
      assert.ok(!fs.existsSync(path.join(root, DIRECT_MESSAGE_DIR)));
    });
  });

  it('expires direct conversations on the same clock as group history', () => {
    withRoot((root) => {
      const old = new Date('2026-01-01T00:00:00.000Z');
      const file = inbound(root, 'dm-old', old, 'long ago').files[0];
      fs.utimesSync(file, old, old);
      const groupFile = archiveLineWebhookPayload(
        {
          events: [{
            webhookEventId: 'g-old', timestamp: old.getTime(), type: 'message',
            source: { type: 'group', groupId: GROUP_ID, userId: USER_ID },
            message: { id: 'mgo', type: 'text', text: 'also long ago' },
          }],
        },
        { ...options(root), receivedAt: old }
      ).files[0];
      fs.utimesSync(groupFile, old, old);

      const deleted = pruneExpiredArchives(root, new Date('2026-09-06T00:00:00.000Z'), 30);

      assert.ok(deleted.includes(file), 'a direct conversation must expire too');
      assert.ok(deleted.includes(groupFile));
      assert.ok(!fs.existsSync(file));
      // An empty hash directory is still a record that someone once wrote in.
      assert.ok(!fs.existsSync(path.dirname(file)));
    });
  });

  it('expires a private conversation sooner than the group history beside it', () => {
    withRoot((root) => {
      // Ten days old: past a 7-day direct retention, well inside a 30-day group one.
      const tenDaysAgo = new Date('2026-08-27T00:00:00.000Z');
      const now = new Date('2026-09-06T00:00:00.000Z');

      const dmFile = inbound(root, 'dm-aged', tenDaysAgo, 'private and older than a week').files[0];
      fs.utimesSync(dmFile, tenDaysAgo, tenDaysAgo);
      const groupFile = archiveLineWebhookPayload(
        {
          events: [{
            webhookEventId: 'g-aged', timestamp: tenDaysAgo.getTime(), type: 'message',
            source: { type: 'group', groupId: GROUP_ID, userId: USER_ID },
            message: { id: 'mga', type: 'text', text: 'in a group, same age' },
          }],
        },
        { ...options(root), receivedAt: tenDaysAgo }
      ).files[0];
      fs.utimesSync(groupFile, tenDaysAgo, tenDaysAgo);

      const deleted = pruneExpiredArchives(root, now, 30, 7);

      assert.ok(deleted.includes(dmFile), 'the direct conversation is past its own retention');
      assert.ok(!deleted.includes(groupFile), 'the group history is not');
      assert.ok(!fs.existsSync(dmFile));
      assert.ok(fs.existsSync(groupFile));
    });
  });

  it('falls back to one clock when no direct retention is given', () => {
    withRoot((root) => {
      const tenDaysAgo = new Date('2026-08-27T00:00:00.000Z');
      const dmFile = inbound(root, 'dm-same-clock', tenDaysAgo, 'x').files[0];
      fs.utimesSync(dmFile, tenDaysAgo, tenDaysAgo);

      // A caller with no opinion must get the previous behaviour, not an accidental change.
      const deleted = pruneExpiredArchives(root, new Date('2026-09-06T00:00:00.000Z'), 30);
      assert.deepStrictEqual(deleted, []);
      assert.ok(fs.existsSync(dmFile));
    });
  });

  it('derives the same directory from either half of a conversation', () => {
    const hash = 'hmac-sha256:' + 'ab12cd34'.repeat(8);
    assert.strictEqual(conversationDirectory(hash), 'ab12cd34ab12cd34');
    assert.throws(() => conversationDirectory('hmac-sha256:short'));
  });
});
