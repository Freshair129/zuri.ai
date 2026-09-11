#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { AgentConfig, ConfigCheckResult, loadConfig, validateConfig } from '../config/index.js';
import { printJsonSuccess, printJsonError } from './output.js';
import { archiveOutboundLineMessage } from '../history/archive.js';
import { logDiagnostic, redactString } from '../safety/redact.js';
import { HttpZuriApiClient, IZuriApiClient, MockZuriApiClient, defaultMockStatePath } from '../zuri-api/client.js';
import { runPreview, runSend, runStatus, SUPPORTED_TEMPLATES } from './commands.js';
import { PRICE_QUOTE_USAGE, runPriceQuote } from './price.js';
import { runConversationCommand } from './conversation.js';
import { requireLegacyTransport } from '../conversation/contract.js';
import {
  EXTRACTION_USAGE,
  runExtractionOnceCommand,
  runExtractionServeCommand,
} from './extraction.js';
import { LinePocClient } from '../line-poc/client.js';
import { cardViewModelToFlex } from '../line-poc/flex.js';
import { buildCardForTemplate, validateCardViewModel } from '../cards/index.js';
import { createLineWebhookServer } from '../history/webhook-server.js';
import { startHeartbeat } from '../zuri-api/heartbeat.js';
import { createAdminSessions, generateAdminKey, hashAdminKey } from '../history/admin-auth.js';
import { applySavedConfig, upsertEnvValue } from '../config/reload.js';
import { resolvePushTarget } from '../line-poc/targets.js';
import { attachInboundMessageId } from '../delivery/outbox.js';
import { zuriStackFromEnv } from '../stack/stack-client.js';
import { answerConversation, answerMessage } from '../answer/respond.js';
import { LlmOptions } from '../answer/llm.js';
import { createModelPort } from '../answer/providers/index.js';
import { warmModel } from '../answer/providers/model-warmer.js';
import { createFallbackPort } from '../answer/providers/fallback.js';
import { HeadlessOptions, defaultSandboxRoot } from '../answer/headless.js';
import { OutboxOptions, enqueue, listIntents } from '../delivery/outbox.js';
import { startWorker } from '../delivery/worker.js';
import { ConversationOptions, conversationKey, pruneConversations } from '../answer/memory.js';
import { loadCatalog } from '../catalog/store.js';
import {
  ROLES,
  Role,
  approve,
  listIdentities,
  revoke,
} from '../identity/registry.js';
import {
  loadTaxonomyServingContext,
  serveTaxonomyPreview,
  TaxonomyServingError,
  type TaxonomyServingQueryInput,
} from '../rag/taxonomy-serving.js';
import { GenesisLocalRag } from '../rag/genesis-rag.js';
import { createGenesisRag17Runtime, wrapAnswerRag } from '../rag/genesisrag17/published-rag.js';

// @req FR-001 — `config check` validates local configuration, device identity and contract version.
// @req FR-002 — `health` reports registration, contract compatibility and last heartbeat.
// @req SDD-001 — the CLI entry point: command parsing, stdout/stderr and exit codes.
// @req AC-001 — config check exits non-zero on invalid config, identity, contract version or DuckDB access, and reports whether a secret is configured rather than what it is.
// @spec FR-093, FR-143, ADR-031 — zuri-ai's, referenced but not owned here.

/**
 * Production/default calls use the canonical Zuri HTTP contract. The persisted mock is available
 * only when explicitly selected with ZURI_COMMAND_TRANSPORT=mock.
 */
function getZuriApiClient(): IZuriApiClient {
  const config = loadConfig();
  if (config.transport === 'mock') return new MockZuriApiClient(defaultMockStatePath());
  return new HttpZuriApiClient({
    baseUrl: config.apiBaseUrl || '',
    deviceId: config.deviceId || '',
    deviceToken: config.deviceToken || '',
    // The heartbeat authenticates as a device, so it uses the device pair — the minted `edgk_` key
    // and the cloud origin that goes with it — rather than borrowing the command endpoints'
    // settings. Those endpoints are a different, unbuilt contract and keep baseUrl/deviceToken.
    deviceKey: config.edgeDeviceKey || '',
    cloudBaseUrl: config.cloudBaseUrl || '',
  });
}

