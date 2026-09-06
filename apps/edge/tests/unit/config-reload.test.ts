// Contract for picking up configuration saved through the settings page.
//
// The page writes `.env` and the process used to keep whatever it read at startup, so rotating the
// LINE channel token there reported success and changed nothing. That is the worst shape a bug can
// take — it tells the operator the job is done — and every property below exists to keep it fixed.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

import {
  readConfigFromDisk,
  diffConfig,
  applySavedConfig,
  upsertEnvValue,
  HOT_RELOADABLE,
  REQUIRES_RESTART,
} from '../../src/config/reload.js';

const written: string[] = [];
function tempEnv(body: string): string {
  const file = path.join(os.tmpdir(), `zuri-env-${process.pid}-${written.length}`);
  fs.writeFileSync(file, body, 'utf8');
  written.push(file);
  return file;
}
afterEach(() => {
  while (written.length) fs.rmSync(written.pop()!, { force: true });
});

const BASE = 'ZURI_COMMAND_TRANSPORT=zuri-api\nZURI_AGENT_DEVICE_ID=DEV-1\nZURI_AGENT_DEVICE_TOKEN=t\n';

describe('reading config back from disk', () => {
  // The trap that made the original bug survive a first attempt at fixing it: dotenv.config() does
  // not overwrite a variable already in process.env, so re-calling it returns the startup value
  // forever. Anything built on that would look like a reload and reload nothing.
  it('reads the value that is on disk now, not the one the process started with', () => {
    const file = tempEnv(`${BASE}LINE_CHANNEL_SECRET=first
`);
    assert.strictEqual(readConfigFromDisk(file, {}).lineChannelSecret, 'first');

    // What the settings page does.
    fs.writeFileSync(file, `${BASE}LINE_CHANNEL_SECRET=second
`, 'utf8');
    assert.strictEqual(readConfigFromDisk(file, {}).lineChannelSecret, 'second');
  });

  // The trap that would have made a first attempt at this look right and reload nothing.
  it('does not rely on dotenv.config, which refuses to overwrite a variable already set', () => {
    const file = tempEnv(`${BASE}LINE_CHANNEL_SECRET=on-disk
`);
    const already = { LINE_CHANNEL_SECRET: 'stale-from-startup' } as NodeJS.ProcessEnv;
    assert.strictEqual(
      readConfigFromDisk(file, already).lineChannelSecret,
      'on-disk',
      'the file must outrank the environment the process was started with',
    );
  });

  it('returns defaults rather than throwing when there is no .env at all', () => {
    const missing = path.join(os.tmpdir(), `zuri-env-absent-${process.pid}`);
    assert.ok(!fs.existsSync(missing));
    assert.doesNotThrow(() => readConfigFromDisk(missing, {}));
  });
});

describe('classifying what changed', () => {
  it('reports a rotated channel token as reloaded, not as needing a restart', () => {
    const before = readConfigFromDisk(tempEnv(`${BASE}LINE_POC_CHANNEL_ACCESS_TOKEN=old\n`), {});
    const after = readConfigFromDisk(tempEnv(`${BASE}LINE_POC_CHANNEL_ACCESS_TOKEN=new\n`), {});
    const d = diffConfig(before, after);
    assert.deepEqual(d.reloaded, ['linePocChannelAccessToken']);
    assert.deepEqual(d.requiresRestart, []);
  });

  it('reports a moved port as needing a restart, because the socket is already bound', () => {
    const before = readConfigFromDisk(tempEnv(`${BASE}LINE_WEBHOOK_PORT=8787\n`), {});
    const after = readConfigFromDisk(tempEnv(`${BASE}LINE_WEBHOOK_PORT=9999\n`), {});
    const d = diffConfig(before, after);
    assert.deepEqual(d.requiresRestart, ['lineWebhookPort']);
    assert.deepEqual(d.reloaded, []);
  });

  it('says nothing changed when nothing changed, so a no-op save does not claim a reload', () => {
    const body = `${BASE}LINE_CHANNEL_SECRET=same\n`;
    const d = diffConfig(readConfigFromDisk(tempEnv(body), {}), readConfigFromDisk(tempEnv(body), {}));
    assert.deepEqual(d.reloaded, []);
    assert.deepEqual(d.requiresRestart, []);
  });

  it('compares group aliases by content, not by object identity', () => {
    const body = `${BASE}LINE_POC_GROUP_LEADERSHIP=C123\n`;
    const d = diffConfig(readConfigFromDisk(tempEnv(body), {}), readConfigFromDisk(tempEnv(body), {}));
    assert.deepEqual(d.reloaded, [], 'two equal alias maps are not a change');

    const moved = diffConfig(
      readConfigFromDisk(tempEnv(body), {}),
      readConfigFromDisk(tempEnv(`${BASE}LINE_POC_GROUP_LEADERSHIP=C999\n`), {}),
    );
    assert.deepEqual(moved.reloaded, ['linePocGroupAliases']);
  });

  // The two lists are a claim about the code: a field in the wrong one either silently fails to
  // apply or sends the operator to restart for nothing.
  it('never classifies the same field as both', () => {
    const both = HOT_RELOADABLE.filter((f) => (REQUIRES_RESTART as readonly string[]).includes(f));
    assert.deepEqual(both, []);
  });
});

