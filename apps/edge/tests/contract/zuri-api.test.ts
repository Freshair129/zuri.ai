import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HttpZuriApiClient, MockZuriApiClient } from '../../src/zuri-api/client.js';
import { CommandEnvelope, EvidencePacket } from '../../src/zuri-api/types.js';

// @tested SDD-002 — the typed request and response models of the canonical contract.

describe('Zuri API Contract Client (Mock)', () => {
  it('admits a valid command envelope and respects idempotency', async () => {
    const client = new MockZuriApiClient();
    const envelope: CommandEnvelope = {
      contractVersion: '0.1.0b',
      source: 'antigravity',
      command: 'executive_summary',
      arguments: { period: 'yesterday' },
      delivery: 'preview',
      idempotencyKey: 'idemp_key_001',
    };

    const job1 = await client.admitCommand(envelope);
    assert.strictEqual(job1.contractVersion, '0.1.0b');
    assert.strictEqual(job1.lifecycle, 'ADMITTED');
    assert.strictEqual(job1.source, 'antigravity');

    const job2 = await client.admitCommand(envelope);
    assert.strictEqual(job2.commandId, job1.commandId, 'Idempotency key should return same commandId');
  });

  it('claims a queued job under a valid lease', async () => {
    const client = new MockZuriApiClient();
    await client.admitCommand({
      contractVersion: '0.1.0b',
      source: 'codex',
      command: 'channel_performance',
      arguments: { period: 'this_week' },
      delivery: 'preview',
      idempotencyKey: 'idemp_key_002',
    });

    const claimed = await client.claimJob('device_workstation_01');
    assert.ok(claimed);
    assert.strictEqual(claimed.job.lifecycle, 'CLAIMED');
    assert.strictEqual(claimed.lease.deviceId, 'device_workstation_01');
    assert.strictEqual(claimed.lease.queryId, 'channel_performance.v1');
  });

  it('submits evidence and transitions job state', async () => {
    const client = new MockZuriApiClient();
    const job = await client.admitCommand({
      contractVersion: '0.1.0b',
      source: 'claude_code',
      command: 'approval_queue',
      arguments: {},
      delivery: 'preview',
      idempotencyKey: 'idemp_key_003',
    });

    const claimed = await client.claimJob('device_workstation_01');
    assert.ok(claimed);

    const evidencePacket: EvidencePacket = {
      contractVersion: '0.1.0b',
      commandId: job.commandId,
      tenantId: job.tenantId,
      policySnapshotId: job.policySnapshotId,
      queryId: claimed.lease.queryId,
      queryVersion: claimed.lease.queryVersion,
      source: 'SmartGift DuckDB Analytics',
      asOf: new Date().toISOString(),
      sensitivity: 'INTERNAL',
      data: { pendingCount: 5 },
      cardViewModel: {
        templateId: 'actions-approval-queue.v1',
        templateVersion: '1.0.0',
        title: 'รายการรออนุมัติ',
        operationalState: 'live',
        sourceLabel: 'SmartGift DuckDB',
        asOf: new Date().toISOString(),
        ctaButtons: [
          {
            label: 'เปิดรายการอนุมัติ',
            uri: 'https://zuri.app/approvals',
            type: 'uri',
          },
        ],
      },
    };

    const res = await client.submitEvidence(claimed.lease.leaseId, evidencePacket);
    assert.strictEqual(res.success, true);

    const status = await client.getCommandStatus(job.commandId);
    assert.strictEqual(status?.lifecycle, 'REVIEW_REQUIRED');
  });
});

