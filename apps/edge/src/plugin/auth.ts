import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorDataClass } from './contract.js';

// @req ZPP-FR-001 — the identity tuple: session, principal, installation and device binding are separate identities, and none of them is an external provider id.
// @req ZPP-FR-002 — interactive authentication over Authorization Code with PKCE; no static client secret lives here.
// @req ZPP-SEC-002 — scope is server-derived — this holds no tenant or business authority, so a request body cannot assert one.
// @req BR-006 — a capability snapshot must be presented and valid; the local runtime cannot mint or promote its own policySnapshotId.

const DEFAULT_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PENDING_AUTHORIZATIONS = 8;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FORBIDDEN_REDIRECT_PROTOCOLS = new Set(['javascript:', 'data:', 'file:']);

export type PluginAuthErrorCode =
  | 'AUTHORIZATION_INVALID'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_NOT_FOUND'
  | 'AUTH_TRANSPORT_UNAVAILABLE'
  | 'AUTH_EXCHANGE_FAILED'
  | 'AUTH_GRANT_INVALID'
  | 'AUTH_SESSION_UNAVAILABLE'
  | 'AUTH_SESSION_EXPIRED'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CAPABILITY_INVALID'
  | 'AUTH_REVOCATION_UNAVAILABLE';

export class PluginAuthError extends Error {
  constructor(
    public readonly code: PluginAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PluginAuthError';
  }
}

export interface PluginAuthorizationStartInput {
  installationId: string;
  redirectUri: string;
  now?: Date;
}

export interface PluginAuthorizationStart {
  requestId: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  installationId: string;
  expiresAt: string;
}

export interface PluginAuthorizationCodeExchangeInput {
  requestId: string;
  state: string;
  code: string;
  now?: Date;
}

export interface PluginAuthorizationCodeExchange {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  installationId: string;
}

export interface PluginAuthGrant {
  accessToken: string;
  tokenType: 'Bearer';
  sessionId: string;
  principalId: string;
  installationId: string;
  deviceBindingId?: string;
  expiresAt: string;
}

export interface PluginCapabilityRequest {
  accessToken: string;
  sessionId: string;
  installationId: string;
}

export interface PluginRevokeRequest {
  accessToken: string;
  sessionId: string;
  installationId: string;
}

export interface PluginAuthTransport {
  exchangeAuthorizationCode(input: PluginAuthorizationCodeExchange): Promise<unknown>;
  getCapabilities(input: PluginCapabilityRequest): Promise<unknown>;
  revoke(input: PluginRevokeRequest): Promise<void>;
}

export type PluginSessionStatus = 'AUTHENTICATED' | 'UNAUTHENTICATED';
export type PluginSessionClosedReason = 'NO_SESSION' | 'EXPIRED' | 'REVOKED';

export interface PluginSessionSnapshot {
  status: PluginSessionStatus;
  reason?: PluginSessionClosedReason;
  sessionId?: string;
  principalId?: string;
  installationId?: string;
  deviceBindingId?: string;
  expiresAt?: string;
}

export interface PluginCapabilityDescriptor {
  capability: string;
  connectorId?: string;
  connectorVersion?: string;
  operation: 'read' | 'write';
  dataClasses: ConnectorDataClass[];
  requiresApproval: boolean;
}

export interface PluginCapabilitySnapshot {
  policySnapshotId: string;
  expiresAt: string;
  capabilities: PluginCapabilityDescriptor[];
}

interface PendingAuthorization extends PluginAuthorizationStart {
  createdAtMs: number;
  expiresAtMs: number;
}

interface ActiveSession {
  grant: PluginAuthGrant;
}

const identifierSchema = z.string().min(1).max(160).regex(IDENTIFIER_PATTERN);
const authGrantSchema = z
  .object({
    accessToken: z.string().min(1).max(4096),
    tokenType: z.literal('Bearer'),
    sessionId: identifierSchema,
    principalId: identifierSchema,
    installationId: identifierSchema,
    deviceBindingId: identifierSchema.optional(),
    expiresAt: z.string().min(1).max(64),
  })
  .strict();

