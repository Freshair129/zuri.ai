// Contract for reading and applying settings saved through the local configuration page.
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

const BASE = 'ZURI_LLM_ENABLED=true\nLINE_HISTORY_ROOT=state/chat-history\nLINE_HISTORY_RETENTION_DAYS=30\n';

describe('reading config back from disk', () => {
  it('reads the value that is on disk now, not the one the process started with', () => {
    const file = tempEnv(`${BASE}ZURI_LLM_MODEL=first\n`);
    assert.strictEqual(readConfigFromDisk(file, {}).llmModel, 'first');

    fs.writeFileSync(file, `${BASE}ZURI_LLM_MODEL=second\n`, 'utf8');
    assert.strictEqual(readConfigFromDisk(file, {}).llmModel, 'second');
  });

  it('does not rely on dotenv.config, which refuses to overwrite a variable already set', () => {
    const file = tempEnv(`${BASE}ZURI_LLM_MODEL=on-disk\n`);
    const already = { ZURI_LLM_MODEL: 'stale-from-startup' } as NodeJS.ProcessEnv;
    assert.strictEqual(
      readConfigFromDisk(file, already).llmModel,
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
  it('reports the active model as hot-reloadable', () => {
    const before = readConfigFromDisk(tempEnv(`${BASE}ZURI_LLM_MODEL=first\n`), {});
    const after = readConfigFromDisk(tempEnv(`${BASE}ZURI_LLM_MODEL=second\n`), {});
    const d = diffConfig(before, after);
    assert.deepEqual(d.reloaded, ['llmModel']);
    assert.deepEqual(d.requiresRestart, []);
  });

  it('reports a moved history root as needing a restart', () => {
    const before = readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_ROOT=state/old\n`), {});
    const after = readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_ROOT=state/new\n`), {});
    const d = diffConfig(before, after);
    assert.deepEqual(d.requiresRestart, ['lineHistoryRoot']);
    assert.deepEqual(d.reloaded, []);
  });

  it('says nothing changed when nothing changed', () => {
    const d = diffConfig(readConfigFromDisk(tempEnv(BASE), {}), readConfigFromDisk(tempEnv(BASE), {}));
    assert.deepEqual(d.reloaded, []);
    assert.deepEqual(d.requiresRestart, []);
  });

  it('compares archive group aliases by content, not by object identity', () => {
    const body = `${BASE}LINE_HISTORY_GROUP_TEAM=C123\n`;
    const d = diffConfig(readConfigFromDisk(tempEnv(body), {}), readConfigFromDisk(tempEnv(body), {}));
    assert.deepEqual(d.reloaded, [], 'equal alias maps are not a change');

    const moved = diffConfig(
      readConfigFromDisk(tempEnv(body), {}),
      readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_GROUP_OPERATIONS=C999\n`), {}),
    );
    assert.deepEqual(moved.reloaded, ['lineHistoryAllowedGroupAliases']);
  });

  it('never classifies the same field as both', () => {
    const both = HOT_RELOADABLE.filter((f) => (REQUIRES_RESTART as readonly string[]).includes(f));
    assert.deepEqual(both, []);
  });
});

describe('applying a save to a running process', () => {
  it('mutates the config object in place, because callers may already hold that object', () => {
    const current = readConfigFromDisk(tempEnv(`${BASE}ZURI_LLM_MODEL=old\n`), {});
    const currentRef = current;
    const next = readConfigFromDisk(tempEnv(`${BASE}ZURI_LLM_MODEL=rotated\n`), {});
    const applied = applySavedConfig(current, next);

    assert.strictEqual(current, currentRef);
    assert.strictEqual(current.llmModel, 'rotated');
    assert.ok(applied.reloaded.includes('llmModel'));
  });

  it('reports a restart-only change separately', () => {
    const current = readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_RETENTION_DAYS=30\n`), {});
    const applied = applySavedConfig(
      current,
      readConfigFromDisk(tempEnv(`${BASE}LINE_HISTORY_RETENTION_DAYS=7\n`), {}),
    );
    assert.deepEqual(applied.requiresRestart, ['lineHistoryRetentionDays']);
    assert.deepEqual(applied.reloaded, []);
  });
});

describe('writing one value into .env', () => {
  it('replaces an existing key rather than appending a second one', () => {
    const file = tempEnv(`${BASE}ZURI_LLM_MODEL=old\n`);
    upsertEnvValue('ZURI_LLM_MODEL', 'new', file);
    const body = fs.readFileSync(file, 'utf8');
    assert.strictEqual(body.match(/^ZURI_LLM_MODEL=/gm)?.length, 1);
    assert.match(body, /ZURI_LLM_MODEL="new"/);
  });

  it('appends a key that was not there, keeping what was', () => {
    const file = tempEnv(BASE);
    upsertEnvValue('ZURI_LLM_MODEL', 'custom', file);
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /ZURI_LLM_MODEL="custom"/);
    assert.match(body, /LINE_HISTORY_ROOT=state\/chat-history/);
  });

  it('writes a value dotenv reads back unchanged, including one with a # in it', () => {
    const file = tempEnv(BASE);
    upsertEnvValue('ZURI_LLM_MODEL', 'local#model', file);
    const parsed = dotenv.parse(fs.readFileSync(file));
    assert.strictEqual(parsed.ZURI_LLM_MODEL, 'local#model');
  });
});
