#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadCatalog } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
import {
  EvidenceOptions,
  POLICY_TOPIC_KEYS,
  PolicyTopic,
  explainPolicy,
  findWithinBudget,
  leadTime,
  quotePrice,
  searchProducts,
} from '../answer/tools.js';
import { GenesisLocalRag } from '../rag/genesis-rag.js';

// @req SDD-015 — the read-only pricing MCP door the sandboxed headless answer layer calls.

/**
 * The only door the sandboxed agent has into SmartGift's numbers.
 *
 * The agent that answers chat runs with no database, no shell and no repository — it can reach
 * exactly the five calls below and nothing else. That is the same rule the runtime already applies
 * to itself in `AGENTS.md`: registered read-only queries, never arbitrary SQL or a shell.
 *
 * The role is fixed by the parent process at spawn time and read from the environment here. It is
 * not a parameter, because a parameter is something a message could ask to change: a sales
 * conversation cannot talk its way into a cost figure, since this process was started without the
 * ability to produce one.
 */

function optionsFromEnv(): EvidenceOptions {
  const role: Role = process.env.ZURI_MCP_ROLE === 'owner' ? 'owner' : 'sales';
  const catalogRoot = process.env.ZURI_MCP_CATALOG_ROOT || 'state/catalog';
  const catalog = loadCatalog(catalogRoot);
  if (catalog.products.length === 0) {
    /*
     * Say it out loud on stderr (stdout is the JSON-RPC channel). An empty catalog answers every
     * cost question with "ไม่มีรหัสนี้ในแคตตาล็อก", which reads exactly like a wrong item code —
     * so a worktree started without `state/` looked like a customer typo for as long as nobody
     * checked. A missing catalog is a deployment fact and should announce itself.
     */
    process.stderr.write(
      `[pricing-mcp] cost catalog at ${catalogRoot} is empty; the rmb estimate path will answer ` +
        `"not in the catalog" for every code.
`
    );
  }
  return {
    catalog,
    role,
    exchangeRate: Number(process.env.ZURI_MCP_FX_THB_PER_RMB || '5'),
    shipMonth: process.env.ZURI_MCP_SHIP_MONTH
      ? Number(process.env.ZURI_MCP_SHIP_MONTH)
      : undefined,
    rag: new GenesisLocalRag({ apiUrl: process.env.GENESIS_RAG_API_URL }),
  };
}

const TOOLS = [
  {
    name: 'quote_price',
    description:
      'ราคาขายต่อชุดของสินค้าหนึ่งรหัส ครบทุกขั้นบันไดจำนวน ใช้เมื่อรู้รหัสสินค้าแล้ว ' +
      'ใส่ quantity ด้วยถ้าลูกค้าบอกจำนวน จะได้ราคาของขั้นที่ครอบจำนวนนั้น ' +
      'ตัวเลขทุกตัวมาจากเครื่องคำนวณราคาจริง ห้ามคำนวณเอง',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'รหัสสินค้าตามแคตตาล็อก เช่น TJS23-2' },
        quantity: { type: 'integer', minimum: 1, description: 'จำนวนที่ลูกค้าจะสั่ง (ชุด)' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'find_within_budget',
    description:
      'ค้นสินค้าที่ราคาต่อชุดไม่เกินงบที่กำหนด ณ จำนวนสั่งซื้อหนึ่ง ๆ ' +
      'ใช้เมื่อลูกค้าบอกงบและจำนวนมาแล้วแต่ยังไม่ได้เลือกสินค้า',
    inputSchema: {
      type: 'object',
      properties: {
        quantity: { type: 'integer', minimum: 1, description: 'จำนวนที่จะสั่ง (ชุด)' },
        maxPriceThb: { type: 'number', minimum: 1, description: 'งบสูงสุดต่อชุด เป็นบาท' },
      },
      required: ['quantity', 'maxPriceThb'],
    },
  },
  {
    name: 'search_products',
    description:
      'ค้นสินค้าจากชื่อหรือคำอธิบาย ใช้เมื่อลูกค้าพูดถึงประเภทสินค้าแต่ยังไม่มีรหัส เช่น "ร่ม" "กระติกน้ำ"',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'คำค้น ภาษาไทยหรืออังกฤษ' } },
      required: ['query'],
    },
  },
  {
    name: 'lead_time',
    description:
      'ระยะเวลาตั้งแต่วางมัดจำจนได้รับของ แยกตามขั้นตอน ' +
      'ใส่ deadlineDays ถ้าลูกค้ามีกำหนดรับของ จะได้คำตอบว่าต้องส่งทางรถหรือทางเรือ',
    inputSchema: {
      type: 'object',
      properties: {
        quantity: { type: 'integer', minimum: 1, description: 'จำนวนที่จะสั่ง (ชุด)' },
        mode: { type: 'string', enum: ['truck', 'sea'], description: 'วิธีขนส่งจากจีน' },
        deadlineDays: { type: 'integer', minimum: 1, description: 'จำนวนวันที่ลูกค้าต้องการของ' },
        rush: { type: 'boolean', description: 'งานเร่ง ข้ามขั้นทำตัวอย่าง' },
      },
      required: ['quantity'],
    },
  },
  {
    name: 'explain_policy',
    description:
      'เงื่อนไขการค้าที่บริษัทใช้เป็นมาตรฐาน ใช้เมื่อถูกถามเรื่องค่าส่งในไทย วิธีขนส่งจากจีน ' +
      'ค่าสกรีน ขั้นตอนสั่งซื้อ หรือหลักการของราคาขั้นบันได',
    inputSchema: {
      type: 'object',
      properties: { topic: { type: 'string', enum: [...POLICY_TOPIC_KEYS] } },
      required: ['topic'],
    },
  },
] as const;

export type ToolArgs = Record<string, unknown>;

export async function call(name: string, args: ToolArgs, options: EvidenceOptions): Promise<unknown> {
  switch (name) {
    case 'quote_price':
      return quotePrice(
        String(args.sku ?? ''),
        args.quantity === undefined ? null : Number(args.quantity),
        options
      );
    case 'find_within_budget':
      return findWithinBudget(Number(args.quantity), Number(args.maxPriceThb), options);
    case 'search_products':
      return searchProducts(String(args.query ?? ''), options);
    case 'lead_time':
      return leadTime(Number(args.quantity), {
        mode: args.mode === 'sea' ? 'sea' : args.mode === 'truck' ? 'truck' : undefined,
        deadlineDays: args.deadlineDays === undefined ? undefined : Number(args.deadlineDays),
        rush: args.rush === true,
      });
    case 'explain_policy':
      return explainPolicy(String(args.topic ?? 'price_ladder') as PolicyTopic);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main(): Promise<void> {
  const options = optionsFromEnv();
  const server = new Server(
    { name: 'smartgift-pricing', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await call(
        request.params.name,
        (request.params.arguments || {}) as ToolArgs,
        options
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (error) {
      /*
       * A failed lookup is reported as a tool error rather than thrown, so the agent can say "ยังหา
       * ข้อมูลนี้ไม่ได้" instead of the whole turn collapsing.
       */
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

/*
 * Only connect the stdio transport when this file is run directly (`node .../pricing-server.js`,
 * as the LINE agent's MCP client spawns it). Importing it for `call` — as the unit tests do — must
 * not also start listening on stdin, or the test process would hang waiting for EOF that never
 * comes.
 */
const isMainModule =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`[pricing-mcp] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
