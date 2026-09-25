import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const desktop = fs.readFileSync(new URL('../../public/desktop.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

test('desktop shell no longer polls or displays Edge worker logs', () => {
  assert.doesNotMatch(desktop, /get_worker_log_page|refreshWorkerLog|workerLogCursor/);
  assert.doesNotMatch(html, /workerLog|worker-log|บันทึกการทำงาน/);
});
