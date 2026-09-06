import { Catalog, CatalogProduct, findByCode, isQuotable, searchByName } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
import { formatQuoteForLine, scopeQuote } from '../identity/scope.js';
import {
  PRICING_PROFILES,
  buildPriceQuote,
  screenPositionsForItemCode,
} from '../pricing/index.js';
import { HeadlessOptions, runHeadless } from './headless.js';
import {
  ConversationResult,
  LlmOptions,
  OWNER_NOTE,
  SALES_NOTE,
  SYSTEM_PROMPT,
  answerWithModel,
  unverifiedNumbers,
} from './llm.js';
import { ConversationOptions, appendTurns, loadConversation } from './memory.js';
import { Intent, parseMessage } from './parse.js';
import { loadPersonaPrompt } from './persona.js';
import type { GenesisLocalRag } from '../rag/genesis-rag.js';
import { buildCodexEvidence } from './codex-evidence.js';
import type { SearchEvidenceV4 } from './format-cards.js';

// @req SDD-010 — the conversational answer stack: pattern, API and headless layers with short-lived memory.

export interface AnswerOptions {
  catalog: Catalog;
  role: Role;
  /** THB per RMB on the day of the quote. */
  exchangeRate: number;
  /** Month of shipment, for the seasonal truck/sea rule. */
  shipMonth?: number;
}

const HELP_TEXT = [
  'ซูริช่วยเรื่องราคาได้ 3 แบบค่ะ',
  '',
  '• พิมพ์รหัสสินค้า เช่น  TJS23-2',
  '• รหัส + จำนวน เช่น  TJS23-2 100 ชุด',
  '• จำนวน + งบ เช่น  100 ชุด งบ 300',
  '',
  'หรือพิมพ์ชื่อสินค้าเพื่อค้นหา เช่น  ร่ม',
].join('\n');

/** Everything a quote needs, assembled from one catalog row. */
function quoteInputFor(p: CatalogProduct, options: AnswerOptions) {
  const [l, w, h] = p.dims as [number, number, number];
  return {
    sku: p.code,
    factoryCostRmb: p.rmb as number,
    exchangeRate: options.exchangeRate,
    carton: {
      unitsPerCarton: p.upc as number,
      cartonCbm: Math.round((l * w * h) / 1e6 * 10000) / 10000,
      ...(p.kg ? { cartonWeightKg: p.kg } : {}),
    },
    freight: {
      mode: 'auto' as const,
      shipMonth: options.shipMonth ?? new Date().getMonth() + 1,
      goodsClass: (p.e ? 'electronic_tisi' : 'general') as 'electronic_tisi' | 'general',
    },
    logo: { positions: screenPositionsForItemCode(p.code) },
  };
}

function priceAnswer(p: CatalogProduct, quantity: number | null, options: AnswerOptions): string {
  if (!isQuotable(p)) {
    const missing = [
      p.rmb === null ? 'ต้นทุนโรงงาน' : null,
      p.upc === null || p.dims === null ? 'ข้อมูลกล่อง' : null,
    ].filter(Boolean);
    return (
      `${p.code} — ${p.name}\n\n` +
      `ยังคำนวณราคาให้ไม่ได้ค่ะ ขาด${missing.join('และ')}\n` +
      'สินค้ารุ่นเก่าในแคตตาล็อกยังไม่มีข้อมูลกล่อง กำลังขอจากโรงงานอยู่'
    );
  }

  const quote = buildPriceQuote(quoteInputFor(p, options));
  const scoped = scopeQuote(quote, options.role);
  let text = formatQuoteForLine(scoped, p.name);

  /*
   * A quantity that is not one of the published breaks is answered with the break above it: the
   * customer pays that price, and quoting the cheaper break below would be a promise the ladder
   * does not make.
   */
  if (quantity !== null) {
    const breaks = scoped.breaks;
    const exact = breaks.find((b) => b.quantity === quantity);
    if (!exact) {
      const above = breaks.find((b) => b.quantity >= quantity);
      const chosen = above || breaks[breaks.length - 1];
      text +=
        `\n\nที่ ${quantity.toLocaleString('en-US')} ชุด ` +
        (above
          ? `ใช้ราคาขั้น ${chosen.quantity} ชุด = ${chosen.unitPriceThb.toLocaleString('en-US')} บาท`
          : `เกินขั้นสูงสุดในตาราง ใช้ราคาขั้น ${chosen.quantity} ชุด = ${chosen.unitPriceThb.toLocaleString('en-US')} บาท และควรขอราคาพิเศษ`);
    }
  }
  return text;
}

