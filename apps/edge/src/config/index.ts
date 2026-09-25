import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSecret } from './secret.js';

// @req SDD-007 — the configuration module: environment loading and the Docker-secret `_FILE` adapter.
// @req SEC-005 — device identity and token may live in a secret file rather than in plaintext.

// The managed Desktop worker supplies every setting over its private initialization channel.
// Keep standalone CLI behavior unchanged while preventing a developer checkout's `.env` from
// overriding that explicit worker contract.
if (process.env.ZURI_CONFIG_SKIP_DOTENV !== '1') dotenv.config();

export interface AgentConfig {
  transport: 'zuri-api' | 'mock';
  apiBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  duckdbPath: string;
  pollIntervalSeconds: number;
  maxConcurrentJobs: number;
  lineHistoryHashKey: string;
  lineHistoryRoot: string;
  /** Directory holding the 1:1 identity register. */
  lineIdentityRoot: string;
  /** Directory holding the extracted factory catalogs. */
  catalogRoot: string;
  /** THB per RMB used when quoting from chat. */
  exchangeRateThbPerRmb: number;
  /** Short-lived per-person chat memory, so a follow-up has something to refer back to. */
  chatMemoryRoot: string;
  chatRetentionHours: number;
  /**
   * The conversational layer. Off unless both the switch and a key are set. With it off the agent
   * still answers, from the pattern-based reader — so this is a quality setting, not a
   * prerequisite, and losing the key degrades the replies rather than stopping them.
   */
  llmEnabled: boolean;
  /** Explicit consent to answer through a hosted model API rather than a local one. */
  llmAllowCloud: boolean;
  anthropicApiKey: string;
  llmModel: string;
  /**
   * OpenAI-compatible endpoint for a model the business runs itself (Ollama, vLLM,
   * LM Studio, llama.cpp). Set means local; unset means the hosted API. This one
   * value is what decides the provider, so the two cannot drift apart.
   */
  llmBaseUrl: string;
  /** Second model, tried only when the core one cannot answer. Optional. */
  llmFallbackModel: string;
  /** Context window; also what decides whether the model fits in VRAM. */
  llmNumCtx: number;
  llmEffort: 'low' | 'medium' | 'high';
  /** Bounds the local conversation provider call. */
  llmTimeoutMs: number;
  llmMaxIterations: number;
  /**
   * The subscription-backed answer path: Claude Code driven headlessly. Preferred over the API
   * layer when both are on, because it bills against a plan rather than per token and brings its
   * own web search and file authoring.
   */
  headlessEnabled: boolean;
  headlessBin: string;
  headlessModel: string;
  headlessMaxTurns: number;
  /** Far longer than a reply token allows, which is why this path must deliver by push. */
  headlessTimeoutMs: number;
  /** Scratch directories, deliberately outside every repository. */
  headlessSandboxRoot: string;
  headlessSessionRoot: string;
  headlessSessionRetentionHours: number;
  /** Each an outward capability, each off until switched on deliberately. */
  headlessWebSearch: boolean;
  headlessFileAuthoring: boolean;
  /** Absolute operator-managed CLI credential/config home; never inferred from the user home. */
  managedProviderHome: string;
  /**
   * Retained queue configuration for durable outbox records.
   */
  outboxEnabled: boolean;
  outboxRoot: string;
  /** How long a claim is honoured before the work is considered abandoned. */
  outboxLeaseMs: number;
  outboxMaxAttempts: number;
  outboxPollMs: number;
  outboxRetentionHours: number;
  /** How long a quarantined record's question text survives before being redacted (G12). */
  outboxQuarantineQuestionRetentionHours: number;
  lineHistoryRetentionDays: number;
  /** Retention for direct conversations, kept separately because they are private. */
  lineHistoryDmRetentionDays: number;
  lineHistoryAllowedGroupAliases: string[];
  contractVersion: '0.1.0b';
}

export interface ConfigCheckResult {
  valid: boolean;
  contractVersion: string;
  /**
   * Things that work but should not stay this way. Kept apart from `errors` so `valid` still means
   * "this runtime can start" — a warning that flipped `valid` would just get switched off.
   */
  warnings?: string[];
  checks: {
    transport: { status: 'pass' | 'fail'; value?: string };
    apiBaseUrl: { status: 'pass' | 'fail'; value?: string };
    deviceId: { status: 'pass' | 'fail'; value?: string };
    deviceTokenConfigured: { status: 'pass' | 'fail' };
    duckdbPath: { status: 'pass' | 'fail' | 'warn'; path?: string; readable?: boolean };
    outbox?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      root: string;
      leaseMs: number;
      maxAttempts: number;
    };
    llm?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      apiKeyConfigured: boolean;
      model: string;
      effort: string;
      timeoutMs: number;
    };
    lineHistory?: {
      status: 'pass' | 'fail' | 'warn';
      hashKeyConfigured: boolean;
      root: string;
      retentionDays: number;
      dmRetentionDays: number;
      allowedGroupAliases: string[];
    };
  };
  errors: string[];
}

