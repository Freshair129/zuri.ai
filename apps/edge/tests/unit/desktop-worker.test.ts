import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('../../src/desktop-worker.ts', import.meta.url), 'utf8');
const cli = fs.readFileSync(new URL('../../src/cli/index.ts', import.meta.url), 'utf8');

test('the retired desktop worker has no device credential, cloud claim, residency or model loop', () => {
  assert.match(source, /EDGE_DESKTOP_WORKER_REMOVED/);
  assert.doesNotMatch(source, /edgk_|conversation-jobs|residency|createConversationExecutor|runConversationLoop|LINE/);
  assert.doesNotMatch(cli, /runConversationCommand|conversation serve|conversation once/);
});
