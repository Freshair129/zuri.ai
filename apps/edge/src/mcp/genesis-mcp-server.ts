#!/usr/bin/env node

import http, { type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GenesisNativeCatalog } from '../rag/genesis-native.js';
import {
  TaxonomyServingError,
  type TaxonomyServingQueryInput,
} from '../rag/taxonomy-serving.js';

/**
 * GenesisBlock MCP Server
 * Exposes GenesisBlock Graph Database & Catalog 2026 over stdio or authenticated HTTP/SSE.
 */

let genesisCatalog: GenesisNativeCatalog | undefined;

function getGenesisCatalog(): GenesisNativeCatalog {
  genesisCatalog ??= new GenesisNativeCatalog({
    storePath: process.env.GENESIS_STORE_PATH || './data/genesis_smartgift_store_family_v2',
  });
  return genesisCatalog;
}

const TOOLS = [
  {
    name: 'search_catalog',
    description: 'ค้นหาสินค้า สเปก และราคาแคตตาล็อก 2026 ในฐานข้อมูลกราฟ GenesisBlock',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'คำค้นหา เช่น "ร่ม", "แก้ว", "พัดลม", หรือรหัสสินค้า "TJS23-2"' },
        limit: { type: 'number', description: 'จำนวนผลลัพธ์สูงสุด (ค่าเริ่มต้น 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'taxonomy_preview',
    description: 'ตรวจสอบ taxonomy evidence แบบ read-only; ผลลัพธ์ยังไม่ใช่ category authority',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'คำค้นหา Thai/English หรือ source code แบบ exact' },
        categoryId: { type: 'string', description: 'P0 candidate category id เช่น drinkware' },
        limit: { type: 'number', description: 'จำนวนผลลัพธ์สูงสุด 1-50 (ค่าเริ่มต้น 5)' },
        includeReview: { type: 'boolean', description: 'รวม review_required/unclassified หรือไม่ (ค่าเริ่มต้น true)' },
      },
      required: [],
    },
  },
];

