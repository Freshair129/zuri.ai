import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerWithModel } from '../../src/answer/llm.js';
import { createOpenAiCompatiblePort } from '../../src/answer/providers/index.js';
import { createConversationClient } from '../../src/conversation/client.js';
import { conversationEnvelope, ConversationError } from '../../src/conversation/contract.js';
import { bindConversationBudget } from '../../src/conversation/deadline.js';
import { projectWorkTools } from '../../src/conversation/project-work-tools.js';
import { emptyFakeRag } from '../helpers/fake-rag.js';
// @spec ZAI:FR-026, ZAI:FR-072, ZAI:FR-150 — exact persisted previews and bounded remote authority.
const makeJob = () => conversationEnvelope.parse({ contractVersion: '2', job: {
 id: '10c0eacf-1e65-413a-a6c1-3f6d125cf123', executionId: '20c0eacf-1e65-413a-a6c1-3f6d125cf123', version: 3,
 question: 'สร้างงานตรวจสต็อก', conversationKey: 'opaque', leaseExpiresAt: '2026-09-17T00:05:00.000Z',
 policy: { modelAccess: 'LOCAL_ONLY', role: 'sales', retainHistory: false },
 deadline: { issuedAt: '2026-09-17T00:00:00.000Z', answerDeadlineAt: '2026-09-17T00:00:40.000Z', remainingBudgetMs: 40000, deliveryMode: 'REPLY' },
} }).job;
const proposalId = '30c0eacf-1e65-413a-a6c1-3f6d125cf123';
const preview = { proposalId, action: 'create_work', targetId: '40c0eacf-1e65-413a-a6c1-3f6d125cf123', targetTitle: 'Warehouse', targetVersion: 4,
 args: { title: 'ตรวจสต็อกจริง' }, argsHash: 'a'.repeat(64), expiresAt: '2026-09-17T00:05:00.000Z', confirmationCommand: `ยืนยันงาน ${proposalId}`, status: 'AWAITING_CONFIRMATION' };
