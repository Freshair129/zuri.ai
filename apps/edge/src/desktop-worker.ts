import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { z } from 'zod';

/*
 * Desktop worker boundary
 *
 * The Tauri process owns the child process and sends the device credential over this private
 * stdin channel.  The worker deliberately does not use the normal CLI entry point: importing the
 * CLI would expose a much larger command surface and would make stdout an accidental diagnostics
 * channel.  Only the existing conversation client, executor and worker are reused below.
 */

const PROTOCOL_VERSION = 1 as const;
const MAX_CONTROL_LINE = 16_384;
const MAX_EVENT_LINE = 4_096;
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_HEARTBEAT_MS = 40_000;
const MAX_STOP_MS = 300_000;

const providerSchema = z.object({
  llmEnabled: z.boolean().default(false),
  llmAllowCloud: z.boolean().default(false),
  llmBaseUrl: z.string().max(512).optional(),
  llmModel: z.string().max(120).optional(),
  llmNumCtx: z.number().int().min(256).max(131_072).optional(),
  llmEffort: z.enum(['low', 'medium', 'high']).optional(),
  llmTimeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  llmMaxIterations: z.number().int().min(1).max(16).optional(),
  headlessEnabled: z.boolean().default(false),
  headlessBin: z.enum(['codex', 'claude']).default('claude'),
  headlessModel: z.string().max(120).optional(),
  headlessMaxTurns: z.number().int().min(1).max(32).optional(),
  headlessTimeoutMs: z.number().int().min(1_000).max(300_000).optional(),
}).strict();

const initializeSchema = z.object({
  type: z.literal('initialize'),
  version: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/),
  deviceKey: z.string().regex(/^edgk_[A-Za-z0-9_-]+$/).min(20).max(200),
  cloudBaseUrl: z.string().trim().min(1).max(512),
  dataRoot: z.string().trim().min(1).max(1_024),
  managedProviderHome: z.string().trim().max(1_024).optional(),
  ragUrl: z.string().trim().max(512).optional(),
  pollIntervalMs: z.number().int().min(250).max(30_000).default(DEFAULT_POLL_MS),
  heartbeatIntervalMs: z.number().int().min(1_000).max(120_000).default(DEFAULT_HEARTBEAT_MS),
  provider: providerSchema.default({}),
}).strict();

const stopSchema = z.object({
  type: z.literal('stop'),
  version: z.literal(PROTOCOL_VERSION),
  reason: z.enum(['operator', 'quit', 'parent']).default('operator'),
  deadlineMs: z.number().int().min(0).max(MAX_STOP_MS).default(30_000),
}).strict();

const heartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  version: z.literal(PROTOCOL_VERSION),
}).strict();

const commandSchema = z.union([stopSchema, heartbeatSchema]);

export type DesktopWorkerInit = z.infer<typeof initializeSchema>;
export type DesktopWorkerCommand = z.infer<typeof commandSchema>;

type FailureCode =
  | 'INVALID_INIT'
  | 'INVALID_MESSAGE'
  | 'CONFIG_INVALID'
  | 'LOCK_BUSY'
  | 'EXTERNAL_UNVERIFIED'
  | 'AUTH_FAILED'
  | 'CONTRACT_INCOMPATIBLE'
  | 'WORKER_FAILED'
  | 'HEARTBEAT_FAILED'
  | 'STOP_TIMEOUT';

type EdgeStatus = 'healthy' | 'degraded' | 'unavailable';

type WorkerEvent =
  | { type: 'ready'; version: typeof PROTOCOL_VERSION; workerId: string; transportOwner: 'SERVER' }
  | { type: 'claim'; version: typeof PROTOCOL_VERSION; outcome: string }
  | { type: 'heartbeat'; version: typeof PROTOCOL_VERSION; ok: boolean; status?: EdgeStatus; at: string }
  | { type: 'stopping'; version: typeof PROTOCOL_VERSION; reason: 'operator' | 'quit' | 'parent' | 'worker' }
  | { type: 'stopped'; version: typeof PROTOCOL_VERSION; graceful: boolean }
  | { type: 'failure'; version: typeof PROTOCOL_VERSION; code: FailureCode };

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) && !value.includes('\0');
}

function validateOrigin(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_CLOUD_ORIGIN');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (
    (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('INVALID_CLOUD_ORIGIN');
  }
}