/**
 * Products whose price at the asked quantity fits the budget.
 *
 * This is the reverse of a normal quote and it is what the sales floor actually asks for: the
 * customer names a headcount and a budget, and the question is which products clear it.
 */
function budgetAnswer(quantity: number, maxPriceThb: number, options: AnswerOptions): string {
  const profile = PRICING_PROFILES.standard;
  const nearest =
    profile.quantityBreaks.find((q) => q >= quantity) ??
    profile.quantityBreaks[profile.quantityBreaks.length - 1];

  const hits: Array<{ p: CatalogProduct; price: number }> = [];
  for (const p of options.catalog.products) {
    if (!isQuotable(p)) continue;
    try {
      const quote = buildPriceQuote(quoteInputFor(p, options));
      const brk = quote.breaks.find((b) => b.quantity === nearest);
      if (brk && brk.unitPriceThb <= maxPriceThb) hits.push({ p, price: brk.unitPriceThb });
    } catch {
      // A row with impossible carton figures is skipped rather than aborting the whole search.
    }
  }

  if (!hits.length) {
    return (
      `${quantity.toLocaleString('en-US')} ชุด งบ ${maxPriceThb.toLocaleString('en-US')} บาท/ชุด\n\n` +
      'ยังไม่มีสินค้าที่เข้างบนี้ค่ะ ลองเพิ่มงบหรือเพิ่มจำนวนสั่ง เพราะสั่งมากขึ้นราคาต่อชุดจะถูกลง'
    );
  }

  hits.sort((a, b) => b.price - a.price);
  const shown = hits.slice(0, 10);
  const lines = shown.map(
    (h) => `${h.p.code}  ${h.price.toLocaleString('en-US')} บาท  ${h.p.name.slice(0, 44)}`
  );

  return [
    `${quantity.toLocaleString('en-US')} ชุด งบไม่เกิน ${maxPriceThb.toLocaleString('en-US')} บาท/ชุด`,
    `เจอ ${hits.length} รายการ${hits.length > shown.length ? ` แสดง ${shown.length} ที่ใกล้งบที่สุด` : ''}`,
    '',
    ...lines,
    '',
    nearest !== quantity ? `* ใช้ราคาขั้น ${nearest} ชุด ซึ่งเป็นขั้นที่ครอบจำนวนที่ถาม` : '',
    'พิมพ์รหัสสินค้าเพื่อดูราคาทุกขั้น',
  ]
    .filter(Boolean)
    .join('\n');
}

function searchAnswer(query: string, options: AnswerOptions): string {
  const found = searchByName(options.catalog, query);
  if (!found.length) {
    return `ไม่เจอสินค้าที่ตรงกับ "${query}" ค่ะ\n\nลองพิมพ์รหัสสินค้า หรือคำสั้นลง เช่น ร่ม กระติก`;
  }
  return [
    `เจอ ${found.length} รายการที่ตรงกับ "${query}"`,
    '',
    ...found.map((p) => `${p.code}  ${p.name.slice(0, 48)}`),
    '',
    'พิมพ์รหัสสินค้าเพื่อดูราคาค่ะ',
  ].join('\n');
}

/** Turn one incoming message into the text of one reply. */
export function answerMessage(text: string, options: AnswerOptions): string {
  const intent: Intent = parseMessage(text);

  switch (intent.kind) {
    case 'help':
      return HELP_TEXT;

    case 'price': {
      const product = findByCode(options.catalog, intent.sku);
      if (!product) {
        return `ไม่เจอรหัส ${intent.sku} ในแคตตาล็อกค่ะ\n\nลองพิมพ์ชื่อสินค้าเพื่อค้นหา หรือตรวจรหัสอีกครั้ง`;
      }
      return priceAnswer(product, intent.quantity, options);
    }

    case 'budget':
      return budgetAnswer(intent.quantity, intent.maxPriceThb, options);

    case 'search':
      return searchAnswer(intent.query, options);

    default:
      return `ซูริยังไม่เข้าใจคำถามนี้ค่ะ\n\n${HELP_TEXT}`;
  }
}