describe('applying a save to a running process', () => {
  it('mutates the config object in place, because every closure already holds that object', () => {
    const current = readConfigFromDisk(tempEnv(`${BASE}LINE_POC_CHANNEL_ACCESS_TOKEN=old\n`), {});
    const options = { channelSecret: '', groupAliases: {}, allowedGroupAliases: [] };
    // What the LINE client does: capture the object once, read the field per call.
    const clientReadsTokenNow = () => current.linePocChannelAccessToken;

    const next = readConfigFromDisk(tempEnv(`${BASE}LINE_POC_CHANNEL_ACCESS_TOKEN=rotated\n`), {});
    const applied = applySavedConfig(current, options, next);

    assert.strictEqual(clientReadsTokenNow(), 'rotated', 'a push after the save uses the new token');
    assert.ok(applied.reloaded.includes('linePocChannelAccessToken'));
  });

  it('updates the server options the request handler reads per message', () => {
    const current = readConfigFromDisk(tempEnv(`${BASE}LINE_CHANNEL_SECRET=old\n`), {});
    const options = { channelSecret: 'old', groupAliases: {}, allowedGroupAliases: [] };
    applySavedConfig(current, options, readConfigFromDisk(tempEnv(`${BASE}LINE_CHANNEL_SECRET=new\n`), {}));
    assert.strictEqual(options.channelSecret, 'new', 'the next signature check uses the new secret');
  });

  it('reports a restart-only change without pretending it applied', () => {
    const current = readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_RETENTION_DAYS=30\n`), {});
    const options = { channelSecret: '', groupAliases: {}, allowedGroupAliases: [] };
    const applied = applySavedConfig(
      current,
      options,
      readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_RETENTION_DAYS=7\n`), {}),
    );
    assert.deepEqual(applied.requiresRestart, ['lineHistoryRetentionDays']);
    assert.deepEqual(applied.reloaded, []);
  });
});

describe('writing one value into .env', () => {
  it('replaces an existing key rather than appending a second one', () => {
    const file = tempEnv(`${BASE}ZURI_EDGE_ADMIN_KEY_HASH=old\n`);
    upsertEnvValue('ZURI_EDGE_ADMIN_KEY_HASH', 'new', file);
    const body = fs.readFileSync(file, 'utf8');
    assert.strictEqual(body.match(/^ZURI_EDGE_ADMIN_KEY_HASH=/gm)?.length, 1);
    assert.match(body, /ZURI_EDGE_ADMIN_KEY_HASH="new"/);
  });

  it('appends a key that was not there, keeping what was', () => {
    const file = tempEnv(BASE);
    upsertEnvValue('ZURI_EDGE_ADMIN_KEY_HASH', 'abc', file);
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /ZURI_EDGE_ADMIN_KEY_HASH="abc"/);
    assert.match(body, /ZURI_AGENT_DEVICE_ID=DEV-1/);
  });

  it('writes a value dotenv reads back unchanged, including one with a # in it', () => {
    const file = tempEnv(BASE);
    upsertEnvValue('LINE_POC_CHANNEL_ACCESS_TOKEN', 'ab#cd/ef+gh=', file);
    const parsed = dotenv.parse(fs.readFileSync(file));
    assert.strictEqual(parsed.LINE_POC_CHANNEL_ACCESS_TOKEN, 'ab#cd/ef+gh=');
  });
});
