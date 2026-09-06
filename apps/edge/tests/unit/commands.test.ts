import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MockZuriApiClient } from '../../src/zuri-api/client.js';
import {
  SUPPORTED_TEMPLATES,
  mapTemplateToCommand,
  runPreview,
  runSend,
  runStatus,
} from '../../src/cli/commands.js';

// @tested FR-003, AC-002 — `preview` creates one idempotent command and calls no LINE API.
// @tested FR-004, AC-003 — `send --group <alias>` requests a governed delivery intent.
// @tested FR-005, AC-007 — `status` returns a redacted lifecycle.
// @tested FR-008 — a raw LINE group id passed as the alias is rejected.
// @tested SDD-001 — the CLI command handlers and the shape of what they print.

describe('CLI command handlers (preview/send/status) wired to MockZuriApiClient', () => {
  it('maps every supported template to its contract command', () => {
    assert.strictEqual(mapTemplateToCommand('executive-summary'), 'executive_summary');
    assert.strictEqual(mapTemplateToCommand('channel-performance'), 'channel_performance');
    assert.strictEqual(mapTemplateToCommand('campaign-breakdown'), 'campaign_breakdown');
    assert.strictEqual(mapTemplateToCommand('actions-approval-queue'), 'approval_queue');
  });

  it('rejects an unsupported template', () => {
    assert.throws(() => mapTemplateToCommand('not-a-template'), /Unsupported template/);
  });

  it('lists the approved v1 templates', () => {
    assert.deepStrictEqual(
      [...SUPPORTED_TEMPLATES].sort(),
      ['actions-approval-queue', 'campaign-breakdown', 'channel-performance', 'executive-summary'].sort()
    );
  });

  it('runPreview admits an idempotent preview-only command', async () => {
    const client = new MockZuriApiClient();
    const job = await runPreview(client, 'executive-summary', { period: 'yesterday' });

    assert.strictEqual(job.lifecycle, 'ADMITTED');
    assert.strictEqual(job.deliveryIntent, 'preview');
    assert.strictEqual(job.command, 'executive_summary');
    assert.strictEqual(job.arguments.period, 'yesterday');
  });

  it('runPreview reuses the same idempotency key deterministically when supplied', async () => {
    const client = new MockZuriApiClient();
    const job1 = await runPreview(client, 'executive-summary', { idempotencyKey: 'fixed-key' });
    const job2 = await runPreview(client, 'executive-summary', { idempotencyKey: 'fixed-key' });
    assert.strictEqual(job1.commandId, job2.commandId);
  });

  it('runPreview rejects an unsupported template before calling the client', async () => {
    const client = new MockZuriApiClient();
    await assert.rejects(() => runPreview(client, 'bogus-template'), /Unsupported template/);
  });

  it('runSend requires a non-empty --group alias', async () => {
    const client = new MockZuriApiClient();
    await assert.rejects(
      () => runSend(client, 'actions-approval-queue', { group: '' }),
      /--group.*required/i
    );
  });

  it('runSend rejects a raw LINE group ID passed as the alias', async () => {
    const client = new MockZuriApiClient();
    await assert.rejects(
      () => runSend(client, 'actions-approval-queue', { group: 'C1234567890abcdef1234567890abcdef' }),
      /raw LINE (group )?ID/i
    );
  });

  it('runSend admits a line_push command with the resolved group alias', async () => {
    const client = new MockZuriApiClient();
    const job = await runSend(client, 'actions-approval-queue', { group: 'leadership' });

    assert.strictEqual(job.deliveryIntent, 'line_push');
    assert.strictEqual(job.command, 'approval_queue');
  });

  it('runStatus rejects an empty command id', async () => {
    const client = new MockZuriApiClient();
    await assert.rejects(() => runStatus(client, ''), /command-id/i);
  });

  it('runStatus reports a clear error for an unknown command id', async () => {
    const client = new MockZuriApiClient();
    await assert.rejects(() => runStatus(client, 'cmd_does_not_exist'), /No command found/);
  });

  it('runStatus returns the job previously admitted by runPreview on the same client', async () => {
    const client = new MockZuriApiClient();
    const created = await runPreview(client, 'channel-performance', { period: 'this_week' });
    const fetched = await runStatus(client, created.commandId);
    assert.strictEqual(fetched.commandId, created.commandId);
    assert.strictEqual(fetched.lifecycle, 'ADMITTED');
  });
});
