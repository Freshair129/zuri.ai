import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactString } from '../safety/redact.js';

// @req ZPP-FR-003 — harness-neutral command semantics: one command set, so a Codex adapter and a Claude Code adapter mean the same thing by PLAN_COMMIT.
// @req ZPP-FR-004 — the canonical read-only capability discovery commands — capabilities.get, connector.list, connector.health.

export const PLUGIN_COMMAND_TYPES = [
  'CAPABILITIES_GET',
  'PLAN_PREVIEW',
  'PLAN_COMMIT',
  'PIPELINE_START',
  'PIPELINE_GET',
  'PIPELINE_CANCEL',
  'CONNECTOR_LIST',
  'CONNECTOR_HEALTH',
] as const;

export type PluginCommandType = (typeof PLUGIN_COMMAND_TYPES)[number];
export type HarnessType = 'codex' | 'claude_code' | 'other';
export type ConnectorAuthType = 'oauth2' | 'api_key' | 'device' | 'none';
export type ConnectorDataClass =
  | 'public'
  | 'internal'
  | 'business-confidential'
  | 'pii'
  | 'restricted';

export interface PluginHarness {
  type: HarnessType;
  version: string;
  installationId: string;
}

export interface PluginRequestedTarget {
  projectRef?: string;
}

export interface PluginClientContext {
  locale: string;
  timezone: string;
}

export interface PluginCommandEnvelope {
  schemaVersion: '1.0';
  commandId: string;
  idempotencyKey: string;
  issuedAt: string;
  trace: {
    correlationId: string;
    causationId?: string;
  };
  commandType: PluginCommandType;
  harness: PluginHarness;
  requestedTarget: PluginRequestedTarget;
  payload: Record<string, unknown>;
  clientContext: PluginClientContext;
}

export interface PluginCommandInput {
  commandType: PluginCommandType;
  harness: PluginHarness;
  requestedTarget?: PluginRequestedTarget;
  payload: Record<string, unknown>;
  clientContext: PluginClientContext;
  idempotencyKey?: string;
  causationId?: string;
}

export interface ConnectorManifest {
  connectorId: string;
  version: string;
  authType: ConnectorAuthType;
  capabilities: string[];
  inputSchemaRef: string;
  outputSchemaRef: string;
  dataClasses: ConnectorDataClass[];
  egressAllowlist: string[];
  supportsIdempotency: boolean;
  rateLimitPolicy: string;
  healthCheckRef: string;
}

export type PluginContractErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHORITY_FIELD_FORBIDDEN'
  | 'INVALID_PAYLOAD'
  | 'INVALID_MANIFEST';

export class PluginContractError extends Error {
  constructor(
    public readonly code: PluginContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PluginContractError';
  }
}

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const issuedAtSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'issuedAt must be an ISO-8601 timestamp',
});

const pluginCommandEnvelopeSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    commandId: identifierSchema,
    idempotencyKey: identifierSchema,
    issuedAt: issuedAtSchema,
    trace: z
      .object({
        correlationId: identifierSchema,
        causationId: identifierSchema.optional(),
      })
      .strict(),
    commandType: z.enum(PLUGIN_COMMAND_TYPES),
    harness: z
      .object({
        type: z.enum(['codex', 'claude_code', 'other']),
        version: z.string().min(1).max(64),
        installationId: identifierSchema,
      })
      .strict(),
    requestedTarget: z
      .object({
        projectRef: z.string().min(1).max(256).optional(),
      })
      .strict(),
    payload: z.record(z.unknown()),
    clientContext: z
      .object({
        locale: z.string().min(2).max(35),
        timezone: z.string().min(1).max(64),
      })
      .strict(),
  })
  .strict();

const connectorManifestSchema = z
  .object({
    connectorId: identifierSchema,
    version: z.string().min(1).max(64),
    authType: z.enum(['oauth2', 'api_key', 'device', 'none']),
    capabilities: z.array(identifierSchema).min(1),
    inputSchemaRef: z.string().min(1).max(256),
    outputSchemaRef: z.string().min(1).max(256),
    dataClasses: z
      .array(z.enum(['public', 'internal', 'business-confidential', 'pii', 'restricted']))
      .min(1),
    egressAllowlist: z.array(z.string().min(1).max(256)).min(1),
    supportsIdempotency: z.boolean(),
    rateLimitPolicy: z.string().min(1).max(256),
    healthCheckRef: z.string().min(1).max(256),
  })
  .strict();

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'personid',
  'sessionid',
  'tenantid',
  'businessid',
  'membershipid',
  'role',
  'rolebindings',
  'policysnapshotid',
  'plugininstallationid',
  'devicebindingid',
  'connectoraccountid',
  'executionrunid',
  'workitemid',
  'planid',
  'containerid',
  'secret',
  'token',
  'password',
  'credential',
  'clientsecret',
  'channelaccesstoken',
  'channelsecret',
]);