/**
 * @param env Injectable so `validateConfig`/`loadConfig` can be exercised against a synthetic
 * environment in tests without mutating the real `process.env` a shared test run depends on.
 * Defaults to `process.env`, so every existing call site is unaffected.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Partial<AgentConfig> {
  const transport = env.ZURI_COMMAND_TRANSPORT || 'zuri-api';
  const lineHistoryAllowedGroupAliases = Object.entries(env)
    .filter(([name, value]) => (name.startsWith('LINE_HISTORY_GROUP_') || name.startsWith('LINE_GROUP_')) && Boolean(value))
    .map(([name]) => {
      const prefix = name.startsWith('LINE_HISTORY_GROUP_') ? 'LINE_HISTORY_GROUP_' : 'LINE_GROUP_';
      return name.slice(prefix.length).toLowerCase().replace(/_/g, '-');
    })
    .sort();

  return {
    transport: transport === 'mock' ? transport : 'zuri-api',
    apiBaseUrl: env.ZURI_COMMAND_API_BASE_URL || 'http://localhost:3000',
    deviceId: env.ZURI_AGENT_DEVICE_ID || '',
    // SEC-005 / SDD-007: each honors an optional `${NAME}_FILE` pointing at a Docker secret or
    // an ACL-protected file, so a deployment need not keep the raw value in the process env.
    deviceToken: resolveSecret(env, 'ZURI_AGENT_DEVICE_TOKEN'),
    duckdbPath: env.SMARTGIFT_DUCKDB_PATH || '',
    pollIntervalSeconds: parseInt(env.BRIDGE_POLL_INTERVAL_SECONDS || '15', 10),
    maxConcurrentJobs: parseInt(env.BRIDGE_MAX_CONCURRENT_JOBS || '1', 10),
    lineHistoryHashKey: resolveSecret(env, 'LINE_HISTORY_HASH_KEY'),
    lineHistoryRoot: env.LINE_HISTORY_ROOT || 'state/line-history',
    lineIdentityRoot: env.LINE_IDENTITY_ROOT || 'state/line-identity',
    catalogRoot: env.SMARTGIFT_CATALOG_ROOT || 'state/catalog',
    exchangeRateThbPerRmb: Number(env.SMARTGIFT_FX_THB_PER_RMB || '5'),
    chatMemoryRoot: env.ZURI_CHAT_MEMORY_ROOT || 'state/line-chat',
    chatRetentionHours: parseInt(env.ZURI_CHAT_RETENTION_HOURS || '24', 10),
    llmEnabled: env.ZURI_LLM_ENABLED === 'true',
    llmAllowCloud: env.ZURI_LLM_ALLOW_CLOUD === 'true',
    anthropicApiKey: resolveSecret(env, 'ANTHROPIC_API_KEY'),
    llmModel: env.ZURI_LLM_MODEL || 'claude-opus-5',
    llmBaseUrl: env.ZURI_LLM_BASE_URL || '',
    llmFallbackModel: env.ZURI_LLM_FALLBACK_MODEL || '',
    llmNumCtx: Number(env.ZURI_LLM_NUM_CTX || 8192),
    llmEffort: (['low', 'medium', 'high'] as const).includes(
      env.ZURI_LLM_EFFORT as 'low' | 'medium' | 'high'
    )
      ? (env.ZURI_LLM_EFFORT as 'low' | 'medium' | 'high')
      : 'low',
    llmTimeoutMs: parseInt(env.ZURI_LLM_TIMEOUT_MS || '12000', 10),
    llmMaxIterations: parseInt(env.ZURI_LLM_MAX_ITERATIONS || '4', 10),
    headlessEnabled: env.ZURI_HEADLESS_ENABLED === 'true',
    headlessBin: env.ZURI_HEADLESS_BIN || 'claude',
    headlessModel: env.ZURI_HEADLESS_MODEL || 'claude-sonnet-5',
    headlessMaxTurns: parseInt(env.ZURI_HEADLESS_MAX_TURNS || '8', 10),
    headlessTimeoutMs: parseInt(env.ZURI_HEADLESS_TIMEOUT_MS || '120000', 10),
    headlessSandboxRoot:
      env.ZURI_HEADLESS_SANDBOX_ROOT ||
      path.join(os.tmpdir(), 'zuri-agent-sandbox'),
    headlessSessionRoot: env.ZURI_HEADLESS_SESSION_ROOT || 'state/agent-sessions',
    headlessSessionRetentionHours: parseInt(
      env.ZURI_HEADLESS_SESSION_RETENTION_HOURS || '168',
      10
    ),
    headlessWebSearch: env.ZURI_HEADLESS_WEB_SEARCH === 'true',
    headlessFileAuthoring: env.ZURI_HEADLESS_FILES === 'true',
    managedProviderHome: (env.ZURI_MANAGED_PROVIDER_HOME || '').trim(),
    outboxEnabled: env.ZURI_OUTBOX_ENABLED === 'true',
    outboxRoot: env.ZURI_OUTBOX_ROOT || 'state/outbox',
    outboxLeaseMs: parseInt(env.ZURI_OUTBOX_LEASE_MS || '180000', 10),
    outboxMaxAttempts: parseInt(env.ZURI_OUTBOX_MAX_ATTEMPTS || '3', 10),
    outboxPollMs: parseInt(env.ZURI_OUTBOX_POLL_MS || '2000', 10),
    outboxRetentionHours: parseInt(env.ZURI_OUTBOX_RETENTION_HOURS || '48', 10),
    outboxQuarantineQuestionRetentionHours: parseInt(
      env.ZURI_OUTBOX_QUARANTINE_QUESTION_RETENTION_HOURS || '168',
      10
    ),
    lineHistoryRetentionDays: parseInt(env.LINE_HISTORY_RETENTION_DAYS || '30', 10),
    /*
     * A private conversation is kept for a week by default rather than the group archive's month.
     * The default is bounded by the group value so that lowering one lowers both: an operator who
     * sets the archive to three days has said what they mean about all of it, and a direct message
     * outliving the group history it sits beside would be the wrong way round.
     */
    lineHistoryDmRetentionDays: env.LINE_HISTORY_DM_RETENTION_DAYS
      ? parseInt(env.LINE_HISTORY_DM_RETENTION_DAYS, 10)
      : Math.min(7, parseInt(env.LINE_HISTORY_RETENTION_DAYS || '30', 10)),
    lineHistoryAllowedGroupAliases,
    contractVersion: '0.1.0b',
  };
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigCheckResult {
  const config = loadConfig(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const transportCheck: { status: 'pass' | 'fail'; value?: string } =
    config.transport === 'zuri-api' || config.transport === 'mock'
      ? { status: 'pass', value: config.transport }
      : { status: 'fail' };

  if (transportCheck.status === 'fail') {
    errors.push('ZURI_COMMAND_TRANSPORT must be zuri-api or mock');
  }

  const apiBaseUrlCheck: { status: 'pass' | 'fail'; value?: string } = config.transport !== 'zuri-api' || config.apiBaseUrl
    ? { status: 'pass', value: config.apiBaseUrl }
    : { status: 'fail' };

  if (config.transport === 'zuri-api' && apiBaseUrlCheck.status === 'fail') {
    errors.push('ZURI_COMMAND_API_BASE_URL is required');
  }

  const deviceIdCheck: { status: 'pass' | 'fail'; value?: string } = config.transport !== 'zuri-api' || config.deviceId
    ? { status: 'pass', value: config.deviceId }
    : { status: 'fail' };

  if (config.transport === 'zuri-api' && deviceIdCheck.status === 'fail') {
    errors.push('ZURI_AGENT_DEVICE_ID is missing');
  }

  const deviceTokenCheck: { status: 'pass' | 'fail' } = config.transport !== 'zuri-api' || config.deviceToken
    ? { status: 'pass' }
    : { status: 'fail' };

  if (config.transport === 'zuri-api' && deviceTokenCheck.status === 'fail') {
    errors.push('ZURI_AGENT_DEVICE_TOKEN is missing');
  }

  let duckdbCheck: { status: 'pass' | 'fail' | 'warn'; path?: string; readable?: boolean } = {
    status: 'warn',
    path: config.duckdbPath || '(memory/unspecified)',
    readable: false,
  };

  if (config.duckdbPath) {
    try {
      if (fs.existsSync(config.duckdbPath)) {
        fs.accessSync(config.duckdbPath, fs.constants.R_OK);
        duckdbCheck = { status: 'pass', path: config.duckdbPath, readable: true };
      } else {
        duckdbCheck = { status: 'fail', path: config.duckdbPath, readable: false };
        errors.push(`SmartGift DuckDB file not found at path: ${config.duckdbPath}`);
      }
    } catch {
      duckdbCheck = { status: 'fail', path: config.duckdbPath, readable: false };
      errors.push(`SmartGift DuckDB file is not readable at path: ${config.duckdbPath}`);
    }
  }

  /*
   * The model layer is checked, not required. Its failure mode is a plainer reply, so a missing
   * key is only an error once someone has explicitly switched the layer on.
   */
  const llm = {
    enabled: config.llmEnabled || false,
    apiKeyConfigured: Boolean(config.anthropicApiKey),
    /** Which way this deployment is pointed. Reported so `health` says it out loud. */
    provider: config.llmBaseUrl ? 'openai-compatible' : 'anthropic',
    baseUrlConfigured: Boolean(config.llmBaseUrl),
    model: config.llmModel || '',
    effort: config.llmEffort || 'low',
    timeoutMs: config.llmTimeoutMs || 0,
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (config.llmEnabled) {
    const timeoutSane = llm.timeoutMs >= 3000 && llm.timeoutMs <= 25000;
    // A model the business runs itself authenticates to nobody, so demanding a key
    // would make the local deployment permanently fail its own health check. Each
    // provider is checked for what it actually needs.
    const credentialed = llm.baseUrlConfigured || llm.apiKeyConfigured;
    llm.status = credentialed && timeoutSane ? 'pass' : 'fail';
    if (!credentialed) {
      errors.push(
        'ZURI_LLM_ENABLED=true needs either ZURI_LLM_BASE_URL (a model you run) ' +
        'or ANTHROPIC_API_KEY (the hosted API)'
      );
    }
    if (llm.timeoutMs < 3000) {
      errors.push('ZURI_LLM_TIMEOUT_MS must be at least 3000');
    }
    if (llm.timeoutMs > 25000) {
      errors.push(
        'ZURI_LLM_TIMEOUT_MS must stay at or under 25000'
      );
    }
  }

  const outbox = {
    enabled: config.outboxEnabled || false,
    root: config.outboxRoot || 'state/outbox',
    leaseMs: config.outboxLeaseMs || 0,
    maxAttempts: config.outboxMaxAttempts || 0,
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (config.outboxEnabled) {
    outbox.status = outbox.leaseMs >= 30000 && outbox.maxAttempts >= 1 ? 'pass' : 'fail';
    if (outbox.leaseMs < 30000) {
      errors.push('ZURI_OUTBOX_LEASE_MS must be at least 30000, or slow answers get reclaimed mid-flight');
    }
    if (outbox.maxAttempts < 1) errors.push('ZURI_OUTBOX_MAX_ATTEMPTS must be at least 1');
  }

  const lineHistory = {
    hashKeyConfigured: Boolean(config.lineHistoryHashKey),
    root: config.lineHistoryRoot || 'state/line-history',
    retentionDays: config.lineHistoryRetentionDays || 0,
    dmRetentionDays: config.lineHistoryDmRetentionDays || 0,
    allowedGroupAliases: config.lineHistoryAllowedGroupAliases || [],
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (lineHistory.hashKeyConfigured) {
    lineHistory.status = lineHistory.retentionDays > 0 && lineHistory.dmRetentionDays > 0 ? 'pass' : 'fail';
    if (lineHistory.retentionDays < 1) errors.push('LINE_HISTORY_RETENTION_DAYS must be at least 1');
    const dmRetentionDays = config.lineHistoryDmRetentionDays ?? 0;
    if (dmRetentionDays < 1) {
      errors.push('LINE_HISTORY_DM_RETENTION_DAYS must be at least 1');
    } else if (dmRetentionDays > lineHistory.retentionDays) {
      /*
       * Warned, not clamped. Silently shortening what an operator configured would make the
       * setting untrustworthy in the one direction that matters — you would read 30 and get 7
       * without being told. The explicit value stands and the disagreement is visible instead.
       */
      warnings.push(
        `LINE_HISTORY_DM_RETENTION_DAYS (${dmRetentionDays}) outlives ` +
          `LINE_HISTORY_RETENTION_DAYS (${lineHistory.retentionDays}), so private conversations are ` +
          'kept longer than the group history beside them.'
      );
    }
  }

  return {
    valid: errors.length === 0,
    contractVersion: '0.1.0b',
    ...(warnings.length ? { warnings } : {}),
    checks: {
      transport: transportCheck,
      apiBaseUrl: apiBaseUrlCheck,
      deviceId: deviceIdCheck,
      deviceTokenConfigured: deviceTokenCheck,
      duckdbPath: duckdbCheck,
      llm,
      outbox,
      lineHistory,
    },
    errors,
  };
}
