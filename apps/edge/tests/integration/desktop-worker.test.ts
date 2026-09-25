import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('retired desktop worker entrypoint cannot be launched by the packaged runtime', () => {
  const worker = fs.readFileSync(new URL('../../src/desktop-worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /EDGE_DESKTOP_WORKER_REMOVED/);
  assert.match(worker, /process\.exitCode\s*=\s*78/);
  assert.doesNotMatch(worker, /readline|createServer|fetch\(|spawn\(|deviceKey|conversation-jobs/);
  const entry = fileURLToPath(new URL('../../src/desktop-worker.ts', import.meta.url));
  const result = spawnSync(process.execPath, [entry], {
    encoding: 'utf8', timeout: 5000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(result.status, 78, result.stderr);
  assert.equal(result.stderr.trim(), 'EDGE_DESKTOP_WORKER_REMOVED');
  assert.equal(result.stdout, '');
});
