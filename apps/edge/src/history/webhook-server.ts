import { requireLegacyTransport } from '../conversation/contract.js';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  DIRECT_MESSAGE_DIR,
  archiveLineWebhookPayload,
  archiveOutboundLineMessage,
  verifyLineSignature,
} from './archive.js';
import { RegistryOptions, Role, requestAccess, resolveIdentity, listIdentities } from '../identity/registry.js';
import { isAuthorized, sessionCookie, keyMatches, type AdminSessions } from './admin-auth.js';
import { activePersonaId, listPersonaOptions } from '../answer/persona.js';
import { childEnv } from '../answer/headless.js';

// @req BR-009 — every route that reads or changes configuration, or that can send as the OA,
//   requires the operator key; only `/` and `/webhook/line` are open.
// @req BR-008 — captures the cloud's inbound message id so a delivery receipt can be addressed.
// @req SDD-012 — the LINE history and webhook module: signed transport, signed archive, DM routing.
// @req BR-010 — the reply path records what it delivered, into the same archive as the inbound half.
// @spec FR-093, ADR-058 — zuri-ai's, referenced but not owned here.

const ACK_REPLY = 'ซูริรับคำถามแล้วค่ะ กำลังดูข้อมูลให้ เดี๋ยวส่งคำตอบตามมานะคะ';
const NOT_REGISTERED_REPLY =
  'ซูริรับข้อความแล้วค่ะ แต่ยังไม่มีสิทธิ์ตอบให้ — ' +
  'ซูริส่งคำขอให้ผู้ดูแลอนุมัติแล้ว รอสักครู่แล้วทักมาใหม่ได้เลยค่ะ';
const STACK_UNAVAILABLE_REPLY =
  'ซูริยังตอบจากข้อมูลธุรกิจไม่ได้ชั่วคราวค่ะ กรุณาลองใหม่อีกครั้งภายหลัง';

/**
 * Paths that require the operator key. Kept beside the handler rather than derived from a route
 * table, so adding a route is a deliberate decision about whether it is public.
 */
const ADMIN_PATHS = new Set([
  '/gui', '/config', '/api/config', '/api/ollama/models',
  '/api/monitor/channels', '/api/monitor/logs', '/api/command/dispatch',
  '/graph', '/graph-viewer', '/api/graph',
]);

/**
 * Sign-in screen, served in place of any admin page to an unauthenticated browser.
 *
 * Self-contained: no fonts, no scripts, no images from anywhere. A login page that fetches from a
 * CDN is a login page that stops working on the day the warehouse loses its uplink, which is
 * exactly when somebody needs to get in and look.
 */
const LOGIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zuri Edge Device</title>
<style>
:root{color-scheme:dark;--bg:#111417;--card:#1a1f23;--line:#2b3237;--ink:#e7ebed;--dim:#8d979d;--accent:#c9793a}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:15px/1.55 ui-sans-serif,system-ui,"Segoe UI",sans-serif;padding:24px}
.card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:30px}
h1{font-size:17px;margin:0 0 6px;letter-spacing:-.01em}
p{margin:0 0 22px;color:var(--dim);font-size:13.5px}
label{display:block;font-size:12px;color:var(--dim);margin-bottom:7px;letter-spacing:.04em;text-transform:uppercase}
input{width:100%;padding:11px 12px;border-radius:5px;border:1px solid var(--line);background:#0d1013;
color:var(--ink);font:14px ui-monospace,Consolas,monospace}
input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:5px;background:var(--accent);
color:#14181b;font-weight:600;font-size:14px;cursor:pointer}
button:hover{filter:brightness(1.08)}
.err{margin-top:14px;color:#e2707a;font-size:13px;min-height:19px}
</style></head><body><div class="card">
<h1>Zuri Edge Device</h1>
<p>This device&rsquo;s settings are protected. Enter the operator key printed in the runtime log.</p>
<form id="f"><label for="k">Operator key</label>
<input id="k" name="k" type="password" autocomplete="current-password" autofocus placeholder="zadm_&hellip;">
<button type="submit">Unlock</button></form>
<div class="err" id="e" role="alert"></div>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e');
  e.textContent = '';
  try {
    const r = await fetch('/api/admin/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: document.getElementById('k').value })
    });
    if (r.ok) { location.reload(); return; }
    e.textContent = r.status === 401 ? 'That key was not accepted.' : 'Sign-in failed (' + r.status + ').';
  } catch { e.textContent = 'Could not reach the device.'; }
});
</script></div></body></html>`;

interface LineWebhookEvent {
  webhookEventId?: string;
  type?: string;
  replyToken?: string;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type?: string; text?: string };
}

interface LineWebhookPayload {
  destination?: string;
  events?: LineWebhookEvent[];
}

export interface LineWebhookServerOptions {
  /** Explicit legacy transport only; omitted means server owns LINE. */
  transportOwner?: 'SERVER' | 'LEGACY_EDGE';
  port: number;
  channelSecret: string;
  historyRoot: string;
  historyHashKey: string;
  retentionDays: number;
  /** Retention for direct conversations; defaults to `retentionDays` when unset. */
  dmRetentionDays?: number;
  groupAliases: Record<string, string>;
  allowedGroupAliases: string[];
  /**
   * Gate for the configuration surface. Optional in the type only so existing tests that exercise
   * the LINE paths need not construct one; when absent every admin route answers 401, because a
   * server built without a gate has not been told who may configure it.
   */
  admin?: { keyHash: string; sessions: AdminSessions };
  /**
   * Called after `POST /api/config` has written `.env`. Returns which settings the running process
   * picked up and which still need a restart, so the page can report what it did rather than claim
   * the save took effect. Mutating this options object is how a value goes live: the fields above
   * are read per request, so an assignment into them is seen by the next message.
   */
  onConfigSaved?: () => { reloaded: string[]; requiresRestart: string[] };
  /**
   * Handed the cloud's reply to a forwarded batch, so the caller can record the inbound message
   * ids it names. Optional: a device with no cloud binding forwards nothing and never fires this.
   */
  onInboundForwarded?: (raw: unknown) => void;
  stack?: {
    replyEnabled?: boolean;
    forward: (events: unknown[], destination?: string, correlationId?: string) => Promise<unknown>;
    replyText?: (replyToken: string, text: string) => Promise<unknown>;
    /**
     * Report what was actually delivered (FR-093). Optional: a transport without it
     * still replies correctly, it just leaves the outbound half of the conversation
     * unrecorded — which is the state everything was in before this existed.
     */
    reportDelivery?: (
      deliveries: Array<{ inboundMessageId: string; text: string; source: 'STACK' | 'TRANSPORT_FALLBACK' }>,
      destination?: string,
      correlationId?: string
    ) => Promise<unknown>;
  };
  directMessages?: {
    enabled: boolean;
    identity: RegistryOptions;
    replyText: (replyToken: string, text: string) => Promise<unknown>;
    pushText?: (target: string, text: string) => Promise<unknown>;
    answer: (text: string, role: Role, conversationKey: string) => Promise<string> | string;
    getDisplayName?: (userId: string) => Promise<string | null>;
    enqueue?: (input: {
      conversationKey: string;
      lineEventId: string;
      recipientId: string;
      role: Role;
      question: string;
    }) => { created: boolean };
  };
}

async function deliverDirectReply(
  dm: NonNullable<LineWebhookServerOptions['directMessages']>,
  replyToken: string,
  text: string,
  target: string | undefined,
  eventId: string,
  dedupe: ReplyDedupe,
  // Recording the outbound half happens here because here is where delivery is known to have
  // succeeded — the same reason `dedupe.remember` lives on this line and not before the await.
  recordOutbound?: OutboundRecorder
): Promise<void> {
  try {
    await dm.replyText(replyToken, text);
    dedupe.remember(eventId);
    recordOutbound?.({ recipientId: target, text, deliveryKind: 'reply', inReplyToEventId: eventId });
    return;
  } catch (replyError) {
    if (dm.pushText && target) {
      try {
        console.log(`[LINE Reply] Reply token expired, pushing message directly to ${target}...`);
        await dm.pushText(target, text);
        dedupe.remember(eventId);
        recordOutbound?.({ recipientId: target, text, deliveryKind: 'push', inReplyToEventId: eventId });
        return;
      } catch (pushError) {
        dedupe.forget(eventId);
        console.error('[LINE Push Error]', pushError);
        throw pushError;
      }
    }

    dedupe.forget(eventId);
    console.error('[LINE Reply Error]', replyError);
    throw replyError;
  }
}

export interface ReplyDedupe {
  has(eventId: string): boolean;
  remember(eventId: string): void;
  /**
   * Undo a `remember` that turned out to be premature — the direct-message path records an event
   * as replied before the reply call, so a request to approve survives even if the reply itself
   * fails, then undoes that record if the reply did fail. Without `forget`, a failed reply would
   * stay marked seen and LINE's retry — the only thing standing between that failure and the
   * customer never getting an answer — would silently be swallowed as a duplicate.
   */
  forget(eventId: string): void;
}

function createReplyDedupe(root: string, hashKey: string, retentionDays: number): ReplyDedupe {
  const file = path.join(path.resolve(root), '.reply-dedupe.json');
  const hash = (eventId: string) => crypto.createHmac('sha256', hashKey).update(eventId).digest('hex');
  const read = (): Record<string, string> => {
    try {
      const now = Date.now();
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
      return Object.fromEntries(Object.entries(parsed).filter(([, expiresAt]) => Date.parse(expiresAt) > now));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('ZURI_REPLY_DEDUPE_STORE_CORRUPT');
    }
  };
  let entries = read();
  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryFile, file);
    } finally {
      try { fs.unlinkSync(temporaryFile); } catch {}
    }
  };
  return {
    has(eventId) {
      entries = read();
      return Boolean(entries[hash(eventId)]);
    },
    remember(eventId) {
      entries[hash(eventId)] = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
      persist();
    },
    forget(eventId) {
      entries = read();
      delete entries[hash(eventId)];
      persist();
    },
  };
}

interface StackReplyOutcome {
  replied: number;
  duplicate: number;
  accessRequested: number;
  queued: number;
  correlationId?: string;
  /**
   * How many of `replied` were the transport's own fallback copy rather than the stack's answer
   * (G11). Consumed-with-fallback still counts as a reply for idempotency — the event is durably
   * remembered either way, so LINE will not redeliver it — but a question answered only with
   * `STACK_UNAVAILABLE_REPLY` was, from the customer's side, never actually answered. Before this
   * field, that was invisible: findable only by grepping logs for the literal Thai string.
   * Optional because the direct-message path has no upstream to fall back from.
   */
  fallbackReplied?: number;
}

export function createLineWebhookServer(options: LineWebhookServerOptions): http.Server {
  requireLegacyTransport({ ZURI_LINE_TRANSPORT_OWNER: options.transportOwner });
  /*
   * One durable dedupe for both reply paths (G10). The stack path always had this; the direct-
   * message path used to keep its own in-memory Set, bounded to 5000 ids, which forgets on every
   * restart. LINE's retry window can outlast a restart in a way it cannot outlast a request, so a
   * restart inside that window used to risk a second acknowledgement or a second answer to the
   * same message. Sharing one on-disk store closes that gap for both paths at once.
   */
  const durableReplies = createReplyDedupe(options.historyRoot, options.historyHashKey, options.retentionDays);
  const stackInFlight = new Set<string>();

  return http.createServer((request, response) => {
    const url = request.url?.split('?')[0] || '';
    const validPaths = [
      '/webhook/line', '/api/agent/line-webhook', '/webhook', '/',
      '/graph', '/graph-viewer',
      '/gui', '/config', '/api/config', '/api/ollama/models',
      '/api/monitor/channels', '/api/command/dispatch', '/api/monitor/logs',
      '/api/graph', '/api/admin/session'
    ];

    if (!validPaths.includes(url)) {
      response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'NOT_FOUND', url }));
      return;
    }

    /*
     * Everything that reads or changes how this device is configured, or that can speak to a
     * customer, sits behind the operator key. `/webhook/line` is absent because LINE authenticates
     * it by signature, and `/` because it is a liveness probe that says nothing.
     *
     * The catalog viewer is included deliberately: it is read-only, but what it reads out is the
     * customer's product catalogue and pricing.
     */
    if (ADMIN_PATHS.has(url) && !(options.admin && isAuthorized(request, options.admin))) {
      // Someone who navigated here gets somewhere to sign in; a script gets a status code.
      if ((request.headers.accept || '').includes('text/html')) {
        response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE);
      } else {
        response
          .writeHead(401, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'ADMIN_KEY_REQUIRED' }));
      }
      return;
    }

    if (request.method === 'GET') {
      if (url === '/gui' || url === '/config') {
        const guiPath = path.resolve('edge-gui.html');
        if (fs.existsSync(guiPath)) {
          const html = fs.readFileSync(guiPath, 'utf8');
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
          return;
        }
      }

      if (url === '/api/ollama/models') {
        try {
          // The CLI needs the OS and, if set, the host it should query — nothing else.
          // This process holds device keys, LINE credentials and model API keys that
          // a model listing has no use for, and a shell child passes them on again.
          const ollamaEnv = { ...childEnv(), ...(process.env.OLLAMA_HOST ? { OLLAMA_HOST: process.env.OLLAMA_HOST } : {}) };
          const output = execSync('ollama list', { encoding: 'utf8', timeout: 5000, env: ollamaEnv });
          const lines = output.trim().split('\n').slice(1);
          const models = lines.map((l: string) => l.split(/\s{2,}/)[0].trim()).filter(Boolean);
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ models }));
        } catch {
          // Fallback if ollama CLI is not found or fails
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            models: ['qwen3.5:9b', 'qwen3.5:4b', 'lfm2.5:8b', 'Qwen-4B-Thai-Reasoning:latest', 'llama3.2:1b']
          }));
        }
        return;
      }

      if (url === '/api/config') {
        const envPath = path.resolve('.env');
        const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        const getVal = (key: string) => {
          const m = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
          return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
        };

        const systemHostName = os.hostname().toUpperCase() || 'DEV-NODE-PRIMARY';
        const configPayload = {
          deviceId: getVal('ZURI_AGENT_DEVICE_ID') || process.env.ZURI_AGENT_DEVICE_ID || systemHostName,
          deviceToken: getVal('ZURI_AGENT_DEVICE_TOKEN') || process.env.ZURI_AGENT_DEVICE_TOKEN || '',
          deviceSecret: getVal('ZURI_AGENT_DEVICE_SECRET') || process.env.ZURI_AGENT_DEVICE_SECRET || '',
          lineChannelSecret: getVal('LINE_CHANNEL_SECRET') || process.env.LINE_CHANNEL_SECRET || '',
          lineChannelAccessToken: getVal('LINE_CHANNEL_ACCESS_TOKEN') || process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
          lineGroupTeam: getVal('LINE_GROUP_TEAM') || process.env.LINE_GROUP_TEAM || '',
          lineGroupTest: getVal('LINE_GROUP_TEST') || process.env.LINE_GROUP_TEST || '',
          historyRoot: getVal('LINE_HISTORY_ROOT') || 'state/line-history',
          retentionDays: getVal('LINE_HISTORY_RETENTION_DAYS') || '90',
          engineMode: getVal('ZURI_ENGINE_MODE') || (getVal('ZURI_HEADLESS_ENABLED') === 'false' ? 'OLLAMA_LOCAL' : 'HEADLESS_PLAN'),
          modelName: getVal('ZURI_HEADLESS_MODEL') || getVal('OLLAMA_MODEL') || process.env.ZURI_HEADLESS_MODEL || 'gpt-5.6-luna',
          activePersona: getVal('ZURI_ACTIVE_PERSONA') || activePersonaId(),
          availablePersonas: listPersonaOptions(),
          /*
           * Whether this device is actually paired with the cloud, rather than a badge.
           *
           * The Security & Pairing panel used to print a device id hardcoded into the page and a
           * green "● Paired" beside it, both true of nothing: the id shown was not this device's,
           * and the status was a literal. Pairing is the credential pair being present — the same
           * pair the heartbeat needs — so that is what is reported.
           */
          pairing: {
            configured: Boolean(
              (getVal('ZURI_EDGE_DEVICE_KEY_FILE') || getVal('ZURI_EDGE_DEVICE_KEY') ||
                process.env.ZURI_EDGE_DEVICE_KEY_FILE || process.env.ZURI_EDGE_DEVICE_KEY) &&
              (getVal('ZURI_CLOUD_BASE_URL') || process.env.ZURI_CLOUD_BASE_URL)
            ),
          },
          // ADR-058: zuri-ai moved to a per-deployment origin (Docker Compose + ngrok). There is no
          // fixed platform URL any more, so this is unset until the operator points it at their own
          // deployment — never a hardcoded fallback that would silently point at a retired host.
          cloudConsoleUrl: getVal('ZURI_CLOUD_CONSOLE_URL') || process.env.ZURI_CLOUD_CONSOLE_URL || '',
        };

        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(configPayload));
        return;
      }

      if (url === '/api/monitor/channels') {
        try {
          const groups = Object.entries(options.groupAliases).map(([alias, id]) => {
            let name = 'กลุ่มไลน์ทั่วไป';
            if (alias === 'team') name = 'กลุ่มทีมงาน SmartGift';
            else if (alias === 'test') name = 'กลุ่มทดสอบระบบ';
            return { id, alias, name };
          });

          let users: Array<{ id: string; displayName: string; role?: string }> = [];
          if (options.directMessages?.identity) {
            const list = listIdentities(options.directMessages.identity);
            users = list
              .filter((i) => i.status === 'approved')
              .map((i) => ({
                id: i.userIdHash, // In client.ts pushTextToUser requires real ID, but we lookup raw id when sending or fallback to push
                displayName: i.displayName,
                role: i.role
              }));
          }

          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ groups, users }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (url === '/api/monitor/logs') {
        try {
          const rootDir = options.historyRoot || 'state/line-history';
          let logLines: Array<{ time: string; target: string; sender: string; text: string; correlationId?: string | null }> = [];

          if (fs.existsSync(rootDir)) {
            // Group weeks sit one level down; direct conversations sit two, under `_dm/<hash>/`.
            // Flattening them here keeps one timeline — which is what the monitor is for — while the
            // `target` still says which conversation each line came from.
            const conversationDirs: Array<{ path: string; label: string }> = [];
            for (const subdir of fs.readdirSync(rootDir)) {
              const subdirPath = path.join(rootDir, subdir);
              if (!fs.statSync(subdirPath).isDirectory()) continue;
              if (subdir === DIRECT_MESSAGE_DIR) {
                for (const conversation of fs.readdirSync(subdirPath)) {
                  const conversationPath = path.join(subdirPath, conversation);
                  if (fs.statSync(conversationPath).isDirectory()) {
                    conversationDirs.push({ path: conversationPath, label: `dm:${conversation}` });
                  }
                }
                continue;
              }
              conversationDirs.push({ path: subdirPath, label: subdir });
            }

            for (const { path: subdirPath, label: subdir } of conversationDirs) {
              {
                const files = fs.readdirSync(subdirPath).filter(f => f.endsWith('.jsonl'));
                // Take the most recent files
                files.sort().reverse().slice(0, 3).forEach(file => {
                  const filePath = path.join(subdirPath, file);
                  try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    content.split('\n').filter(Boolean).forEach(line => {
                      const log = JSON.parse(line);
                      logLines.push({
                        time: log.occurredAt || log.timestamp || new Date().toISOString(),
                        target: subdir,
                        // A record without `direction` predates BR-010 and is inbound; showing an
                        // outbound line under the group's own name would read as the group having
                        // said what the OA said.
                        sender:
                          log.direction === 'outbound'
                            ? 'Zuri (outbound)'
                            : log.groupAlias || log.displayName || log.userId || 'Unknown',
                        text: log.text || (log.message && log.message.text) || '',
                        correlationId: log.correlationId || null
                      });
                    });
                  } catch {}
                });
              }
            }
          }

          // Sort logs by time descending and take last 20
          logLines.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ logs: logLines.slice(0, 20) }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      if (url === '/api/graph') {
        // Proxy, not a direct read. The GenesisBlock engine takes an exclusive lock on a store
        // directory even when opened readOnly, so this process cannot open the store while
        // `rag:serve` holds it — the same reason the answer path goes over HTTP. Serving the
        // viewer from here and the data from :8888 keeps one owner for the store.
        const ragUrl = (process.env.GENESIS_RAG_API_URL || 'http://localhost:8888').replace(/\/+$/, '');
        const query = request.url?.includes('?') ? `?${request.url.split('?')[1]}` : '';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        fetch(`${ragUrl}/api/graph${query}`, { signal: controller.signal })
          .then(async (upstream) => {
            const body = await upstream.text();
            response
              .writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' })
              .end(body);
          })
          .catch((err: unknown) => {
            // The viewer reads `nodes`, so answer in its own shape: an empty graph plus the reason,
            // rather than a bare 5xx it would only surface in the console.
            response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(
              JSON.stringify({
                error: 'RAG_SERVICE_UNAVAILABLE',
                detail: `${ragUrl} did not answer: ${err instanceof Error ? err.message : String(err)}`,
                hint: 'Start it with `npm run rag:serve`.',
                nodes: [],
                edges: [],
                label_counts: {},
              }),
            );
          })
          .finally(() => clearTimeout(timer));
        return;
      }

      if (url === '/graph' || url === '/graph-viewer') {
        const viewerPath = path.resolve('graph-viewer.html');
        if (fs.existsSync(viewerPath)) {
          const html = fs.readFileSync(viewerPath, 'utf8');
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
          return;
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        status: 'ok',
        service: 'zuri-edge-webhook',
        gui: '/gui',
        graphViewer: '/graph'
      }));
      return;
    }

    if (request.method === 'POST' && url === '/api/admin/session') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        // One refusal for a wrong key and for a device with no key set: which of the two it is
        // tells an unauthenticated caller something about the device, and neither is actionable
        // from outside anyway.
        const deny = (): void => {
          response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'ADMIN_KEY_REQUIRED' }));
        };
        if (!options.admin?.keyHash) { deny(); return; }
        let key = '';
        try {
          key = String(JSON.parse(Buffer.concat(chunks).toString('utf8'))?.key ?? '');
        } catch {
          response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'BAD_REQUEST' }));
          return;
        }
        if (!keyMatches(key, options.admin.keyHash)) { deny(); return; }
        const token = options.admin.sessions.issue();
        response
          .writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) })
          .end(JSON.stringify({ success: true }));
      });
      return;
    }

    if (request.method === 'POST' && url === '/api/config') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const envPath = path.resolve('.env');
          let current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

          const setVal = (key: string, val: string) => {
            if (current.match(new RegExp(`^${key}=.*$`, 'm'))) {
              current = current.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}="${val}"`);
            } else {
              current += `\n${key}="${val}"`;
            }
          };

          if (body.deviceId) setVal('ZURI_AGENT_DEVICE_ID', body.deviceId);
          if (body.deviceToken) setVal('ZURI_AGENT_DEVICE_TOKEN', body.deviceToken);
          if (body.deviceSecret) setVal('ZURI_AGENT_DEVICE_SECRET', body.deviceSecret);
          if (body.lineChannelSecret) setVal('LINE_CHANNEL_SECRET', body.lineChannelSecret);
          if (body.lineChannelAccessToken) setVal('LINE_CHANNEL_ACCESS_TOKEN', body.lineChannelAccessToken);
          if (body.lineGroupTeam) setVal('LINE_GROUP_TEAM', body.lineGroupTeam);
          if (body.lineGroupTest) setVal('LINE_GROUP_TEST', body.lineGroupTest);
          if (body.historyRoot) setVal('LINE_HISTORY_ROOT', body.historyRoot);
          if (body.retentionDays) setVal('LINE_HISTORY_RETENTION_DAYS', body.retentionDays);
          if (body.engineMode) {
            setVal('ZURI_ENGINE_MODE', body.engineMode);
            if (body.engineMode === 'OLLAMA_LOCAL') {
              setVal('ZURI_HEADLESS_ENABLED', 'false');
              if (body.modelName) setVal('OLLAMA_MODEL', body.modelName);
            } else {
              setVal('ZURI_HEADLESS_ENABLED', 'true');
              if (body.modelName) setVal('ZURI_HEADLESS_MODEL', body.modelName);
            }
          } else if (body.modelName) {
            setVal('ZURI_HEADLESS_MODEL', body.modelName);
          }
          if (body.activePersona) setVal('ZURI_ACTIVE_PERSONA', body.activePersona);

          fs.writeFileSync(envPath, current.trim() + '\n', 'utf8');
          /*
           * Saving used to end here and answer `{success:true}`, which was true of the file and
           * false of the running device: the process kept the values it read at startup, so an
           * operator who rotated the LINE token watched the bot keep using the old one. Reload what
           * can be reloaded and name what cannot, rather than implying it all took effect.
           */
          const applied = options.onConfigSaved?.() ?? { reloaded: [], requiresRestart: [] };
          if (body.activePersona) {
            // The persona is read from the environment at answer time, so updating the
            // process is what makes the saved choice apply to the next message.
            process.env.ZURI_ACTIVE_PERSONA = String(body.activePersona);
            applied.reloaded = [...applied.reloaded, 'activePersona'];
          }
          response
            .writeHead(200, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ success: true, ...applied }));
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (request.method === 'POST' && url === '/api/command/dispatch') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const target = body.target?.trim();
          const rawCommand = body.rawCommand?.trim();

          if (!target || !rawCommand) {
            response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'MISSING_TARGET_OR_COMMAND' }));
            return;
          }

          if (!options.directMessages?.answer) {
            response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'DM_ANSWER_TRANSPORT_UNAVAILABLE' }));
            return;
          }

          // Build custom Zuri transformation instructions to process command
          const prompt = `[คำสั่งด่วนจาก Boss/Owner]: ให้ซูริแจ้งผู้ใช้ในกลุ่มแชท/ลูกค้าตามข้อความนี้:\n"${rawCommand}"\n\nจงเปลี่ยนคำสั่งข้างต้นให้กลายเป็นประกาศหรือคำตอบที่ส่งจาก "ซูริ" โดยใช้โทนเสียงที่สุภาพ อบอุ่น นอบน้อม และเป็นมิตร ห้ามเกริ่นอธิบายตัวคุณเอง ห้ามพ่นขั้นตอนการทำงาน ให้เขียนคำตอบของซูริที่จะส่งให้ลูกค้าตรง ๆ เท่านั้น`;

          // Use directMessages.answer tool (calls answerConversation with LLM)
          console.log(`[Command Dispatch] Transforming boss command: "${rawCommand}" for target: ${target}`);
          const zuriText = await options.directMessages.answer(prompt, 'owner', target);

          console.log(`[Command Dispatch] Transformed text to push: "${zuriText}"`);

          if (options.directMessages.pushText) {
            await options.directMessages.pushText(target, zuriText);
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, text: zuriText }));
          } else {
            response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'PUSH_TRANSPORT_UNCONFIGURED' }));
          }
        } catch (err) {
          response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', async () => {
      const rawBody = Buffer.concat(chunks);
      const signature = request.headers['x-line-signature'];

      const bodyStr = rawBody.toString('utf8');
      console.log(`[Webhook Received] Size: ${rawBody.length} bytes, Signature: ${signature ? 'Present' : 'Missing'}`);
      if (bodyStr.includes('"events":[]') || bodyStr.includes('"events": []') || !bodyStr) {
        console.log('[Webhook Verify] Handled verify test from LINE');
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', verify: true }));
        return;
      }

      if (
        !verifyLineSignature(
          rawBody,
          typeof signature === 'string' ? signature : undefined,
          options.channelSecret
        )
      ) {
        console.warn('[Webhook Warning] Invalid LINE signature rejected');
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'INVALID_SIGNATURE' }));
        return;
      }

      const correlationId = `cli-${crypto.randomUUID()}`;
      try {
        const payload = JSON.parse(rawBody.toString('utf8')) as LineWebhookPayload;
        const result = archiveLineWebhookPayload(payload, {
          root: options.historyRoot,
          groupAliases: options.groupAliases,
          allowedGroupAliases: options.allowedGroupAliases,
          hashKey: options.historyHashKey,
          retentionDays: options.retentionDays,
          dmRetentionDays: options.dmRetentionDays,
          correlationId,
        });

        // Respond 200 OK immediately to LINE Webhook to satisfy LINE 1-2s SLA and prevent Tunnel context canceled
        response.setHeader('Content-Type', 'application/json');
        response.writeHead(200).end(
          JSON.stringify({
            status: 'ok',
            correlationId,
            archived: result.archived,
          })
        );

        // Process AI / Rule Reply in background asynchronously
        if (options.stack?.replyEnabled) {
          void handleStackReplies(
            payload, options.stack, durableReplies, stackInFlight, correlationId
          ).then((outcome) => {
            // G11 — the response already went out, so this is the only place fallback
            // visibility can surface: LINE will not redeliver the event (it is durably
            // remembered either way), but the customer's actual question went unanswered.
            if (outcome.fallbackReplied) {
              console.warn(
                `[Stack Reply] ${outcome.fallbackReplied} fallback repl${outcome.fallbackReplied === 1 ? 'y' : 'ies'} sent — customer question(s) unanswered by the stack`
              );
            }
          }).catch((e) => console.error('[Stack Reply Error]', e));
        } else {
          /*
           * The forward's answer used to be thrown away. It carries the row id the cloud created
           * for each inbound message, and that id is the only thing a delivery receipt can be
           * addressed by (FR-093) — so discarding it was what left the outbound half of every
           * conversation absent from the cloud's record, which BR-008 names.
           *
           * Still not awaited before answering. The customer's acknowledgement uses a reply token
           * that expires in about thirty seconds, and making it wait on a cloud that may be slow or
           * gone would trade a real delivery for a bookkeeping one. The id is attached to the
           * queued record when it arrives instead; the answer takes seconds, so it is there in
           * time, and when it is not the worker says so rather than guessing.
           */
          if (options.stack) {
            void Promise.resolve(
              options.stack.forward(payload.events || [], payload.destination, correlationId)
            )
              .then((raw) => options.onInboundForwarded?.(raw))
              .catch(() => {});
          }
          void handleDirectMessages(payload, options.directMessages, durableReplies, (sent) => {
            // BR-010. Best effort on purpose: the message is already delivered, so a failure to
            // record it must not surface as a delivery failure. It is logged, not swallowed.
            if (!sent.recipientId) return;
            try {
              archiveOutboundLineMessage(
                {
                  recipientId: sent.recipientId,
                  text: sent.text,
                  deliveryKind: sent.deliveryKind,
                  inReplyToEventId: sent.inReplyToEventId,
                },
                {
                  root: options.historyRoot,
                  groupAliases: options.groupAliases,
                  allowedGroupAliases: options.allowedGroupAliases,
                  hashKey: options.historyHashKey,
                  retentionDays: options.retentionDays,
                  dmRetentionDays: options.dmRetentionDays,
                  correlationId,
                }
              );
            } catch (archiveError) {
              console.error('[Outbound Archive Error]', archiveError);
            }
          }).catch((e) => console.error('[Direct Reply Error]', e));
        }
      } catch {
        response.writeHead(502).end();
      }
    });
  });
}