const capabilityDescriptorSchema = z
  .object({
    capability: identifierSchema,
    connectorId: identifierSchema.optional(),
    connectorVersion: z.string().min(1).max(64).optional(),
    operation: z.enum(['read', 'write']),
    dataClasses: z
      .array(z.enum(['public', 'internal', 'business-confidential', 'pii', 'restricted']))
      .min(1),
    requiresApproval: z.boolean(),
  })
  .strict();

const capabilitySnapshotSchema = z
  .object({
    policySnapshotId: identifierSchema,
    expiresAt: z.string().min(1).max(64),
    capabilities: z.array(capabilityDescriptorSchema),
  })
  .strict();

function assertValidDate(value: Date, code: PluginAuthErrorCode): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PluginAuthError(code, 'A valid timestamp is required');
  }
  return value.getTime();
}

function assertIdentifier(value: string, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value) || value.length > 160) {
    throw new PluginAuthError('AUTHORIZATION_INVALID', `${field} is invalid`);
  }
  return value;
}

function assertRedirectUri(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) {
    throw new PluginAuthError('AUTHORIZATION_INVALID', 'redirectUri is invalid');
  }

  try {
    const parsed = new URL(value);
    if (FORBIDDEN_REDIRECT_PROTOCOLS.has(parsed.protocol)) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'redirectUri is invalid');
    }
  } catch (error) {
    if (error instanceof PluginAuthError) throw error;
    throw new PluginAuthError('AUTHORIZATION_INVALID', 'redirectUri is invalid');
  }

  return value;
}

function assertFutureIsoTimestamp(value: string, nowMs: number): void {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || timestamp <= nowMs) {
    throw new PluginAuthError('CAPABILITY_INVALID', 'The server response has an invalid or expired timestamp');
  }
}

function parseAuthGrant(value: unknown, nowMs: number): PluginAuthGrant {
  try {
    const parsed = authGrantSchema.parse(value);
    const expiresAt = Date.parse(parsed.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= nowMs) {
      throw new PluginAuthError('AUTH_GRANT_INVALID', 'The server auth grant is expired or invalid');
    }
    return parsed;
  } catch (error) {
    if (error instanceof PluginAuthError) throw error;
    throw new PluginAuthError('AUTH_GRANT_INVALID', 'The server auth grant is invalid');
  }
}

export function validatePluginAuthGrant(value: unknown, now: Date = new Date()): PluginAuthGrant {
  const nowMs = assertValidDate(now, 'AUTH_GRANT_INVALID');
  return parseAuthGrant(value, nowMs);
}

export function validatePluginCapabilitySnapshot(
  value: unknown,
  now: Date = new Date()
): PluginCapabilitySnapshot {
  const nowMs = assertValidDate(now, 'CAPABILITY_INVALID');
  try {
    const parsed = capabilitySnapshotSchema.parse(value);
    assertFutureIsoTimestamp(parsed.expiresAt, nowMs);
    return parsed;
  } catch (error) {
    if (error instanceof PluginAuthError) throw error;
    throw new PluginAuthError('CAPABILITY_INVALID', 'The server capability snapshot is invalid');
  }
}

export function createFailClosedPluginAuthTransport(): PluginAuthTransport {
  return {
    async exchangeAuthorizationCode(): Promise<never> {
      throw new PluginAuthError(
        'AUTH_TRANSPORT_UNAVAILABLE',
        'Plugin authentication transport is unavailable'
      );
    },
    async getCapabilities(): Promise<never> {
      throw new PluginAuthError(
        'AUTH_TRANSPORT_UNAVAILABLE',
        'Plugin authentication transport is unavailable'
      );
    },
    async revoke(): Promise<never> {
      throw new PluginAuthError(
        'AUTH_TRANSPORT_UNAVAILABLE',
        'Plugin authentication transport is unavailable'
      );
    },
  };
}

