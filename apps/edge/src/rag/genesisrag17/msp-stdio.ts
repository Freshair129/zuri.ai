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
 * Edge secrets MSP has no use for. The child still gets the rest of the environment, because MSP
 * reads its own runtime grants from it, exactly as it does when zuri-ai's server starts it.
 */
const WITHHELD_FROM_MSP = [
  'ZURI_EDGE_DEVICE_KEY', 'ZURI_EDGE_DEVICE_KEY_FILE', 'ZURI_AGENT_DEVICE_TOKEN', 'ZURI_AGENT_DEVICE_TOKEN_FILE',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_FILE', 'ANTHROPIC_AUTH_TOKEN', 'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_ACCESS_TOKEN_FILE', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_SECRET_FILE', 'LINE_HISTORY_HASH_KEY',
  'LINE_HISTORY_HASH_KEY_FILE', 'ZURI_EDGE_ADMIN_KEY_HASH', 'ZURI_EDGE_GENESISRAG17_CREDENTIAL',
  'ZURI_EDGE_GENESISRAG17_CREDENTIAL_FILE',
];

export function mspChildEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  for (const name of WITHHELD_FROM_MSP) delete copy[name];
  return copy;
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
