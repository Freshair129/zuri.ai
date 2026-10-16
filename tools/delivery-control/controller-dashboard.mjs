import http from 'node:http';

const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zuri delivery DAG</title>
<style>body{font:16px system-ui;background:#101827;color:#e7edf5;margin:32px;max-width:1200px}h1{margin-bottom:8px}p{color:#aebdd0}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;border-bottom:1px solid #344258;padding:12px}#status{color:#ffc773}a{color:#89caff}.error{color:#ff9999}</style>
<h1>Zuri delivery DAG</h1><p>Repository-local controller · read-only · worker → verifier → reviewer → root delivery</p>
<p id="status" role="status">Loading durable state…</p><main id="runs"></main><section><h2>Recent verified events</h2><div id="events" aria-live="polite"></div></section>
<script src="/dashboard.js"></script></html>`;
const SCRIPT = `const status=document.querySelector('#status'), runs=document.querySelector('#runs'), events=document.querySelector('#events');let inFlight=false;
async function refresh(){if(inFlight)return;inFlight=true;try{const response=await fetch('/api/state',{cache:'no-store'});if(!response.ok)throw new Error('State unavailable');const state=await response.json();runs.replaceChildren();events.replaceChildren();status.textContent='Observed '+new Date().toLocaleTimeString()+' · '+state.runs.length+' tasks · no merge or deploy authority';for(const run of state.runs){const title=document.createElement('h2');title.textContent=run.taskId+' — '+run.status;runs.append(title);const table=document.createElement('table');const row=document.createElement('tr');for(const label of ['Stage','State','Attempt','Reason']){const th=document.createElement('th');th.textContent=label;row.append(th)}table.append(row);for(const node of run.nodes){const tr=document.createElement('tr');for(const value of [node.stage,node.status,node.attempt,node.reason]){const td=document.createElement('td');td.textContent=String(value??'');tr.append(td)}table.append(tr)}runs.append(table)}if(!state.runs.length){const p=document.createElement('p');p.textContent='No tasks queued. Intake is performed by the trusted local CLI.';runs.append(p)}for(const event of state.events||[]){const item=document.createElement('p');item.textContent=[event.observedAt,event.kind,event.status,event.taskId,event.cycleNo?'cycle '+event.cycleNo:'',event.role].filter(Boolean).join(' · ');events.append(item)}if(!(state.events||[]).length){const p=document.createElement('p');p.textContent='No verified events recorded.';events.append(p)}}catch(error){status.textContent=error.message;status.className='error'}finally{inFlight=false}}refresh();setInterval(refresh,5000);`;

/** Explicit allowlist: never expose prompts, credentials, log contents or paths. */
const EVENT_KINDS = new Set(['TASK_REGISTERED', 'CYCLE_ADMITTED', 'LEASE_ACQUIRED', 'HEARTBEAT',
  'LEASE_EXPIRED', 'LEASE_RELEASED', 'DISPATCH_STARTED', 'CANDIDATE_SUBMITTED', 'VERIFY_PASSED',
  'REVIEW_PASSED', 'YIELD_REASSESS', 'EXTERNAL_BLOCKER', 'UNKNOWN_EFFECT', 'UNKNOWN_RESOLVED',
  'ROOT_INTEGRATED', 'DEADLINE_EXCEEDED', 'SCOPE_BLOCKED', 'STALE_BASELINE', 'STALE_CANDIDATE', 'CI_OBSERVED']);
const EVENT_STATUSES = new Set(['OBSERVED', 'BLOCKED', 'PASSED', 'PASS', 'FAIL', 'PENDING', 'STALE', 'UNKNOWN']);

export function publicControllerSnapshot(runs, events = []) {
  const code = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,95}$/.test(value) ? value : 'UNKNOWN';
  const reasons = new Set(['METADATA_DEFECT', 'IMPLEMENTATION_FAILURE', 'EXTERNAL_BLOCKER', 'UNKNOWN_EFFECT',
    'YIELD_REASSESS', 'BLOCKED_SCOPE', 'BLOCKED_DEPENDENCY', 'BLOCKED_ENVIRONMENT', 'DEADLINE_EXCEEDED']);
  const safeEvents = (Array.isArray(events) ? events : []).filter((event) =>
    EVENT_KINDS.has(event?.kind) && EVENT_STATUSES.has(event?.status)
    && typeof event?.observedAt === 'string' && Number.isFinite(Date.parse(event.observedAt)))
    .slice(0, 200).map((event) => ({
      taskId: event.taskId == null ? null : code(event.taskId),
      cycleNo: Number.isSafeInteger(event.cycleNo) && event.cycleNo > 0 ? event.cycleNo : null,
      role: ['worker', 'verifier', 'reviewer', 'delivery'].includes(event.role) ? event.role : null,
      kind: event.kind,
      status: event.status,
      observedAt: new Date(event.observedAt).toISOString(),
      sequence: Number.isSafeInteger(event.sequence) ? event.sequence : null,
    }));
  return { schemaVersion: 'delivery-dashboard/v1', runs: runs.map((run) => ({
    taskId: code(run.taskId), status: code(run.status),
    nodes: (run.nodes ?? []).map((node) => ({ stage: code(node.stage), status: code(node.status),
      attempt: Number.isSafeInteger(node.attempt) ? node.attempt : 0,
      reason: reasons.has(node.reason) ? node.reason : null })),
  })), events: safeEvents };
}

export async function startControllerDashboard({ readRuns, readEvents = async () => [], port = 4190 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const host = `127.0.0.1:${address.port}`;
    const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer' };
    const send = (code, body, type = 'text/plain; charset=utf-8') => { response.writeHead(code, { ...headers, 'Content-Type': type }); response.end(body); };
    if (request.headers.host !== host || request.headers['sec-fetch-site'] === 'cross-site'
      || (request.headers.origin && request.headers.origin !== `http://${host}`)) return send(403, 'Forbidden');
    if (request.method !== 'GET') return send(405, 'Read-only dashboard');
    if (request.url === '/') return send(200, PAGE, 'text/html; charset=utf-8');
    if (request.url === '/dashboard.js') return send(200, SCRIPT, 'application/javascript; charset=utf-8');
    if (request.url !== '/api/state') return send(404, 'Not found');
    try {
      const [runs, events] = await Promise.all([readRuns(), readEvents()]);
      send(200, JSON.stringify(publicControllerSnapshot(runs, events)), 'application/json; charset=utf-8');
    }
    catch { send(503, JSON.stringify({ code: 'STATE_UNAVAILABLE' }), 'application/json; charset=utf-8'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
