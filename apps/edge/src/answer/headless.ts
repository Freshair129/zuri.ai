import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Role } from '../identity/registry.js';
import { numbersIn } from './llm.js';
import { ConversationError } from '../conversation/contract.js';

export function requireHeadlessPolicy(bin: string, stateless: boolean): void {
  // Empty MCP overrides do not remove inherited servers; keep this path closed.
  if (stateless && bin.includes('codex')) throw new ConversationError('LOCAL_POLICY_UNAVAILABLE');
}

/**
 * Answering by driving Claude Code headlessly, on the owner's own plan.
 *
 * The reason for a whole second provider next to the API one: this path bills against a
 * subscription rather than per token, it already carries web search and file authoring, and
 * `--resume` gives a conversation that genuinely continues instead of a history we replay by hand.
 *
 * The reason it needs a cage: the thing on the other end of the chat is a person we have approved,
 * but the *text* they send is not trusted input. A message can carry an instruction, and a coding
 * agent is very good at following instructions. So the child process gets:
 *
 * - **a working directory outside every repository**, so nothing above it can be read and no
 *   CLAUDE.md is discovered up the tree;
 * - **an environment built from an allow-list**, so no LINE token, Vercel token, database path or
 *   API key exists in it to be read or spent;
 * - **an explicit tool allow-list**, with no shell at all;
 * - **one door to company data** — the pricing MCP server, which is registered read-only calls and
 *   is started with the caller's role already fixed.
 *
 * What it can do is therefore: ask the pricing engine, search the web, and write a file into its
 * own scratch directory. What it cannot do is reach the SoT, the tokens, or the repositories.
 */

export interface HeadlessOptions {
  /** Server jobs have no local session, replay, or durable transcript. */
  stateless?: boolean;
  /** Path to the `claude` executable. */
  bin: string;
  model: string;
  /** Ceiling on the agent's own tool loop. */
  maxTurns: number;
  timeoutMs: number;
  /** Absolute path to the built pricing MCP server. */
  mcpServerPath: string;
  /** Root of the scratch directories. Kept outside every repository. */
  sandboxRoot: string;
  /** Where session ids are remembered, so a conversation continues. */
  sessionRoot: string;
  sessionRetentionHours: number;
  catalogRoot: string;
  exchangeRate: number;
  shipMonth?: number;
  /** Off by default: an outward call is a decision, not a default. */
  webSearch: boolean;
  /** Off by default: writing files is only useful once there is a way to deliver them. */
  fileAuthoring: boolean;
}

export interface HeadlessResult {
  ok: boolean;
  text: string;
  /** Everything the tools returned this turn, for the number check to compare against. */
  evidence: string;
  /** Figures the engine produced earlier in this same conversation. */
  rememberedNumbers: number[];
  toolCalls: string[];
  sessionId?: string;
  numTurns?: number;
  costUsd?: number;
  durationMs?: number;
  permissionDenials?: unknown[];
  error?: string;
}

/**
 * The variables a child process genuinely needs to start on Windows or POSIX.
 *
 * An allow-list rather than a deny-list, for the same reason the sales note filter is: a deny-list
 * has to be updated every time a new secret is added to `.env`, and the one nobody remembered is
 * the one that leaks.
 */
const ENV_ALLOW = [
  'PATH', 'Path', 'PATHEXT', 'COMSPEC', 'SystemRoot', 'windir', 'SystemDrive',
  'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE', 'USERNAME', 'LOGNAME', 'USER',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'ProgramFiles(x86)',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
];

export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ENV_ALLOW) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  /*
   * Deliberate: with no ANTHROPIC_API_KEY the CLI falls back to the signed-in subscription, which
   * is the whole point of this path. Leaving a key in the environment would silently move the cost
   * from the plan onto per-token billing.
   */
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

interface SessionRecord {
  sessionId: string;
  updatedAt: string;
  /**
   * Every figure the tools have produced in this conversation so far.
   *
   * The agent keeps its own history through `--resume`, so on a follow-up like "แล้วถ้าสั่ง 1000
   * ล่ะ" it can answer from a tool result it received two turns ago without calling anything now.
   * Checking a reply against only the current turn's evidence would reject those — correct numbers,
   * from the engine, rejected for being remembered rather than re-fetched. So the conversation
   * remembers what the engine has said, not just what it said this minute.
   *
   * Numbers only. There is no reason to keep the surrounding text, and every reason not to.
   */
  evidenceNumbers?: number[];
}

