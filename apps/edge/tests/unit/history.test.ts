import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { archiveLineWebhookPayload, weeklyArchivePath } from '../../src/history/archive.js';

// @tested SDD-012 — the signed archive and signature validation.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-history-test-'));
const groupId = 'C0123456789abcdef0123456789abcdef';
const hashKey = 'history-test-key';
const now = new Date('2026-08-11T03:00:00.000Z');

after(() => fs.rmSync(root, { recursive: true, force: true }));

function options() {
  return { root, groupAliases: { leadership: groupId }, allowedGroupAliases: ['leadership'], hashKey, retentionDays: 30, receivedAt: now };
}

describe('weekly conversation archive records', () => {
  it('archives one permitted text message as UTF-8 JSONL and hashes identifiers', () => {
    const result = archiveLineWebhookPayload({ events: [{ webhookEventId: 'evt_1', timestamp: now.getTime(), type: 'message', source: { type: 'group', groupId, userId: 'U0123456789abcdef0123456789abcdef' }, message: { id: 'msg_1', type: 'text', text: 'นัดประชุมวันศุกร์' } }] }, options());
    assert.strictEqual(result.archived, 1);
    const record = JSON.parse(fs.readFileSync(result.files[0], 'utf8').trim());
    assert.strictEqual(record.groupAlias, 'leadership');
    assert.strictEqual(record.text, 'นัดประชุมวันศุกร์');
    assert.ok(record.senderHash.startsWith('hmac-sha256:'));
    assert.ok(!JSON.stringify(record).includes(groupId));
  });

  it('deduplicates a replay and ignores a non-permitted group', () => {
    const replay = { webhookEventId: 'evt_1', timestamp: now.getTime(), type: 'message', source: { groupId, userId: 'U0123456789abcdef0123456789abcdef' }, message: { id: 'msg_1', type: 'text', text: 'นัดประชุมวันศุกร์' } };
    assert.strictEqual(archiveLineWebhookPayload({ events: [replay] }, options()).duplicate, 1);
    const ignored = archiveLineWebhookPayload({ events: [{ ...replay, webhookEventId: 'evt_other', source: { groupId: 'C11111111111111111111111111111111' } }] }, options());
    assert.strictEqual(ignored.ignored, 1);
  });

  it('uses ISO-week filenames and prunes only expired archive files', () => {
    assert.match(weeklyArchivePath(root, 'leadership', now), /2026-W33\.jsonl$/);
    const oldFile = path.join(root, 'leadership', '2026-W01.jsonl');
    fs.mkdirSync(path.dirname(oldFile), { recursive: true });
    fs.writeFileSync(oldFile, '{}\n');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.000Z'));
    const result = archiveLineWebhookPayload({ events: [] }, options());
    assert.ok(result.pruned.includes(oldFile));
    assert.strictEqual(fs.existsSync(oldFile), false);
  });


});
