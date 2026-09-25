import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadConfig, validateConfig } from '../../src/config/index.js';
import { resolveSecret } from '../../src/config/secret.js';
import { buildHealthReport } from '../../src/cli/index.js';

// @tested FR-001 — `config check` validates local configuration and device identity.
// @tested FR-002 — `health` reports registration and contract compatibility.
// @tested SEC-005 — a credential resolves from a secret file rather than plaintext.
// @tested SDD-007 — the configuration module: environment loading and the `${NAME}_FILE` adapter.
// @tested AC-001 — config check fails on an invalid transport, device identity or binding, and reports a credential as configured or not rather than echoing it. The exit code itself is exercised by the CLI, not here.

/*
 * `validateConfig`/`loadConfig` take an injectable env object precisely so these tests never
 * touch the real `process.env` — this file runs inside the same shared `node --test` process as
 * every other test file, and a mutation left behind here would leak into whichever file happens
 * to run next.
 */

describe('config check (FR-001)', () => {
  it('passes a fully configured zuri-api transport', () => {
    const result = validateConfig({
      ZURI_COMMAND_TRANSPORT: 'zuri-api',
      ZURI_COMMAND_API_BASE_URL: 'https://zuri.example',
      ZURI_AGENT_DEVICE_ID: 'device-1',
      ZURI_AGENT_DEVICE_TOKEN: 'device-token',
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.checks.transport.status, 'pass');
    assert.strictEqual(result.checks.deviceId.status, 'pass');
    assert.strictEqual(result.checks.deviceTokenConfigured.status, 'pass');
  });

  it('fails a zuri-api transport missing its device credentials', () => {
    const result = validateConfig({ ZURI_COMMAND_TRANSPORT: 'zuri-api' });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.checks.deviceId.status, 'fail');
    assert.strictEqual(result.checks.deviceTokenConfigured.status, 'fail');
    assert.ok(result.errors.some((e) => e.includes('ZURI_AGENT_DEVICE_ID')));
    assert.ok(result.errors.some((e) => e.includes('ZURI_AGENT_DEVICE_TOKEN')));
  });

  it('does not require device credentials for the mock transport', () => {
    const result = validateConfig({ ZURI_COMMAND_TRANSPORT: 'mock' });
    assert.strictEqual(result.checks.deviceId.status, 'pass');
    assert.strictEqual(result.checks.deviceTokenConfigured.status, 'pass');
  });

  it('does not accept the retired local LINE transport', () => {
    const result = validateConfig({ ZURI_COMMAND_TRANSPORT: 'line-poc' });
    assert.strictEqual(result.checks.transport.value, 'zuri-api');
    assert.strictEqual(result.valid, false);
  });

  it('validates retained outbox configuration when enabled', () => {
    const result = validateConfig({
      ZURI_OUTBOX_ENABLED: 'true',
      ZURI_OUTBOX_LEASE_MS: '180000',
      ZURI_OUTBOX_MAX_ATTEMPTS: '3',
    });
    assert.strictEqual(result.checks.outbox?.status, 'pass');
  });

  it('refuses a model timeout above the local execution bound', () => {
    const result = validateConfig({
      ZURI_LLM_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'sk-x',
      ZURI_LLM_TIMEOUT_MS: '29000',
    });
    assert.strictEqual(result.checks.llm?.status, 'fail');
    assert.ok(result.errors.some((e) => e.includes('ZURI_LLM_TIMEOUT_MS must stay at or under')));
  });

  it('does not require a model key when the layer is off', () => {
    const result = validateConfig({ ZURI_LLM_ENABLED: 'false' });
    assert.strictEqual(result.checks.llm?.status, 'warn');
    assert.strictEqual(result.errors.some((e) => e.includes('ANTHROPIC_API_KEY')), false);
  });
});

describe('retired Edge Device worker configuration', () => {
  it('does not load the old cloud origin, device credential, or claim polling settings', () => {
    const config = loadConfig({
      ZURI_CLOUD_BASE_URL: 'https://retired.example',
      ZURI_EDGE_DEVICE_KEY: 'edgk_retired_fixture',
      ZURI_CONVERSATION_POLL_MS: '9000',
    });
    assert.strictEqual('cloudBaseUrl' in config, false);
    assert.strictEqual('edgeDeviceKey' in config, false);
    assert.strictEqual('conversationPollMs' in config, false);
  });
});

