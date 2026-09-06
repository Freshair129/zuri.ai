import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MockZuriApiClient } from '../../src/zuri-api/client.js';

describe('MockZuriApiClient local persistence (survives separate CLI process invocations)', () => {
  const tmpFile = path.join(os.tmpdir(), `zuri-agent-mock-state-test-${process.pid}.json`);

  after(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  it('has no on-disk footprint when constructed without a persistPath (default/test behavior)', async () => {
    const client = new MockZuriApiClient();
    await client.admitCommand({
      contractVersion: '0.1.0b',
      source: 'codex',
      command: 'executive_summary',
      arguments: {},
      delivery: 'preview',
      idempotencyKey: 'no-persist-key',
    });
    assert.strictEqual(fs.existsSync(tmpFile), false);
  });

  it('persists an admitted job to disk and hydrates it in a fresh instance pointed at the same file', async () => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    const writer = new MockZuriApiClient(tmpFile);
    const job = await writer.admitCommand({
      contractVersion: '0.1.0b',
      source: 'codex',
      command: 'channel_performance',
      arguments: { period: 'today' },
      delivery: 'preview',
      idempotencyKey: 'persist-key-001',
    });

    assert.strictEqual(fs.existsSync(tmpFile), true, 'state file should be written after a mutating call');

    // Simulate a brand-new CLI process by constructing a fresh client against the same file.
    const reader = new MockZuriApiClient(tmpFile);
    const rehydrated = await reader.getCommandStatus(job.commandId);

    assert.ok(rehydrated, 'job should be recoverable from a new client instance sharing the persist path');
    assert.strictEqual(rehydrated?.commandId, job.commandId);
    assert.strictEqual(rehydrated?.lifecycle, 'ADMITTED');
  });

  it('preserves idempotency across process boundaries via the same persisted file', async () => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    const first = new MockZuriApiClient(tmpFile);
    const job1 = await first.admitCommand({
      contractVersion: '0.1.0b',
      source: 'codex',
      command: 'executive_summary',
      arguments: {},
      delivery: 'preview',
      idempotencyKey: 'shared-idem-key',
    });

    const second = new MockZuriApiClient(tmpFile);
    const job2 = await second.admitCommand({
      contractVersion: '0.1.0b',
      source: 'codex',
      command: 'executive_summary',
      arguments: {},
      delivery: 'preview',
      idempotencyKey: 'shared-idem-key',
    });

    assert.strictEqual(job1.commandId, job2.commandId);
  });
});
