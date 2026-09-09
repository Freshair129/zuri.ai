import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  HeadlessOptions,
  allowedTools,
  buildArgs,
  childEnv,
  codexMcpArgs,
  harvestStream,
  loadSessionId,
  rememberedNumbers,
  saveSession,
  resolveBin,
  runHeadless,
  requireHeadlessPolicy,
} from '../../src/answer/headless.js';

let root = '';
let options: HeadlessOptions;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-headless-'));
  options = {
    bin: 'claude',
    model: 'claude-sonnet-5',
    maxTurns: 8,
    timeoutMs: 60000,
    mcpServerPath: '/abs/pricing-server.js',
    sandboxRoot: path.join(root, 'sandbox'),
    sessionRoot: path.join(root, 'sessions'),
    sessionRetentionHours: 168,
    catalogRoot: 'state/catalog',
    exchangeRate: 5,
    webSearch: false,
    fileAuthoring: false,
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('What the sandboxed agent is given', () => {
  it('rejects stateless Codex before resolving a binary or creating a sandbox', async () => {
    for (const bin of ['codex', 'C:/missing/codex.exe']) {
      await assert.rejects(runHeadless('question', 'system', 'sales', 'key', {
        ...options, bin, stateless: true,
      }), /LOCAL_POLICY_UNAVAILABLE/);
    }
    assert.equal(fs.existsSync(options.sandboxRoot), false);
    assert.equal(fs.existsSync(options.sessionRoot), false);
    assert.doesNotThrow(() => requireHeadlessPolicy('codex', false));
    assert.doesNotThrow(() => requireHeadlessPolicy('claude', true));
  });

  it('requires an explicit managed Codex home and never inherits ambient CODEX_HOME', () => {
    const managedHome = path.join(root, 'managed-codex-home');
    fs.mkdirSync(managedHome, { recursive: true });

    assert.doesNotThrow(() => requireHeadlessPolicy('codex', true, managedHome));
    assert.throws(
      () => requireHeadlessPolicy(path.join(root, 'codex-missing.exe'), true, managedHome),
      /LOCAL_POLICY_UNAVAILABLE/
    );
    assert.throws(
      () => requireHeadlessPolicy('codex', true, path.join(os.homedir(), '.codex')),
      /LOCAL_POLICY_UNAVAILABLE/
    );

    const previous = process.env.CODEX_HOME;
    const previousClaude = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = path.join(root, 'ambient-home');
    process.env.CLAUDE_CONFIG_DIR = path.join(root, 'ambient-claude-home');
    try {
      assert.strictEqual(childEnv().CODEX_HOME, undefined);
      assert.strictEqual(childEnv().CLAUDE_CONFIG_DIR, undefined);
      assert.strictEqual(childEnv(managedHome).CODEX_HOME, path.resolve(managedHome));
      const managedClaudeDir = path.join(root, 'managed-claude-home');
      assert.strictEqual(childEnv(undefined, managedClaudeDir).CLAUDE_CONFIG_DIR, path.resolve(managedClaudeDir));
      assert.strictEqual(childEnv().CLAUDE_CONFIG_DIR, undefined);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
      if (previousClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousClaude;
    }
  });
  it('builds the environment from an allow-list, so no secret is inherited', () => {
    process.env.LINE_POC_CHANNEL_ACCESS_TOKEN = 'line-secret';
    process.env.VERCEL_TOKEN = 'vercel-secret';
    process.env.SMARTGIFT_DUCKDB_PATH = 'D:/data/sot.duckdb';
    try {
      const env = childEnv();
      assert.strictEqual(env.LINE_POC_CHANNEL_ACCESS_TOKEN, undefined);
      assert.strictEqual(env.VERCEL_TOKEN, undefined);
      assert.strictEqual(env.SMARTGIFT_DUCKDB_PATH, undefined);
      assert.ok(env.PATH || env.Path, 'the child still needs a PATH to start');
    } finally {
      delete process.env.LINE_POC_CHANNEL_ACCESS_TOKEN;
      delete process.env.VERCEL_TOKEN;
      delete process.env.SMARTGIFT_DUCKDB_PATH;
    }
  });

  it('removes the API key, so the work bills against the plan and not per token', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-inherited';
    try {
      assert.strictEqual(childEnv().ANTHROPIC_API_KEY, undefined);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  /*
   * Asserted as a property rather than a list of names: the MCP surface grows as tools are added,
   * and a test that pins the names fails on every addition without saying anything about safety.
   * What has to stay true is narrower and does not change — with nothing switched on, the agent
   * can reach the company's own door and nothing else.
   */
  it('offers nothing but the MCP door until a capability is switched on', () => {
    const tools = allowedTools(options);
    assert.ok(tools.length > 0);
    assert.ok(
      tools.every((tool) => tool.startsWith('mcp__smartgift__')),
      `default surface reaches outside MCP: ${tools.filter((t) => !t.startsWith('mcp__smartgift__'))}`
    );
  });

  it('keeps the priced answer working, whatever else the door grows', () => {
    const tools = allowedTools(options);
    for (const required of ['quote_price', 'find_within_budget', 'search_products']) {
      assert.ok(tools.includes(`mcp__smartgift__${required}`), `${required} is missing`);
    }
  });

  it('adds web search and file authoring only when each is asked for', () => {
    const both = allowedTools({ ...options, webSearch: true, fileAuthoring: true });
    assert.ok(both.includes('WebSearch'));
    assert.ok(both.includes('Write'));
    assert.ok(!allowedTools({ ...options, fileAuthoring: true }).includes('WebSearch'));
  });

  it('never offers a shell, whatever else is enabled', () => {
    const everything = allowedTools({ ...options, webSearch: true, fileAuthoring: true });
    assert.ok(!everything.some((tool) => tool.startsWith('Bash')));
  });

  it('denies the shell explicitly as well as omitting it', () => {
    const args = buildArgs('hello', 'system', 'sales', null, options);
    const denied = args[args.indexOf('--disallowedTools') + 1];
    assert.ok(denied.includes('Bash'));
  });

  it('uses Codex config isolation and no-retention flags for a stateless managed home', () => {
    const managedHome = path.join(root, 'managed-codex-home');
    fs.mkdirSync(managedHome, { recursive: true });
    const args = buildArgs('hello', 'system', 'sales', null, {
      ...options,
      bin: 'codex',
      stateless: true,
      codexHome: managedHome,
    });

    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.includes('--ignore-rules'));
    assert.ok(args.includes('--strict-config'));
    assert.ok(args.includes('cli_auth_credentials_store="keyring"'));
    assert.ok(args.includes('history.persistence="none"'));
    assert.ok(args.includes('features.shell_tool=false'));
    assert.ok(args.includes('features.unified_exec=false'));
    assert.ok(args.includes('features.multi_agent=false'));
    assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  });

  it('uses Claude restricted mode plus explicit managed config when selected', () => {
    const managedClaudeDir = path.join(root, 'managed-claude-home');
    const args = buildArgs('hello', 'system', 'sales', null, {
      ...options,
      bin: 'claude',
      claudeConfigDir: managedClaudeDir,
      stateless: true,
    });
    assert.ok(args.includes('--restricted'));
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(!args.includes('--dangerously-skip-permissions'));
    const stateful = buildArgs('hello', 'system', 'sales', 'session-1', {
      ...options,
      bin: 'claude',
      claudeConfigDir: managedClaudeDir,
    });
    assert.ok(!stateful.includes('--restricted'));
  });

  it('pins the MCP configuration so no other server can be picked up', () => {
    const args = buildArgs('hello', 'system', 'sales', null, options);
    assert.ok(args.includes('--strict-mcp-config'));

    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    assert.strictEqual(config.mcpServers.smartgift.env.ZURI_MCP_ROLE, 'sales');
  });

  it('fixes the role at spawn time, where a chat message cannot reach it', () => {
    const owner = JSON.parse(
      buildArgs('hello', 'system', 'owner', null, options)[
        buildArgs('hello', 'system', 'owner', null, options).indexOf('--mcp-config') + 1
      ]
    );
    assert.strictEqual(owner.mcpServers.smartgift.env.ZURI_MCP_ROLE, 'owner');
  });

  it('resumes an existing conversation, and starts a new one when there is none', () => {
    assert.ok(buildArgs('hi', 's', 'sales', null, options).includes('--session-id'));

    const resumed = buildArgs('hi', 's', 'sales', 'abc-123', options);
    assert.ok(resumed.includes('--resume'));
    assert.strictEqual(resumed[resumed.indexOf('--resume') + 1], 'abc-123');
    assert.ok(!resumed.includes('--session-id'));
  });

  it('puts the message last, as an argument rather than anything a shell parses', () => {
    const args = buildArgs('ราคา TJS23-2; rm -rf /', 'system', 'sales', null, options);
    assert.strictEqual(args[args.length - 1], 'ราคา TJS23-2; rm -rf /');
  });
});

describe('Reading the event stream', () => {
  const stream = [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__smartgift__quote_price","input":{}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\\"unitPriceThb\\":500}"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"500 บาท"}]}}',
    'not json at all',
    '{"type":"result","subtype":"success","is_error":false,"result":"300 ชุด 500 บาท","session_id":"s-1","num_turns":3}',
  ].join('\n');

  it('finds the answer, the tools used, and the evidence behind them', () => {
    const harvest = harvestStream(stream);
    assert.strictEqual(harvest.result?.result, '300 ชุด 500 บาท');
    assert.deepStrictEqual(harvest.toolCalls, ['mcp__smartgift__quote_price']);
    assert.ok(harvest.evidence.join(' ').includes('500'));
  });

  it('steps over lines that are not events rather than failing the turn', () => {
    assert.strictEqual(harvestStream('garbage\n{ broken').result, null);
  });
});

