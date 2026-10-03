import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const appRoot = new URL('../../', import.meta.url);
const readAppFile = (relativePath: string) =>
  fs.readFileSync(new URL(relativePath, appRoot), 'utf8');

const originalSkipDotenv = process.env.ZURI_CONFIG_SKIP_DOTENV;
process.env.ZURI_CONFIG_SKIP_DOTENV = '1';
const { loadConfig, validateConfig } = await import('../../src/config/index.js');
if (originalSkipDotenv === undefined) delete process.env.ZURI_CONFIG_SKIP_DOTENV;
else process.env.ZURI_CONFIG_SKIP_DOTENV = originalSkipDotenv;

test('retired device credentials do not configure the retained local runtime', () => {
  const legacy = {
    ZURI_COMMAND_TRANSPORT: 'zuri-api',
    ZURI_COMMAND_API_BASE_URL: 'https://retired.example',
    ZURI_AGENT_DEVICE_ID: 'synthetic-device',
    ZURI_AGENT_DEVICE_TOKEN: 'synthetic-device-token',
    ZURI_EDGE_DEVICE_KEY: 'edgk_synthetic-device-key',
  } as NodeJS.ProcessEnv;

  const config = loadConfig(legacy);
  const result = validateConfig(legacy);

  assert.equal(result.valid, true);
  for (const field of ['transport', 'apiBaseUrl', 'deviceId', 'deviceToken', 'edgeDeviceKey']) {
    assert.equal(field in config, false, `${field} must not be loaded`);
  }
  for (const field of ['transport', 'apiBaseUrl', 'deviceId', 'deviceTokenConfigured']) {
    assert.equal(field in result.checks, false, `${field} must not be validated`);
  }
});

test('retired pairing UI and command API callers are absent while local RAG remains available', () => {
  const gui = readAppFile('edge-gui.html');
  const cli = readAppFile('src/cli/index.ts');
  const tauriLib = readAppFile('src-tauri/src/lib.rs');
  const exampleEnv = readAppFile('.env.example');
  const packageJson = JSON.parse(readAppFile('package.json')) as { scripts: Record<string, string> };

  assert.doesNotMatch(gui, /edgeDeviceId|edgeDeviceToken|edgeDeviceSecret|importPairingJson|pairingStatus|ZURI_CLOUD_BASE_URL/i);
  assert.doesNotMatch(cli, /getZuriApiClient|handlePreview|handleSend|handleStatus|buildHealthReport|ZURI_COMMAND_API_BASE_URL|zuri-api\/client/i);
  assert.doesNotMatch(cli, /runConversationCommand|conversation serve|conversation once/);
  assert.doesNotMatch(exampleEnv, /ZURI_COMMAND_|ZURI_AGENT_DEVICE_|ZURI_CLOUD_BASE_URL|ZURI_EDGE_DEVICE_KEY|BRIDGE_POLL_INTERVAL|BRIDGE_MAX_CONCURRENT/);
  assert.equal(fs.existsSync(new URL('src/zuri-api/client.ts', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src/desktop-worker.ts', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src/answer/providers/model-residency-schedule.ts', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src-tauri/src/credential_store.rs', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src/cli/commands.ts', appRoot)), false);
  assert.doesNotMatch(tauriLib, /mod (?:durable_log|packaged_runtime_tests|supervisor);/);
  assert.equal(fs.existsSync(new URL('src-tauri/src/supervisor.rs', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src-tauri/src/durable_log.rs', appRoot)), false);
  assert.equal(fs.existsSync(new URL('src-tauri/src/packaged_runtime_tests.rs', appRoot)), false);
  assert.equal(packageJson.scripts.start, 'npm run rag:serve');
  assert.equal(fs.existsSync(new URL('src/zuri-api/types.ts', appRoot)), false);
});
