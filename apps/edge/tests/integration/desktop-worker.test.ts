import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

type WorkerEvent = { type?: string; code?: string; outcome?: string; [key: string]: unknown };

function createCleanupFaultPreload(markerPath: string): string {
  const preloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-desktop-worker-preload-'));
  const preloadPath = path.join(preloadRoot, 'cleanup-fault.cjs');
  fs.writeFileSync(preloadPath, [
    "const fs = require('node:fs');",
    'const originalRmSync = fs.rmSync;',
    'fs.rmSync = function cleanupFault(target, options) {',
    "  if (String(target).includes('.worker-runtime-')) {",
    `    fs.writeFileSync(${JSON.stringify(markerPath)}, 'triggered');`,
    "    const error = new Error('synthetic private runtime cleanup failure');",
    "    error.code = 'EBUSY';",
    '    throw error;',
    '  }',
    '  return originalRmSync.call(this, target, options);',
    '};',
  ].join('\n'));
  return preloadRoot;
}

function waitForEvent(child: ReturnType<typeof spawn>, events: WorkerEvent[], predicate: (event: WorkerEvent) => boolean): Promise<WorkerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker event timeout')), 15_000);
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        let event: WorkerEvent;
        try { event = JSON.parse(line) as WorkerEvent; } catch { reject(new Error(`non-json worker output: ${line}`)); return; }
        events.push(event);
        if (predicate(event)) {
          clearTimeout(timer);
          child.stdout?.off('data', onData);
          resolve(event);
          return;
        }
      }
    };
    child.stdout?.on('data', onData);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timer); reject(new Error(`worker exited ${code}`)); }
    });
  });
}