// Exported for tests, as `handleDirectMessages` below already is: the reply path now
// also decides what gets recorded (FR-093), and driving that through the HTTP server
// would test the signature check rather than the decision.
export async function handleStackReplies(
  payload: LineWebhookPayload,
  stack: NonNullable<LineWebhookServerOptions['stack']>,
  durable: ReplyDedupe,
  inFlight: Set<string>,
  correlationId?: string
): Promise<StackReplyOutcome> {
  if (!stack.replyText) throw new Error('ZURI_STACK_REPLY_TRANSPORT_REQUIRED');
  if (!payload.destination?.trim()) return { replied: 0, duplicate: 0, accessRequested: 0, queued: 0, fallbackReplied: 0 };
  const eligible = (payload.events || []).filter((event) =>
    event.type === 'message' && event.source?.type === 'user' && event.message?.type === 'text' &&
    event.webhookEventId && event.replyToken
  );
  const fresh = eligible.filter((event) =>
    !durable.has(event.webhookEventId!) && !inFlight.has(event.webhookEventId!)
  );
  const duplicate = eligible.length - fresh.length;
  if (fresh.length === 0) return { replied: 0, duplicate, accessRequested: 0, queued: 0, fallbackReplied: 0 };

  for (const event of fresh) inFlight.add(event.webhookEventId!);
  let results: Array<{ ok?: boolean; eventId?: string; skipReply?: boolean; response?: { text?: string }; inboundMessageId?: string }> = [];
  // The id the stack reports back. It normally matches what we sent; when it does
  // not, the stack replaced ours and its id is the one that appears in its records,
  // so that is the one worth keeping.
  let effectiveCorrelationId = correlationId;
  try {
    const raw = await stack.forward(fresh, payload.destination, correlationId) as {
      results?: Array<{ ok?: boolean; eventId?: string; skipReply?: boolean; response?: { text?: string }; inboundMessageId?: string }>;
      correlationId?: string;
    };
    results = Array.isArray(raw?.results) ? raw.results : [];
    if (typeof raw?.correlationId === 'string' && raw.correlationId.trim()) {
      effectiveCorrelationId = raw.correlationId;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'ZURI_STACK_BINDING_UNAUTHORIZED') {
      for (const event of fresh) inFlight.delete(event.webhookEventId!);
      return { replied: 0, duplicate, accessRequested: 0, queued: 0, fallbackReplied: 0, correlationId: effectiveCorrelationId };
    }
    results = [];
  }

  let replied = 0;
  let fallbackReplied = 0;
  const delivered: Array<{ inboundMessageId: string; text: string; source: 'STACK' | 'TRANSPORT_FALLBACK' }> = [];
  try {
    for (const event of fresh) {
      const eventId = event.webhookEventId!;
      const result = results.find((item) => item.eventId === eventId || item.eventId === event.message?.id);
      if (result?.skipReply) {
        durable.remember(eventId);
        continue;
      }
      const fromStack = result?.ok && typeof result.response?.text === 'string' && result.response.text.trim()
        ? result.response.text.trim()
        : null;
      const answer = fromStack ?? STACK_UNAVAILABLE_REPLY;
      const sent = answer.slice(0, 5000);
      await stack.replyText(event.replyToken!, sent);
      durable.remember(eventId);
      replied++;
      // G11 — the reply is durably recorded either way (LINE will not redeliver this event),
      // but a fallback reply means the customer's actual question went unanswered. Counting it
      // is the cheapest way to make that visible instead of grep-only.
      if (!fromStack) fallbackReplied++;

      // FR-093 — collected only after the send resolved, because the receipt is a
      // record of what the customer received. `sent` is the sliced string, not the
      // original: what went out is what gets recorded.
      if (result?.inboundMessageId) {
        delivered.push({
          inboundMessageId: result.inboundMessageId,
          text: sent,
          source: fromStack ? 'STACK' : 'TRANSPORT_FALLBACK',
        });
      }
    }
  } finally {
    for (const event of fresh) inFlight.delete(event.webhookEventId!);
  }

  // Best-effort, and deliberately outside the reply loop's error handling. The customer
  // already has the message; failing to record it is bad, and turning that into a
  // thrown error that costs the next reply would be worse. A dropped receipt is
  // visible on the stack side as an answered conversation with no outbound row.
  if (delivered.length > 0 && stack.reportDelivery) {
    try {
      await stack.reportDelivery(delivered, payload.destination, effectiveCorrelationId);
    } catch {
      /* the reply is already sent; the record is the only thing lost */
    }
  }

  return { replied, duplicate, accessRequested: 0, queued: 0, fallbackReplied, correlationId: effectiveCorrelationId };
}