const SENSITIVE_LOG_FIELDS = new Set([
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'credential',
  'clientsecret',
  'otp',
  'channelaccesstoken',
  'channelsecret',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function authorityFieldName(value: string): string {
  return value.replace(/[-_]/g, '').toLowerCase();
}

function assertNoAuthorityFields(value: unknown, location: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthorityFields(item, location + '[' + index + ']'));
    return;
  }

  if (!isObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(authorityFieldName(key))) {
      throw new PluginContractError(
        'AUTHORITY_FIELD_FORBIDDEN',
        'Client payload contains forbidden authority field at ' + location + '.' + key
      );
    }
    assertNoAuthorityFields(child, location + '.' + key);
  }
}

function createId(prefix: string): string {
  return prefix + '_' + randomUUID().replace(/-/g, '');
}

export function createPluginCommandEnvelope(
  input: PluginCommandInput,
  now: Date = new Date()
): PluginCommandEnvelope {
  if (Number.isNaN(now.getTime())) {
    throw new PluginContractError('VALIDATION_FAILED', 'now must be a valid Date');
  }

  assertNoAuthorityFields(input.payload, 'payload');

  const envelope: PluginCommandEnvelope = {
    schemaVersion: '1.0',
    commandId: createId('cmd'),
    idempotencyKey: input.idempotencyKey || createId('idem'),
    issuedAt: now.toISOString(),
    trace: {
      correlationId: createId('corr'),
      ...(input.causationId ? { causationId: input.causationId } : {}),
    },
    commandType: input.commandType,
    harness: input.harness,
    requestedTarget: input.requestedTarget || {},
    payload: input.payload,
    clientContext: input.clientContext,
  };

  return validatePluginCommandEnvelope(envelope);
}

export function validatePluginCommandEnvelope(
  envelope: unknown
): PluginCommandEnvelope {
  try {
    const parsed = pluginCommandEnvelopeSchema.parse(envelope);
    assertNoAuthorityFields(parsed.payload, 'payload');
    return parsed;
  } catch (error) {
    if (error instanceof PluginContractError) throw error;
    if (error instanceof z.ZodError) {
      throw new PluginContractError(
        'VALIDATION_FAILED',
        error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ')
      );
    }
    throw error;
  }
}

function normalizeForHash(value: unknown, location = 'payload'): unknown {
  if (value === undefined) {
    throw new PluginContractError('INVALID_PAYLOAD', location + ' contains undefined');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new PluginContractError('INVALID_PAYLOAD', location + ' contains a non-finite number');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeForHash(item, location + '[' + index + ']'));
  }
  if (isObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalizeForHash(value[key], location + '.' + key);
        return result;
      }, {});
  }
  throw new PluginContractError('INVALID_PAYLOAD', location + ' contains an unsupported value');
}

export function stableStringify(value: unknown): string {
  const normalized = normalizeForHash(value);
  const serialized = JSON.stringify(normalized);
  if (serialized === undefined) {
    throw new PluginContractError('INVALID_PAYLOAD', 'value cannot be serialized');
  }
  return serialized;
}

export function hashNormalizedPayload(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(stableStringify(value)).digest('hex');
}

function isSensitiveLogField(key: string): boolean {
  const normalized = authorityFieldName(key);
  return SENSITIVE_LOG_FIELDS.has(normalized) || normalized.includes('token');
}

export function redactPluginValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveLogField(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactPluginValue(item));
  if (isObject(value)) {
    return Object.entries(value).reduce<Record<string, unknown>>((result, [field, child]) => {
      result[field] = redactPluginValue(child, field);
      return result;
    }, {});
  }
  return value;
}

export function validateConnectorManifest(value: unknown): ConnectorManifest {
  try {
    return connectorManifestSchema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PluginContractError(
        'INVALID_MANIFEST',
        error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ')
      );
    }
    throw error;
  }
}
