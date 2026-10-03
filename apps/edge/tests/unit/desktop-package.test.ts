import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test('legacy Edge Device desktop packaging is no longer an available package command', () => {
  assert.equal(packageJson.scripts['package:desktop'], undefined);
  assert.equal(packageJson.scripts.start, 'npm run rag:serve');
  assert.equal(fs.existsSync(new URL('../../scripts/package-desktop.mjs', import.meta.url)), false);
});
