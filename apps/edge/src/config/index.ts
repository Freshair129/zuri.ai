import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSecret } from './secret.js';

// @req SDD-007 — the configuration module: environment loading and the Docker-secret `_FILE` adapter.
// @req SEC-005 — device identity and token may live in a secret file rather than in plaintext.
// @req BR-007 — the LINE channel token's custody rule, checked here and surfaced as a warning.
// @spec FR-143, FR-144 — zuri-ai's edge-device requirements, referenced but not owned here.

// The managed Desktop worker supplies every setting over its private initialization channel.
// Keep standalone CLI behavior unchanged while preventing a developer checkout's `.env` from
// overriding that explicit worker contract.
if (process.env.ZURI_CONFIG_SKIP_DOTENV !== '1') dotenv.config();

export interface AgentConfig {
  transport: 'zuri-api' | 'line-poc' | 'mock';
  apiBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  duckdbPath: string;
  pollIntervalSeconds: number;
  maxConcurrentJobs: number;
  linePocEnabled: boolean;
  linePocChannelAccessToken: string;
  linePocGroupAliases: Record<string, string>;
  lineDmPocEnabled: boolean;
  lineWebhookEnabled: boolean;
  lineChannelSecret: string;
  /** SHA-256 of the operator key that gates the config surface. Empty means not set up. */
  adminKeyHash: string;
  lineHistoryHashKey: string;
  lineWebhookBindHost: '127.0.0.1' | '0.0.0.0';
  lineWebhookPort: number;
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
  /** Must stay well inside the roughly thirty seconds a LINE reply token lives. */
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
   * Answer out of band and deliver by push, instead of inside the webhook request.
   *
   * Required whenever answering can outlast a LINE reply token — which the headless layer always
   * does. With it off the webhook answers inline, which is still correct for the fast paths.
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
  /**
   * Edge-executed evidence extraction: this device pulling asset-evidence jobs from the
   * Zuri cloud, reading the document locally, and posting a candidate back. The cloud side
   * is its FR-143 (job lane) and FR-144 (device credential); the names below are the ones
   * the cloud's own activation runbook tells an operator to set, so they are not renamed
   * here for local taste.
   *
   * Off unless both the base URL and the key are present. There is no separate switch:
   * a device with a credential installed is a device that has been activated, and an extra
   * boolean would only create the state where the key is set and nothing polls.
   */
  cloudBaseUrl: string;
  /** The raw `edgk_…` credential. Never logged, never printed, never written to state. */
  edgeDeviceKey: string;
  /** Delay between claim attempts while the cloud queue is empty. */
  heartbeatIntervalMs: number;
  edgeExtractionPollMs: number;
  /**
   * Fixed at 1. Declared rather than implied so the reason is somewhere a reader can find
   * it: one local model, and a ten-minute lease that a queued second job could outlive.
   */
  edgeExtractionConcurrency: 1;
  /**
   * The vision model to read documents with, e.g. `qwen3-vl:8b`. Empty is the default and
   * a supported state — the device then fails every extraction job with a reason saying so.
   *
   * Named separately from `ZURI_LLM_MODEL` on purpose. The conversational model on this
   * hardware (`qwen3.5:9b`) is text-only, and a text model handed no picture still writes a
   * confident receipt. Sharing one setting would mean enabling chat quietly enrolled a blind
   * model into reading documents a Human then approves.
   */
  edgeExtractionVisionModel: string;
  /** Ceiling on reading one document. Nothing is waiting on it, so it is generous. */
  edgeExtractionTimeoutMs: number;
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
    linePoc?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      channelAccessTokenConfigured: boolean;
      configuredGroupAliases: string[];
    };
    lineDmPoc?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      channelAccessTokenConfigured: boolean;
    };
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
    edgeExtraction?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      cloudBaseUrlConfigured: boolean;
      deviceKeyConfigured: boolean;
      pollMs: number;
      concurrency: number;
      /** The model name only — never a key, and never a base URL with credentials in it. */
      visionModel: string;
      /** False means every claimed job will be failed with "no vision model configured". */
      visionModelConfigured: boolean;
    };
    lineHistory?: {
      status: 'pass' | 'fail' | 'warn';
      enabled: boolean;
      channelSecretConfigured: boolean;
      hashKeyConfigured: boolean;
      bindHost: '127.0.0.1' | '0.0.0.0';
      root: string;
      retentionDays: number;
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
  const linePocGroupAliases = Object.entries(env)
    .filter(([name, value]) => (name.startsWith('LINE_POC_GROUP_') || name.startsWith('LINE_GROUP_')) && Boolean(value))
    .reduce<Record<string, string>>((aliases, [name, value]) => {
      const prefix = name.startsWith('LINE_POC_GROUP_') ? 'LINE_POC_GROUP_' : 'LINE_GROUP_';
      const alias = name.slice(prefix.length).toLowerCase().replace(/_/g, '-');
      aliases[alias] = value!;
      return aliases;
    }, {});
  const lineHistoryAllowedGroupAliases = Object.entries(env)
    .filter(([name, value]) => (name.startsWith('LINE_HISTORY_GROUP_') || name.startsWith('LINE_GROUP_')) && Boolean(value))
    .map(([name]) => {
      const prefix = name.startsWith('LINE_HISTORY_GROUP_') ? 'LINE_HISTORY_GROUP_' : 'LINE_GROUP_';
      return name.slice(prefix.length).toLowerCase().replace(/_/g, '-');
    })
    .sort();

  return {
    transport: transport === 'line-poc' || transport === 'mock' ? transport : 'zuri-api',
    apiBaseUrl: env.ZURI_COMMAND_API_BASE_URL || 'http://localhost:3000',
    deviceId: env.ZURI_AGENT_DEVICE_ID || '',
    // SEC-005 / SDD-007: each honors an optional `${NAME}_FILE` pointing at a Docker secret or
    // an ACL-protected file, so a deployment need not keep the raw value in the process env.
    deviceToken: resolveSecret(env, 'ZURI_AGENT_DEVICE_TOKEN'),
    duckdbPath: env.SMARTGIFT_DUCKDB_PATH || '',
    pollIntervalSeconds: parseInt(env.BRIDGE_POLL_INTERVAL_SECONDS || '15', 10),
    maxConcurrentJobs: parseInt(env.BRIDGE_MAX_CONCURRENT_JOBS || '1', 10),
    linePocEnabled: env.LINE_ENABLED === 'true' || env.LINE_POC_ENABLED === 'true',
    linePocChannelAccessToken:
      resolveSecret(env, 'LINE_CHANNEL_ACCESS_TOKEN') || resolveSecret(env, 'LINE_POC_CHANNEL_ACCESS_TOKEN'),
    linePocGroupAliases,
    lineDmPocEnabled: env.LINE_DM_ENABLED === 'true' || env.LINE_DM_POC_ENABLED === 'true',
    lineWebhookEnabled: env.LINE_WEBHOOK_ENABLED === 'true',
    lineChannelSecret: resolveSecret(env, 'LINE_CHANNEL_SECRET'),
    adminKeyHash: (env.ZURI_EDGE_ADMIN_KEY_HASH || '').trim(),
    lineHistoryHashKey: resolveSecret(env, 'LINE_HISTORY_HASH_KEY'),
    lineWebhookBindHost: env.LINE_WEBHOOK_BIND_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1',
    lineWebhookPort: parseInt(env.LINE_WEBHOOK_PORT || '8787', 10),
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
    cloudBaseUrl: (env.ZURI_CLOUD_BASE_URL || '').trim(),
    // The `_FILE` form matters more here than anywhere else in this file: this key is a
    // Business-scoped credential to a production cloud, and `.env` on a warehouse PC is
    // the wrong place for it when the OS can hold it behind an ACL instead.
    edgeDeviceKey: resolveSecret(env, 'ZURI_EDGE_DEVICE_KEY'),
    // Clamped where it is used, not here: an out-of-range value is a broken heartbeat rather than
    // a slow one, and the reason it has to stay under the cloud's window belongs next to that rule.
    heartbeatIntervalMs: positiveInt(env.ZURI_HEARTBEAT_INTERVAL_MS, 40000),
    edgeExtractionPollMs: positiveInt(env.ZURI_EDGE_POLL_MS, 5000),
    edgeExtractionConcurrency: 1,
    edgeExtractionVisionModel: (env.ZURI_EXTRACTION_VISION_MODEL || '').trim(),
    edgeExtractionTimeoutMs: positiveInt(env.ZURI_EXTRACTION_TIMEOUT_MS, 120000),
    contractVersion: '0.1.0b',
  };
}