/**
 * How the outbound half reaches the archive (BR-010).
 *
 * A callback rather than archive options threaded through `directMessages`: the server already
 * holds the history root, hash key and alias allow-list at the call site, and duplicating them here
 * would give the two halves of one archive two sources of configuration.
 */
export type OutboundRecorder = (input: {
  recipientId: string | undefined;
  text: string;
  deliveryKind: 'reply' | 'push';
  inReplyToEventId?: string;
}) => void;

export async function handleDirectMessages(
  payload: { events?: LineWebhookEvent[] },
  dm: LineWebhookServerOptions['directMessages'],
  dedupe: ReplyDedupe,
  recordOutbound?: OutboundRecorder
): Promise<{ replied: number; duplicate: number; accessRequested: number; queued: number }> {
  if (!dm?.enabled) return { replied: 0, duplicate: 0, accessRequested: 0, queued: 0 };

  let replied = 0;
  let duplicate = 0;
  let accessRequested = 0;
  let queued = 0;

  for (const event of payload.events || []) {
    const eventId = event.webhookEventId;
    const replyToken = event.replyToken;
    const userId = event.source?.userId;
    const groupId = event.source?.groupId || (event.source as any)?.roomId;
    const isText =
      event.type === 'message' &&
      (event.source?.type === 'user' || event.source?.type === 'group' || event.source?.type === 'room') &&
      event.message?.type === 'text';

    if (!isText || !eventId || !replyToken) continue;
    if (dedupe.has(eventId)) {
      duplicate++;
      continue;
    }

    const convKey = groupId || userId || 'default_room';
    const rawMsgText = (event.message?.text || '').trim();

    // 🌟 Group / Room Mention Trigger Guard
    // หากเป็นข้อความในกลุ่ม ต้องมีคำเรียก "ซูริ", "@ซูริ", "@zuri", "zuri" (ตรงไหนของประโยคก็ได้)
    if (event.source?.type === 'group' || event.source?.type === 'room') {
      const isMentioned = /ซูริ|zuri/i.test(rawMsgText);
      if (!isMentioned) {
        // หากไม่มีการแท็กหรือเรียกชื่อซูริในกลุ่ม ให้ข้ามไปไม่ต้องตอบกลับ
        continue;
      }
    }

    const identity = userId ? resolveIdentity(userId, dm.identity) : null;
    if (!identity) {
      if (userId && dm.getDisplayName) {
        try {
          const name = await dm.getDisplayName(userId);
          requestAccess(userId, name || '', dm.identity);
          accessRequested++;
        } catch {}
      }
      await deliverDirectReply(
        dm,
        replyToken,
        NOT_REGISTERED_REPLY,
        groupId || userId,
        eventId,
        dedupe,
        recordOutbound
      );
      replied++;
      continue;
    }

    const effectiveRole = identity.role ?? 'sales';

    let text: string;
    if (dm.enqueue && event.source?.type === 'user') {
      const accepted = dm.enqueue({
        conversationKey: identity.userIdHash,
        lineEventId: eventId,
        recipientId: userId!,
        role: effectiveRole,
        question: rawMsgText,
      });
      if (accepted.created) queued++;

      await deliverDirectReply(
        dm,
        replyToken,
        ACK_REPLY,
        groupId || userId,
        eventId,
        dedupe,
        recordOutbound
      );
      replied++;
      continue;
    }

    try {
      text = await dm.answer(
        rawMsgText,
        effectiveRole,
        convKey
      );
    } catch {
      text = 'ซูริคำนวณให้ไม่สำเร็จค่ะ ลองพิมพ์ใหม่อีกครั้งนะคะ';
    }

    await deliverDirectReply(
      dm,
      replyToken,
      text,
      groupId || userId,
      eventId,
      dedupe,
      recordOutbound
    );
    replied++;
  }
  return { replied, duplicate, accessRequested, queued };
}
