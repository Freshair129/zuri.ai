import assert from 'node:assert/strict';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { test } from 'node:test';

import { createHttpServer } from '../../src/mcp/genesis-mcp-server.js';

const TEST_TOKEN = 'test-only-mcp-token-with-more-than-32-characters';

type RunningServer = {
  server: Awaited<ReturnType<typeof createHttpServer>>;
  baseUrl: string;
};

function testMcpServer(toolName = 'test_tool'): Server {
  const server = new Server(
    { name: 'genesis-mcp-http-test', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: toolName, description: 'test tool', inputSchema: { type: 'object', properties: {} } }],
  }));
  return server;
}

function startServer(options: Parameters<typeof createHttpServer>[0] = {}): Promise<RunningServer> {
  const server = createHttpServer({
    port: 0,
    token: null,
    createMcpServer: () => testMcpServer(),
    getHealthDetails: () => ({ engine: 'test-engine', readiness: { catalog: { state: 'ready' } } }),
    ...options,
  });

  return server.then((httpServer) => {
    const address = httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const { address: host, port } = address as AddressInfo;
    return { server: httpServer, baseUrl: `http://${host}:${port}` };
  });
}

async function closeServer(server: RunningServer['server']): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  server.closeAllConnections();
  await closed;
}

type ReadableReader = ReadableStreamDefaultReader<Uint8Array>;

class SseEventReader {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  constructor(readonly reader: ReadableReader) {}

