import fs from 'node:fs';
import path from 'node:path';
import { resolveSecret } from '../../config/secret.js';

// @req FR-189 — the one setting that decides whether edge answers read the published GenesisRAG17
//   generation through MSP: `off` (default, today's v4 behaviour), `shadow` or `primary`.
// @spec ADR-075 D7, ADR-075 D8 Phase 4, ADR-075 owner question 3 (the configured v4 fallback window)
// @spec ADR-043 D2 — the only lawful call direction out of Tier 1 is to MSP, never to GKS or Tier 4.
// @tested tests/unit/genesisrag17-edge.test.ts
//
// Nothing in this file is read when the mode is `off`: no file is touched, no process is spawned,
// and no other setting is required. A mode other than `off` refuses to start — it never degrades
// silently — when a prerequisite is missing, and the error names the setting, never its value.

export type GenesisRag17Mode = 'off' | 'shadow' | 'primary';

export const MODE_ENV = 'ZURI_EDGE_GENESISRAG17_MODE';
export const CREDENTIAL_ENV = 'ZURI_EDGE_GENESISRAG17_CREDENTIAL';
export const SCOPE_ENV = 'ZURI_EDGE_GENESISRAG17_SCOPE';
export const FALLBACK_UNTIL_ENV = 'ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL';
export const TOP_K_ENV = 'ZURI_EDGE_GENESISRAG17_TOP_K';
export const RECORD_ROOT_ENV = 'ZURI_EDGE_GENESISRAG17_RECORD_ROOT';
export const RETENTION_DAYS_ENV = 'ZURI_EDGE_GENESISRAG17_RETENTION_DAYS';
export const MAX_RECORDS_PER_DAY_ENV = 'ZURI_EDGE_GENESISRAG17_MAX_RECORDS_PER_DAY';
/** The same names zuri-ai's server uses to start MSP (`apps/server/src/modules/agent/msp-stdio-transport.js`). */
export const MSP_COMMAND_ENV = 'ZURI_MSP_COMMAND';
export const MSP_ARGS_ENV = 'ZURI_MSP_ARGS';
export const MSP_CWD_ENV = 'ZURI_MSP_CWD';
export const MSP_TIMEOUT_ENV = 'ZURI_MSP_TIMEOUT_MS';

export const GENESISRAG17_SCHEMA_VERSION = 'genesisrag17.v1';

/** The six-field MSP scope, in MSP's order (`GENESISRAG17.tools.json` `$defs.scope`). */
export interface GenesisRag17Scope {
  portfolioId: string;
  tenantId: string;
  businessId: string;
  workspaceId: string;
  agentId: string;
  visibility: 'private';
}

export interface MspCommandSettings {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
}

export interface GenesisRag17Settings {
  mode: Exclude<GenesisRag17Mode, 'off'>;
  msp: MspCommandSettings;
  /** The MSP `source`-role credential. Never logged, never recorded. */
  credential: string;
  scope: GenesisRag17Scope;
  topK: number;
  /** Primary mode only: v4 fallback is allowed strictly before this instant, never at or after it. */
  fallbackUntil: Date | null;
  recordRoot: string;
  retentionDays: number;
  maxRecordsPerDay: number;
}

export class GenesisRag17ConfigError extends Error {
  readonly code = 'GENESISRAG17_PREREQUISITE_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'GenesisRag17ConfigError';
  }
}

export function readGenesisRag17Mode(env: NodeJS.ProcessEnv = process.env): GenesisRag17Mode {
  const raw = (env[MODE_ENV] || 'off').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'primary') return raw;
  throw new GenesisRag17ConfigError(`${MODE_ENV} must be off, shadow or primary`);
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new GenesisRag17ConfigError(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
}

function parseArgs(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  let args: unknown;
  try { args = JSON.parse(raw); } catch { throw new GenesisRag17ConfigError(`${MSP_ARGS_ENV} must be a JSON array of strings`); }
  if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
    throw new GenesisRag17ConfigError(`${MSP_ARGS_ENV} must be a JSON array of strings`);
  }
  return args as string[];
}

const SCOPE_KEYS = ['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility'] as const;

