import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PluginAuthError,
  PluginAuthManager,
  validatePluginCapabilitySnapshot,
} from '../../src/plugin/auth.js';

// @tested ZPP-FR-001 — a grant bound to another installation is refused, so installation and session stay separate identities.
// @tested ZPP-FR-002 — a bounded PKCE transaction with an S256 challenge, and a fail-closed default transport.
// @tested ZPP-SEC-002 — a capability snapshot carrying authority or token fields is rejected.
// @tested BR-006 — expired capability state fails closed; the runtime cannot promote its own snapshot.

const NOW = new Date('2026-08-23T03:20:00.000Z');

function future(seconds: number): string {
  return new Date(NOW.getTime() + seconds * 1000).toISOString();
}

function createGrant(installationId = 'install_test', expiresAt = future(300)) {
  return {
    accessToken: 'opaque-test-token',
    tokenType: 'Bearer' as const,
    sessionId: 'session_test_001',
    principalId: 'person_test_001',
    installationId,
    deviceBindingId: 'device_binding_test_001',
    expiresAt,
  };
}

function createCapabilities(expiresAt = future(120)) {
  return {
    policySnapshotId: 'policy_snapshot_test_001',
    expiresAt,
    capabilities: [
      {
        capability: 'plan.preview',
        operation: 'read' as const,
        dataClasses: ['business-confidential' as const],
        requiresApproval: false,
      },
      {
        capability: 'pipeline.start',
        connectorId: 'connector_test',
        connectorVersion: '1.0.0',
        operation: 'write' as const,
        dataClasses: ['business-confidential' as const],
        requiresApproval: true,
      },
    ],
  };
}