describe('Conversation continuity', () => {
  it('remembers the session so the next turn continues it', () => {
    saveSession('k', 'sess-1', [500, 150000], options);
    assert.strictEqual(loadSessionId('k', options), 'sess-1');
  });

  it('accumulates the figures the engine has produced across turns', () => {
    saveSession('k', 'sess-1', [500, 150000], options);
    saveSession('k', 'sess-1', [470, 470000], options);

    const numbers = rememberedNumbers('k', options);
    assert.ok(numbers.includes(150000));
    assert.ok(numbers.includes(470000));
  });

  it('forgets a session that has aged out, rather than resuming a stale one', () => {
    saveSession('k', 'sess-1', [500], options);
    const file = path.join(options.sessionRoot, 'k.json');
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.updatedAt = new Date(Date.now() - 200 * 3600_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(record));

    assert.strictEqual(loadSessionId('k', options), null);
  });
});

describe('resolveBin on Windows', () => {
  it("prefers the standalone installer's native claude.exe over PATH shell shims", (t) => {
    if (process.platform !== 'win32') return t.skip('windows-only');
    const native = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
    const resolved = resolveBin('claude');
    if (fs.existsSync(native)) {
      assert.strictEqual(path.resolve(resolved).toLowerCase(), path.resolve(native).toLowerCase());
    } else {
      assert.doesNotMatch(resolved.toLowerCase(), /[.](cmd|bat|ps1)$/, 'must never resolve to a shell shim');
    }
  });
  it('an explicit path is returned as-is', () => {
    assert.strictEqual(resolveBin('C:/nowhere/claude.exe'), 'C:/nowhere/claude.exe');
  });
});

