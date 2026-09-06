#!/usr/bin/env node

import http from 'http';
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
 * Exposes GenesisBlock Graph Database & Catalog 2026 as an MCP Server over both:
 * 1. Stdio (Local CLI, Claude Desktop, Cursor)
 * 2. HTTP / SSE (Remote Client over Network & Cloudflare Tunnel)
 */

const genesis = new GenesisNativeCatalog({
  storePath: process.env.GENESIS_STORE_PATH || './data/genesis_smartgift_store_family_v2',
});

void genesis.init();

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

function createServerInstance() {
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
      const ready = await genesis.init();
      if (!ready) {
        return unavailableResult(
          genesis,
          'GENESIS_CATALOG_UNAVAILABLE',
          'canonical catalog is not ready'
        );
      }
      const query = String((args as any)?.query || '');
      const limit = Number((args as any)?.limit || 5);
      const results = await genesis.searchProducts(query, limit);
      return toolText(results);
    }

    if (name === 'taxonomy_preview') {
      const ready = await genesis.init();
      if (!ready) {
        return unavailableResult(
          genesis,
          'TAXONOMY_PROJECTION_UNAVAILABLE',
          'canonical catalog is not ready'
        );
      }
      try {
        const result = await genesis.previewTaxonomy(
          ((args || {}) as TaxonomyServingQueryInput)
        );
        return toolText(result);
      } catch (error) {
        return unavailableResult(
          genesis,
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

// Mode Selection: Stdio vs HTTP/SSE Server
const args = process.argv.slice(2);
const ssePortIndex = args.indexOf('--port');
const ssePort = ssePortIndex !== -1 ? parseInt(args[ssePortIndex + 1], 10) : null;

if (ssePort) {
  // Remote SSE MCP Server Mode (for sharing across LAN / Cloudflare Tunnel)
  let sseTransport: SSEServerTransport | null = null;
  const mcpServer = createServerInstance();

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end();
      return;
    }

    if (req.url === '/sse') {
      sseTransport = new SSEServerTransport('/messages', res);
      await mcpServer.connect(sseTransport);
      return;
    }

    if (req.url === '/messages' && req.method === 'POST') {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.writeHead(400).end('SSE session not established');
      }
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          status: 'ok',
          service: 'genesisblock-mcp',
          engine: 'GenesisBlock Native Rust',
          readiness: {
            catalog: genesis.getCatalogStatus(),
            taxonomyProjection: genesis.getTaxonomyProjectionStatus(),
          },
        })
      );
      return;
    }

    res.writeHead(404).end('Not Found');
  });

  httpServer.listen(ssePort, '0.0.0.0', () => {
    console.log(`[GenesisBlock MCP] 🚀 Remote MCP Server listening on http://0.0.0.0:${ssePort}/sse`);
    console.log(`[GenesisBlock MCP] 🔗 Health endpoint: http://localhost:${ssePort}/health`);
  });
} else {
  // Local Stdio Mode (for Claude Desktop / Cursor in local machine)
  const mcpServer = createServerInstance();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