export interface PluginAuthManagerOptions {
  transport?: PluginAuthTransport;
  authorizationTtlMs?: number;
  maxPendingAuthorizations?: number;
}

/**
 * Transport-neutral, memory-only authentication boundary for the plugin.
 *
 * This class deliberately does not open a browser, call fetch, persist a token, or resolve
 * tenant/business authority. A Zuri-approved adapter must be injected for live authentication.
 */
export class PluginAuthManager {
  private readonly transport: PluginAuthTransport;
  private readonly authorizationTtlMs: number;
  private readonly maxPendingAuthorizations: number;
  private readonly pending = new Map<string, PendingAuthorization>();
  private session: ActiveSession | null = null;
  private closedReason: PluginSessionClosedReason = 'NO_SESSION';

  constructor(options: PluginAuthManagerOptions = {}) {
    this.transport = options.transport || createFailClosedPluginAuthTransport();
    this.authorizationTtlMs = options.authorizationTtlMs ?? DEFAULT_AUTHORIZATION_TTL_MS;
    this.maxPendingAuthorizations = options.maxPendingAuthorizations ?? DEFAULT_MAX_PENDING_AUTHORIZATIONS;

    if (
      !Number.isInteger(this.authorizationTtlMs) ||
      this.authorizationTtlMs < 1_000 ||
      this.authorizationTtlMs > 15 * 60 * 1000
    ) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'authorizationTtlMs is invalid');
    }
    if (
      !Number.isInteger(this.maxPendingAuthorizations) ||
      this.maxPendingAuthorizations < 1 ||
      this.maxPendingAuthorizations > 32
    ) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'maxPendingAuthorizations is invalid');
    }
  }

  beginAuthorization(input: PluginAuthorizationStartInput): PluginAuthorizationStart {
    const now = input.now || new Date();
    const nowMs = assertValidDate(now, 'AUTHORIZATION_INVALID');
    const installationId = assertIdentifier(input.installationId, 'installationId');
    const redirectUri = assertRedirectUri(input.redirectUri);

    this.prunePending(nowMs);
    while (this.pending.size >= this.maxPendingAuthorizations) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pending.delete(oldest);
    }

    const requestId = `authreq_${randomUUID().replace(/-/g, '')}`;
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const expiresAtMs = nowMs + this.authorizationTtlMs;
    const authorization: PluginAuthorizationStart = {
      requestId,
      state,
      codeVerifier,
      codeChallenge,
      redirectUri,
      installationId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };

    this.pending.set(requestId, {
      ...authorization,
      createdAtMs: nowMs,
      expiresAtMs,
    });
    return authorization;
  }

  async exchangeAuthorizationCode(
    input: PluginAuthorizationCodeExchangeInput
  ): Promise<PluginSessionSnapshot> {
    const now = input.now || new Date();
    const nowMs = assertValidDate(now, 'AUTHORIZATION_INVALID');
    const requestId = assertIdentifier(input.requestId, 'requestId');
    if (typeof input.state !== 'string' || input.state.length < 1 || input.state.length > 512) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'state is invalid');
    }
    if (typeof input.code !== 'string' || input.code.length < 1 || input.code.length > 4096) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'authorization code is invalid');
    }

    const pending = this.pending.get(requestId);
    if (!pending) {
      throw new PluginAuthError('AUTHORIZATION_NOT_FOUND', 'Authorization transaction was not found');
    }
    this.pending.delete(requestId);

    if (pending.expiresAtMs <= nowMs) {
      throw new PluginAuthError('AUTHORIZATION_EXPIRED', 'Authorization transaction has expired');
    }
    if (pending.state !== input.state) {
      throw new PluginAuthError('AUTHORIZATION_INVALID', 'Authorization state is invalid');
    }

    let rawGrant: unknown;
    try {
      rawGrant = await this.transport.exchangeAuthorizationCode({
        code: input.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUri,
        installationId: pending.installationId,
      });
    } catch (error) {
      if (error instanceof PluginAuthError) throw error;
      throw new PluginAuthError('AUTH_EXCHANGE_FAILED', 'Authorization code exchange failed');
    }

    const grant = parseAuthGrant(rawGrant, nowMs);
    if (grant.installationId !== pending.installationId) {
      throw new PluginAuthError('AUTH_GRANT_INVALID', 'The auth grant is not bound to this installation');
    }

    this.session = { grant };
    this.closedReason = 'NO_SESSION';
    return this.getSessionSnapshot(now);
  }

  getSessionSnapshot(now: Date = new Date()): PluginSessionSnapshot {
    const nowMs = assertValidDate(now, 'AUTHORIZATION_INVALID');
    if (this.session && Date.parse(this.session.grant.expiresAt) <= nowMs) {
      this.session = null;
      this.closedReason = 'EXPIRED';
    }

    if (!this.session) {
      return {
        status: 'UNAUTHENTICATED',
        reason: this.closedReason,
      };
    }

    return {
      status: 'AUTHENTICATED',
      sessionId: this.session.grant.sessionId,
      principalId: this.session.grant.principalId,
      installationId: this.session.grant.installationId,
      ...(this.session.grant.deviceBindingId
        ? { deviceBindingId: this.session.grant.deviceBindingId }
        : {}),
      expiresAt: this.session.grant.expiresAt,
    };
  }

  async getCapabilities(now: Date = new Date()): Promise<PluginCapabilitySnapshot> {
    const nowMs = assertValidDate(now, 'CAPABILITY_INVALID');
    const session = this.requireActiveSession(now);

    let rawSnapshot: unknown;
    try {
      rawSnapshot = await this.transport.getCapabilities({
        accessToken: session.grant.accessToken,
        sessionId: session.grant.sessionId,
        installationId: session.grant.installationId,
      });
    } catch (error) {
      if (error instanceof PluginAuthError) throw error;
      throw new PluginAuthError('CAPABILITY_UNAVAILABLE', 'Capability discovery is unavailable');
    }

    try {
      return validatePluginCapabilitySnapshot(rawSnapshot, new Date(nowMs));
    } catch (error) {
      if (error instanceof PluginAuthError) throw error;
      throw new PluginAuthError('CAPABILITY_INVALID', 'The server capability snapshot is invalid');
    }
  }

  async revoke(): Promise<PluginSessionSnapshot> {
    const current = this.session;
    if (!current) return this.getSessionSnapshot();

    this.session = null;
    this.closedReason = 'REVOKED';

    try {
      await this.transport.revoke({
        accessToken: current.grant.accessToken,
        sessionId: current.grant.sessionId,
        installationId: current.grant.installationId,
      });
    } catch {
      throw new PluginAuthError(
        'AUTH_REVOCATION_UNAVAILABLE',
        'Remote authentication revocation could not be confirmed'
      );
    }

    return this.getSessionSnapshot();
  }

  private requireActiveSession(now: Date): ActiveSession {
    const snapshot = this.getSessionSnapshot(now);
    if (snapshot.status === 'AUTHENTICATED' && this.session) return this.session;
    if (snapshot.reason === 'EXPIRED') {
      throw new PluginAuthError('AUTH_SESSION_EXPIRED', 'Plugin authentication session has expired');
    }
    throw new PluginAuthError('AUTH_SESSION_UNAVAILABLE', 'An authenticated plugin session is required');
  }

  private prunePending(nowMs: number): void {
    for (const [requestId, authorization] of this.pending.entries()) {
      if (authorization.expiresAtMs <= nowMs) this.pending.delete(requestId);
    }
  }
}
