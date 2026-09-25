#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { AgentConfig, ConfigCheckResult, loadConfig, validateConfig } from '../config/index.js';
import { printJsonSuccess, printJsonError } from './output.js';
import { logDiagnostic } from '../safety/redact.js';
import { HttpZuriApiClient, IZuriApiClient, MockZuriApiClient, defaultMockStatePath } from '../zuri-api/client.js';
import { runPreview, runSend, runStatus, SUPPORTED_TEMPLATES } from './commands.js';
import { PRICE_QUOTE_USAGE, runPriceQuote } from './price.js';
import { answerConversation } from '../answer/respond.js';
import { LlmOptions } from '../answer/llm.js';
import { createModelPort } from '../answer/providers/index.js';
import { createFallbackPort } from '../answer/providers/fallback.js';
import { HeadlessOptions, defaultSandboxRoot } from '../answer/headless.js';
import { OutboxOptions, listIntents } from '../delivery/outbox.js';
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

  if (!command || command === '--help' || command === '-h') {
    logDiagnostic('Showing zuri-agent CLI usage');
    printJsonSuccess({
      name: 'zuri-agent',
      version: '0.2.0b',
      description: 'Zuri local Knowledge and RAG tools',
      usage: 'zuri-agent <command> [subcommand] [options]',
      availableCommands: [
        'config check',
        'health',
        'preview <template> [--period <p>] [--limit <n>]',
        'send <template> --group <alias> [--period <p>] [--limit <n>]',
        'status <command-id>',
        PRICE_QUOTE_USAGE.usage,
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
        'price quote is a local calculation from supplied cost and carton figures. It reads no ' +
          'tenant data and creates no Zuri command.',
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