function validateInit(input: unknown): DesktopWorkerInit {
  const parsed = initializeSchema.safeParse(input);
  if (!parsed.success) throw new Error('INVALID_INIT');
  if (!isAbsolutePath(parsed.data.dataRoot)) throw new Error('INVALID_INIT');
  validateOrigin(parsed.data.cloudBaseUrl);
  if (parsed.data.ragUrl) {
    let rag: URL;
    try {
      rag = new URL(parsed.data.ragUrl);
    } catch {
      throw new Error('INVALID_INIT');
    }
    if (!['http:', 'https:'].includes(rag.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(rag.hostname)) {
      throw new Error('INVALID_INIT');
    }
  }
  if (parsed.data.provider.llmBaseUrl) {
    let modelUrl: URL;
    try {
      modelUrl = new URL(parsed.data.provider.llmBaseUrl);
    } catch {
      throw new Error('INVALID_INIT');
    }
    if (!['http:', 'https:'].includes(modelUrl.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(modelUrl.hostname)) {
      throw new Error('INVALID_INIT');
    }
  }
  if (parsed.data.managedProviderHome && !isAbsolutePath(parsed.data.managedProviderHome)) {
    throw new Error('INVALID_INIT');
  }
  return parsed.data;
}

function emit(event: WorkerEvent): void {
  const line = JSON.stringify(event);
  if (line.length > MAX_EVENT_LINE) return;
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    // The supervisor owns this pipe. A closed pipe is handled by the lifecycle caller.
  }
}

function emitFailure(code: FailureCode): void {
  emit({ type: 'failure', version: PROTOCOL_VERSION, code });
}

function acquireLock(dataRoot: string): { path: string; fd: number } {
  const lockPath = path.join(dataRoot, '.zuri-worker.lock');
  let fd: number;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch {
    throw new Error('LOCK_BUSY');
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), 'utf8');
  } catch {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
    throw new Error('CONFIG_INVALID');
  }
  return { path: lockPath, fd };
}

function releaseLock(lock: { path: string; fd: number } | null): void {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch { /* already closed */ }
  try { fs.rmSync(lock.path, { force: true }); } catch { /* owned lock is best effort on exit */ }
}

function removeSensitiveEnvironment(): void {
  const names = [
    'ZURI_EDGE_DEVICE_KEY', 'ZURI_EDGE_DEVICE_KEY_FILE', 'ZURI_AGENT_DEVICE_TOKEN',
    'ZURI_AGENT_DEVICE_TOKEN_FILE', 'ZURI_CLOUD_BASE_URL', 'ZURI_CLOUD_BASE_URL_FILE',
    'ZURI_COMMAND_API_BASE_URL', 'ZURI_COMMAND_API_BASE_URL_FILE', 'ANTHROPIC_API_KEY',
    'ANTHROPIC_API_KEY_FILE', 'ANTHROPIC_AUTH_TOKEN', 'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_ACCESS_TOKEN_FILE', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_SECRET_FILE',
    'LINE_HISTORY_HASH_KEY', 'LINE_HISTORY_HASH_KEY_FILE', 'ZURI_STACK_REPLY_ENABLED',
    'ZURI_LINE_TRANSPORT_OWNER', 'ZURI_HEADLESS_DEBUG',
  ];
  for (const name of names) delete process.env[name];
}

function setOptionalEnv(name: string, value: string | number | boolean | undefined): void {
  if (value === undefined) return;
  process.env[name] = String(value);
}