describe('health (FR-002)', () => {
  it('reports configured once every required field is present', () => {
    const report = buildHealthReport({
      ZURI_COMMAND_TRANSPORT: 'zuri-api',
      ZURI_COMMAND_API_BASE_URL: 'https://zuri.example',
      ZURI_AGENT_DEVICE_ID: 'device-1',
      ZURI_AGENT_DEVICE_TOKEN: 'device-token',
    });
    assert.strictEqual(report.status, 'configured');
    assert.strictEqual(report.agentId, 'zuri.command-agent');
    assert.strictEqual(report.transport, 'zuri-api');
    assert.ok(report.capabilities.includes('bridge.claim'));
    assert.ok(report.approvedTemplates.includes('executive-summary.v1'));
  });

  it('degrades rather than pretending, when config is invalid', () => {
    const report = buildHealthReport({ ZURI_COMMAND_TRANSPORT: 'zuri-api' });
    assert.strictEqual(report.status, 'degraded');
    assert.strictEqual(report.configStatus.valid, false);
  });
});

describe('Secret resolution (SEC-005)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('reads the plain value when no _FILE indirection is set', () => {
    assert.strictEqual(resolveSecret({ TOKEN: 'plain-value' }, 'TOKEN'), 'plain-value');
  });

  it('returns empty rather than throwing when neither form is set', () => {
    assert.strictEqual(resolveSecret({}, 'TOKEN'), '');
  });

  it('prefers the Docker-secrets _FILE form, trimmed, over a plain value', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-secret-'));
    const file = path.join(dir, 'token');
    fs.writeFileSync(file, 'from-the-file\n');
    const value = resolveSecret({ TOKEN: 'ignored-because-file-wins', TOKEN_FILE: file }, 'TOKEN');
    assert.strictEqual(value, 'from-the-file');
  });

  it('fails closed when _FILE names a path that cannot be read', () => {
    assert.throws(
      () => resolveSecret({ TOKEN_FILE: 'C:/definitely/not/a/real/path.secret' }, 'TOKEN'),
      /TOKEN_FILE names a secret file that could not be read/
    );
  });

  it('lets a device token be supplied as a file instead of a plaintext value', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-secret-'));
    const file = path.join(dir, 'device-token');
    fs.writeFileSync(file, 'secret-from-disk');

    const result = validateConfig({
      ZURI_COMMAND_TRANSPORT: 'zuri-api',
      ZURI_COMMAND_API_BASE_URL: 'https://zuri.example',
      ZURI_AGENT_DEVICE_ID: 'device-1',
      ZURI_AGENT_DEVICE_TOKEN_FILE: file,
    });
    assert.strictEqual(result.checks.deviceTokenConfigured.status, 'pass');
  });
});

// ADR-031 0.3.0b permits an EDGE account a local model but no cloud fallback. The risk was never
// that a hosted-API key exists — it is parked deliberately, for a future policy change — but that
// the provider was chosen by the *absence* of a base URL, so clearing or mistyping one variable
// would have started answering customers through the hosted API without anyone deciding to.
describe('Reaching a hosted model API is a decision, not a fallback', () => {
  const base = {
    ZURI_COMMAND_TRANSPORT: 'zuri-api',
    ZURI_AGENT_DEVICE_ID: 'DEV-01',
    ZURI_AGENT_DEVICE_TOKEN: 'tok',
    ZURI_LLM_ENABLED: 'true',
    ANTHROPIC_API_KEY: 'sk-parked-for-a-future-policy-change',
  } as NodeJS.ProcessEnv;

  it('does not consent to the cloud just because a key is present', () => {
    assert.strictEqual(validateConfig(base).checks.llm.status !== 'fail', true);
    assert.strictEqual(loadConfig(base).llmAllowCloud, false);
  });

  it('records consent only when it is stated outright', () => {
    assert.strictEqual(loadConfig({ ...base, ZURI_LLM_ALLOW_CLOUD: 'true' }).llmAllowCloud, true);
    for (const notTrue of ['1', 'yes', 'TRUE', '', undefined]) {
      assert.strictEqual(
        loadConfig({ ...base, ZURI_LLM_ALLOW_CLOUD: notTrue }).llmAllowCloud,
        false,
        `treated ${JSON.stringify(notTrue)} as consent`,
      );
    }
  });

  it('leaves the local base URL untouched by any of this', () => {
    const local = loadConfig({ ...base, ZURI_LLM_BASE_URL: 'http://localhost:11434/v1' });
    assert.strictEqual(local.llmBaseUrl, 'http://localhost:11434/v1');
    assert.strictEqual(local.llmAllowCloud, false, 'a local model needs no cloud consent');
  });
});