test('real managed child runs the existing worker loop and stops through private stdin', async () => {
  const requests: Array<{ path: string; authorization?: string }> = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url || '', authorization: request.headers.authorization });
    if (request.method === 'GET' && request.url === '/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/claim')) { response.statusCode = 204; response.end(); return; }
    response.end(JSON.stringify({ acknowledged: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-desktop-worker-test-'));
  const events: WorkerEvent[] = [];
  let stderr = '';
  let stdout = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/desktop-worker.ts'], {
    cwd: path.resolve('.'),
    env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '',
      ZURI_HEADLESS_ENABLED: 'false', ZURI_LLM_ENABLED: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    child.stdin?.write(`${JSON.stringify({
      type: 'initialize', version: 1, deviceId: 'DEV-DESKTOP-TEST',
      deviceKey: 'edgk_synthetic_test_credential', cloudBaseUrl: origin, dataRoot,
      ragUrl: origin, pollIntervalMs: 250, heartbeatIntervalMs: 5000,
      provider: { llmEnabled: false, llmAllowCloud: false, headlessEnabled: false, headlessBin: 'claude' },
    })}\n`);
    await waitForEvent(child, events, (event) => event.type === 'ready').catch((error) => {
      throw new Error(`${error instanceof Error ? error.message : error}; stdout=${stdout}; stderr=${stderr}`);
    });
    await waitForEvent(child, events, (event) => event.type === 'claim' && event.outcome === 'idle');
    child.stdin?.write('{"type":"unexpected","version":1}\n');
    await waitForEvent(child, events, (event) => event.type === 'failure' && event.code === 'INVALID_MESSAGE');
    child.stdin?.write('{"type":"heartbeat","version":1}\n');
    await waitForEvent(child, events, (event) => event.type === 'heartbeat');
    child.stdin?.write('{"type":"stop","version":1,"reason":"operator","deadlineMs":5000}\n');
    await waitForEvent(child, events, (event) => event.type === 'stopped');
    const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(exit, 0);
    assert.ok(events.some((event) => event.type === 'stopping'));
    assert.ok(events.every((event) => !JSON.stringify(event).includes('edgk_synthetic_test_credential')));
    assert.ok(requests.some((request) => request.path.endsWith('/claim')));
    assert.ok(requests.some((request) => request.path === '/api/agent/heartbeat'));
    assert.ok(requests.filter((request) => request.path !== '/health').every((request) => request.authorization === 'Bearer edgk_synthetic_test_credential'));
    assert.equal(fs.existsSync(path.join(dataRoot, '.zuri-worker.lock')), false);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('EOF during module initialization is preserved as a graceful parent stop', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = request.url?.endsWith('/claim') ? 204 : 200;
    response.end(request.url?.endsWith('/claim') ? undefined : JSON.stringify({ acknowledged: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-desktop-worker-eof-'));
  const events: WorkerEvent[] = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/desktop-worker.ts'], {
    cwd: path.resolve('.'),
    env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const lines: string[] = [];
    child.stdout?.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/).filter(Boolean)) {
        lines.push(line);
        try { events.push(JSON.parse(line) as WorkerEvent); } catch { /* assertion below catches no lifecycle event */ }
      }
    });
    const origin = `http://127.0.0.1:${address.port}`;
    child.stdin?.write(`${JSON.stringify({
      type: 'initialize', version: 1, deviceId: 'DEV-DESKTOP-EOF',
      deviceKey: 'edgk_synthetic_test_credential', cloudBaseUrl: origin, dataRoot,
      ragUrl: origin, pollIntervalMs: 250, heartbeatIntervalMs: 5000,
      provider: { llmEnabled: false, llmAllowCloud: false, headlessEnabled: false, headlessBin: 'claude' },
    })}\n`);
    child.stdin?.end();
    const exit = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`EOF stop timeout; output=${lines.join('|')}`)), 15_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exit, 0);
    assert.ok(events.some((event) => event.type === 'stopping' && event.reason === 'parent'));
    assert.ok(events.some((event) => event.type === 'stopped'));
    assert.equal(fs.existsSync(path.join(dataRoot, '.zuri-worker.lock')), false);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('private runtime cleanup failure does not turn a graceful stop into exit 2', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.statusCode = request.url?.endsWith('/claim') ? 204 : 200;
    response.end(request.url?.endsWith('/claim') ? undefined : JSON.stringify({ acknowledged: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-desktop-worker-cleanup-'));
  const markerPath = path.join(dataRoot, 'cleanup-fault.marker');
  const preloadRoot = createCleanupFaultPreload(markerPath);
  const preloadPath = path.join(preloadRoot, 'cleanup-fault.cjs');
  const events: WorkerEvent[] = [];
  let stdout = '';
  let stderr = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/desktop-worker.ts'], {
    cwd: path.resolve('.'),
    env: {
      PATH: process.env.PATH || '',
      SystemRoot: process.env.SystemRoot || '',
      NODE_OPTIONS: `--require=${preloadPath}`,
      ZURI_HEADLESS_ENABLED: 'false',
      ZURI_LLM_ENABLED: 'false',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    child.stdin?.write(`${JSON.stringify({
      type: 'initialize', version: 1, deviceId: 'DEV-DESKTOP-CLEANUP',
      deviceKey: 'edgk_synthetic_test_credential', cloudBaseUrl: origin, dataRoot,
      ragUrl: origin, pollIntervalMs: 250, heartbeatIntervalMs: 5000,
      provider: { llmEnabled: false, llmAllowCloud: false, headlessEnabled: false, headlessBin: 'claude' },
    })}\n`);
    await waitForEvent(child, events, (event) => event.type === 'ready').catch((error) => {
      throw new Error(`${error instanceof Error ? error.message : error}; stdout=${stdout}; stderr=${stderr}`);
    });
    await waitForEvent(child, events, (event) => event.type === 'claim' && event.outcome === 'idle');
    child.stdin?.write('{"type":"stop","version":1,"reason":"operator","deadlineMs":5000}\n');
    await waitForEvent(child, events, (event) => event.type === 'stopped');
    const exit = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(exit, 0);
    assert.equal(fs.existsSync(markerPath), true, `cleanup fault was not triggered; stdout=${stdout}; stderr=${stderr}`);
    assert.equal(events.some((event) => event.type === 'failure'), false);
    assert.equal(fs.existsSync(path.join(dataRoot, '.zuri-worker.lock')), false);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(preloadRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