function applyInitEnvironment(init: DesktopWorkerInit, packageRoot: string, privateCwd: string): void {
  removeSensitiveEnvironment();
  process.env.ZURI_DESKTOP_MANAGED = '1';
  process.env.ZURI_CONFIG_SKIP_DOTENV = '1';
  process.env.ZURI_LINE_TRANSPORT_OWNER = 'SERVER';
  process.env.ZURI_STACK_REPLY_ENABLED = 'false';
  process.env.ZURI_COMMAND_TRANSPORT = 'zuri-api';
  process.env.ZURI_AGENT_DEVICE_ID = init.deviceId;
  process.env.ZURI_CLOUD_BASE_URL = init.cloudBaseUrl;
  // The device key is deliberately kept in memory and is never placed in the environment.
  // Heartbeat and conversation clients receive it directly from the private init object.
  delete process.env.ZURI_EDGE_DEVICE_KEY;
  delete process.env.ZURI_EDGE_DEVICE_KEY_FILE;
  delete process.env.ZURI_CLOUD_BASE_URL_FILE;
  process.env.ZURI_AGENT_DEVICE_TOKEN = '';
  process.env.ZURI_AGENT_DEVICE_TOKEN_FILE = '';
  process.env.GENESIS_RAG_API_URL = init.ragUrl || 'http://127.0.0.1:8888';
  process.env.ZURI_EDGE_POLL_MS = String(init.pollIntervalMs);
  process.env.ZURI_HEARTBEAT_INTERVAL_MS = String(init.heartbeatIntervalMs);
  process.env.ZURI_DESKTOP_PACKAGE_ROOT = packageRoot;
  process.env.ZURI_DESKTOP_DATA_ROOT = init.dataRoot;
  process.env.ZURI_CHAT_MEMORY_ROOT = path.join(init.dataRoot, 'memory');
  process.env.ZURI_HEADLESS_SANDBOX_ROOT = path.join(init.dataRoot, 'headless-sandbox');
  process.env.ZURI_HEADLESS_SESSION_ROOT = path.join(init.dataRoot, 'headless-sessions');
  process.env.ZURI_HEADLESS_SESSION_RETENTION_HOURS = '0';
  process.env.ZURI_HEADLESS_WEB_SEARCH = 'false';
  process.env.ZURI_HEADLESS_FILES = 'false';
  process.env.ZURI_OUTBOX_ENABLED = 'false';
  process.env.LINE_ENABLED = 'false';
  process.env.LINE_POC_ENABLED = 'false';
  process.env.LINE_WEBHOOK_ENABLED = 'false';
  // Catalogs are operator-provisioned mutable data under the Desktop data root. They are never
  // copied into the portable artifact and are not resolved from a developer checkout.
  process.env.ZURI_MCP_CATALOG_ROOT = path.join(init.dataRoot, 'catalog');
  process.env.SMARTGIFT_CATALOG_ROOT = path.join(init.dataRoot, 'catalog');
  process.chdir(privateCwd);

  const provider = init.provider;
  process.env.ZURI_LLM_ENABLED = String(provider.llmEnabled);
  process.env.ZURI_LLM_ALLOW_CLOUD = String(provider.llmAllowCloud);
  process.env.ZURI_HEADLESS_ENABLED = String(provider.headlessEnabled);
  process.env.ZURI_HEADLESS_BIN = provider.headlessBin;
  setOptionalEnv('ZURI_LLM_BASE_URL', provider.llmBaseUrl);
  setOptionalEnv('ZURI_LLM_MODEL', provider.llmModel);
  setOptionalEnv('ZURI_LLM_NUM_CTX', provider.llmNumCtx);
  setOptionalEnv('ZURI_LLM_EFFORT', provider.llmEffort);
  setOptionalEnv('ZURI_LLM_TIMEOUT_MS', provider.llmTimeoutMs);
  setOptionalEnv('ZURI_LLM_MAX_ITERATIONS', provider.llmMaxIterations);
  setOptionalEnv('ZURI_HEADLESS_MODEL', provider.headlessModel);
  setOptionalEnv('ZURI_HEADLESS_MAX_TURNS', provider.headlessMaxTurns);
  setOptionalEnv('ZURI_HEADLESS_TIMEOUT_MS', provider.headlessTimeoutMs);
  setOptionalEnv('ZURI_MANAGED_PROVIDER_HOME', init.managedProviderHome);
}