/** Enough for a long conversation, bounded so the file cannot grow without limit. */
const MAX_REMEMBERED_NUMBERS = 4000;

function sessionFile(root: string, key: string): string {
  return path.join(root, `${key}.json`);
}

function loadSession(key: string, options: HeadlessOptions): SessionRecord | null {
  if (options.stateless) return null;
  const file = sessionFile(options.sessionRoot, key);
  if (!fs.existsSync(file)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionRecord;
    const age = Date.now() - Date.parse(record.updatedAt);
    if (!Number.isFinite(age) || age > options.sessionRetentionHours * 3600_000) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function loadSessionId(key: string, options: HeadlessOptions): string | null {
  return loadSession(key, options)?.sessionId || null;
}

/** Figures the engine has produced anywhere in this conversation. */
export function rememberedNumbers(key: string, options: HeadlessOptions): number[] {
  return loadSession(key, options)?.evidenceNumbers || [];
}

export function saveSession(
  key: string,
  sessionId: string,
  newNumbers: number[],
  options: HeadlessOptions
): void {
  if (options.stateless) return;
  const previous = loadSession(key, options);
  const merged = Array.from(new Set([...(previous?.evidenceNumbers || []), ...newNumbers])).slice(
    -MAX_REMEMBERED_NUMBERS
  );

  fs.mkdirSync(options.sessionRoot, { recursive: true });
  fs.writeFileSync(
    sessionFile(options.sessionRoot, key),
    JSON.stringify(
      { sessionId, updatedAt: new Date().toISOString(), evidenceNumbers: merged },
      null,
      2
    ),
    'utf8'
  );
}

export function forgetSession(key: string, options: HeadlessOptions): boolean {
  const file = sessionFile(options.sessionRoot, key);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

export function defaultSandboxRoot(): string {
  return path.join(os.tmpdir(), 'zuri-agent-sandbox');
}

/**
 * Find the real executable behind a bare command name.
 *
 * On Windows `claude` on PATH is a `.cmd` shim, and Node refuses to spawn a `.cmd` without a
 * shell. Running through a shell is the wrong fix here: the prompt is a message somebody typed,
 * and handing it to a shell turns punctuation into syntax. So the native executable next to the
 * shim is located and spawned directly instead — no shell anywhere on this path.
 */
export function resolveBin(bin: string): string {
  if (bin.includes(path.sep) || bin.includes('/')) {
    return fs.existsSync(bin) ? bin : bin;
  }

  const windows = process.platform === 'win32';
  const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();

  // 0. Native claude.exe from the standalone installer — the PATH shims are .cmd/.ps1, which
  // Node's spawn refuses without a shell (EINVAL since the CVE-2024-27980 fix).
  if (windows && bin.toLowerCase() === 'claude') {
    const claudeNative = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
    if (isFile(claudeNative)) return claudeNative;
  }

  // 1. Direct check for native codex.exe binary
  if (windows && bin.toLowerCase().includes('codex')) {
    const codexNativePaths = [
      'C:/Users/freshair/AppData/Local/GoVibeToolchains/node-v24.16.0-win-x64/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
      path.join(process.env.LOCALAPPDATA || '', 'GoVibeToolchains/node-v24.16.0-win-x64/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe')
    ];
    for (const p of codexNativePaths) {
      if (isFile(p)) return path.resolve(p);
    }
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    if (windows) {
      const exe = path.join(dir, `${bin}.exe`);
      if (isFile(exe)) return exe;

      const cmd = path.join(dir, `${bin}.cmd`);
      if (isFile(cmd)) return cmd;

      const bat = path.join(dir, `${bin}.bat`);
      if (isFile(bat)) return bat;

      // npm keeps the actual binary inside the package and puts only shims on PATH.
      const packaged = path.join(
        dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', `${bin}.exe`
      );
      if (isFile(packaged)) return packaged;
      continue;
    }

    const full = path.join(dir, bin);
    if (isFile(full)) return full;
  }
  return bin;
}

/** One scratch directory per conversation, created outside every repository. */
function sandboxFor(key: string, options: HeadlessOptions): string {
  const dir = path.join(options.sandboxRoot, key);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  return dir;
}

function mcpConfig(options: HeadlessOptions, role: Role): string {
  return JSON.stringify({
    mcpServers: {
      smartgift: {
        command: process.execPath,
        args: [options.mcpServerPath],
        env: {
          ZURI_MCP_ROLE: role,
          ZURI_MCP_CATALOG_ROOT: path.resolve(options.catalogRoot),
          ZURI_MCP_FX_THB_PER_RMB: String(options.exchangeRate),
          ...(options.shipMonth ? { ZURI_MCP_SHIP_MONTH: String(options.shipMonth) } : {}),
        },
      },
    },
  });
}

/**
 * The same server as `mcpConfig`, expressed the way Codex takes it: repeated `-c` overrides of
 * `mcp_servers.<name>.*`, each value parsed as TOML. Kept beside `mcpConfig` deliberately — two
 * encodings of one fact, and they must not drift.
 */
export function codexMcpArgs(options: HeadlessOptions, role: Role): string[] {
  const toml = (v: string): string => JSON.stringify(v); // TOML and JSON agree on basic strings
  const env: Record<string, string> = {
    ZURI_MCP_ROLE: role,
    ZURI_MCP_CATALOG_ROOT: path.resolve(options.catalogRoot),
    ZURI_MCP_FX_THB_PER_RMB: String(options.exchangeRate),
    ...(options.shipMonth ? { ZURI_MCP_SHIP_MONTH: String(options.shipMonth) } : {}),
  };
  return [
    '-c',
    `mcp_servers.smartgift.command=${toml(process.execPath)}`,
    '-c',
    `mcp_servers.smartgift.args=[${toml(options.mcpServerPath)}]`,
    '-c',
    `mcp_servers.smartgift.env={${Object.entries(env)
      .map(([k, v]) => `${k}=${toml(v)}`)
      .join(', ')}}`,
  ];
}

const MCP_TOOLS = [
  'mcp__smartgift__quote_price',
  'mcp__smartgift__find_within_budget',
  'mcp__smartgift__search_products',
  'mcp__smartgift__lead_time',
  'mcp__smartgift__explain_policy',
];

/** Never available, whatever else is switched on. A shell would undo every other boundary. */
const ALWAYS_DENIED = ['Bash', 'BashOutput', 'KillShell', 'Task', 'NotebookEdit'];

export function allowedTools(options: HeadlessOptions): string[] {
  const allowed = [...MCP_TOOLS];
  if (options.webSearch) allowed.push('WebSearch', 'WebFetch');
  if (options.fileAuthoring) allowed.push('Write', 'Read', 'Glob', 'Grep');
  return allowed;
}

export function buildArgs(
  prompt: string,
  systemPrompt: string,
  role: Role,
  resumeSessionId: string | null,
  options: HeadlessOptions
): string[] {
  const isCodex = options.bin.includes('codex');

  if (isCodex) {
    const fullInstruction = `${systemPrompt}\n\nคำสั่ง/คำถามจากลูกค้า: ${prompt}`;
    return [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '-c', 'features.shell_tool=false',
      '-c', 'features.unified_exec=false',
      ...(options.stateless ? ['--ephemeral', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'features.multi_agent=false'] : []),
      '-m',
      options.model || 'gpt-5.6-luna',
      // The same read-only pricing server the Claude path gets, and for the same reason: without
      // it this model answers about products it cannot see, which reads as fluent and is worth
      // nothing. Codex takes MCP servers as `-c` overrides rather than a JSON config file, so the
      // one door to company data is opened the same way, with the caller's role already fixed.
      ...codexMcpArgs(options, role),
      fullInstruction,
    ];
  }

  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    options.model,
    '--max-turns',
    String(options.maxTurns),
    '--append-system-prompt',
    systemPrompt,
    '--mcp-config',
    mcpConfig(options, role),
    '--strict-mcp-config',
    '--allowedTools',
    allowedTools(options).join(','),
    '--disallowedTools',
    ALWAYS_DENIED.join(','),
  ];

  if (options.stateless) {
    args.push('--no-session-persistence', '--tools', '');
  } else if (resumeSessionId) {
    args.push('--resume', resumeSessionId);
  } else {
    args.push('--session-id', crypto.randomUUID());
  }

  args.push(prompt);
  return args;
}

interface StreamEvent {
  type?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  permission_denials?: unknown[];
  message?: { content?: Array<Record<string, unknown>> };
}

interface StreamHarvest {
  result: StreamEvent | null;
  evidence: string[];
  toolCalls: string[];
}

/**
 * Pull the answer, the tool names and the tool results out of the event stream.
 *
 * Exported because the number check depends on it: if this silently returned no evidence, every
 * figure in a reply would look invented and every turn would fall back. It is worth a test of its
 * own rather than living inside a process callback.
 */
export function harvestStream(stdout: string): StreamHarvest {
  const harvest: StreamHarvest = { result: null, evidence: [], toolCalls: [] };

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch {
      continue;
    }

    if (event.type === 'result') {
      harvest.result = event;
      continue;
    }

    for (const block of event.message?.content || []) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        harvest.toolCalls.push(block.name);
      }
      if (block.type === 'tool_result') {
        harvest.evidence.push(
          typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
        );
      }
    }
  }

  return harvest;
}