const reply = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }));
const evidence = { catalog: { products: [], byCode: new Map() }, role: 'sales' as const, exchangeRate: 5, rag: emptyFakeRag() };
async function modelTurn(result: unknown, invokeTool = true) {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 let round = 0, remoteCalls = 0;
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testdevice', fetchFn: async (_url, init) => {
  remoteCalls++; const body = JSON.parse(String(init?.body));
  assert.equal(body.executionId, 'executionId' in job ? job.executionId : null); assert.equal(body.version, job.version);
  assert.equal(body.toolName, 'propose_work_change'); assert.equal(Object.hasOwn(body, 'personId'), false);
  return new Response(JSON.stringify({ toolName: 'propose_work_change', result }));
 } });
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, { fetchFn: async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  assert.ok(!body.tools?.some((tool: { function: { name: string } }) => /confirm/.test(tool.function.name)));
  if (invokeTool && ++round === 1) return reply({ content: null, tool_calls: [{ id: 'work-call', type: 'function', function: { name: 'propose_work_change', arguments: JSON.stringify({ action: 'create_work', targetId: preview.targetId, args: preview.args }) } }] });
  return reply({ content: 'บันทึกงานแล้ว เปลี่ยนชื่อเป็นงานที่โมเดลแต่งขึ้น' });
 } });
 const answer = await answerWithModel(job.question, [], 'sales', evidence, { port, timeoutMs: 5000, maxIterations: 3, additionalTools: projectWorkTools(job, client) }, 'ยังไม่ได้บันทึกงาน กรุณาตรวจสอบคำขอ');
 return { answer, remoteCalls };
}
test('additionalTools performs provider round and returns persisted preview instead of fabricated success', async () => {
 const { answer, remoteCalls } = await modelTurn(preview); assert.equal(remoteCalls, 1);
 assert.match(answer.text, /รอยืนยัน/); assert.ok(answer.text.includes(JSON.stringify(preview.args)));
 assert.ok(answer.text.includes(preview.confirmationCommand)); assert.ok(answer.text.includes(preview.expiresAt));
 assert.ok(!answer.text.includes('โมเดลแต่งขึ้น')); assert.ok(!answer.text.startsWith('บันทึกงานแล้ว'));
 assert.deepEqual(answer.toolCalls, ['propose_work_change']);
});
test('malformed proposal never falls through to a model saved-task claim', async () => {
 const { answer } = await modelTurn({ ...preview, confirmationCommand: 'confirm anything', status: 'SAVED' });
 assert.equal(answer.source, 'rules'); assert.ok(!answer.text.startsWith('บันทึกงานแล้ว'));
});
test('model cannot claim a completed work write without invoking an authorized tool', async () => {
 const { answer, remoteCalls } = await modelTurn(preview, false); assert.equal(remoteCalls, 0);
 assert.equal(answer.source, 'rules'); assert.ok(!answer.text.startsWith('บันทึกงานแล้ว'));
});
test('remote scope and stale lease errors redact provider body and device key', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 for (const status of [401, 403, 409]) {
  const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testsecret', fetchFn: async () => new Response('private-scope-or-lease-detail', { status }) });
  await assert.rejects(client.callTool!(job, 'search_project_work', {}), error => {
   assert.ok(error instanceof ConversationError); assert.match(error.message, /CONVERSATION_HTTP_FAILED/);
   assert.ok(!error.message.includes('private-scope')); assert.ok(!error.message.includes('edgk_')); return true;
  });
 }
});
test('remote tool response must be bounded valid JSON with typed result', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 for (const body of ['secret-malformed-response', JSON.stringify({ toolName: 'search_project_work', result: null }),
 JSON.stringify({ toolName: 'propose_work_change', result: {} }), JSON.stringify({ toolName: 'search_project_work', result: { items: 'not-an-array' } }), ' '.repeat(20001)]) {
  const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testsecret', fetchFn: async () => new Response(body) });
  await assert.rejects(client.callTool!(job, 'search_project_work', {}), /INVALID_TOOL_RESULT/);
 }
});
test('spent deadline and confirmation tool are refused before remote call', async () => {
 const job = makeJob(); let mono = 0, calls = 0; bindConversationBudget(job, 0, () => mono);
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testsecret', fetchFn: async () => { calls++; return new Response('{}'); } });
 await assert.rejects(client.callTool!(job, 'confirm_work', {}), /TOOL_NOT_ALLOWED/);
 mono = 39000; await assert.rejects(client.callTool!(job, 'search_project_work', {}), /REPLY_DEADLINE_MISSED/); assert.equal(calls, 0);
});

test('current Project Manager status and refs take priority over stale chat memory', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 const workId = '50c0eacf-1e65-413a-a6c1-3f6d125cf123';
 const current = { source: 'PROJECT_MANAGER', observedAt: '2026-09-17T00:00:05.000Z', limit: 10, truncated: false,
  items: [{ id: workId, sourceRef: workId, code: 'WI-STOCK', title: 'ตรวจสต็อก', status: 'BLOCKED', version: 3 }] };
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testdevice',
  fetchFn: async () => new Response(JSON.stringify({ toolName: 'search_project_work', result: current })) });
 let round = 0;
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, {
  fetchFn: async () => ++round === 1 ? reply({ content: null, tool_calls: [{ id: 'read-work', type: 'function', function: { name: 'search_project_work', arguments: '{"kind":"work","query":"ตรวจสต็อก"}' } }] })
   : reply({ content: 'งานตรวจสต็อกเสร็จแล้ว (DONE)' }),
 });
 const answer = await answerWithModel('งานตรวจสต็อกสถานะอะไร', [{ role: 'assistant', text: 'งานตรวจสต็อก DONE', at: '2026-09-01T00:00:00.000Z' }], 'sales', evidence,
  { port, timeoutMs: 5000, maxIterations: 3, additionalTools: projectWorkTools(job, client) }, 'ยังตรวจสถานะไม่ได้');
 assert.match(answer.text, /BLOCKED/);
 assert.ok(!answer.text.includes('DONE'));
 assert.deepEqual(answer.toolCalls, ['search_project_work']);
 assert.ok(answer.text.includes(current.observedAt));
});