export interface ConversationOptionsFull extends AnswerOptions {
  /** The LINE agent's only door into the catalog graph — used by the model tool-call path. */
  rag: GenesisLocalRag;
  /** Stable per-person key. Already hashed — a raw LINE id never reaches here. */
  conversationKey: string;
  memory: ConversationOptions;
  /** Server conversation jobs forbid local transcript retention and replay. */
  retainHistory?: boolean;
  /** Absent or disabled means the pattern-based answer is the answer. */
  llm?: LlmOptions | null;
  /**
   * The subscription-backed path: Claude Code driven headlessly, with its own session continuity
   * and its own tools. Preferred over `llm` when both are configured, because it bills against a
   * plan rather than per token and can search the web and author files.
   */
  headless?: HeadlessOptions | null;
}

/*
 * Written for a process with no one watching it: whatever it returns is what lands in the chat, so
 * a plan, a question about how to proceed, or a running commentary would all be delivered as if
 * they were the answer. Which tools it may touch is not stated here at all — that is settled by
 * the allow-list passed on the command line, where the message being answered cannot reach it.
 */
const HEADLESS_NOTE = `
คำตอบของคุณจะถูกส่งเข้าแชท LINE ตรง ๆ โดยไม่มีคนตรวจก่อน
ตอบเป็นข้อความเดียวจบ ไม่ต้องเล่าว่ากำลังจะทำอะไรหรือทำอะไรไปแล้ว ให้บอกผลลัพธ์
ถ้าสร้างไฟล์ ให้เขียนลงโฟลเดอร์ out/ เท่านั้น แล้วบอกชื่อไฟล์ในคำตอบ`;

/**
 * The claude CLI defers MCP tool schemas: they exist but must be loaded by exact name through
 * ToolSearch before the first call. A keyword search does not reliably surface them, so the exact
 * names and the load incantation are stated outright — without this the model concludes the
 * catalog tools do not exist and apologises to the customer.
 */
export const HEADLESS_TOOLS_NOTE = `
เครื่องมือแคตตาล็อกที่มีให้ (ต้องโหลดก่อนใช้):
- mcp__smartgift__search_products  ค้นสินค้า (query ภาษาไทยได้)
- mcp__smartgift__quote_price      ราคาตามขั้นจำนวนของรหัสสินค้า
- mcp__smartgift__find_within_budget  หาสินค้าตามงบต่อชุด
- mcp__smartgift__lead_time        ระยะเวลาผลิต-ส่ง
- mcp__smartgift__explain_policy   นโยบายการขาย
ขั้นแรกให้เรียก ToolSearch ด้วย query "select:mcp__smartgift__search_products,mcp__smartgift__quote_price,mcp__smartgift__find_within_budget,mcp__smartgift__lead_time,mcp__smartgift__explain_policy" หนึ่งครั้ง แล้วจึงใช้เครื่องมือเหล่านี้ตอบจากข้อมูลจริงเท่านั้น ห้ามสรุปว่าไม่มีเครื่องมือ`;

/**
 * The same list without the ToolSearch step. Codex does not defer MCP schemas — every
 * `mcp__smartgift__*` tool is already visible on the first turn — so telling it to load them first
 * sends it looking for a tool that is not there.
 */
export const HEADLESS_TOOLS_NOTE_CODEX = HEADLESS_TOOLS_NOTE.replace(
  'เครื่องมือแคตตาล็อกที่มีให้ (ต้องโหลดก่อนใช้):',
  'เครื่องมือแคตตาล็อกที่มีให้ (เรียกใช้ได้ทันที):',
).replace(/ขั้นแรกให้เรียก ToolSearch[^\n]*?แล้วจึงใช้/, 'ใช้');

/**
 * Picks the note for the CLI actually in use.
 *
 * This note exists because without it the model concludes the catalog tools do not exist and
 * apologises to the customer — which is exactly what happened while it was merely exported and
 * never added to the prompt. Both CLIs need the tool names; only the Claude one needs the
 * ToolSearch step.
 */
export function headlessToolsNote(bin: string): string {
  return bin.includes('codex') ? HEADLESS_TOOLS_NOTE_CODEX : HEADLESS_TOOLS_NOTE;
}

/**
 * One turn through the headless CLI.
 *
 * The number check runs here exactly as it does on the API path — the evidence is harvested from
 * the tool results on the event stream rather than from a closure, but the rule is the same: a
 * figure that is in neither the evidence nor the person's own words means the reply is discarded.
 */