function toolText(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function unavailableResult(genesisRag: GenesisNativeCatalog, code: string, message: string) {
  return toolText({
    status: 'unavailable',
    error: { code, message },
    readiness: {
      catalog: genesisRag.getCatalogStatus(),
      taxonomyProjection: genesisRag.getTaxonomyProjectionStatus(),
    },
  });
}

function createServerInstance(catalog: GenesisNativeCatalog = getGenesisCatalog()) {
  const server = new Server(
    { name: 'genesisblock-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'search_catalog') {
      const ready = await catalog.init();
      if (!ready) {
        return unavailableResult(
          catalog,
          'GENESIS_CATALOG_UNAVAILABLE',
          'canonical catalog is not ready'
        );
      }
      const query = String((args as any)?.query || '');
      const limit = Number((args as any)?.limit || 5);
      const results = await catalog.searchProducts(query, limit);
      return toolText(results);
    }

    if (name === 'taxonomy_preview') {
      const ready = await catalog.init();
      if (!ready) {
        return unavailableResult(
          catalog,
          'TAXONOMY_PROJECTION_UNAVAILABLE',
          'canonical catalog is not ready'
        );
      }
      try {
        const result = await catalog.previewTaxonomy(
          ((args || {}) as TaxonomyServingQueryInput)
        );
        return toolText(result);
      } catch (error) {
        return unavailableResult(
          catalog,
          error instanceof TaxonomyServingError
            ? error.code
            : 'TAXONOMY_PROJECTION_UNAVAILABLE',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

export type HttpServerOptions = {
  host?: string | null;
  port?: number;
  token?: string | null;
  createMcpServer?: () => ReturnType<typeof createServerInstance>;
  getHealthDetails?: () => Record<string, unknown>;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const MAX_CONCURRENT_SSE_SESSIONS = 16;

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  const match = authorization && /^Bearer ([^\s]+)$/i.exec(authorization);
  if (!match) return false;

  const expected = createHash('sha256').update(expectedToken, 'utf8').digest();
  const supplied = createHash('sha256').update(match[1], 'utf8').digest();
  return timingSafeEqual(expected, supplied);
}

function allowedLoopbackHostHeaders(server: HttpServer): string[] {
  const address = server.address();
  if (!address || typeof address === 'string') return [];

  return [
    `127.0.0.1:${address.port}`,
    `localhost:${address.port}`,
    `[::1]:${address.port}`,
  ];
}

function writeJson(response: ServerResponse, value: Record<string, unknown>): void {
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}

function defaultHealthDetails(): Record<string, unknown> {
  const catalog = getGenesisCatalog();
  return {
    engine: 'GenesisBlock Native Rust',
    readiness: {
      catalog: catalog.getCatalogStatus(),
      taxonomyProjection: catalog.getTaxonomyProjectionStatus(),
    },
  };
}

/** Creates and listens on the local HTTP/SSE surface. A non-loopback host must have a strong token. */
export function createHttpServer(options: HttpServerOptions = {}): Promise<HttpServer> {
  const hostOption = Object.hasOwn(options, 'host') ? options.host : process.env.GENESIS_MCP_HOST;
  const host = hostOption?.trim() || '127.0.0.1';
  const tokenOption = Object.hasOwn(options, 'token') ? options.token : process.env.GENESIS_MCP_TOKEN;
  if (typeof tokenOption === 'string' && /\s/.test(tokenOption)) {
    throw new Error('GENESIS_MCP_TOKEN must not contain whitespace.');
  }
  const token = tokenOption || undefined;

  if (token && Array.from(token).length < 32) {
    throw new Error('GENESIS_MCP_TOKEN must contain at least 32 characters when configured.');
  }
  if (!isLoopbackHost(host) && !token) {
    throw new Error('GENESIS_MCP_TOKEN is required with at least 32 characters when GENESIS_MCP_HOST binds beyond loopback.');
  }

  const sessions = new Map<string, { transport: SSEServerTransport; server: ReturnType<typeof createServerInstance> }>();

  const httpServer = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error('[GenesisBlock MCP] HTTP request failed:', error);
      if (!response.writableEnded) {
        if (!response.headersSent) response.writeHead(500);
        response.end('Internal Server Error');
      }
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || '/', 'http://localhost');
    let allowedHosts: string[] = [];
    if (!token) {
      allowedHosts = allowedLoopbackHostHeaders(httpServer);
      const hostHeader = request.headers.host?.toLowerCase();
      if (!hostHeader || !allowedHosts.includes(hostHeader)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      // The SDK compares allowedHosts literally, so normalize after the case-insensitive check.
      request.headers.host = hostHeader;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(405).end();
      return;
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      const health: Record<string, unknown> = {
        status: 'ok',
        service: 'genesisblock-mcp',
      };
      if (token && hasValidBearerToken(request, token)) {
        Object.assign(health, options.getHealthDetails?.() ?? defaultHealthDetails());
      }
      writeJson(response, health);
      return;
    }

    if (url.pathname === '/sse' && request.method === 'GET') {
      if (token && !hasValidBearerToken(request, token)) {
        response.writeHead(401).end('Unauthorized');
        return;
      }

      if (sessions.size >= MAX_CONCURRENT_SSE_SESSIONS) {
        response.writeHead(503).end('SSE session capacity reached');
        return;
      }

      const transport = new SSEServerTransport('/messages', response, token ? undefined : {
        enableDnsRebindingProtection: true,
        allowedHosts,
      });
      const sessionId = transport.sessionId;
      const mcpServer = options.createMcpServer?.() ?? createServerInstance();
      sessions.set(sessionId, { transport, server: mcpServer });
      transport.onclose = () => {
        sessions.delete(sessionId);
      };

      try {
        await mcpServer.connect(transport);
      } catch (error) {
        sessions.delete(sessionId);
        throw error;
      }
      return;
    }

    if (url.pathname === '/messages' && request.method === 'POST') {
      if (token && !hasValidBearerToken(request, token)) {
        response.writeHead(401).end('Unauthorized');
        return;
      }

      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        response.writeHead(400).end('Missing sessionId parameter');
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        response.writeHead(404).end('SSE session not found');
        return;
      }

      await session.transport.handlePostMessage(request, response);
      return;
    }

    response.writeHead(404).end('Not Found');
  }

  return new Promise<HttpServer>((resolveServer, rejectServer) => {
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      rejectServer(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolveServer(httpServer);
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(options.port ?? 8989, host);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const ssePortIndex = args.indexOf('--port');
  if (ssePortIndex !== -1) {
    const ssePort = Number(args[ssePortIndex + 1]);
    if (!Number.isInteger(ssePort) || ssePort < 1 || ssePort > 65535) {
      throw new Error('A valid port number from 1 to 65535 is required after --port.');
    }

    const httpServer = await createHttpServer({ port: ssePort });
    void getGenesisCatalog().init();
    const address = httpServer.address();
    const listeningHost = address && typeof address !== 'string' ? address.address : '127.0.0.1';
    console.log(`[GenesisBlock MCP] HTTP/SSE server listening on http://${listeningHost}:${ssePort}/sse`);
    console.log(`[GenesisBlock MCP] Health endpoint: http://${listeningHost}:${ssePort}/health`);
    return;
  }

  const catalog = getGenesisCatalog();
  void catalog.init();
  const transport = new StdioServerTransport();
  await createServerInstance(catalog).connect(transport);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error('[GenesisBlock MCP] Startup failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