  async next(): Promise<{ event: string; data: string }> {
    for (;;) {
      const separator = this.buffer.match(/\r?\n\r?\n/);
      if (separator?.index !== undefined) {
        const frame = this.buffer.slice(0, separator.index);
        this.buffer = this.buffer.slice(separator.index + separator[0].length);
        if (frame.startsWith(':')) continue;
        const lines = frame.split(/\r?\n/);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) return { event, data };
        continue;
      }

      const { done, value } = await this.reader.read();
      if (done) throw new Error('SSE stream closed before the expected event');
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async response(id: number): Promise<Record<string, unknown>> {
    for (;;) {
      const frame = await this.next();
      if (frame.event !== 'message') continue;
      const message = JSON.parse(frame.data) as Record<string, unknown>;
      if (message.id === id) return message;
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel();
  }
}

async function openSse(baseUrl: string, token?: string): Promise<{ response: Response; events: SseEventReader }> {
  const response = await fetch(`${baseUrl}/sse`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  assert.ok(response.body, 'SSE endpoint must provide a response stream');
  return { response, events: new SseEventReader(response.body.getReader()) };
}

function openSseWithHost(baseUrl: string, hostHeader: string, token?: string): Promise<IncomingMessage> {
  const url = new URL(`${baseUrl}/sse`);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname,
      method: 'GET',
      headers: {
        host: hostHeader,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

async function postMcpMessage(endpoint: URL, message: Record<string, unknown>, token: string): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
  assert.ok(response.ok, `MCP POST returned ${response.status}`);
  await response.arrayBuffer();
}

const initializeRequest = (id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'mcp-http-test', version: '1.0.0' },
  },
});

test('HTTP mode binds to loopback by default', async () => {
  const previousHost = process.env.GENESIS_MCP_HOST;
  const previousToken = process.env.GENESIS_MCP_TOKEN;
  delete process.env.GENESIS_MCP_HOST;
  delete process.env.GENESIS_MCP_TOKEN;
  let running: RunningServer | undefined;
  try {
    running = await startServer();
    const address = running.server.address() as AddressInfo;
    assert.equal(address.address, '127.0.0.1');
  } finally {
    if (previousHost === undefined) delete process.env.GENESIS_MCP_HOST;
    else process.env.GENESIS_MCP_HOST = previousHost;
    if (previousToken === undefined) delete process.env.GENESIS_MCP_TOKEN;
    else process.env.GENESIS_MCP_TOKEN = previousToken;
    if (running) await closeServer(running.server);
  }
});

test('a non-loopback bind requires a bearer token of at least 32 characters', () => {
  assert.throws(
    () => createHttpServer({ host: '0.0.0.0', port: 0, token: null }),
    /GENESIS_MCP_TOKEN.*32 characters/i
  );
  assert.throws(
    () => createHttpServer({ host: '0.0.0.0', port: 0, token: 'too-short' }),
    /GENESIS_MCP_TOKEN.*32 characters/i
  );
});

test('rejects a configured bearer token that contains whitespace', () => {
  assert.throws(
    () => createHttpServer({ host: '127.0.0.1', port: 0, token: `${'x'.repeat(40)} token` }),
    /GENESIS_MCP_TOKEN must not contain whitespace/i
  );
});

test('unauthenticated loopback HTTP rejects foreign Host values and accepts localhost', async () => {
  const running = await startServer();
  let foreignResponse: IncomingMessage | undefined;
  let localResponse: IncomingMessage | undefined;
  try {
    const port = (running.server.address() as AddressInfo).port;
    foreignResponse = await openSseWithHost(running.baseUrl, `attacker.example:${port}`);
    assert.equal(foreignResponse.statusCode, 403);

    localResponse = await openSseWithHost(running.baseUrl, `LOCALHOST:${port}`);
    assert.equal(localResponse.statusCode, 200);
  } finally {
    foreignResponse?.destroy();
    localResponse?.destroy();
    await closeServer(running.server);
  }
});

test('SSE and message routes require a valid bearer token and send no CORS headers', async () => {
  const running = await startServer({ token: TEST_TOKEN });
  let sse: SseEventReader | undefined;
  try {
    const unauthenticated = await fetch(`${running.baseUrl}/sse`);
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.body?.cancel();

    const wrongToken = await fetch(`${running.baseUrl}/messages?sessionId=unknown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${'x'.repeat(TEST_TOKEN.length)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(wrongToken.status, 401);

    const unauthenticatedMessage = await fetch(`${running.baseUrl}/messages?sessionId=unknown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthenticatedMessage.status, 401);

    const authorized = await openSse(running.baseUrl, TEST_TOKEN);
    sse = authorized.events;
    assert.equal(authorized.response.status, 200);
    assert.equal(authorized.response.headers.get('access-control-allow-origin'), null);

    const options = await fetch(`${running.baseUrl}/sse`, { method: 'OPTIONS' });
    assert.equal(options.status, 405);
    for (const header of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers']) {
      assert.equal(options.headers.get(header), null, `${header} must not be emitted`);
    }
  } finally {
    await sse?.cancel().catch(() => undefined);
    await closeServer(running.server);
  }
});

test('token-authenticated SSE accepts a forwarded Host value', async () => {
  const running = await startServer({ token: TEST_TOKEN });
  let response: IncomingMessage | undefined;
  try {
    const port = (running.server.address() as AddressInfo).port;
    response = await openSseWithHost(running.baseUrl, `mcp-tunnel.example:${port}`, TEST_TOKEN);
    assert.equal(response.statusCode, 200);
  } finally {
    response?.destroy();
    await closeServer(running.server);
  }
});

test('unauthenticated health exposes only status and service while a valid token gets details', async () => {
  const running = await startServer({ token: TEST_TOKEN });
  try {
    const publicResponse = await fetch(`${running.baseUrl}/health`);
    assert.equal(publicResponse.status, 200);
    const publicHealth = await publicResponse.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(publicHealth).sort(), ['service', 'status']);

    const privateResponse = await fetch(`${running.baseUrl}/health`, {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(privateResponse.status, 200);
    const privateHealth = await privateResponse.json() as Record<string, unknown>;
    assert.equal(privateHealth.engine, 'test-engine');
    assert.deepEqual(privateHealth.readiness, { catalog: { state: 'ready' } });
  } finally {
    await closeServer(running.server);
  }
});

test('SSE messages are routed to their own session transport', { timeout: 5000 }, async () => {
  let serverNumber = 0;
  const running = await startServer({
    token: TEST_TOKEN,
    createMcpServer: () => testMcpServer(`session_tool_${++serverNumber}`),
  });
  let first: SseEventReader | undefined;
  let second: SseEventReader | undefined;
  try {
    const firstConnection = await openSse(running.baseUrl, TEST_TOKEN);
    first = firstConnection.events;
    assert.equal(firstConnection.response.status, 200);
    const firstEndpointEvent = await first.next();
    assert.equal(firstEndpointEvent.event, 'endpoint');
    const firstEndpoint = new URL(firstEndpointEvent.data, running.baseUrl);

    const secondConnection = await openSse(running.baseUrl, TEST_TOKEN);
    second = secondConnection.events;
    assert.equal(secondConnection.response.status, 200);
    const secondEndpointEvent = await second.next();
    assert.equal(secondEndpointEvent.event, 'endpoint');
    const secondEndpoint = new URL(secondEndpointEvent.data, running.baseUrl);
    assert.notEqual(firstEndpoint.searchParams.get('sessionId'), secondEndpoint.searchParams.get('sessionId'));

    await postMcpMessage(firstEndpoint, initializeRequest(1), TEST_TOKEN);
    assert.equal((await first.response(1)).id, 1);
    await postMcpMessage(secondEndpoint, initializeRequest(1), TEST_TOKEN);
    assert.equal((await second.response(1)).id, 1);

    await postMcpMessage(firstEndpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, TEST_TOKEN);
    await postMcpMessage(secondEndpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, TEST_TOKEN);
    await postMcpMessage(firstEndpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, TEST_TOKEN);
    await postMcpMessage(secondEndpoint, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, TEST_TOKEN);

    const firstTools = (await first.response(2)).result as { tools: Array<{ name: string }> };
    const secondTools = (await second.response(2)).result as { tools: Array<{ name: string }> };
    assert.equal(firstTools.tools[0]?.name, 'session_tool_1');
    assert.equal(secondTools.tools[0]?.name, 'session_tool_2');
  } finally {
    await Promise.allSettled([
      ...(first ? [first.cancel()] : []),
      ...(second ? [second.cancel()] : []),
    ]);
    await closeServer(running.server);
  }
});

test('refuses new SSE connections when 16 sessions are already active', { timeout: 15000 }, async () => {
  const running = await startServer({ token: TEST_TOKEN });
  const sessions: SseEventReader[] = [];
  try {
    for (let index = 0; index < 16; index += 1) {
      const connection = await openSse(running.baseUrl, TEST_TOKEN);
      assert.equal(connection.response.status, 200);
      sessions.push(connection.events);
    }

    const atCapacity = await fetch(`${running.baseUrl}/sse`, {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(atCapacity.status, 503);
    await atCapacity.body?.cancel();
  } finally {
    await Promise.allSettled(sessions.map((session) => session.cancel()));
    await closeServer(running.server);
  }
});