describe('codex MCP wiring', () => {
  const opts = {
    bin: 'codex', model: 'gpt-5.6-luna', mcpServerPath: 'C:/srv/pricing-server.js',
    catalogRoot: 'state/catalog', exchangeRate: 5, maxTurns: 8,
    webSearch: false, fileAuthoring: false,
  } as never;

  it('opens the same one door to company data the claude path gets', () => {
    // Without this the model answers about products it cannot see, which reads as fluent and is
    // worth nothing — observed in the wild before the wiring existed.
    const args = buildArgs('ราคา', 'SYSTEM', 'sales', null, opts);
    const joined = args.join(' ');
    assert.match(joined, /mcp_servers\.smartgift\.command=/);
    assert.match(joined, /mcp_servers\.smartgift\.args=/);
    assert.match(joined, /pricing-server\.js/);
  });

  it('fixes the caller role in the server env rather than trusting the model to respect it', () => {
    const sales = buildArgs('x', 'S', 'sales', null, opts).join(' ');
    const owner = buildArgs('x', 'S', 'owner', null, opts).join(' ');
    assert.match(sales, /ZURI_MCP_ROLE="sales"/);
    assert.match(owner, /ZURI_MCP_ROLE="owner"/);
  });

  it('passes the prompt last, after every flag', () => {
    const args = buildArgs('คำถาม', 'SYSTEM', 'sales', null, opts);
    assert.match(args[args.length - 1], /คำถาม/);
  });

  it('proves empty MCP overrides do not erase inherited config and the managed fresh home does', (t) => {
    const codex = resolveBin('codex');
    if (!fs.existsSync(codex)) return t.skip('Codex CLI is not installed');

    const fixtureSource = fileURLToPath(
      new URL('../fixtures/codex-inherited-mcp/', import.meta.url)
    );
    const maliciousHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-codex-malicious-home-'));
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-codex-isolated-home-'));
    fs.cpSync(fixtureSource, maliciousHome, { recursive: true });

    const list = (home: string, overrides: string[] = []) => spawnSync(
      codex,
      ['mcp', 'list', '--json', ...overrides],
      {
        env: childEnv(home),
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    const names = (result: ReturnType<typeof spawnSync>): string[] => {
      assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
      const output = result.stdout.toString();
      const start = output.indexOf('[');
      assert.ok(start >= 0, `Codex MCP output did not contain JSON: ${output}`);
      return (JSON.parse(output.slice(start)) as Array<{ name: string }>).map(server => server.name);
    };

    try {
      assert.deepStrictEqual(names(list(maliciousHome)), ['unapproved_fixture']);
      const explicitMcp = [
        '-c', 'mcp_servers={}',
        ...codexMcpArgs({ ...opts, mcpServerPath: 'C:/approved/pricing-server.js' }, 'sales'),
      ];
      assert.deepStrictEqual(
        names(list(maliciousHome, explicitMcp)),
        ['smartgift', 'unapproved_fixture'],
        'the empty object override must not be treated as an inherited-config boundary'
      );
      assert.deepStrictEqual(
        names(list(isolatedHome, explicitMcp)),
        ['smartgift']
      );
    } finally {
      fs.rmSync(maliciousHome, { recursive: true, force: true });
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });
});