describe('Plugin P2 authentication boundary', () => {
  it('creates a bounded PKCE transaction with an S256 challenge', () => {
    const manager = new PluginAuthManager({ maxPendingAuthorizations: 1 });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });

    assert.match(authorization.requestId, /^authreq_/);
    assert.match(authorization.state, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(authorization.codeVerifier, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(
      authorization.codeChallenge,
      createHash('sha256').update(authorization.codeVerifier).digest('base64url')
    );
    assert.equal(authorization.expiresAt, '2026-08-23T03:30:00.000Z');
  });

  it('rejects a state mismatch before invoking the auth transport', async () => {
    let exchangeCalls = 0;
    const manager = new PluginAuthManager({
      transport: {
        exchangeAuthorizationCode: async () => {
          exchangeCalls += 1;
          return createGrant();
        },
        getCapabilities: async () => createCapabilities(),
        revoke: async () => undefined,
      },
    });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'com.example.zuri:/callback',
      now: NOW,
    });

    await assert.rejects(
      manager.exchangeAuthorizationCode({
        requestId: authorization.requestId,
        state: 'wrong-state',
        code: 'authorization-code',
        now: NOW,
      }),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'AUTHORIZATION_INVALID'
    );
    assert.equal(exchangeCalls, 0);
  });

  it('exchanges a server grant and discovers capabilities without exposing the token in a snapshot', async () => {
    let exchangeInput: Record<string, string> | undefined;
    let capabilityInput: Record<string, string> | undefined;
    const manager = new PluginAuthManager({
      transport: {
        exchangeAuthorizationCode: async (input) => {
          exchangeInput = input;
          return createGrant();
        },
        getCapabilities: async (input) => {
          capabilityInput = input;
          return createCapabilities();
        },
        revoke: async () => undefined,
      },
    });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });

    const session = await manager.exchangeAuthorizationCode({
      requestId: authorization.requestId,
      state: authorization.state,
      code: 'authorization-code',
      now: NOW,
    });
    const capabilities = await manager.getCapabilities(NOW);

    assert.equal(exchangeInput?.code, 'authorization-code');
    assert.equal(exchangeInput?.codeVerifier, authorization.codeVerifier);
    assert.equal(exchangeInput?.installationId, 'install_test');
    assert.equal(session.status, 'AUTHENTICATED');
    assert.equal(session.sessionId, 'session_test_001');
    assert.equal('accessToken' in session, false);
    assert.equal(JSON.stringify(session).includes('opaque-test-token'), false);
    assert.equal(capabilityInput?.accessToken, 'opaque-test-token');
    assert.equal(capabilityInput?.sessionId, 'session_test_001');
    assert.equal(capabilities.policySnapshotId, 'policy_snapshot_test_001');
    assert.equal(capabilities.capabilities.length, 2);
  });

  it('rejects a grant bound to another installation and leaves no session', async () => {
    const manager = new PluginAuthManager({
      transport: {
        exchangeAuthorizationCode: async () => createGrant('another_installation'),
        getCapabilities: async () => createCapabilities(),
        revoke: async () => undefined,
      },
    });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });

    await assert.rejects(
      manager.exchangeAuthorizationCode({
        requestId: authorization.requestId,
        state: authorization.state,
        code: 'authorization-code',
        now: NOW,
      }),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'AUTH_GRANT_INVALID'
    );
    assert.deepEqual(manager.getSessionSnapshot(NOW), {
      status: 'UNAUTHENTICATED',
      reason: 'NO_SESSION',
    });
  });

  it('fails closed for expired capability and session state', async () => {
    const manager = new PluginAuthManager({
      transport: {
        exchangeAuthorizationCode: async () => createGrant(),
        getCapabilities: async () => createCapabilities('2026-08-23T03:19:59.000Z'),
        revoke: async () => undefined,
      },
    });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });
    await manager.exchangeAuthorizationCode({
      requestId: authorization.requestId,
      state: authorization.state,
      code: 'authorization-code',
      now: NOW,
    });

    await assert.rejects(
      manager.getCapabilities(NOW),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'CAPABILITY_INVALID'
    );
    assert.deepEqual(manager.getSessionSnapshot(new Date('2026-08-23T03:26:00.000Z')), {
      status: 'UNAUTHENTICATED',
      reason: 'EXPIRED',
    });
    await assert.rejects(
      manager.getCapabilities(new Date('2026-08-23T03:26:00.000Z')),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'AUTH_SESSION_EXPIRED'
    );
  });

  it('revokes locally even when remote revoke is unavailable', async () => {
    const manager = new PluginAuthManager({
      transport: {
        exchangeAuthorizationCode: async () => createGrant(),
        getCapabilities: async () => createCapabilities(),
        revoke: async () => {
          throw new Error('remote opaque-test-token failure');
        },
      },
    });
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });
    await manager.exchangeAuthorizationCode({
      requestId: authorization.requestId,
      state: authorization.state,
      code: 'authorization-code',
      now: NOW,
    });

    await assert.rejects(
      manager.revoke(),
      (error: unknown) => {
        assert.ok(error instanceof PluginAuthError);
        assert.equal(error.code, 'AUTH_REVOCATION_UNAVAILABLE');
        assert.equal(error.message.includes('opaque-test-token'), false);
        return true;
      }
    );
    assert.deepEqual(manager.getSessionSnapshot(NOW), {
      status: 'UNAUTHENTICATED',
      reason: 'REVOKED',
    });
    await assert.rejects(
      manager.getCapabilities(NOW),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'AUTH_SESSION_UNAVAILABLE'
    );
  });

  it('uses a fail-closed default transport until a canonical live adapter exists', async () => {
    const manager = new PluginAuthManager();
    const authorization = manager.beginAuthorization({
      installationId: 'install_test',
      redirectUri: 'http://127.0.0.1:43123/callback',
      now: NOW,
    });

    await assert.rejects(
      manager.exchangeAuthorizationCode({
        requestId: authorization.requestId,
        state: authorization.state,
        code: 'authorization-code',
        now: NOW,
      }),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'AUTH_TRANSPORT_UNAVAILABLE'
    );
  });

  it('rejects capability snapshots that contain authority or token fields', () => {
    assert.throws(
      () =>
        validatePluginCapabilitySnapshot({
          ...createCapabilities(),
          tenantId: 'must-not-be-accepted',
        }),
      (error: unknown) => error instanceof PluginAuthError && error.code === 'CAPABILITY_INVALID'
    );
  });
});