interface ParsedFlags {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Minimal `--flag value` / `--flag` parser for the args following the command/subcommand.
 */
function parseFlags(args: string[]): ParsedFlags {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function handlePreview(template: string | undefined, rest: string[]): Promise<void> {
  if (!template) {
    printJsonError(
      'MISSING_TEMPLATE',
      `A <template> argument is required. Supported: ${SUPPORTED_TEMPLATES.join(', ')}`,
      undefined,
      1
    );
    return;
  }

  const { flags } = parseFlags(rest);
  logDiagnostic(`Running zuri-agent preview ${template}`);

  try {
    const client = getZuriApiClient();
    const job = await runPreview(client, template, {
      period: typeof flags.period === 'string' ? flags.period : undefined,
      limit: typeof flags.limit === 'string' ? parseInt(flags.limit, 10) : undefined,
    });
    printJsonSuccess(job);
  } catch (err) {
    printJsonError('PREVIEW_FAILED', err instanceof Error ? err.message : String(err), undefined, 1);
  }
}

async function handleSend(template: string | undefined, rest: string[]): Promise<void> {
  if (!template) {
    printJsonError(
      'MISSING_TEMPLATE',
      `A <template> argument is required. Supported: ${SUPPORTED_TEMPLATES.join(', ')}`,
      undefined,
      1
    );
    return;
  }

  const { flags } = parseFlags(rest);
  logDiagnostic(`Running zuri-agent send ${template}`);

  try {
    const client = getZuriApiClient();
    const job = await runSend(client, template, {
      group: typeof flags.group === 'string' ? flags.group : '',
      period: typeof flags.period === 'string' ? flags.period : undefined,
      limit: typeof flags.limit === 'string' ? parseInt(flags.limit, 10) : undefined,
    });
    printJsonSuccess(job);
  } catch (err) {
    printJsonError('SEND_FAILED', err instanceof Error ? err.message : String(err), undefined, 1);
  }
}

async function handleStatus(commandId: string | undefined): Promise<void> {
  logDiagnostic('Running zuri-agent status');

  try {
    const client = getZuriApiClient();
    const job = await runStatus(client, commandId || '');
    printJsonSuccess(job);
  } catch (err) {
    printJsonError('STATUS_FAILED', err instanceof Error ? err.message : String(err), undefined, 1);
  }
}

function handlePrice(subcommand: string | undefined, rest: string[]): void {
  if (subcommand !== 'quote') {
    printJsonError(
      'UNKNOWN_SUBCOMMAND',
      `Unsupported price subcommand: ${subcommand ?? '(none)'}. Only "quote" is available.`,
      PRICE_QUOTE_USAGE,
      1
    );
    return;
  }

  const { flags } = parseFlags(rest);
  logDiagnostic('Running zuri-agent price quote');

  try {
    printJsonSuccess(runPriceQuote(flags));
  } catch (err) {
    printJsonError(
      'PRICE_QUOTE_FAILED',
      err instanceof Error ? err.message : String(err),
      PRICE_QUOTE_USAGE,
      1
    );
  }
}

function handleConfigCheck(): void {
  logDiagnostic('Running zuri-agent config check');
  const result = validateConfig();
  if (result.valid) {
    printJsonSuccess(result);
  } else {
    printJsonError('CONFIG_INVALID', 'Local configuration or environment check failed', result, 1);
  }
}

export interface HealthReport {
  agentId: string;
  contractVersion: string;
  status: 'configured' | 'degraded';
  transport: AgentConfig['transport'] | undefined;
  capabilities: string[];
  registeredQueries: string[];
  approvedTemplates: string[];
  lastHeartbeat: string;
  configStatus: ConfigCheckResult;
}

/**
 * The decision logic behind `health`, separated from printing it.
 *
 * `handleHealth` exists to be run as a CLI subcommand — it writes to stdout and, on the CLI's
 * general error path, can exit the process. Neither is safe to trigger from inside a shared test
 * run, which is exactly why FR-002 had no test at this level before: there was no way to reach
 * the decision (`configured` vs `degraded`, which capabilities are reported) without also
 * reaching the side effect. Split apart, this half is a pure function of the environment.
 */
export function buildHealthReport(env?: NodeJS.ProcessEnv): HealthReport {
  const configResult = validateConfig(env);
  return {
    agentId: 'zuri.command-agent',
    contractVersion: '0.1.0b',
    status: configResult.valid ? 'configured' : 'degraded',
    transport: loadConfig(env).transport,
    capabilities: [
      'bridge.health',
      'bridge.claim',
      'duckdb.execute',
      'evidence.submit',
      'preview.open',
    ],
    registeredQueries: [
      'executive_summary.v1',
      'channel_performance.v1',
      'campaign_breakdown.v1',
      'approval_queue.v1',
    ],
    approvedTemplates: [
      'executive-summary.v1',
      'channel-performance.v1',
      'campaign-breakdown.v1',
      'actions-approval-queue.v1',
    ],
    lastHeartbeat: new Date().toISOString(),
    configStatus: configResult,
  };
}

function handleHealth(): void {
  logDiagnostic('Running zuri-agent health check');
  printJsonSuccess(buildHealthReport());
}

interface PocCardContent {
  title?: string;
  subtitle?: string;
  sourceLabel?: string;
  asOf?: string;
  riskFlags?: string[];
  items?: Record<string, unknown>[];
  ctaButtons?: Array<{ label: string; uri: string; type: 'uri' }>;
}

/**
 * Loads the bounded card copy for `poc send` from a local JSON file. Without `--content-file`
 * the builder keeps its own default checklist. The card still passes `validateCardViewModel`,
 * so the template allow-list and the CTA domain allow-list continue to apply.
 */
function readPocContentFile(value: string | boolean | undefined): PocCardContent {
  if (typeof value !== 'string' || value.length === 0) return {};
  const parsed: unknown = JSON.parse(readFileSync(value, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`--content-file must contain a JSON object: ${value}`);
  }
  return parsed as PocCardContent;
}


type LoadedConfig = ReturnType<typeof loadConfig>;

/** Where the 1:1 identity register lives, keyed with the same secret the archive uses. */
function identityOptions(config: LoadedConfig) {
  return {
    root: config.lineIdentityRoot || 'state/line-identity',
    hashKey: config.lineHistoryHashKey || '',
  };
}

/** Where a person's last few turns live, and for how long. */
function memoryOptions(config: LoadedConfig): ConversationOptions {
  return {
    root: config.chatMemoryRoot || 'state/line-chat',
    hashKey: config.lineHistoryHashKey || '',
    retentionHours: config.chatRetentionHours || 24,
  };
}

/**
 * The model layer, or null. Null is a supported state, not a failure: the pattern-based reader
 * answers on its own, so a missing key costs conversational range and nothing else.
 */
function llmOptions(config: LoadedConfig): LlmOptions | null {
  if (!config.llmEnabled) return null;

  // A base URL means a model on the business's own hardware; no base URL means the hosted API;
  // neither means no model, which is a supported state — the deterministic reader still answers.
  const baseUrl = config.llmBaseUrl || '';

  /*
   * Reaching a hosted API is a decision, not a consequence of a missing value.
   *
   * This used to fall through to the hosted provider whenever the base URL was absent, so an
   * ANTHROPIC_API_KEY parked in `.env` for a future policy change would have started answering
   * customers the moment someone cleared or mistyped ZURI_LLM_BASE_URL — silently, and against
   * ADR-031 0.3.0b, which permits an EDGE account a local model but no cloud fallback. The key can
   * now sit there safely; turning it on is one deliberate line rather than an accident.
   */
  if (!baseUrl && !config.llmAllowCloud) return null;

  const provider = baseUrl ? 'openai-compatible' : 'anthropic';
  if (provider === 'anthropic' && !config.anthropicApiKey) return null;

  const shared = {
    provider,
    effort: config.llmEffort || 'low',
    apiKey: config.anthropicApiKey || undefined,
    baseUrl: baseUrl || undefined,
    numCtx: baseUrl ? config.llmNumCtx : undefined,
  } as const;
  const core = createModelPort({
    ...shared,
    model: config.llmModel || (provider === 'anthropic' ? 'claude-opus-5' : 'llama3.1'),
  });

  // A second model is only worth having where it can actually be reached — locally.
  // It is not resident (this hardware fits one model at a time), so it costs a cold
  // load and exists for a broken core model, not for speed.
  const port = baseUrl && config.llmFallbackModel
    ? createFallbackPort({
      core,
      fallback: createModelPort({ ...shared, model: config.llmFallbackModel }),
      onFallback: (info) => logDiagnostic('model-fallback', { ...info }),
    })
    : core;

  return {
    port,
    timeoutMs: config.llmTimeoutMs || 12000,
    maxIterations: config.llmMaxIterations || 4,
  };
}

/**
 * The subscription-backed path, or null.
 *
 * The MCP server it points at is the built one under `dist/`, resolved from this file's own
 * location: the child process is started somewhere outside the repository, so a relative path
 * would not find it.
 */
function headlessOptions(config: LoadedConfig): HeadlessOptions | null {
  if (!config.headlessEnabled) return null;
  return {
    bin: config.headlessBin || 'claude',
    model: config.headlessModel || 'claude-sonnet-5',
    maxTurns: config.headlessMaxTurns || 8,
    timeoutMs: config.headlessTimeoutMs || 120000,
    mcpServerPath: fileURLToPath(new URL('../mcp/pricing-server.js', import.meta.url)),
    sandboxRoot: config.headlessSandboxRoot || defaultSandboxRoot(),
    sessionRoot: config.headlessSessionRoot || 'state/agent-sessions',
    sessionRetentionHours: config.headlessSessionRetentionHours || 168,
    catalogRoot: config.catalogRoot || 'state/catalog',
    exchangeRate: config.exchangeRateThbPerRmb || 5,
    webSearch: config.headlessWebSearch === true,
    fileAuthoring: config.headlessFileAuthoring === true,
  };
}

/** Where queued questions wait, and how patient the queue is about them. */
function outboxOptions(config: LoadedConfig): OutboxOptions {
  return {
    root: config.outboxRoot || 'state/outbox',
    leaseMs: config.outboxLeaseMs || 180000,
    maxAttempts: config.outboxMaxAttempts || 3,
    retentionHours: config.outboxRetentionHours || 48,
    quarantineQuestionRetentionHours: config.outboxQuarantineQuestionRetentionHours || 168,
  };
}

function dmClient(config: LoadedConfig): LinePocClient {
  return new LinePocClient({
    channelAccessToken: config.linePocChannelAccessToken || '',
    groupAliases: {},
  });
}

/**
 * `zuri-agent identity <list|approve|revoke>` — the approval desk for 1:1 chats.
 *
 * Approval is a person's decision, so it is a deliberate command rather than anything the bot can
 * do for itself. The register only ever holds hashed LINE ids, which is why approve and revoke
 * take the hash shown by `list` rather than a LINE user id.
 */
function handleIdentity(subcommand: string | undefined, rest: string[]): void {
  const config = loadConfig();
  const options = identityOptions(config);
  if (!options.hashKey) {
    printJsonError(
      'IDENTITY_HASH_KEY_MISSING',
      'Set LINE_HISTORY_HASH_KEY before using the identity register.',
      undefined,
      1
    );
    return;
  }

  const { flags } = parseFlags(rest);
  try {
    if (subcommand === 'list') {
      const all = listIdentities(options);
      const status = typeof flags.status === 'string' ? flags.status : undefined;
      printJsonSuccess({
        total: all.length,
        identities: (status ? all.filter((i) => i.status === status) : all).map((i) => ({
          userIdHash: i.userIdHash,
          displayName: i.displayName,
          status: i.status,
          role: i.role,
          email: i.email,
          firstSeenAt: i.firstSeenAt,
          decidedAt: i.decidedAt,
        })),
      });
      return;
    }

    if (subcommand === 'approve') {
      const hash = typeof flags.hash === 'string' ? flags.hash : '';
      const role = typeof flags.role === 'string' ? (flags.role as Role) : '';
      const email = typeof flags.email === 'string' ? flags.email : '';
      const by = typeof flags.by === 'string' ? flags.by : 'cli';
      if (!hash) throw new Error('The --hash <userIdHash> flag is required. Run `identity list` to see it.');
      if (!ROLES.includes(role as Role)) {
        throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
      }
      if (!email) throw new Error('The --email <address> flag is required, so the register maps to a person.');
      printJsonSuccess(approve(hash, role as Role, email, by, options));
      return;
    }

    if (subcommand === 'revoke') {
      const hash = typeof flags.hash === 'string' ? flags.hash : '';
      const by = typeof flags.by === 'string' ? flags.by : 'cli';
      if (!hash) throw new Error('The --hash <userIdHash> flag is required.');
      printJsonSuccess(revoke(hash, by, options));
      return;
    }

    throw new Error(
      'Use `identity list [--status pending]`, ' +
        '`identity approve --hash <h> --role <owner|sales> --email <address>`, or ' +
        '`identity revoke --hash <h>`.'
    );
  } catch (err) {
    printJsonError('IDENTITY_FAILED', err instanceof Error ? err.message : String(err), undefined, 1);
  }
}

/**
 * `zuri-agent chat --text "..."` — the same answer path a LINE message takes, without LINE.
 *
 * This exists so the conversational layer can be exercised and reviewed before anything reaches a
 * customer: it reports which path answered and which tools were called, which the reply itself
 * deliberately does not.
 */
async function handleChat(subcommand: string | undefined, rest: string[]): Promise<void> {
  const { flags } = parseFlags(rest);
  const config = loadConfig();

  if (subcommand === 'prune') {
    printJsonSuccess({
      removed: pruneConversations(memoryOptions(config)),
      retentionHours: config.chatRetentionHours || 24,
    });
    return;
  }

  if (subcommand !== 'say') {
    printJsonError(
      'UNSUPPORTED_CHAT_SUBCOMMAND',
      `Unsupported chat subcommand: ${subcommand ?? '(none)'}. Use "say" or "prune".`,
      { usage: 'zuri-agent chat say --text "<message>" [--role owner|sales] [--who <label>]' },
      1
    );
    return;
  }

  const text = typeof flags.text === 'string' ? flags.text : '';
  if (!text) {
    printJsonError('CHAT_TEXT_REQUIRED', 'The --text "<message>" flag is required.', undefined, 1);
    return;
  }

  const role: Role = flags.role === 'owner' ? 'owner' : 'sales';
  const hashKey = config.lineHistoryHashKey || '';
  if (!hashKey) {
    printJsonError(
      'IDENTITY_HASH_KEY_MISSING',
      'Set LINE_HISTORY_HASH_KEY before using chat: the conversation key is derived from it.',
      undefined,
      1
    );
    return;
  }

  const who = typeof flags.who === 'string' ? flags.who : 'cli-local';
  const result = await answerConversation(text, {
    catalog: loadCatalog(config.catalogRoot || 'state/catalog'),
    role,
    exchangeRate: config.exchangeRateThbPerRmb || 5,
    rag: new GenesisLocalRag({ apiUrl: process.env.GENESIS_RAG_API_URL }),
    conversationKey: conversationKey(who, hashKey),
    memory: memoryOptions(config),
    llm: llmOptions(config),
    headless: headlessOptions(config),
  });

  printJsonSuccess({
    role,
    source: result.source,
    ...(result.reason ? { reason: result.reason } : {}),
    toolCalls: result.toolCalls,
    reply: result.text,
  });
}

async function handlePoc(subcommand: string | undefined, rest: string[]): Promise<void> {
  requireLegacyTransport();
  const { flags } = parseFlags(rest);
  const config = loadConfig();
  const configCheck = validateConfig();
  if (config.transport !== 'line-poc' || !configCheck.valid) {
    printJsonError(
      'LINE_POC_DISABLED',
      'Complete the required line-poc fields in local .env first.',
      configCheck,
      1
    );
    return;
  }

  const client = new LinePocClient({
    channelAccessToken: config.linePocChannelAccessToken || '',
    groupAliases: config.linePocGroupAliases || {},
  });
  const group = typeof flags.group === 'string' ? flags.group : '';

  try {
    if (subcommand === 'verify') {
      if (!group) throw new Error('The --group <alias> flag is required.');
      printJsonSuccess(await client.verifyGroupAlias(group));
      return;
    }

    /*
     * `poc text` answers in words. The Flex templates are fixed-shape checklists — they cannot
     * carry an ordinary written reply — so a question asked in prose needs this path.
     * The message is read from a file so nothing is retyped between review and send.
     */
    if (subcommand === 'text') {
      if (!group) throw new Error('The --group <alias> flag is required.');
      const file = flags['message-file'];
      if (typeof file !== 'string' || file.length === 0) {
        throw new Error('The --message-file <path> flag is required.');
      }
      const message = readFileSync(file, 'utf8').trim();
      if (!message) throw new Error(`--message-file is empty: ${file}`);

      if (flags['dry-run'] === true) {
        printJsonSuccess({
          lifecycle: 'PREVIEW_ONLY',
          groupAlias: group,
          characters: message.length,
          message,
        });
        return;
      }
      printJsonSuccess({
        lifecycle: 'ACCEPTED_BY_LINE',
        receipt: await client.pushText(group, message),
        characters: message.length,
      });
      return;
    }

    if (subcommand === 'send') {
      const template = rest[0];
      if (template !== 'information-request') {
        throw new Error('LINE POC permits only the bounded information-request template; KPI cards require governed Zuri evidence.');
      }
      if (!group) throw new Error('The --group <alias> flag is required.');

      const content = readPocContentFile(flags['content-file']);
      const card = buildCardForTemplate('information-request', content.items || [], {
        operationalState: 'snapshot',
        sourceLabel: content.sourceLabel || 'SmartGift DuckDB schema audit',
        asOf: content.asOf,
        title: content.title,
        subtitle: content.subtitle,
        riskFlags: content.riskFlags,
        ctaButtons: content.ctaButtons,
      });
      const validation = validateCardViewModel(card);
      if (!validation.valid) throw new Error(`POC card validation failed: ${validation.errors.join('; ')}`);

      const altText = `Zuri: ${card.title}`.slice(0, 400);
      const flex = cardViewModelToFlex(card);

      // `--dry-run` renders the exact payload for review without calling the LINE push API.
      if (flags['dry-run'] === true) {
        printJsonSuccess({ lifecycle: 'PREVIEW_ONLY', groupAlias: group, altText, card, flex });
        return;
      }

      const receipt = await client.pushFlex(group, altText, flex);
      printJsonSuccess({
        lifecycle: 'ACCEPTED_BY_LINE',
        receipt,
        card: { templateId: card.templateId, title: card.title, operationalState: card.operationalState, asOf: card.asOf },
      });
      return;
    }

    throw new Error(
      'Unsupported poc command. Use `poc verify --group <alias>`, ' +
        '`poc text --group <alias> --message-file <path> [--dry-run]`, or ' +
        '`poc send information-request --group <alias> [--content-file <path>] [--dry-run]`.'
    );
  } catch (error) {
    printJsonError('LINE_POC_FAILED', error instanceof Error ? error.message : String(error), undefined, 1);
  }
}

/**
 * What this device should tell the cloud about itself.
 *
 * The heartbeat used to report `healthy` unconditionally, which made the console's Edge tab a
 * check that a process exists rather than a check that it works. The case is not theoretical: the
 * ollama server died while its tray app kept running, every answer silently fell back to the
 * pattern reader, and the device stayed green throughout.
 *
 * Only the webhook's own listener makes this `unavailable` — if that is gone there is nothing
 * serving LINE at all. A missing dependency is `degraded`: the device still accepts and answers,
 * just less well, and calling that "unavailable" would train whoever reads the tab to ignore it.
 */
async function probeEdgeStatus(
  server: { listening: boolean },
  config: ReturnType<typeof loadConfig>,
): Promise<'healthy' | 'degraded' | 'unavailable'> {
  if (!server.listening) return 'unavailable';

  const answers = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  };

  // Same source the graph proxy reads it from; it is not part of the typed config today.
  const ragBase = (process.env.GENESIS_RAG_API_URL || 'http://127.0.0.1:8888').replace(/\/+$/, '');
  const checks = [answers(`${ragBase}/health`)];
  // The model host is only a dependency when the model layer is switched on; with it off, the
  // pattern reader is the intended answer path rather than a fallback.
  if (config.llmEnabled && config.llmBaseUrl) {
    checks.push(answers(`${config.llmBaseUrl.replace(/\/v1\/?$/, '')}/api/tags`));
  }
  const results = await Promise.all(checks);
  return results.every(Boolean) ? 'healthy' : 'degraded';
}

async function handleWebhook(subcommand: string | undefined): Promise<void> {
  requireLegacyTransport();
  if (subcommand !== 'serve') {
    printJsonError('UNKNOWN_SUBCOMMAND', 'Use `zuri-agent webhook serve`.', undefined, 1);
    return;
  }
  const config = loadConfig();
  const configCheck = validateConfig();
  const stackReplyRequested = process.env.ZURI_STACK_REPLY_ENABLED === 'true';
  let stack;
  try {
    stack = zuriStackFromEnv();
  } catch (error) {
    printJsonError(
      'ZURI_STACK_REPLY_CONFIGURATION_INVALID',
      error instanceof Error ? error.message : 'Invalid Zuri stack binding configuration.',
      undefined,
      1
    );
    return;
  }
  if (stackReplyRequested && (!stack || !config.linePocChannelAccessToken)) {
    printJsonError(
      'ZURI_STACK_REPLY_CONFIGURATION_INVALID',
      'Binding-only Zuri stack configuration and the LINE channel access token are required.',
      undefined,
      1
    );
    return;
  }
  if (!config.lineWebhookEnabled || !configCheck.valid) {
    printJsonError(
      'LINE_WEBHOOK_DISABLED',
      'Complete and enable the LINE webhook archive settings in local .env first.',
      configCheck,
      1
    );
    return;
  }

  // The LINE agent's own door into the catalog graph — HTTP only, per §5.8. This process must
  // never open a GenesisBlock store directly (AC-D4): the old `/api/graph` debug route read the
  // native store in-process via the graph-viewer module, which the ADR guard now forbids
  // importing from anywhere the agent's own message path can reach. That route (and its native
  // import) is gone; the live graph visualisation is the MCP server's concern, a separate process.
  // FR-189 (ADR-075 D7): the same mode switch as the compute worker. `off` (the default) returns the
  // v4 door itself; `shadow`/`primary` refuse to start the webhook without their prerequisites.
  const genesisRag = wrapAnswerRag(new GenesisLocalRag({ apiUrl: process.env.GENESIS_RAG_API_URL }), createGenesisRag17Runtime());
  /*
   * The config surface needs an operator key before it can be reached from anywhere but this
   * console. Minted on first run rather than demanded up front, because a device that refuses to
   * start until someone invents a password is a device that gets started with the check removed.
   * The key is printed once, here, and only its hash is written to `.env`.
   */
  let adminKeyHash = config.adminKeyHash;
  if (!adminKeyHash) {
    const key = generateAdminKey();
    adminKeyHash = hashAdminKey(key);
    upsertEnvValue('ZURI_EDGE_ADMIN_KEY_HASH', adminKeyHash);
    console.log(
      `
[zuri-edge] An operator key was generated for the settings page. It is shown once:

    ${key}

` +
        `[zuri-edge] Keep it somewhere you can find it. Only its hash is stored; losing it means clearing
` +
        `[zuri-edge] ZURI_EDGE_ADMIN_KEY_HASH from .env and restarting to mint another.
`
    );
  }
  const adminSessions = createAdminSessions();

  const serverOptions: Parameters<typeof createLineWebhookServer>[0] = {
    transportOwner: 'LEGACY_EDGE',
    port: config.lineWebhookPort || 8787,
    channelSecret: config.lineChannelSecret || '',
    historyRoot: config.lineHistoryRoot || 'state/line-history',
    historyHashKey: config.lineHistoryHashKey || '',
    retentionDays: config.lineHistoryRetentionDays || 30,
    dmRetentionDays: config.lineHistoryDmRetentionDays || 7,
    groupAliases: config.linePocGroupAliases || {},
    allowedGroupAliases: config.lineHistoryAllowedGroupAliases || [],
    admin: { keyHash: adminKeyHash, sessions: adminSessions },
    onConfigSaved: () => applySavedConfig(config, serverOptions),
    /*
     * Record the row ids the cloud created for the events just forwarded, so the worker can quote
     * one back when it reports what the customer received (FR-093). Nothing here when no cloud is
     * bound: the forward never happens, so this never fires.
     */
    onInboundForwarded: (raw) => {
      if (!config.outboxEnabled) return;
      const results = (raw as { results?: Array<{ eventId?: string; inboundMessageId?: string }> })?.results;
      if (!Array.isArray(results)) return;
      for (const entry of results) {
        if (!entry?.eventId || !entry?.inboundMessageId) continue;
        attachInboundMessageId(outboxOptions(config), entry.eventId, entry.inboundMessageId);
      }
    },
    ...(stack
      ? {
          stack: {
            ...stack,
            ...(stack.replyEnabled
              ? { replyText: (replyToken: string, text: string) => dmClient(config).replyText(replyToken, text) }
              : {}),
          },
        }
      : {}),
    ...(config.lineDmPocEnabled
      ? {
          directMessages: {
            enabled: true,
            identity: identityOptions(config),
            replyText: (replyToken: string, text: string) =>
              dmClient(config).replyText(replyToken, text),
            /*
             * The console names a recipient in its request body, so the recipient is resolved
             * against what the owner configured rather than trusted. This used to cast past
             * `private` to reach the group path for anything that did not look like a user id,
             * which meant a group id pasted into a request was a message sent to that group.
             */
            pushText: (target: string, text: string) => {
              const resolved = resolvePushTarget(target, config.linePocGroupAliases || {});
              if (!resolved) {
                return Promise.reject(
                  new Error(`Refusing to push to "${redactString(target)}": not a signed user id or a configured group.`)
                );
              }
              const client = dmClient(config);
              return resolved.kind === 'user'
                ? client.pushTextToUser(resolved.id, text)
                : client.pushText(resolved.alias, text);
            },
            answer: async (text: string, role, key: string) => {
              console.log(`[LINE Inbound] Received question: "${text}" from key: ${key}`);
              // No pre-fetched catalog context is concatenated into `text` here (AC-D1/D4): every
              // product fact the model gives back must come from a recorded tool call through
              // `EvidenceOptions.rag`, not from a string spliced onto the person's own message.
              const result = await answerConversation(text, {
                catalog: loadCatalog(config.catalogRoot || 'state/catalog'),
                role,
                exchangeRate: config.exchangeRateThbPerRmb || 5,
                rag: genesisRag,
                conversationKey: key,
                memory: memoryOptions(config),
                llm: llmOptions(config),
                headless: headlessOptions(config),
              });
              logDiagnostic('answer', {
                source: result.source,
                ...(result.reason ? { reason: result.reason } : {}),
                toolCalls: result.toolCalls,
              });
              return result.text;
            },
            getDisplayName: (userId: string) => dmClient(config).getDisplayName(userId),
            ...(config.outboxEnabled
              ? { enqueue: (input) => enqueue(outboxOptions(config), input) }
              : {}),
          },
        }
      : {}),
  };
  const server = createLineWebhookServer(serverOptions);

  /*
   * The worker runs beside the server rather than as its own process. One machine, one queue, and
   * a second process would only add a way for the two to disagree about who owns a claim.
   */
  const stopWorker = config.outboxEnabled
    ? startWorker(
        {
          outbox: outboxOptions(config),
          answer: async (question, role, key) => {
            const result = await answerConversation(question, {
              catalog: loadCatalog(config.catalogRoot || 'state/catalog'),
              role,
              exchangeRate: config.exchangeRateThbPerRmb || 5,
              rag: genesisRag,
              conversationKey: key,
              memory: memoryOptions(config),
              llm: llmOptions(config),
              headless: headlessOptions(config),
            });
            logDiagnostic('answer', {
              source: result.source,
              ...(result.reason ? { reason: result.reason } : {}),
              toolCalls: result.toolCalls,
            });
            return result.text;
          },
          push: (recipientId, text) => dmClient(config).pushTextToUser(recipientId, text),
          // Present only when a cloud binding is configured; without one there is nobody to report
          // to, and the worker says so per delivery rather than failing.
          ...(stack?.reportDelivery
            ? {
                reportDelivery: (receipt: { inboundMessageId: string; text: string; source: 'STACK' | 'TRANSPORT_FALLBACK' }) =>
                  stack.reportDelivery!([receipt], undefined, undefined),
              }
            : {}),
          /*
           * BR-010. Every place a message leaves this runtime offers it to the archive, and the
           * archive decides whether it has somewhere honest to file it — today, only an
           * allow-listed group. The queue currently carries direct messages only (the webhook
           * enqueues on `source.type === 'user'`), so this offer is declined every time. It is
           * wired anyway: the alternative is a send site the archive cannot see, which is how the
           * outbound half went unrecorded in the first place. When the archive learns to file
           * direct messages, this starts filing without anyone having to find it.
           */
          recordOutbound: (sent) => {
            try {
              archiveOutboundLineMessage(
                {
                  recipientId: sent.recipientId,
                  text: sent.text,
                  deliveryKind: 'push',
                  inReplyToEventId: sent.inReplyToEventId,
                },
                {
                  root: config.lineHistoryRoot || 'state/line-history',
                  groupAliases: config.linePocGroupAliases || {},
                  allowedGroupAliases: config.lineHistoryAllowedGroupAliases || [],
                  hashKey: config.lineHistoryHashKey || '',
                  retentionDays: config.lineHistoryRetentionDays || 30,
                  dmRetentionDays: config.lineHistoryDmRetentionDays || 7,
                }
              );
            } catch (error) {
              console.error('[Outbound Archive Error]', error);
            }
          },
          onEvent: (event) => logDiagnostic('outbox', { ...event }),
        },
        config.outboxPollMs || 2000
      )
    : null;

  /*
   * Report liveness for as long as this process is the thing LINE talks to.
   *
   * It lives here rather than in the launcher because the launcher's report would be a claim about
   * a process it started and then stopped watching. What the cloud's Edge tab should reflect is
   * whether the webhook is still serving, and that is only knowable from inside it.
   *
   * Silent when the device pair is not configured: a machine with no minted credential has nothing
   * to announce, and 401ing every 40 seconds would be noise, not information.
   */
  /*
   * Started from inside `listen`, below, rather than here. The first beat fires immediately, and
   * from this point the socket is not bound yet — so the probe read `server.listening` as false and
   * announced `unavailable` on every single startup, which zuri-ai then recorded as a status
   * transition. Reporting liveness before there is any is worse than reporting it a moment later.
   */
  let stopHeartbeat: (() => void) | null = null;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopHeartbeat?.();
      stopWorker?.();
      server.close(() => process.exit(0));
    });
  }

  // Pin the model before the first customer arrives. Cold load on this hardware runs
  // 21-91s while a LINE reply token dies at ~30s, so an unpinned first message does
  // not get a late answer — it gets none. Fire-and-forget: the server must start
  // whether or not the model host is up, and an un-warmed model still answers, just
  // slowly enough that the ack-and-push path takes over.
  if (config.llmEnabled && config.llmBaseUrl) {
    void warmModel({ nativeBaseUrl: config.llmBaseUrl, model: config.llmModel || '', numCtx: config.llmNumCtx }).then((result) =>
      logDiagnostic('model-warm', {
        model: config.llmModel,
        pinned: result.pinned,
        ms: result.ms,
        ...(result.reason ? { reason: result.reason } : {}),
      })
    );
  }

  server.listen(config.lineWebhookPort || 8787, config.lineWebhookBindHost || '127.0.0.1', () => {
    if (config.cloudBaseUrl && config.edgeDeviceKey) {
      stopHeartbeat = startHeartbeat({
        client: getZuriApiClient(),
        deviceId: config.deviceId || '',
        intervalMs: config.heartbeatIntervalMs,
        status: () => probeEdgeStatus(server, config),
        onEvent: (event) => logDiagnostic('heartbeat', { ...event }),
      });
    }
    printJsonSuccess({
      status: 'listening',
      modelPinned: Boolean(config.llmEnabled && config.llmBaseUrl),
      endpoint: `http://${config.lineWebhookBindHost || '127.0.0.1'}:${config.lineWebhookPort || 8787}/webhook/line`,
      retentionDays: config.lineHistoryRetentionDays || 30,
    dmRetentionDays: config.lineHistoryDmRetentionDays || 7,
      allowedGroupAliases: config.lineHistoryAllowedGroupAliases || [],
      directMessagePocEnabled: config.lineDmPocEnabled,
      outboxEnabled: Boolean(config.outboxEnabled),
    });
  });
}