function parseScope(raw: string | undefined): GenesisRag17Scope {
  if (!raw || !raw.trim()) throw new GenesisRag17ConfigError(`${SCOPE_ENV} is required: the edge's six-field MSP scope as JSON`);
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw); } catch { throw new GenesisRag17ConfigError(`${SCOPE_ENV} must be a JSON object`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GenesisRag17ConfigError(`${SCOPE_ENV} must be a JSON object`);
  const keys = Object.keys(value);
  if (keys.length !== SCOPE_KEYS.length || SCOPE_KEYS.some((key) => typeof value[key] !== 'string')) {
    throw new GenesisRag17ConfigError(`${SCOPE_ENV} must have exactly ${SCOPE_KEYS.join(', ')} as strings`);
  }
  if (['portfolioId', 'tenantId', 'businessId'].some((key) => !(value[key] as string).length)) {
    throw new GenesisRag17ConfigError(`${SCOPE_ENV} portfolioId, tenantId and businessId must be non-empty`);
  }
  if (value.visibility !== 'private') throw new GenesisRag17ConfigError(`${SCOPE_ENV} visibility must be private`);
  // Rebuilt in MSP's field order; the configured object is never forwarded as-is.
  return {
    portfolioId: value.portfolioId as string, tenantId: value.tenantId as string, businessId: value.businessId as string,
    workspaceId: value.workspaceId as string, agentId: value.agentId as string, visibility: 'private',
  };
}

/**
 * A bare date is the owner's calendar day in Bangkok, inclusive: fallback stays allowed through the
 * whole of that day. A full ISO timestamp is taken as written. The date is configuration, never a
 * constant in code: ADR-075 question 3 sets it as "120 days after the Phase 4 cutover or the end of
 * the New Year 2027 season, whichever is later", and neither end is known until cutover happens.
 */
export function parseFallbackUntil(raw: string | undefined): Date {
  const value = (raw || '').trim();
  if (!value) {
    throw new GenesisRag17ConfigError(
      `${FALLBACK_UNTIL_ENV} is required in primary mode: the owner-set end of the v4 fallback window ` +
      '(ADR-075 question 3: 120 days after cutover or the end of the New Year 2027 season, whichever is later)',
    );
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999+07:00` : value;
  const date = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(date.getTime())) {
    throw new GenesisRag17ConfigError(`${FALLBACK_UNTIL_ENV} must be a date (YYYY-MM-DD) or an ISO timestamp`);
  }
  return date;
}

function looksLikePath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || path.isAbsolute(value);
}

/**
 * The static half of "is there an MSP runtime on this device": the command, its working directory
 * and its entry script must exist. It cannot prove MSP answers — only a query can — but it turns
 * the common case (MSP never installed here) into a refusal at start-up instead of an error on
 * every customer question.
 */
export function assertMspRuntimePresent(msp: MspCommandSettings, exists: (p: string) => boolean = fs.existsSync): void {
  if (msp.cwd && !exists(msp.cwd)) throw new GenesisRag17ConfigError(`${MSP_CWD_ENV} names a directory that does not exist on this device`);
  if (looksLikePath(msp.command) && !exists(path.resolve(msp.cwd || '.', msp.command))) {
    throw new GenesisRag17ConfigError(`${MSP_COMMAND_ENV} names an executable that does not exist on this device`);
  }
  const script = msp.args.find((arg) => /\.(mjs|cjs|js)$/i.test(arg));
  if (script && !exists(path.resolve(msp.cwd || '.', script))) {
    throw new GenesisRag17ConfigError(`${MSP_ARGS_ENV} names an MSP entry script that does not exist on this device`);
  }
}

/**
 * Returns null for `off` without reading anything else. For `shadow`/`primary`, every prerequisite
 * is checked here, once, so the worker refuses to start rather than run half-configured.
 */
export function loadGenesisRag17Settings(
  env: NodeJS.ProcessEnv = process.env,
  options: { exists?: (p: string) => boolean } = {},
): GenesisRag17Settings | null {
  const mode = readGenesisRag17Mode(env);
  if (mode === 'off') return null;

  const command = (env[MSP_COMMAND_ENV] || '').trim();
  if (!command) {
    throw new GenesisRag17ConfigError(
      `${MODE_ENV}=${mode} needs a local MSP runtime: set ${MSP_COMMAND_ENV} (and ${MSP_ARGS_ENV}/${MSP_CWD_ENV}) ` +
      'to start MSP over stdio on this device',
    );
  }
  const msp: MspCommandSettings = {
    command,
    args: parseArgs(env[MSP_ARGS_ENV]),
    cwd: (env[MSP_CWD_ENV] || '').trim() || undefined,
    timeoutMs: positiveInt(env, MSP_TIMEOUT_ENV, 8000, 120000),
  };
  assertMspRuntimePresent(msp, options.exists);

  let credential: string;
  try { credential = resolveSecret(env, CREDENTIAL_ENV).trim(); } catch {
    throw new GenesisRag17ConfigError(`${CREDENTIAL_ENV}_FILE names a file that could not be read`);
  }
  if (!credential) throw new GenesisRag17ConfigError(`${CREDENTIAL_ENV} (or ${CREDENTIAL_ENV}_FILE) is required: the MSP source-role credential`);

  return {
    mode,
    msp,
    credential,
    scope: parseScope(env[SCOPE_ENV]),
    topK: positiveInt(env, TOP_K_ENV, 5, 100),
    fallbackUntil: mode === 'primary' ? parseFallbackUntil(env[FALLBACK_UNTIL_ENV]) : null,
    recordRoot: (env[RECORD_ROOT_ENV] || '').trim() || 'state/genesisrag17',
    retentionDays: positiveInt(env, RETENTION_DAYS_ENV, 400, 3650),
    maxRecordsPerDay: positiveInt(env, MAX_RECORDS_PER_DAY_ENV, 20000, 1000000),
  };
}