/**
 * Run one turn. Policy rejection throws before execution; ordinary process failures return
 * a result for the legacy webhook's pattern-based answer.
 */
export async function runHeadless(
  prompt: string,
  systemPrompt: string,
  role: Role,
  conversationKey: string,
  options: HeadlessOptions
): Promise<HeadlessResult> {
  requireHeadlessPolicy(options.bin, Boolean(options.stateless));
  const resume = loadSessionId(conversationKey, options);
  const cwd = sandboxFor(conversationKey, options);
  const args = buildArgs(prompt, systemPrompt, role, resume, options);

  return new Promise<HeadlessResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const binPath = resolveBin(options.bin);
    const child = spawn(binPath, args, {
      cwd,
      env: { ...childEnv(), PYTHONIOENCODING: 'utf-8', LC_ALL: 'en_US.UTF-8' },
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: HeadlessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        ok: false,
        text: '',
        evidence: '',
        rememberedNumbers: [],
        toolCalls: [],
        error: `timed out after ${options.timeoutMs}ms`,
      });
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) =>
      finish({ ok: false, text: '', evidence: '', rememberedNumbers: [], toolCalls: [], error: error.message })
    );

    child.on('close', (code) => {
      if (process.env.ZURI_HEADLESS_DEBUG) {
        try {
          fs.writeFileSync(
            path.join(options.sandboxRoot, `headless-debug-${Date.now()}.log`),
            `ARGS:
${JSON.stringify(args)}

STDOUT:
${stdout}

STDERR:
${stderr}
`,
            'utf8'
          );
        } catch { /* debug only */ }
      }
      const isCodex = options.bin.includes('codex');

      if (isCodex) {
        const raw = (stdout || '').trim();
        // Extract the agent text response from codex output
        let cleanText = raw;
        if (raw.includes('\ncodex\n')) {
          cleanText = raw.split('\ncodex\n')[1].split('\ntokens used\n')[0].trim();
        } else if (raw.includes('\nuser\n')) {
          const parts = raw.split('\nuser\n')[1].split('\n--------\n');
          cleanText = (parts[parts.length - 1] || '').trim();
        }
        if (cleanText.length > 0) {
          finish({
            ok: true,
            text: cleanText,
            evidence: '',
            rememberedNumbers: [],
            toolCalls: [],
          });
          return;
        }
      }

      const { result, evidence, toolCalls } = harvestStream(stdout);

      if (!result) {
        const directText = (stdout || '').trim();
        if (directText.length > 0) {
          finish({
            ok: true,
            text: directText,
            evidence: '',
            rememberedNumbers: [],
            toolCalls: [],
          });
          return;
        }

        finish({
          ok: false,
          text: '',
          evidence: '',
          rememberedNumbers: [],
          toolCalls,
          error: `no result from cli (exit ${code}): ${stderr.slice(0, 300)}`,
        });
        return;
      }

      const evidenceText = evidence.join('\n');
      const remembered = rememberedNumbers(conversationKey, options);
      if (result.session_id) {
        saveSession(conversationKey, result.session_id, numbersIn(evidenceText), options);
      }

      const text = (result.result || '').trim();
      finish({
        ok: !result.is_error && text.length > 0,
        text,
        evidence: evidenceText,
        rememberedNumbers: remembered,
        toolCalls,
        ...(result.session_id ? { sessionId: result.session_id } : {}),
        ...(result.num_turns !== undefined ? { numTurns: result.num_turns } : {}),
        ...(result.total_cost_usd !== undefined ? { costUsd: result.total_cost_usd } : {}),
        ...(result.duration_ms !== undefined ? { durationMs: result.duration_ms } : {}),
        ...(result.permission_denials?.length
          ? { permissionDenials: result.permission_denials }
          : {}),
        ...(result.is_error ? { error: 'claude reported an error result' } : {}),
        ...(text.length === 0 ? { error: 'claude returned no text' } : {}),
      });
    });
  });
}

/** Files the agent produced this turn, for delivery back to the person who asked. */
export function outputFiles(conversationKey: string, options: HeadlessOptions): string[] {
  const dir = path.join(options.sandboxRoot, conversationKey, 'out');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
}