/** `zuri-agent outbox list` — what is queued, what failed, and what nobody ever answered. */
function handleOutbox(subcommand: string | undefined): void {
  const config = loadConfig();
  if (subcommand !== 'list') {
    printJsonError(
      'UNSUPPORTED_OUTBOX_SUBCOMMAND',
      `Unsupported outbox subcommand: ${subcommand ?? '(none)'}. Only "list" is available.`,
      undefined,
      1
    );
    return;
  }

  const intents = listIntents(outboxOptions(config));
  printJsonSuccess({
    total: intents.length,
    byStatus: intents.reduce<Record<string, number>>((counts, i) => {
      counts[i.status] = (counts[i.status] || 0) + 1;
      return counts;
    }, {}),
    /* Never the question text: this is an operations view, not a transcript. */
    intents: intents.map((i) => ({
      idempotencyKey: i.idempotencyKey,
      conversationKey: i.conversationKey,
      status: i.status,
      attempts: i.attempts,
      recipientRedacted: i.recipientRedacted,
      updatedAt: i.updatedAt,
      ...(i.lastError ? { lastError: i.lastError } : {}),
    })),
  });
}

/** `zuri-agent taxonomy preview` — bounded, non-authoritative taxonomy evidence. */
async function handleTaxonomy(subcommand: string | undefined, rest: string[]): Promise<void> {
  if (subcommand !== 'preview') {
    printJsonError(
      'UNSUPPORTED_TAXONOMY_SUBCOMMAND',
      `Unsupported taxonomy subcommand: ${subcommand ?? '(none)'}. Only "preview" is available.`,
      undefined,
      1
    );
    return;
  }

  const { flags } = parseFlags(rest);
  const input: TaxonomyServingQueryInput = {
    ...(typeof flags.query === 'string' ? { query: flags.query } : {}),
    ...(typeof flags.category === 'string'
      ? { categoryId: flags.category }
      : typeof flags.categoryId === 'string'
        ? { categoryId: flags.categoryId }
        : {}),
    ...(flags.limit !== undefined
      ? { limit: typeof flags.limit === 'string' ? Number(flags.limit) : Number.NaN }
      : {}),
    ...(flags['exclude-review'] === true ? { includeReview: false } : {}),
  };

  try {
    const context = loadTaxonomyServingContext();
    printJsonSuccess(
      serveTaxonomyPreview(
        context.catalog,
        context.report,
        context.projectionManifest,
        input
      )
    );
  } catch (error) {
    const code = error instanceof TaxonomyServingError
      ? error.code
      : 'TAXONOMY_PROJECTION_UNAVAILABLE';
    printJsonError(
      code,
      error instanceof Error ? error.message : String(error),
      { surface: 'cli', mode: 'preview' },
      1
    );
  }
}

