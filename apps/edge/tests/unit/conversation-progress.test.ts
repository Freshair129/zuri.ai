import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createProgressReporter, type ExecutionProgress } from '../../src/conversation/progress.js';
import { bindConversationBudget } from '../../src/conversation/deadline.js';
import { createConversationExecutor } from '../../src/conversation/executor.js';
import type { ConversationJob } from '../../src/conversation/contract.js';

// @req ZAI:FR-150, ZAI:FR-171 — actual per-turn context/model/tool progress without payloads.
// @spec ZAI:ADR-090, SEC-025
function job(): ConversationJob {
  return { id: '10000000-0000-0000-0000-000000000001', executionId: '20000000-0000-0000-0000-000000000001', version: 1,
    question: 'synthetic private question', conversationKey: 'private-conversation', leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
    policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
    deadline: { issuedAt: new Date().toISOString(), answerDeadlineAt: new Date(Date.now() + 40000).toISOString(), remainingBudgetMs: 40000, deliveryMode: 'REPLY' } };
}
test('progress records monotonic spans and exact turn refs, drops arbitrary tools/fields and isolates observer failures', async () => {
  const current = job(); let now = 10; bindConversationBudget(current, now, () => now);
  const events: ExecutionProgress[] = [];
  const report = createProgressReporter(current, 'qwen3.5:9b', async event => { events.push(event); throw new Error('observer failed'); }, () => now);
  report({ phase: 'TOOL', state: 'STARTED', toolName: 'quote_price', rawPrompt: 'secret' } as never);
  now = 25; report({ phase: 'TOOL', state: 'COMPLETED', toolName: 'quote_price' });
  report({ phase: 'TOOL', state: 'STARTED', toolName: 'arbitrary_shell' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 2);
  assert.equal(events[1].durationMs, 15);
  assert.equal(events[1].elapsedMs, 15);
  assert.equal(events[1].remainingBudgetMs, 39985);
  assert.equal(events[1].executionId, '20000000-0000-0000-0000-000000000001');
  assert.doesNotMatch(JSON.stringify(events), /secret|private|arbitrary_shell/);
  const other = job(); other.id = '10000000-0000-0000-0000-000000000002'; bindConversationBudget(other, now, () => now);
  const next: ExecutionProgress[] = [];
  createProgressReporter(other, 'http://secret.invalid/model', event => { next.push(event); }, () => now)({ phase: 'MODEL', state: 'STARTED' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(next[0].elapsedMs, 0); assert.equal(next[0].modelRef, undefined); assert.notEqual(next[0].jobId, events[0].jobId);
});

test('actual local provider rounds and tool invocation report progress even without MemoryOS slices', async () => {
  const current = job(); bindConversationBudget(current, performance.now());
  const events: ExecutionProgress[] = []; let rounds = 0;
  const execute = createConversationExecutor({ llmEnabled: true, llmBaseUrl: 'http://127.0.0.1:11434/v1', llmModel: 'qwen3.5:9b',
    catalogRoot: path.join(os.tmpdir(), 'synthetic-progress-no-catalog') }, {
    genesisRag17: null,
    onProgress: event => { events.push(event); if (event.state === 'STARTED') throw new Error('diagnostic failure'); },
    fetchFn: async url => {
      assert.match(String(url), /chat\/completions$/);
      rounds++;
      return Response.json({ choices: [{ message: rounds === 1
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'lead_time', arguments: '{"quantity":100}' } }] }
        : { role: 'assistant', content: 'ตรวจเงื่อนไขแล้ว' } }] });
    },
  });
  const result = await execute(current);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.text, 'ตรวจเงื่อนไขแล้ว');
  assert.equal(rounds, 2);
  assert.deepEqual(events.map(e => `${e.phase}:${e.state}`), [
    'CONTEXT:STARTED', 'CONTEXT:COMPLETED', 'MODEL:STARTED', 'MODEL:COMPLETED',
    'TOOL:STARTED', 'TOOL:COMPLETED', 'CONTEXT:STARTED', 'CONTEXT:COMPLETED', 'MODEL:STARTED', 'MODEL:COMPLETED',
  ]);
  assert.ok(events.every((event, index) => event.elapsedMs >= (events[index - 1]?.elapsedMs ?? 0)));
  assert.doesNotMatch(JSON.stringify(events), /private question|quantity|100\}|ตรวจเงื่อนไข/);
});