/**
 * Parse a positive integer, falling back on anything that is not one.
 *
 * A poll interval of `0`, `-1` or `abc` is not a configuration to honour: zero is a hot
 * loop against the cloud, and the other two are typos. Silently using the default is the
 * kind thing here — the alternative is a device that refuses to start over a stray key.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): ConfigCheckResult {
  const config = loadConfig(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const transportCheck: { status: 'pass' | 'fail'; value?: string } =
    config.transport === 'zuri-api' || config.transport === 'line-poc' || config.transport === 'mock'
      ? { status: 'pass', value: config.transport }
      : { status: 'fail' };

  if (transportCheck.status === 'fail') {
    errors.push('ZURI_COMMAND_TRANSPORT must be zuri-api, line-poc, or mock');
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

/**
 * Is the LINE channel token supplied through the `_FILE` convention rather than inline?
 *
 * Asked of the raw environment, not of the resolved value: by the time `resolveSecret` has run,
 * a token read from a locked file and one pasted into `.env` are the same string, and the whole
 * point of BR-007 is the difference between them.
 */
function tokenIsFileBacked(env: NodeJS.ProcessEnv): boolean {
  // The question is whether a plaintext token is sitting in `.env`, so it is answered by the
  // absence of an inline value — not by the presence of a `_FILE` variable. Asking the latter let
  // a `_FILE` pointing anywhere, even at an empty file, vouch for an inline token right beside it.
  const inline = (env.LINE_CHANNEL_ACCESS_TOKEN || '').trim() || (env.LINE_POC_CHANNEL_ACCESS_TOKEN || '').trim();
  return !inline;
}

  const linePoc = {
    enabled: config.linePocEnabled || false,
    channelAccessTokenConfigured: Boolean(config.linePocChannelAccessToken),
    // BR-007: the credential that can speak to customers as the OA must come from a file the OS
    // restricts, not from `.env`. Reported rather than refused: a deployment that predates the
    // decision still works, it is just told, every time, that it is standing in the open.
    channelAccessTokenFromFile: tokenIsFileBacked(env),
    configuredGroupAliases: Object.keys(config.linePocGroupAliases || {}).sort(),
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (linePoc.channelAccessTokenConfigured && !linePoc.channelAccessTokenFromFile) {
    // Advisory, not a refusal: the settings page writes the token to `.env`, and that is the
    // supported way to configure a device (BR-007). This says the value is readable by anything
    // that can read the file, and that the `_FILE` form moves it behind OS permissions instead.
    warnings.push(
      'The LINE channel access token is stored in plaintext in .env. To keep it behind file ' +
        'permissions instead, point LINE_CHANNEL_ACCESS_TOKEN_FILE or ' +
        'LINE_POC_CHANNEL_ACCESS_TOKEN_FILE at a restricted file and remove the inline value.'
    );
  }

  if (config.transport === 'line-poc') {
    linePoc.status = linePoc.enabled && linePoc.channelAccessTokenConfigured && linePoc.configuredGroupAliases.length > 0
      ? 'pass'
      : 'fail';
    if (!linePoc.enabled) errors.push('LINE_POC_ENABLED=true is required for line-poc transport');
    if (!linePoc.channelAccessTokenConfigured) errors.push('LINE_POC_CHANNEL_ACCESS_TOKEN is missing');
    if (linePoc.configuredGroupAliases.length === 0) errors.push('At least one LINE_POC_GROUP_<ALIAS> binding is required');
  }

  const lineDmPoc = {
    enabled: config.lineDmPocEnabled || false,
    channelAccessTokenConfigured: Boolean(config.linePocChannelAccessToken),
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };
  if (config.lineDmPocEnabled) {
    lineDmPoc.status = config.lineWebhookEnabled && config.linePocEnabled && lineDmPoc.channelAccessTokenConfigured
      ? 'pass'
      : 'fail';
    if (!config.lineWebhookEnabled) errors.push('LINE_WEBHOOK_ENABLED=true is required for LINE direct-message POC');
    if (!config.linePocEnabled) errors.push('LINE_ENABLED=true or LINE_POC_ENABLED=true is required for LINE direct-message POC');
    if (!lineDmPoc.channelAccessTokenConfigured) errors.push('LINE_CHANNEL_ACCESS_TOKEN or LINE_POC_CHANNEL_ACCESS_TOKEN is missing for LINE direct-message POC');
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
        'ZURI_LLM_TIMEOUT_MS must stay at or under 25000: a LINE reply token expires after about 30 seconds'
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

  /*
   * The one combination that looks configured and cannot work: the headless layer needs tens of
   * seconds and a reply token lives about thirty, so without the queue every webhook answer is a
   * race the agent loses quietly.
   */
  if (config.headlessEnabled && config.lineWebhookEnabled && !config.outboxEnabled) {
    outbox.status = 'fail';
    errors.push(
      'ZURI_OUTBOX_ENABLED=true is required when ZURI_HEADLESS_ENABLED=true and the webhook is ' +
        'serving: answering outlasts the LINE reply token, so the answer must be pushed'
    );
  } else if (config.outboxEnabled) {
    outbox.status = outbox.leaseMs >= 30000 && outbox.maxAttempts >= 1 ? 'pass' : 'fail';
    if (outbox.leaseMs < 30000) {
      errors.push('ZURI_OUTBOX_LEASE_MS must be at least 30000, or slow answers get reclaimed mid-flight');
    }
    if (outbox.maxAttempts < 1) errors.push('ZURI_OUTBOX_MAX_ATTEMPTS must be at least 1');
  }

  /*
   * Edge extraction is checked the way the LLM layer is: reported always, required only
   * once someone has half-configured it. A device with neither value set is a device that
   * was never activated for this lane, which is not an error.
   *
   * The one genuine error is half a credential — a base URL with no key, or a key with no
   * base URL — because that reads as "activated" to an operator while polling nothing.
   * A missing vision model is a `warn`, not a `fail`: the worker still runs and still
   * reports each job as failed with a readable reason, which is more useful to the human
   * waiting in the console than a device that refuses to start.
   */
  const edgeExtraction = {
    enabled: Boolean(config.cloudBaseUrl && config.edgeDeviceKey),
    cloudBaseUrlConfigured: Boolean(config.cloudBaseUrl),
    deviceKeyConfigured: Boolean(config.edgeDeviceKey),
    pollMs: config.edgeExtractionPollMs || 0,
    concurrency: config.edgeExtractionConcurrency || 1,
    visionModel: config.edgeExtractionVisionModel || '',
    visionModelConfigured: Boolean(config.edgeExtractionVisionModel),
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (edgeExtraction.cloudBaseUrlConfigured !== edgeExtraction.deviceKeyConfigured) {
    edgeExtraction.status = 'fail';
    errors.push(
      'ZURI_CLOUD_BASE_URL and ZURI_EDGE_DEVICE_KEY must be set together: one without the ' +
        'other looks activated but claims nothing'
    );
  } else if (edgeExtraction.enabled) {
    edgeExtraction.status = edgeExtraction.visionModelConfigured ? 'pass' : 'warn';
  }

  const lineHistory = {
    enabled: config.lineWebhookEnabled || false,
    channelSecretConfigured: Boolean(config.lineChannelSecret),
    hashKeyConfigured: Boolean(config.lineHistoryHashKey),
    bindHost: config.lineWebhookBindHost || '127.0.0.1',
    root: config.lineHistoryRoot || 'state/line-history',
    retentionDays: config.lineHistoryRetentionDays || 0,
    allowedGroupAliases: config.lineHistoryAllowedGroupAliases || [],
    status: 'warn' as 'pass' | 'fail' | 'warn',
  };

  if (config.lineWebhookEnabled) {
    lineHistory.status = lineHistory.channelSecretConfigured && lineHistory.hashKeyConfigured &&
      lineHistory.retentionDays > 0 && lineHistory.allowedGroupAliases.length > 0
      ? 'pass'
      : 'fail';
    if (!lineHistory.channelSecretConfigured) errors.push('LINE_CHANNEL_SECRET is missing');
    if (!lineHistory.hashKeyConfigured) errors.push('LINE_HISTORY_HASH_KEY is missing');
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
    if (lineHistory.allowedGroupAliases.length === 0) errors.push('At least one LINE_HISTORY_GROUP_<ALIAS>=true setting is required');
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
      linePoc,
      lineDmPoc,
      llm,
      outbox,
      edgeExtraction,
      lineHistory,
    },
    errors,
  };
}