/**
 * Edge-executed evidence extraction (the cloud's FR-143 lane).
 *
 * `serve` runs the loop until a signal; `once` claims at most one job and exits, which is
 * the smoke test an operator runs straight after pasting a credential.
 */
async function handleExtraction(subcommand: string | undefined, _rest: string[]): Promise<void> {
  if (subcommand === 'serve') {
    logDiagnostic('Running zuri-agent extraction serve');
    await runExtractionServeCommand();
    return;
  }
  if (subcommand === 'once') {
    logDiagnostic('Running zuri-agent extraction once');
    await runExtractionOnceCommand();
    return;
  }
  printJsonError(
    'UNKNOWN_SUBCOMMAND',
    `Unsupported extraction subcommand: ${subcommand ?? '(none)'}. Use "serve" or "once".`,
    EXTRACTION_USAGE,
    1
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (command === 'config' && subcommand === 'check') {
    handleConfigCheck();
    return;
  }

  if (command === 'health') {
    handleHealth();
    return;
  }

  if (command === 'preview') {
    await handlePreview(subcommand, args.slice(2));
    return;
  }

  if (command === 'send') {
    await handleSend(subcommand, args.slice(2));
    return;
  }

  if (command === 'status') {
    await handleStatus(subcommand);
    return;
  }

  if (command === 'price') {
    handlePrice(subcommand, args.slice(2));
    return;
  }

  if (command === 'poc') {
    await handlePoc(subcommand, args.slice(2));
    return;
  }

  if (command === 'outbox') {
    handleOutbox(subcommand);
    return;
  }

  if (command === 'taxonomy') {
    await handleTaxonomy(subcommand, args.slice(2));
    return;
  }

  if (command === 'chat') {
    await handleChat(subcommand, args.slice(2));
    return;
  }

  if (command === 'identity') {
    handleIdentity(subcommand, args.slice(2));
    return;
  }

  if (command === 'webhook') {
    await handleWebhook(subcommand);
    return;
  }

  if (command === 'conversation') {
    await runConversationCommand(subcommand);
    return;
  }

  if (command === 'extraction') {
    await handleExtraction(subcommand, args.slice(2));
    return;
  }

  if (!command || command === '--help' || command === '-h') {
    logDiagnostic('Showing zuri-agent CLI usage');
    printJsonSuccess({
      name: 'zuri-agent',
      version: '0.2.0b',
      description: 'Zuri Command Agent Local CLI & Bridge Worker',
      usage: 'zuri-agent <command> [subcommand] [options]',
      availableCommands: [
        'config check',
        'health',
        'preview <template> [--period <p>] [--limit <n>]',
        'send <template> --group <alias> [--period <p>] [--limit <n>]',
        'status <command-id>',
        PRICE_QUOTE_USAGE.usage,
        'poc verify --group <alias>',
        'poc send information-request --group <alias> [--content-file <path>] [--dry-run]',
        'webhook serve (requires ZURI_LINE_TRANSPORT_OWNER=LEGACY_EDGE)',
        'conversation serve',
        'conversation once',
        'extraction serve',
        'extraction once',
        'chat say --text "<message>" [--role owner|sales] [--who <label>]',
        'chat prune',
        'outbox list',
        'taxonomy preview [--query <text>] [--category <id>] [--limit <n>] [--exclude-review]',
        'identity list [--status pending]',
        'identity approve --hash <h> --role <owner|sales> --email <address>',
        'identity revoke --hash <h>',
      ],
      supportedTemplates: SUPPORTED_TEMPLATES,
      priceQuoteFlags: { required: PRICE_QUOTE_USAGE.required, optional: PRICE_QUOTE_USAGE.optional },
      notes: [
        'preview/send/status use the canonical Zuri HTTP client by default. Set ZURI_COMMAND_TRANSPORT=mock only for local contract tests.',
        'poc is an explicit local-only LINE demonstration transport. A successful push means accepted by LINE, not confirmed display or read receipt.',
        'price quote is a local calculation from supplied cost and carton figures. It reads no ' +
          'tenant data and creates no Zuri command.',
        'extraction pulls asset-evidence jobs from the Zuri cloud (its FR-143 lane) using ' +
          'ZURI_CLOUD_BASE_URL and ZURI_EDGE_DEVICE_KEY, reads each document with the local ' +
          'vision model, and posts a candidate back. With no vision model configured it still ' +
          'runs and fails every job with a readable reason, rather than inventing fields.',
      ],
    });
    return;
  }

  printJsonError(
    'UNKNOWN_COMMAND',
    `Unsupported command: ${args.join(' ')}. Use "zuri-agent --help" for available commands.`,
    { command, args },
    1
  );
}

/*
 * Run only when this file is the process entry point — not when a test imports it to reach
 * `validateConfig`/`buildHealthReport`. Without this guard, importing the module at all would
 * run `main()` against whatever argv the importer happened to have (a test runner's own flags,
 * not a zuri-agent command), fall through to the unknown-command branch, and call
 * `process.exit(1)` — silently killing the entire test run, including every file after this one.
 * This is also, concretely, why FR-001/002 had no CLI-level test before now.
 */
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    printJsonError(
      'UNCAUGHT_ERROR',
      err instanceof Error ? err.message : String(err),
      undefined,
      1
    );
  });
}
