import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// @req ZAI:FR-150, ZAI:FR-171 — reconnect resumes native console pages without duplicating events.
// @spec ZAI:ADR-090, SEC-025
const source = fs.readFileSync(new URL('../../public/desktop.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function refreshWorkerLog()'), source.indexOf('async function refreshWorker({'));
const entry = (id: string) => ({ id, at: new Date().toISOString(), message: 'งาน: failed', level: 'error' });
function fixture(responses: unknown[]) {
  const calls: unknown[] = [];
  const state: any = { workerLog: [], workerLogCursor: null, workerLogBusy: false };
  const context = vm.createContext({ state, native: true, renderWorkerLog() {}, Date, Map, Array, Error,
    async invoke(command: string, params: unknown) { calls.push([command, params]); const response = responses.shift(); if (response instanceof Error) throw response; return response; } });
  vm.runInContext(`${body};globalThis.refresh = refreshWorkerLog;`, context);
  return { state, calls, refresh: () => context.refresh() };
}
test('native console resumes cursor, deduplicates overlapping pages and resets explicitly on a gap', async () => {
  const f = fixture([{ entries: [entry('one')], cursor: 'epoch:1', storage: 'DURABLE' },
    { entries: [entry('one'), entry('two')], cursor: 'epoch:2', storage: 'DURABLE' },
    { entries: [entry('three')], cursor: 'next:3', storage: 'PENDING', gap: 'PROCESS_RESTART_OR_RESET' }]);
  await f.refresh(); await f.refresh();
  assert.deepEqual(Array.from(f.state.workerLog, (e: any) => e.id), ['one', 'two']);
  assert.equal(JSON.stringify(f.calls[1]), JSON.stringify(['get_worker_log_page', { cursor: 'epoch:1' }]));
  await f.refresh();
  assert.deepEqual(Array.from(f.state.workerLog, (e: any) => e.id), ['three']);
  assert.equal(f.state.workerLogGap, 'PROCESS_RESTART_OR_RESET');
  assert.equal(f.state.workerLogStorage, 'PENDING');
});
test('failed or malformed console pages retain cursor/evidence and report unavailable', async () => {
  const f = fixture([{ entries: [entry('one')], cursor: 'epoch:1', storage: 'DURABLE' }, new Error('offline'), { entries: [] }]);
  await f.refresh(); await f.refresh(); await f.refresh();
  assert.equal(f.state.workerLogCursor, 'epoch:1');
  assert.equal(f.state.workerLog.length, 1);
  assert.equal(f.state.workerLogStorage, 'UNAVAILABLE');
  assert.equal(f.state.workerLogBusy, false);
});
test('console bounds retained pages and expires old diagnostic events', async () => {
  const entries = [entry('expired'), ...Array.from({ length: 220 }, (_, i) => entry(String(i)))];
  entries[0].at = '2000-01-01T00:00:00Z';
  const f = fixture([{ entries, cursor: 'epoch:221', storage: 'DURABLE' }]);
  await f.refresh();
  assert.equal(f.state.workerLog.length, 200);
  assert.equal(f.state.workerLog[0].id, '20');
});
test('a window reload checks saved cursor then reloads native history', async () => {
  const f = fixture([{ entries: [], cursor: 'epoch:2', storage: 'DURABLE' },
    { entries: [entry('one'), entry('two')], cursor: 'epoch:2', storage: 'DURABLE' }]);
  f.state.workerLogCursor = 'epoch:2';
  await f.refresh();
  assert.equal(f.state.workerLog.length, 2);
  assert.equal(JSON.stringify(f.calls), JSON.stringify([
    ['get_worker_log_page', { cursor: 'epoch:2' }], ['get_worker_log_page', { cursor: null }],
  ]));
  assert.equal(f.state.workerLogInitialized, true);
});
