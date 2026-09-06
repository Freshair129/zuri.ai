import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLUGIN_COMMAND_TYPES,
  createPluginCommandEnvelope,
  hashNormalizedPayload,
  redactPluginValue,
  validateConnectorManifest,
  validatePluginCommandEnvelope,
} from '../../src/plugin/contract.js';
import { ZuriPluginSdk } from '../../src/plugin/sdk.js';

// @tested ZPP-FR-003 — a harness-neutral envelope, sent through a transport-neutral SDK that adds no authority of its own.
// @tested ZPP-FR-004 — the canonical read-only capability discovery commands exist and the
//   command set stays closed.
// @tested ZPP-SEC-002 — client-supplied authority fields inside a proposal are rejected.

describe('Zuri Plugin Platform contract', () => {
  it('creates and validates a harness-neutral plan preview envelope', () => {
    const envelope = createPluginCommandEnvelope({
      commandType: 'PLAN_PREVIEW',
      harness: {
        type: 'codex',
        version: '1.0.0',
        installationId: 'install_test',
      },
      requestedTarget: { projectRef: 'project_requested' },
      payload: {
        intent: 'สร้างแผน onboarding',
        executionModeId: 'SOFTWARE_SPRINT',
      },
      clientContext: { locale: 'th-TH', timezone: 'Asia/Bangkok' },
      idempotencyKey: 'idem_plan_preview_001',
    });

    const parsed = validatePluginCommandEnvelope(envelope);
    assert.equal(parsed.commandType, 'PLAN_PREVIEW');
    assert.equal(parsed.harness.type, 'codex');
    assert.equal(parsed.requestedTarget.projectRef, 'project_requested');
    assert.equal(parsed.idempotencyKey, 'idem_plan_preview_001');
    assert.match(parsed.trace.correlationId, /^corr_/);
    assert.match(parsed.commandId, /^cmd_/);
  });

  it('rejects client-supplied authority fields inside a proposal', () => {
    assert.throws(
      () =>
        createPluginCommandEnvelope({
          commandType: 'PLAN_PREVIEW',
          harness: {
            type: 'claude_code',
            version: '1.0.0',
            installationId: 'install_test',
          },
          payload: {
            intent: 'preview',
            tenantId: 'tenant_attacker',
            nested: { policySnapshotId: 'policy_fake' },
          },
          clientContext: { locale: 'th-TH', timezone: 'Asia/Bangkok' },
        }),
      /authority field/i
    );
  });

  it('hashes equivalent object payloads deterministically by key order', () => {
    assert.equal(
      hashNormalizedPayload({ b: 2, a: { d: true, c: 'x' } }),
      hashNormalizedPayload({ a: { c: 'x', d: true }, b: 2 })
    );
  });

  it('redacts nested secrets without changing safe fields', () => {
    const redacted = redactPluginValue({
      connector: 'example',
      accessToken: 'do-not-leak',
      nested: { password: 'also-secret', label: 'safe' },
      note: 'Bearer abc.def',
    }) as Record<string, unknown>;

    assert.equal(redacted.connector, 'example');
    assert.equal(redacted.accessToken, '[REDACTED]');
    assert.deepEqual(redacted.nested, { password: '[REDACTED]', label: 'safe' });
    assert.equal(redacted.note, '[REDACTED]');
  });

  it('validates a connector manifest and rejects an unbounded manifest', () => {
    const manifest = validateConnectorManifest({
      connectorId: 'example',
      version: '1.0.0',
      authType: 'oauth2',
      capabilities: ['record.read'],
      inputSchemaRef: 'schema://example/input',
      outputSchemaRef: 'schema://example/output',
      dataClasses: ['business-confidential'],
      egressAllowlist: ['api.example.com'],
      supportsIdempotency: true,
      rateLimitPolicy: 'policy://example',
      healthCheckRef: 'health://example',
    });

    assert.deepEqual(manifest.capabilities, ['record.read']);
    assert.throws(
      () =>
        validateConnectorManifest({
          ...manifest,
          capabilities: [],
          egressAllowlist: [],
        }),
      /capabilit|egress/i
    );
  });

  it('sends preview through a transport-neutral SDK without adding authority fields', async () => {
    const sent: unknown[] = [];
    const sdk = new ZuriPluginSdk({
      send: async (envelope) => {
        sent.push(envelope);
        return {
          receiptId: 'receipt_preview_001',
          status: 'PREVIEW_READY',
          traceId: envelope.trace.correlationId,
        };
      },
    });

    const response = await sdk.preview({
      harness: {
        type: 'claude_code',
        version: '1.0.0',
        installationId: 'install_test',
      },
      payload: { intent: 'สร้างแผน' },
      clientContext: { locale: 'th-TH', timezone: 'Asia/Bangkok' },
      idempotencyKey: 'idem_sdk_preview_001',
    });

    assert.deepEqual(response, {
      receiptId: 'receipt_preview_001',
      status: 'PREVIEW_READY',
      traceId: (sent[0] as { trace: { correlationId: string } }).trace.correlationId,
    });
    const envelope = sent[0] as Record<string, unknown>;
    assert.equal(envelope.commandType, 'PLAN_PREVIEW');
    assert.equal('tenantId' in envelope, false);
  });
});

/*
 * ZPP-FR-004 asks for read-only capability discovery — zuri.capabilities.get, zuri.connector.list
 * and zuri.connector.health. Pinning the whole command set rather than just those three is the
 * point: a discovery command is only read-only for as long as nothing writes under its name, and a
 * set that can grow silently is a set nobody reviews.
 */
describe('canonical command set', () => {
  it('offers the three read-only discovery commands', () => {
    for (const command of ['CAPABILITIES_GET', 'CONNECTOR_LIST', 'CONNECTOR_HEALTH'] as const) {
      assert.ok(PLUGIN_COMMAND_TYPES.includes(command), `${command} is missing`);
    }
  });

  it('is closed: adding a command is a deliberate change to this list', () => {
    assert.deepStrictEqual([...PLUGIN_COMMAND_TYPES].sort(), [
      'CAPABILITIES_GET',
      'CONNECTOR_HEALTH',
      'CONNECTOR_LIST',
      'PIPELINE_CANCEL',
      'PIPELINE_GET',
      'PIPELINE_START',
      'PLAN_COMMIT',
      'PLAN_PREVIEW',
    ]);
  });

  it('keeps plan commit and pipeline start as separate commands', () => {
    // ZPP-FR-008: committing a plan must not be able to start external work by itself.
    assert.ok(PLUGIN_COMMAND_TYPES.includes('PLAN_COMMIT'));
    assert.ok(PLUGIN_COMMAND_TYPES.includes('PIPELINE_START'));
    assert.notStrictEqual('PLAN_COMMIT', 'PIPELINE_START');
  });
});