describe('managed Desktop provider configuration', () => {
  it('loads the operator-managed provider home from its explicit environment key', () => {
    assert.strictEqual(
      loadConfig({ ZURI_MANAGED_PROVIDER_HOME: 'C:/managed/providers/codex' }).managedProviderHome,
      'C:/managed/providers/codex',
    );
  });

  it('skips .env only for the explicit managed-worker switch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-config-dotenv-'));
    fs.writeFileSync(path.join(dir, '.env'), 'ZURI_MANAGED_PROVIDER_HOME=from-dotenv\n', 'utf8');
    const moduleUrl = pathToFileURL(fileURLToPath(new URL('../../src/config/index.ts', import.meta.url))).href;
    const tsxLoader = pathToFileURL(fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url))).href;
    const run = (skip: boolean) => {
      const env = { ...process.env, ...(skip ? { ZURI_CONFIG_SKIP_DOTENV: '1' } : {}) };
      delete env.ZURI_MANAGED_PROVIDER_HOME;
      if (!skip) delete env.ZURI_CONFIG_SKIP_DOTENV;
      return spawnSync(
        process.execPath,
        ['--import', tsxLoader, '-e', `import { loadConfig } from ${JSON.stringify(moduleUrl)}; process.stdout.write(loadConfig(process.env).managedProviderHome);`],
        { cwd: dir, env, encoding: 'utf8', windowsHide: true },
      );
    };
    try {
      const standalone = run(false);
      assert.strictEqual(standalone.status, 0, standalone.stderr);
      assert.strictEqual(standalone.stdout, 'from-dotenv');
      const managed = run(true);
      assert.strictEqual(managed.status, 0, managed.stderr);
      assert.strictEqual(managed.stdout, '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('direct-message retention', () => {
  const base = (over: Record<string, string> = {}) => ({
    ZURI_COMMAND_TRANSPORT: 'mock',
    LINE_HISTORY_HASH_KEY: 'k',
    LINE_HISTORY_GROUP_TEST: 'true',
    LINE_GROUP_TEST: 'Cffffffffffffffffffffffffffffffff',
    ...over,
  }) as NodeJS.ProcessEnv;

  it('defaults to a week, and to the group value when that is shorter', () => {
    assert.strictEqual(loadConfig(base()).lineHistoryDmRetentionDays, 7);
    // An operator who sets the archive to three days has said what they mean about all of it.
    assert.strictEqual(
      loadConfig(base({ LINE_HISTORY_RETENTION_DAYS: '3' })).lineHistoryDmRetentionDays,
      3
    );
  });

  it('takes an explicit value over the default', () => {
    assert.strictEqual(
      loadConfig(base({ LINE_HISTORY_DM_RETENTION_DAYS: '2' })).lineHistoryDmRetentionDays,
      2
    );
  });

  it('warns rather than clamps when a private conversation would outlive the group history', () => {
    // Silently shortening a configured value would make the setting untrustworthy in the one
    // direction that matters: you would read 30 and get 7 without being told.
    const env = base({ LINE_HISTORY_RETENTION_DAYS: '10', LINE_HISTORY_DM_RETENTION_DAYS: '20' });
    assert.strictEqual(loadConfig(env).lineHistoryDmRetentionDays, 20);
    const result = validateConfig(env);
    assert.ok(
      (result.warnings || []).some((w) => w.includes('LINE_HISTORY_DM_RETENTION_DAYS')),
      'the disagreement must be visible'
    );
  });

  it('refuses a retention below a day', () => {
    const result = validateConfig(base({ LINE_HISTORY_DM_RETENTION_DAYS: '0' }));
    assert.ok(!result.valid);
  });
});
