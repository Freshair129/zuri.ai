import { spawn } from 'node:child_process';
import type { MspCommandSettings } from './settings.js';

// @req FR-189 — edge reaches the published generation only through MSP, started locally over stdio;
//   there is no URL here, so there is nothing a job could point at a remote endpoint.
// @spec ADR-075 D7, ADR-043 D2, ADR-061 (a job never names an executable, URL or query target)
// @tested tests/unit/genesisrag17-edge.test.ts
//
// A TypeScript mirror of zuri-ai's server transport (`apps/server/src/modules/agent/msp-stdio-transport.js`):
// NDJSON JSON-RPC, `initialize` → `notifications/initialized` → `tools/call`, one child per call,
// closed in `finally`. Nothing is imported from the MSP repository — the wire is the contract.

export type MspToolCall = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export class MspTransportError extends Error {
  constructor(message: string, readonly code: 'MSP_TRANSPORT_UNAVAILABLE' | 'MSP_TOOL_ERROR' = 'MSP_TRANSPORT_UNAVAILABLE') {
    super(message);
    this.name = 'MspTransportError';
  }
}

/**
 * Every variable an MSP child is allowed to see. An allowlist, not a denylist: a secret added to
 * this process's environment later must not reach MSP merely because nobody remembered to withhold
 * it. Mirrors zuri-ai's server transport (`apps/server/src/modules/agent/msp-stdio-transport.js`)
 * name for name — `tests/unit/genesisrag17-edge.test.ts` reads that file and fails if the two lists
 * drift apart. Nothing named ZURI_* is here: those configure this transport, and MSP never reads them.
 */
export const MSP_RUNTIME_ENV_NAMES: readonly string[] = Object.freeze([
  // apps/msp-server/bin/msp-server.mjs — the store; MSP refuses to start without it
  'MSP_DB_PATH',
  // apps/msp-server/src/providers/gks-stdio-provider.mjs — how MSP spawns GKS
  'MSP_GKS_COMMAND',
  'MSP_GKS_ARGS',
  'MSP_GKS_CWD',
  // apps/msp-server/src/transport/handlers/pipeline-handlers.mjs — relay grants and credentials
  'MSP_PIPELINE_PRINCIPALS',
  'MSP_GKS_PIPELINE_CREDENTIAL',
  'MSP_PIPELINE_WORKER_URL',
  'MSP_PIPELINE_WORKER_TOKEN',
  // packages/msp-retrieval/src/retrieval/vector.mjs — the embedding endpoint
  'OLLAMA_BASE_URL',
  // Read by GKS (apps/gks-server/src/server.mjs, packages/gks-contracts/src/resolution.mjs),
  // reaching it only because MSP spawns GKS with an allowlist of its own
  'GKS_DB_PATH',
  'GKS_PIPELINE_RELAY_CREDENTIAL',
  'GKS_DEFAULT_PORTFOLIO_ID',
  'GKS_AUTOMERGE_FLOOR',
]);

/**
 * What a Node child needs from the OS to start and to spawn its own child: command lookup, temp and
 * home directories, the Windows system paths libuv and OpenSSL resolve through, and locale/time zone.
 * No credentials, no proxies, and no NODE_OPTIONS — that one can load code into the child.
 */
export const MSP_OS_ENV_NAMES: readonly string[] = Object.freeze([
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
  'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
]);

// Windows spells these `Path` and `SystemRoot`, and its environment is case-insensitive, so names
// are matched without case and copied as spelled.
const ALLOWED_ENV_NAMES = new Set([...MSP_RUNTIME_ENV_NAMES, ...MSP_OS_ENV_NAMES].map((name) => name.toUpperCase()));

export function mspChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string' && ALLOWED_ENV_NAMES.has(name.toUpperCase())) child[name] = value;
  }
  return child;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };

export function createMspStdioTransport(settings: MspCommandSettings, env: NodeJS.ProcessEnv = process.env): MspToolCall {
  if (!settings.command.trim()) throw new MspTransportError('MSP command is not configured');
  const childEnv = mspChildEnvironment(env);

  return async function callMspTool(name, input) {
    const child = spawn(settings.command, settings.args, {
      cwd: settings.cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
    });
    let buffer = Buffer.alloc(0);
    let nextId = 1;
    let closed = false;
    const pending = new Map<number, Pending>();

    const rejectPending = (error: Error) => {
      for (const { reject, timeout } of pending.values()) { clearTimeout(timeout); reject(error); }
      pending.clear();
    };
    const close = () => {
      if (closed) return;
      closed = true;
      child.kill();
    };
    const request = (method: string, params: unknown) => {
      const id = nextId++;
      return new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new MspTransportError(`MSP request timed out: ${method}`));
        }, settings.timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    };

    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const body = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        buffer = buffer.subarray(newline + 1);
        let message: { id?: number; error?: { message?: string }; result?: unknown };
        try { message = JSON.parse(body); } catch {
          rejectPending(new MspTransportError('MSP returned malformed NDJSON'));
          close();
          return;
        }
        const waiting = typeof message.id === 'number' ? pending.get(message.id) : undefined;
        if (!waiting) continue;
        pending.delete(message.id as number);
        clearTimeout(waiting.timeout);
        if (message.error) waiting.reject(new MspTransportError(message.error.message ?? 'MSP returned a JSON-RPC error'));
        else waiting.resolve(message.result);
      }
    });
    // stderr is drained so a chatty MSP cannot block on a full pipe; it is never echoed, because it
    // may name paths or grants this device's logs have no reason to keep.
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => rejectPending(new MspTransportError(error.message)));
    child.on('exit', (code) => {
      if (!closed) rejectPending(new MspTransportError(`MSP process exited with code ${code}`));
    });

    try {
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zuri-edge', version: '0.1.0' },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      const result = await request('tools/call', { name, arguments: input ?? {} });
      if (result?.isError) {
        const text = result.content?.find((item: { type?: string }) => item.type === 'text')?.text;
        throw new MspTransportError(text ?? `MSP tool ${name} returned an error`, 'MSP_TOOL_ERROR');
      }
      return (result?.structuredContent ?? {}) as Record<string, unknown>;
    } finally {
      close();
    }
  };
}
