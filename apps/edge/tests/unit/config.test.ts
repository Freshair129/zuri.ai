import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadConfig, validateConfig } from '../../src/config/index.js';
import { resolveSecret } from '../../src/config/secret.js';
import { buildHealthReport } from '../../src/cli/index.js';

// @tested FR-001 — `config check` validates local configuration and device identity.
// @tested FR-002 — `health` reports registration and contract compatibility.
// @tested SEC-005 — a credential resolves from a secret file rather than plaintext.
// @tested SDD-007 — the configuration module: environment loading and the `${NAME}_FILE` adapter.
// @tested BR-007 — the LINE channel token custody rule and the shapes that defeat it.
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

  it('normalizes an unrecognized transport name to zuri-api rather than passing it through', () => {
    // loadConfig() falls back to zuri-api for anything it does not recognize, so an invalid name
    // never reaches the transport check as itself — it fails instead on the zuri-api device
    // credentials the fallback now requires, which is still the right outcome for a nonsense
    // value, just by a different, less obvious path than a caller might expect.
    const result = validateConfig({ ZURI_COMMAND_TRANSPORT: 'carrier-pigeon' });
    assert.strictEqual(result.checks.transport.value, 'zuri-api');
    assert.strictEqual(result.valid, false);
  });

  it('requires a complete line-poc binding before it will pass', () => {
    const missing = validateConfig({
      ZURI_COMMAND_TRANSPORT: 'line-poc',
      LINE_POC_ENABLED: 'true',
    });
    assert.strictEqual(missing.checks.linePoc?.status, 'fail');
    assert.ok(missing.errors.some((e) => e.includes('LINE_POC_CHANNEL_ACCESS_TOKEN')));
    assert.ok(missing.errors.some((e) => e.includes('LINE_POC_GROUP')));

    const complete = validateConfig({
      ZURI_COMMAND_TRANSPORT: 'line-poc',
      LINE_POC_ENABLED: 'true',
      LINE_POC_CHANNEL_ACCESS_TOKEN: 'token',
      LINE_POC_GROUP_LEADERSHIP: 'Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    assert.strictEqual(complete.checks.linePoc?.status, 'pass');
    assert.deepStrictEqual(complete.checks.linePoc?.configuredGroupAliases, ['leadership']);
  });

  it('refuses the one combination that looks configured and cannot work: headless + webhook with no outbox', () => {
    const result = validateConfig({
      ZURI_HEADLESS_ENABLED: 'true',
      LINE_WEBHOOK_ENABLED: 'true',
      LINE_CHANNEL_SECRET: 's',
      LINE_HISTORY_HASH_KEY: 'k',
      LINE_HISTORY_RETENTION_DAYS: '30',
      LINE_HISTORY_GROUP_LEADERSHIP: 'true',
      ZURI_OUTBOX_ENABLED: 'false',
    });
    assert.strictEqual(result.checks.outbox?.status, 'fail');
    assert.ok(result.errors.some((e) => e.includes('ZURI_OUTBOX_ENABLED=true is required')));
  });

  it('accepts headless + webhook once the outbox is on with a sane lease', () => {
    const result = validateConfig({
      ZURI_HEADLESS_ENABLED: 'true',
      LINE_WEBHOOK_ENABLED: 'true',
      LINE_CHANNEL_SECRET: 's',
      LINE_HISTORY_HASH_KEY: 'k',
      LINE_HISTORY_RETENTION_DAYS: '30',
      LINE_HISTORY_GROUP_LEADERSHIP: 'true',
      ZURI_OUTBOX_ENABLED: 'true',
      ZURI_OUTBOX_LEASE_MS: '180000',
      ZURI_OUTBOX_MAX_ATTEMPTS: '3',
    });
    assert.strictEqual(result.checks.outbox?.status, 'pass');
  });

  it('refuses a model timeout that could outlive a LINE reply token', () => {
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

// BR-007 (docs/LINE-REPLY-OWNERSHIP-DECISION.md): retiring BR-003 means this runtime legitimately
// holds a token that can speak to customers as the OA. The one control that replaces "there is no
// token here" is where the token lives, so a rule saying it must be file-backed needs the config
// checker to actually notice when it is not — otherwise it is a sentence in a document.
describe('LINE channel token custody', () => {
  const base = {
    ZURI_COMMAND_TRANSPORT: 'zuri-api',
    ZURI_AGENT_DEVICE_ID: 'DEV-01',
    ZURI_AGENT_DEVICE_TOKEN: 'tok',
  } as NodeJS.ProcessEnv;

  it('warns when the token is pasted inline rather than read from a restricted file', () => {
    const result = validateConfig({ ...base, LINE_POC_CHANNEL_ACCESS_TOKEN: 'inline-token' });
    assert.ok(
      (result.warnings ?? []).some((w) => w.includes('LINE_POC_CHANNEL_ACCESS_TOKEN_FILE')),
      'an inline token should name the fix',
    );
    assert.strictEqual(result.checks.linePoc.channelAccessTokenFromFile, false);
  });

  it('stays quiet when the token comes from a file', () => {
    // A real file, because resolveSecret fails closed on one it cannot read — which is itself the
    // behaviour worth relying on: a mistyped path is refused rather than silently treated as absent.
    const file = path.join(os.tmpdir(), `zuri-line-token-${process.pid}`);
    fs.writeFileSync(file, 'file-token');
    try {
      const result = validateConfig({ ...base, LINE_POC_CHANNEL_ACCESS_TOKEN_FILE: file });
      assert.strictEqual(result.checks.linePoc.channelAccessTokenConfigured, true);
      assert.strictEqual(result.checks.linePoc.channelAccessTokenFromFile, true);
      assert.ok(!(result.warnings ?? []).some((w) => w.includes('LINE_POC_CHANNEL_ACCESS_TOKEN_FILE')));
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('does not make the runtime invalid — a warning that blocked startup would just be switched off', () => {
    const result = validateConfig({ ...base, LINE_POC_CHANNEL_ACCESS_TOKEN: 'inline-token' });
    assert.strictEqual(result.valid, true);
    assert.ok((result.warnings ?? []).length > 0);
  });

  it('says nothing at all when no LINE token is configured', () => {
    const result = validateConfig(base);
    assert.strictEqual(result.warnings, undefined);
  });
});

// The predicate shipped asking whether a *_FILE variable existed, which a token pasted inline
// right beside it satisfied. What it has to answer is whether a plaintext token is in .env.
describe('LINE token custody predicate', () => {
  const base = {
    ZURI_COMMAND_TRANSPORT: 'zuri-api',
    ZURI_AGENT_DEVICE_ID: 'DEV-01',
    ZURI_AGENT_DEVICE_TOKEN: 'tok',
  } as NodeJS.ProcessEnv;

  it('still warns when a _FILE is set but a token is also sitting inline', () => {
    const file = path.join(os.tmpdir(), `zuri-tok-${process.pid}`);
    fs.writeFileSync(file, 'from-file');
    try {
      const result = validateConfig({
        ...base,
        LINE_CHANNEL_ACCESS_TOKEN_FILE: file,
        LINE_POC_CHANNEL_ACCESS_TOKEN: 'still-in-plaintext',
      });
      assert.strictEqual(result.checks.linePoc.channelAccessTokenFromFile, false);
      assert.ok((result.warnings ?? []).some((w) => w.includes('plaintext')));
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('treats a whitespace-only inline value as absent rather than as a token', () => {
    const file = path.join(os.tmpdir(), `zuri-tok2-${process.pid}`);
    fs.writeFileSync(file, 'from-file');
    try {
      const result = validateConfig({ ...base, LINE_CHANNEL_ACCESS_TOKEN_FILE: file, LINE_CHANNEL_ACCESS_TOKEN: '   ' });
      assert.strictEqual(result.checks.linePoc.channelAccessTokenFromFile, true);
    } finally {
      fs.rmSync(file, { force: true });
    }
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

describe('direct-message retention', () => {
  const base = (over: Record<string, string> = {}) => ({
    ZURI_TRANSPORT: 'mock',
    LINE_WEBHOOK_ENABLED: 'true',
    LINE_CHANNEL_SECRET: 'secret',
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