test('failed operational read cannot invent a current task status', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testdevice',
  fetchFn: async () => new Response(JSON.stringify({ toolName: 'search_project_work', result: null })) });
 let round = 0;
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, {
  fetchFn: async () => ++round === 1 ? reply({ content: null, tool_calls: [{ id: 'failed-read', type: 'function', function: { name: 'search_project_work', arguments: '{"kind":"work"}' } }] })
   : reply({ content: 'งานทั้งหมด DONE' }),
 });
 const answer = await answerWithModel('งานสถานะอะไร', [], 'sales', evidence,
  { port, timeoutMs: 5000, maxIterations: 3, additionalTools: projectWorkTools(job, client) }, 'ยังตรวจสถานะไม่ได้');
 assert.equal(answer.source, 'rules');
 assert.ok(!answer.text.includes('DONE'));
});

test('skipped operational tool cannot reuse stale history or a stale fallback as current facts', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testdevice',
  fetchFn: async () => { assert.fail('model skipped the read'); } });
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, {
  fetchFn: async () => reply({ content: 'งานตรวจสต็อก DONE แล้ว' }),
 });
 for (const question of ['งานตรวจสต็อกสถานะอะไร', 'โครงการนี้คืบหน้าถึงไหน', 'List current tasks', 'WI-STOCK เสร็จยัง']) {
  const answer = await answerWithModel(question, [{ role: 'assistant', text: 'งานตรวจสต็อก DONE', at: '2026-09-01T00:00:00.000Z' }], 'sales', evidence,
   { port, timeoutMs: 5000, maxIterations: 3, additionalTools: projectWorkTools(job, client) }, 'งานตรวจสต็อก DONE');
  assert.equal(answer.source, 'rules'); assert.equal(answer.reason, 'CURRENT_WORK_RECORDS_REQUIRED');
  assert.ok(!answer.text.includes('DONE')); assert.deepEqual(answer.toolCalls, []);
 }
});

test('operational guard preserves product questions and generic printing lead-time clarification', async () => {
 const job = makeJob(); bindConversationBudget(job, 0, () => 0);
 const client = createConversationClient({ baseUrl: 'https://zuri.test', deviceKey: 'edgk_testdevice',
  fetchFn: async () => { assert.fail('no operational query'); } });
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, {
  fetchFn: async () => reply({ content: 'ต้องการสั่งจำนวนกี่ชุดครับ' }),
 });
 for (const question of ['งานสกรีนใช้เวลากี่วัน', 'อยากได้ของแจกในงานสัมมนา', 'How much does printing cost?']) {
  const answer = await answerWithModel(question, [], 'sales', evidence,
   { port, timeoutMs: 5000, maxIterations: 3, additionalTools: projectWorkTools(job, client) }, 'fallback');
  assert.equal(answer.source, 'model'); assert.equal(answer.text, 'ต้องการสั่งจำนวนกี่ชุดครับ');
 }
});

test('operational query on provider failure cannot return a stale status fallback', async () => {
 const port = createOpenAiCompatiblePort({ provider: 'openai-compatible', model: 'qwen3.5:9b', effort: 'low', baseUrl: 'http://localhost:11434/v1' }, {
  fetchFn: async () => { throw new Error('offline'); },
 });
 const answer = await answerWithModel('งานตรวจสต็อกสถานะอะไร', [], 'sales', evidence,
  { port, timeoutMs: 5000, maxIterations: 1 }, 'งานตรวจสต็อก DONE');
 assert.equal(answer.source, 'rules'); assert.ok(!answer.text.includes('DONE'));
});