function packageRootForWorker(): string {
  // Source and compiled layouts are both <packageRoot>/{src,dist}/desktop-worker.{ts,js}.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

interface RuntimeModules {
  loadConfig: (env?: NodeJS.ProcessEnv) => Record<string, unknown>;
  createConversationClient: (options: { baseUrl: string; deviceKey: string }) => {
    claim(): Promise<unknown>;
    complete(job: unknown, text: string): Promise<void>;
    fail(job: unknown, code: 'EXECUTION_FAILED' | 'LOCAL_POLICY_UNAVAILABLE'): Promise<void>;
  };
  createConversationExecutor: (config: Record<string, unknown>, options?: { ragUrl?: string }) => (job: unknown) => Promise<string>;
  runConversationLoop: (deps: {
    client: ReturnType<RuntimeModules['createConversationClient']>;
    answer: (job: unknown) => Promise<string>;
    signal: AbortSignal;
    pollMs?: number;
    onEvent?: (event: { outcome: string; jobId?: string }) => void;
  }) => Promise<void>;
  requireComputeWorker: (env?: NodeJS.ProcessEnv) => void;
  HttpZuriApiClient: new (options: {
    baseUrl: string; deviceId: string; deviceToken: string; cloudBaseUrl: string; deviceKey: string;
  }) => { sendHeartbeat(payload: unknown): Promise<{ acknowledged: boolean }> };
  startHeartbeat: (options: {
    client: { sendHeartbeat(payload: unknown): Promise<{ acknowledged: boolean }> };
    deviceId: string;
    intervalMs: number;
    status: () => Promise<EdgeStatus>;
    onEvent: (event: { ok: boolean; status?: EdgeStatus }) => void;
  }) => () => void;
  GenesisLocalRag: new (options: { apiUrl: string; timeoutMs: number; fetchImpl: typeof fetch }) => {
    health(): Promise<{ ok: boolean }>;
  };
}

async function loadRuntimeModules(): Promise<RuntimeModules> {
  const [config, client, executor, worker, contract, api, heartbeat, rag] = await Promise.all([
    import('./config/index.js'),
    import('./conversation/client.js'),
    import('./conversation/executor.js'),
    import('./conversation/worker.js'),
    import('./conversation/contract.js'),
    import('./zuri-api/client.js'),
    import('./zuri-api/heartbeat.js'),
    import('./rag/genesis-rag.js'),
  ]);
  return {
    loadConfig: config.loadConfig as RuntimeModules['loadConfig'],
    createConversationClient: client.createConversationClient as RuntimeModules['createConversationClient'],
    createConversationExecutor: executor.createConversationExecutor as RuntimeModules['createConversationExecutor'],
    runConversationLoop: worker.runConversationLoop as RuntimeModules['runConversationLoop'],
    requireComputeWorker: contract.requireComputeWorker,
    HttpZuriApiClient: api.HttpZuriApiClient,
    startHeartbeat: heartbeat.startHeartbeat,
    GenesisLocalRag: rag.GenesisLocalRag,
  };
}

function errorCode(error: unknown): FailureCode {
  const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'CONTRACT_INCOMPATIBLE';
  return 'WORKER_FAILED';
}

const MAX_PENDING_COMMANDS = 64;

interface DesktopWorkerInput {
  rl: readline.Interface;
  pending: string[];
  ended: boolean;
  preLine: (line: string) => void;
  preClose: () => void;
}

async function runManagedWorker(init: DesktopWorkerInit, input: DesktopWorkerInput): Promise<number> {
  const packageRoot = packageRootForWorker();
  let privateCwd = '';
  let lock: { path: string; fd: number } | null = null;
  let stopRequested = false;
  let stopReason: 'operator' | 'quit' | 'parent' | 'worker' = 'parent';
  let fatalWorker = false;
  let stoppedEmitted = false;
  let stopHeartbeat: (() => void) | undefined;
  const controller = new AbortController();
  let inputEnded = input.ended;
  let inputQueue = input.pending.splice(0);

  const requestStop = (reason: 'operator' | 'quit' | 'parent' | 'worker'): void => {
    if (stopRequested) return;
    stopRequested = true;
    stopReason = reason;
    emit({ type: 'stopping', version: PROTOCOL_VERSION, reason });
    stopHeartbeat?.();
    controller.abort();
  };

  // Keep the one stdin reader alive while runtime modules load. A second readline instance can
  // miss commands already buffered by the first one and cannot observe EOF after that reader has
  // closed, which would leave a parent waiting forever during a slow import.
  input.rl.off('line', input.preLine);
  input.rl.off('close', input.preClose);
  const queueLine = (line: string): void => {
    if (inputQueue.length < MAX_PENDING_COMMANDS) inputQueue.push(line);
    else emitFailure('INVALID_MESSAGE');
  };
  const queueClose = (): void => {
    inputEnded = true;
    requestStop('parent');
  };
  input.rl.on('line', queueLine);
  input.rl.once('close', queueClose);

  try {
    fs.mkdirSync(init.dataRoot, { recursive: true });
    privateCwd = fs.mkdtempSync(path.join(init.dataRoot, '.worker-runtime-'));
    applyInitEnvironment(init, packageRoot, privateCwd);
    // Native Desktop owns the exclusive lock for a managed child. Keeping a second create-new
    // lock here would leave a stale file after a forced native kill and block the next owned start.
    // Standalone fixture/CLI launches still take their own lock.
    lock = process.env.ZURI_DESKTOP_NATIVE_LOCK === '1' ? null : acquireLock(init.dataRoot);
    const modules = await loadRuntimeModules();
    modules.requireComputeWorker(process.env);
    const config = modules.loadConfig(process.env);
    const client = modules.createConversationClient({ baseUrl: init.cloudBaseUrl, deviceKey: init.deviceKey });
    const answer = modules.createConversationExecutor(config, { ragUrl: init.ragUrl || 'http://127.0.0.1:8888' });
    const heartbeatClient = new modules.HttpZuriApiClient({
      baseUrl: init.cloudBaseUrl,
      cloudBaseUrl: init.cloudBaseUrl,
      deviceId: init.deviceId,
      deviceToken: '',
      deviceKey: init.deviceKey,
    });
    let heartbeatInFlight = false;
    let firstClaimAccepted = false;
    const sendHeartbeat = async (payload: unknown): Promise<{ acknowledged: boolean }> => {
      if (heartbeatInFlight) throw new Error('HEARTBEAT_IN_FLIGHT');
      heartbeatInFlight = true;
      try {
        const result = await heartbeatClient.sendHeartbeat(payload);
        if (!result.acknowledged) throw new Error('HEARTBEAT_NOT_ACKNOWLEDGED');
        return result;
      } finally { heartbeatInFlight = false; }
    };
    const rag = new modules.GenesisLocalRag({
      apiUrl: init.ragUrl || 'http://127.0.0.1:8888',
      timeoutMs: 3_000,
      fetchImpl: (input, requestInit) => fetch(input, { ...requestInit, redirect: 'error' }),
    });
    const status = async (): Promise<EdgeStatus> => {
      if (!firstClaimAccepted) return 'unavailable';
      const health = await rag.health();
      if (!health.ok) return 'degraded';
      if (init.provider.llmEnabled && init.provider.llmBaseUrl) {
        const modelHost = init.provider.llmBaseUrl.replace(/\/v1\/?$/, '');
        try {
          const response = await fetch(`${modelHost}/api/tags`, {
            signal: AbortSignal.timeout(3_000),
            redirect: 'error',
          });
          if (!response.ok) return 'degraded';
          const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
          const selected = init.provider.llmModel;
          if (!selected || !body.models?.some(model => (model.name || model.model) === selected)) {
            return 'degraded';
          }
        } catch {
          return 'degraded';
        }
      }
      return 'healthy';
    };
    stopHeartbeat = modules.startHeartbeat({
      client: { sendHeartbeat },
      deviceId: init.deviceId,
      intervalMs: init.heartbeatIntervalMs,
      status,
      onEvent: event => emit({
        type: 'heartbeat', version: PROTOCOL_VERSION, ok: event.ok, ...(event.status ? { status: event.status } : {}),
        at: new Date().toISOString(),
      }),
    });

    const lineHandler = (line: string): void => {
      if (line.length > MAX_CONTROL_LINE) {
        emitFailure('INVALID_MESSAGE');
        return;
      }
      let value: unknown;
      try { value = JSON.parse(line); } catch { emitFailure('INVALID_MESSAGE'); return; }
      const parsed = commandSchema.safeParse(value);
      if (!parsed.success) { emitFailure('INVALID_MESSAGE'); return; }
      if (parsed.data.type === 'stop') requestStop(parsed.data.reason);
      else if (!stopRequested) {
        void (async () => {
          const started = Date.now();
          try {
            const result = await sendHeartbeat({
              contractVersion: '0.1.0b', deviceId: init.deviceId, status: await status(),
              registeredQueries: [], approvedTemplates: [], timestamp: new Date().toISOString(),
            });
            emit({
              type: 'heartbeat', version: PROTOCOL_VERSION, ok: result.acknowledged,
              status: await status(), at: new Date(started).toISOString(),
            });
          } catch {
            emitFailure('HEARTBEAT_FAILED');
            emit({ type: 'heartbeat', version: PROTOCOL_VERSION, ok: false, status: 'degraded', at: new Date().toISOString() });
          }
        })();
      }
    };
    input.rl.off('line', queueLine);
    input.rl.off('close', queueClose);
    input.rl.on('line', lineHandler);
    input.rl.once('close', () => {
      inputEnded = true;
      requestStop('parent');
    });
    emit({ type: 'ready', version: PROTOCOL_VERSION, workerId: `desktop-${process.pid}`, transportOwner: 'SERVER' });
    for (const line of inputQueue) lineHandler(line);
    inputQueue = [];
    if (inputEnded) requestStop('parent');
    const loopPromise = modules.runConversationLoop({
      client,
      answer,
      signal: controller.signal,
      pollMs: init.pollIntervalMs,
      onEvent: event => {
        if (!['retrying', 'stale_lease'].includes(event.outcome)) firstClaimAccepted = true;
        emit({ type: 'claim', version: PROTOCOL_VERSION, outcome: event.outcome });
      },
    }).catch(error => {
      emitFailure(errorCode(error));
      stopRequested = true;
      stopReason = 'worker';
      fatalWorker = true;
      controller.abort();
    });

    await loopPromise;
    stopHeartbeat?.();
    if (!stopRequested) requestStop('worker');
    if (!inputEnded) input.rl.close();
    if (!stoppedEmitted) {
      stoppedEmitted = true;
      emit({ type: 'stopped', version: PROTOCOL_VERSION, graceful: !fatalWorker });
    }
    releaseLock(lock);
    lock = null;
    if (privateCwd) {
      try { process.chdir(packageRoot); } catch { /* exit path */ }
      fs.rmSync(privateCwd, { recursive: true, force: true });
    }
    return fatalWorker ? 1 : 0;
  } catch (error) {
    const code = error instanceof Error && (error.message === 'LOCK_BUSY' || error.message === 'CONFIG_INVALID')
      ? error.message as 'LOCK_BUSY' | 'CONFIG_INVALID'
      : 'CONFIG_INVALID';
    emitFailure(code);
    try { input.rl.close(); } catch { /* input already closed */ }
    releaseLock(lock);
    if (privateCwd) {
      try { process.chdir(packageRoot); } catch { /* exit path */ }
      try { fs.rmSync(privateCwd, { recursive: true, force: true }); } catch { /* exit path */ }
    }
    return 2;
  }
}

export function parseDesktopWorkerInit(value: unknown): DesktopWorkerInit {
  return validateInit(value);
}

export function parseDesktopWorkerCommand(value: unknown): DesktopWorkerCommand {
  const parsed = commandSchema.safeParse(value);
  if (!parsed.success) throw new Error('INVALID_MESSAGE');
  return parsed.data;
}

function createDesktopWorkerInput(): { input: DesktopWorkerInput; firstLine: Promise<string | undefined> } {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending: string[] = [];
  let firstSeen = false;
  let resolveFirst!: (line: string | undefined) => void;
  const firstLine = new Promise<string | undefined>(resolve => { resolveFirst = resolve; });
  const input = {} as DesktopWorkerInput;
  const preLine = (line: string): void => {
    if (!firstSeen) {
      firstSeen = true;
      resolveFirst(line);
      return;
    }
    if (pending.length < MAX_PENDING_COMMANDS) pending.push(line);
  };
  const preClose = (): void => {
    input.ended = true;
    if (!firstSeen) {
      firstSeen = true;
      resolveFirst(undefined);
    }
  };
  input.rl = rl;
  input.pending = pending;
  input.ended = false;
  input.preLine = preLine;
  input.preClose = preClose;
  rl.on('line', preLine);
  rl.once('close', preClose);
  return { input, firstLine };
}

async function main(): Promise<void> {
  const channel = createDesktopWorkerInput();
  const firstLine = await channel.firstLine;
  if (firstLine === undefined || firstLine.length > MAX_CONTROL_LINE) {
    emitFailure('INVALID_INIT');
    channel.input.rl.close();
    process.exitCode = 2;
    return;
  }
  let value: unknown;
  try { value = JSON.parse(firstLine); } catch {
    emitFailure('INVALID_INIT');
    process.exitCode = 2;
    return;
  }
  let init: DesktopWorkerInit;
  try { init = validateInit(value); } catch {
    emitFailure('INVALID_INIT');
    channel.input.rl.close();
    process.exitCode = 2;
    return;
  }
  process.exitCode = await runManagedWorker(init, channel.input);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    emitFailure('WORKER_FAILED');
    process.exitCode = 1;
  });
}