describe('Zuri API Contract Client (HTTP)', () => {
  it('posts an admitted command using a device credential and idempotency header', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example',
      deviceId: 'bridge-01',
      deviceToken: 'test-device-token',
      fetchFn: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ commandId: 'cmd_1', tenantId: 'tenant_1', policySnapshotId: 'pol_1', contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, deliveryIntent: 'preview', lifecycle: 'ADMITTED', idempotencyKey: 'idem_1', traceId: 'trace_1', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' }));
      },
    });
    const job = await client.admitCommand({ contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, delivery: 'preview', idempotencyKey: 'idem_1' });
    assert.strictEqual(job.commandId, 'cmd_1');
    assert.strictEqual(request?.url, 'https://zuri.example/api/agent-commands');
    const headers = request?.init?.headers as Record<string, string>;
    assert.strictEqual(headers.Authorization, 'Bearer test-device-token');
    assert.strictEqual(headers['Idempotency-Key'], 'idem_1');
  });

  // The route this posts to was `/api/agent-bridges/heartbeat` and had been 404ing against
  // zuri-ai — invisibly, because the launcher fires it and discards the result. Pinning the path
  // is the only thing that catches a rename here, since nothing downstream reads the response.
  it('posts liveness to the route zuri-ai actually serves', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example',
      deviceId: 'bridge-01',
      deviceToken: 'edgk_test',
      fetchFn: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ acknowledged: true }));
      },
    });
    // No cloudBaseUrl configured here, so this also pins the fallback to baseUrl.
    const res = await client.sendHeartbeat({
      contractVersion: '0.1.0b',
      deviceId: 'bridge-01',
      status: 'healthy',
      registeredQueries: [],
      approvedTemplates: [],
      timestamp: '2026-09-04T00:00:00.000Z',
    });
    assert.strictEqual(res.acknowledged, true);
    assert.strictEqual(request?.url, 'https://zuri.example/api/agent/heartbeat');
    assert.strictEqual(request?.init?.method, 'POST');
  });

  // zuri-ai accepts exactly one machine credential: the `edgk_` key minted per device. Its viewer
  // resolver reads a session cookie and nothing else, so ZURI_AGENT_DEVICE_TOKEN holding anything
  // else cannot authenticate by any path — it is 401 AUTH_REQUIRED whatever its value. Minting a
  // key is therefore only useful if the heartbeat actually presents it.
  it('presents the minted edge device key rather than the agent token', async () => {
    let headers: Record<string, string> | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example',
      deviceId: 'bridge-01',
      deviceToken: 'CHANGEME',
      deviceKey: 'edgk_minted',
      fetchFn: async (_url, init) => {
        headers = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ acknowledged: true }));
      },
    });
    await client.sendHeartbeat({ contractVersion: '0.1.0b', deviceId: 'bridge-01', status: 'healthy', registeredQueries: [], approvedTemplates: [], timestamp: '2026-09-04T00:00:00.000Z' });
    assert.strictEqual(headers?.Authorization, 'Bearer edgk_minted');
  });

  // The heartbeat is the device talking to the cloud as itself, so it uses the device pair —
  // ZURI_CLOUD_BASE_URL with ZURI_EDGE_DEVICE_KEY — instead of borrowing the command endpoints'
  // origin. The two happen to be the same host today, which is exactly why this needs pinning.
  it('sends liveness to the cloud origin, not the command origin', async () => {
    let url: string | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://commands.example',
      cloudBaseUrl: 'https://cloud.example',
      deviceId: 'bridge-01',
      deviceToken: 'agent_token',
      deviceKey: 'edgk_minted',
      fetchFn: async (u) => {
        url = u;
        return new Response(JSON.stringify({ acknowledged: true }));
      },
    });
    await client.sendHeartbeat({ contractVersion: '0.1.0b', deviceId: 'bridge-01', status: 'healthy', registeredQueries: [], approvedTemplates: [], timestamp: '2026-09-04T00:00:00.000Z' });
    assert.strictEqual(url, 'https://cloud.example/api/agent/heartbeat');
  });

  // The command endpoints keep their own origin; the device pair must not leak into them.
  it('leaves the command endpoints on the command origin', async () => {
    let url: string | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://commands.example',
      cloudBaseUrl: 'https://cloud.example',
      deviceId: 'bridge-01', deviceToken: 'agent_token', deviceKey: 'edgk_minted',
      fetchFn: async (u) => {
        url = u;
        return new Response(JSON.stringify({ commandId: 'cmd_1', tenantId: 't', policySnapshotId: 'p', contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, deliveryIntent: 'preview', lifecycle: 'ADMITTED', idempotencyKey: 'i', traceId: 'tr', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' }));
      },
    });
    await client.admitCommand({ contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, delivery: 'preview', idempotencyKey: 'i' });
    assert.strictEqual(url, 'https://commands.example/api/agent-commands');
  });

  // A deployment that already put the minted key in ZURI_AGENT_DEVICE_TOKEN must keep working.
  it('falls back to the agent token when no edge device key is configured', async () => {
    let headers: Record<string, string> | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example',
      deviceId: 'bridge-01',
      deviceToken: 'edgk_in_the_old_slot',
      fetchFn: async (_url, init) => {
        headers = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ acknowledged: true }));
      },
    });
    await client.sendHeartbeat({ contractVersion: '0.1.0b', deviceId: 'bridge-01', status: 'healthy', registeredQueries: [], approvedTemplates: [], timestamp: '2026-09-04T00:00:00.000Z' });
    assert.strictEqual(headers?.Authorization, 'Bearer edgk_in_the_old_slot');
  });

  // The command endpoints are a different, unbuilt contract; the key must not silently change hands.
  it('leaves the command endpoints on the agent token', async () => {
    let headers: Record<string, string> | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example', deviceId: 'bridge-01', deviceToken: 'agent_token', deviceKey: 'edgk_minted',
      fetchFn: async (_url, init) => {
        headers = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ commandId: 'cmd_1', tenantId: 't', policySnapshotId: 'p', contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, deliveryIntent: 'preview', lifecycle: 'ADMITTED', idempotencyKey: 'i', traceId: 'tr', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' }));
      },
    });
    await client.admitCommand({ contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, delivery: 'preview', idempotencyKey: 'i' });
    assert.strictEqual(headers?.Authorization, 'Bearer agent_token');
  });

  // The route takes the Business from the device credential and 403s a body that names a
  // different one, so sending one can only ever turn a working heartbeat into a refused one.
  it('leaves businessId out of the heartbeat body for the credential to supply', async () => {
    let sent: string | undefined;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example',
      deviceId: 'bridge-01',
      deviceToken: 'edgk_test',
      fetchFn: async (_url, init) => {
        sent = init?.body as string;
        return new Response(JSON.stringify({ acknowledged: true }));
      },
    });
    await client.sendHeartbeat({
      contractVersion: '0.1.0b',
      deviceId: 'bridge-01',
      status: 'healthy',
      registeredQueries: [],
      approvedTemplates: [],
      timestamp: '2026-09-04T00:00:00.000Z',
    });
    assert.ok(sent, 'a body was sent');
    assert.ok(!Object.hasOwn(JSON.parse(sent!) as object, 'businessId'));
  });

  // A wrong route returns Next.js's 404 *page*: ~4KB of HTML that buried the status code at the
  // CLI. The status is the fact worth reading; the marketing copy is not.
  it('reports a non-JSON error body by shape instead of pasting the page into the error', async () => {
    const html = `<!DOCTYPE html><html><head><title>404: This page could not be found.</title></head><body>${'x'.repeat(4000)}</body></html>`;
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example', deviceId: 'bridge-01', deviceToken: 'edgk_test',
      fetchFn: async () => new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });
    await assert.rejects(
      () => client.admitCommand({ contractVersion: '0.1.0b', source: 'codex', command: 'executive_summary', arguments: {}, delivery: 'preview', idempotencyKey: 'idem_1' }),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /\(404\)/, 'the status stays in the message');
        assert.match(message, /non-JSON text\/html response/);
        assert.ok(!message.includes('<!DOCTYPE'), 'the page body is not pasted in');
        assert.ok(message.length < 300, `message stayed short, got ${message.length}`);
        return true;
      },
    );
  });

  // zuri-ai's own error shape is `{ error: "..." }` and is worth quoting exactly.
  it('quotes a JSON error body verbatim', async () => {
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example', deviceId: 'bridge-01', deviceToken: 'edgk_test',
      fetchFn: async () => new Response(JSON.stringify({ error: 'This credential is paired with a different Business' }), { status: 403 }),
    });
    await assert.rejects(
      () => client.sendHeartbeat({ contractVersion: '0.1.0b', deviceId: 'bridge-01', status: 'healthy', registeredQueries: [], approvedTemplates: [], timestamp: '2026-09-04T00:00:00.000Z' }),
      /This credential is paired with a different Business/,
    );
  });

  it('maps an HTTP 404 status read to no command without leaking the body', async () => {
    const client = new HttpZuriApiClient({
      baseUrl: 'https://zuri.example', deviceId: 'bridge-01', deviceToken: 'test-device-token',
      fetchFn: async () => new Response('not found', { status: 404 }),
    });
    assert.strictEqual(await client.getCommandStatus('missing'), null);
  });
});