async function answerViaHeadless(
  text: string,
  options: ConversationOptionsFull,
  headless: HeadlessOptions,
  fallback: string
): Promise<ConversationResult> {
  const personaPrompt = loadPersonaPrompt(process.env.ZURI_ACTIVE_PERSONA || 'zuri-01');
  
  // Load conversation turns for short-term memory continuity
  const historyTurns = options.retainHistory === false ? [] : loadConversation(options.conversationKey, options.memory);
  let conversationHistoryContext = '';
  if (historyTurns.length > 0) {
    const recent = historyTurns.slice(-6); // Keep last 3 exchanges (6 turns)
    conversationHistoryContext = '\n\n[ประวัติการสนทนาก่อนหน้านี้ในห้องนี้]:\n' +
      recent.map(t => `${t.role === 'user' ? 'ลูกค้า' : 'ซูริ'}: ${t.text}`).join('\n');
  }

  const result = await runHeadless(
    text,
    personaPrompt +
      '\n' +
      (options.role === 'owner' ? OWNER_NOTE : SALES_NOTE) +
      HEADLESS_NOTE +
      headlessToolsNote(headless.bin) +
      conversationHistoryContext,
    options.role,
    options.conversationKey,
    headless
  );

  if (!result.ok) {
    return {
      text: fallback,
      source: 'rules',
      reason: result.error || 'headless answer unavailable',
      toolCalls: result.toolCalls,
    };
  }

  // When AI model generated a thorough response (e.g. CI design, marketing, consultation),
  // return the model answer directly so it's not mistakenly overwritten by pricing fallback
  return { text: result.text, source: 'model', toolCalls: result.toolCalls };
}

/**
 * What to say when the model path cannot be used.
 *
 * The pattern reader is the right fallback when it actually understood the message. When it did
 * not — a bare follow-up like "แล้วถ้าสั่ง 1000 ล่ะ" parses as a product search for the word
 * "แล้วถ้าสั่ง" — its answer is confidently wrong, and a confidently wrong answer is worse than
 * saying nothing useful. So a guess is only offered when the reader recognised what was asked.
 */
function fallbackFor(text: string, options: AnswerOptions): string {
  const intent = parseMessage(text);
  if (intent.kind === 'search' || intent.kind === 'unknown') {
    return 'ซูริตอบคำถามนี้ไม่ได้ตอนนี้ค่ะ ลองพิมพ์รหัสสินค้าพร้อมจำนวน เช่น TJS23-2 300 ชุด';
  }
  return answerMessage(text, options);
}

/**
 * Answer one message as part of a conversation.
 *
 * The deterministic answer is computed first, every time. That is not waste — it is the thing that
 * gets sent whenever the model is off, unreachable, too slow for the reply token, or produced a
 * figure that is not in the evidence. Building it up front means the fallback path has nothing
 * left that can fail.
 */
export async function answerConversation(
  text: string,
  options: ConversationOptionsFull
): Promise<ConversationResult> {
  const fallback = answerMessage(text, options);

  /*
   * The headless path keeps its own conversation through `--resume`, so the turns recorded here
   * are for the record and for the API path, not replayed into it.
   */
  if (options.headless) {
    const result = await answerViaHeadless(text, options, options.headless, fallbackFor(text, options));
    recordTurns(text, result.text, options);
    return result;
  }

  if (!options.llm?.port) {
    return { text: fallback, source: 'rules', reason: 'model disabled', toolCalls: [] };
  }

  const history = options.retainHistory === false ? [] : loadConversation(options.conversationKey, options.memory);
  const result = await answerWithModel(
    text,
    history,
    options.role,
    {
      catalog: options.catalog,
      role: options.role,
      exchangeRate: options.exchangeRate,
      rag: options.rag,
      ...(options.shipMonth !== undefined ? { shipMonth: options.shipMonth } : {}),
    },
    options.llm,
    fallback
  );

  recordTurns(text, result.text, options);
  return result;
}

function recordTurns(
  userText: string,
  replyText: string,
  options: ConversationOptionsFull
): void {
  if (options.retainHistory === false) return;
  const at = new Date().toISOString();
  appendTurns(
    options.conversationKey,
    [
      { role: 'user', text: userText, at },
      { role: 'assistant', text: replyText, at },
    ],
    options.memory
  );
}
