import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectWorkTools } from '../../src/conversation/project-work-tools.js';

test('retired Edge executor exposes no project or Work mutation tools', () => {
  const job = { id: 'job', version: 1 } as never;
  const client = { callTool: async () => { assert.fail('retired Work tool must not run'); } } as never;
  assert.deepEqual(projectWorkTools(job, client), []);
});
