import { Catalog, searchByName } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
import { HeadlessOptions, runHeadless } from './headless.js';
import {
  ConversationResult,
  LlmOptions,
  OWNER_NOTE,
  SALES_NOTE,
  answerWithModel,
} from './llm.js';
import { ConversationOptions, appendTurns, loadConversation } from './memory.js';
import { Intent, parseMessage } from './parse.js';
import { activePersonaId, loadPersonaPrompt } from './persona.js';
import type { AnswerRag } from '../rag/genesis-rag.js';

// @req SDD-010 — the conversational answer stack: pattern, API and headless layers with short-lived memory.

export interface AnswerOptions {
  catalog: Catalog;
  role: Role;
  /** THB per RMB on the day of the quote. */
  exchangeRate: number;
  /** Month of shipment, for the seasonal truck/sea rule. */
  shipMonth?: number;
}

/**
 * What to say when there is no data to answer from at all — as opposed to a lookup that ran
 * against real data and came up empty. An empty catalogue means the reader has nothing to check a
 * denial against, so it must not claim a product does not exist (item 2 of the FR-150 defect fix:
 * see docs/CONVERSATIONAL-ANSWER-SPEC.md).
 */
export const CANNOT_ANSWER_NOW_TEXT = 'ซูริตอบคำถามนี้ไม่ได้ตอนนี้ค่ะ ลองพิมพ์รหัสสินค้าพร้อมจำนวน เช่น TJS23-2 300 ชุด';

const HELP_TEXT = [
  'พิมพ์ชื่อสินค้าเพื่อค้นหา เช่น  ร่ม',
  '',
  'ราคาตอบได้จากแคตตาล็อกที่เผยแพร่เท่านั้นค่ะ',
].join('\n');

/** The local cost-to-price calculator was removed (ADR-119); a price is only ever read from the published catalog. */
const PRICE_NOT_AVAILABLE_TEXT = 'ซูริยังคำนวณราคาในโหมดนี้ไม่ได้ค่ะ ราคาตอบได้จากแคตตาล็อกที่เผยแพร่เท่านั้น';

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

  /*
   * An empty catalogue is not a lookup that ran and found nothing — it is no data at all. `price`,
   * `search` and `budget` all read `options.catalog`, so answering any of them from zero products
   * would be a confident denial of something that may well exist (item 2). `help` still answers,
   * and `unknown` already says a truthful "did not understand" rather than claiming anything about
   * the catalogue, so both keep their normal replies.
   */
  if (options.catalog.products.length === 0 && ['search'].includes(intent.kind)) {
    return CANNOT_ANSWER_NOW_TEXT;
  }

  switch (intent.kind) {
    case 'help':
      return HELP_TEXT;

    case 'price':
    case 'budget':
      return PRICE_NOT_AVAILABLE_TEXT;

    case 'search':
      return searchAnswer(intent.query, options);

    default:
      return `ซูริยังไม่เข้าใจคำถามนี้ค่ะ\n\n${HELP_TEXT}`;
  }
}

export interface ConversationOptionsFull extends AnswerOptions {
  /** The LINE agent's only door into the catalog graph — used by the model tool-call path. */
  rag: AnswerRag;
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
ช่องทางนี้ไม่มีเครื่องมือยืนยันราคาสินค้า ส่วนลด สต็อก หรือกำหนดผลิตและจัดส่ง ห้ามใช้เว็บหรือความจำยืนยันข้อมูลเหล่านี้ ให้ส่งต่อช่องทางข้อมูลสินค้าหรือทีมงาน
ถ้าสร้างไฟล์ ให้เขียนลงโฟลเดอร์ out/ เท่านั้น แล้วบอกชื่อไฟล์ในคำตอบ`;

const HEADLESS_HANDOFFS = {
  price: { reason: 'HEADLESS_PRICE_UNVERIFIED',
    text: 'ซูริยังยืนยันราคาหรือส่วนลดจากแคตตาล็อกที่เผยแพร่ไม่ได้ค่ะ กรุณาใช้ช่องทางที่เชื่อมข้อมูลสินค้าหรือให้ผู้ดูแลตรวจสอบก่อน' },
  delivery: { reason: 'HEADLESS_DELIVERY_UNVERIFIED',
    text: 'ซูริยังยืนยันกำหนดผลิตหรือจัดส่งไม่ได้ค่ะ ต้องให้ทีมงานตรวจสอบและยืนยันก่อน' },
  stock: { reason: 'HEADLESS_STOCK_UNVERIFIED',
    text: 'ซูริยังยืนยันสต็อกปัจจุบันไม่ได้ค่ะ ต้องให้ทีมงานตรวจสอบและยืนยันก่อน' },
};

/**
 * A headless CLI has no application catalog tool after ADR-119. Its web results and remembered
 * numbers cannot authorize a commercial promise. Check explicit claim shapes, including amounts
 * below the API's general numeric threshold, without rejecting arbitrary numbers in local tasks.
 * This lexical guard supplements the prompt; it does not interpret every possible paraphrase.
 */
function headlessCommerceClaim(reply: string, userText: string): keyof typeof HEADLESS_HANDOFFS | null {
  const number = String.raw`[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*(?:\s*(?:[-–—]|ถึง|to)\s*[0-9๐-๙]+(?:[.,][0-9๐-๙]+)*)?`;
  const duration = new RegExp(`${number}\\s*(?:วัน|สัปดาห์|เดือน|ชั่วโมง|days?\\b|weeks?\\b|months?\\b|hours?\\b)`, 'iu');
  const date = /(?:วันที่\s*[0-9๐-๙]|วัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|วันนี้|พรุ่งนี้|มะรืน|(?:ต้น|กลาง|สิ้น|ปลาย)(?:เดือน|สัปดาห์|ปี)|\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b)/iu;
  const delivery = /(?:ผลิต|จัดส่ง|ส่งมอบ|ส่งของ|ส่งสินค้า|ส่ง(?:\s|ภายใน|ประมาณ|ใน|ให้|ได้|ถึง|วัน|เมื่อ)|พร้อมส่ง|สกรีน|\b(?:manufacturing|production\s+(?:time|takes|starts|ends)|delivery|shipping|dispatch|ship|lead\s*time)\b)/iu;
  if ((duration.test(reply) || date.test(reply)) && delivery.test(`${reply}\n${userText}`)) return 'delivery';

  const stock = /(?:มีเหลือ|ของเหลือ|สินค้าคงเหลือ|สินค้าพร้อมส่ง|ของพร้อมส่ง|มี(?:สินค้า|ของ)พร้อม|\bin\s+stock\b|\b(?:stock|inventory)\s*(?:available|remaining|:)|สต็อก[^\n]{0,24}[0-9๐-๙])/iu;
  if (stock.test(reply)) return 'stock';

  const amount = new RegExp(`(?:${number}\\s*(?:บาท|THB\\b|USD\\b|EUR\\b|RMB\\b|CNY\\b|[฿$€£¥])|[฿$€£¥]\\s*${number}|${number}\\s*[.]?-\\s*/\\s*(?:ชุด|ชิ้น))`, 'iu');
  const price = new RegExp(`(?:ราคา|ชุดละ|ชิ้นละ|ส่วนลด|ลดให้|\\b(?:price|cost|discount)\\b)[^\\n0-9๐-๙]{0,40}${number}`, 'iu');
  return amount.test(reply) || price.test(reply) ? 'price' : null;
}

/**
 * One turn through the headless CLI.
 *
 * Explicit commercial claims require the published API path or a human handoff. The headless
 * event stream is not catalog evidence; other local assistance keeps its web/file capabilities.
 */
async function answerViaHeadless(
  text: string,
  options: ConversationOptionsFull,
  headless: HeadlessOptions,
  fallback: string,
  headlessRunner: typeof runHeadless
): Promise<ConversationResult> {
  const personaPrompt = loadPersonaPrompt(activePersonaId());

  // Load conversation turns for short-term memory continuity
  const historyTurns = options.retainHistory === false ? [] : loadConversation(options.conversationKey, options.memory);
  let conversationHistoryContext = '';
  if (historyTurns.length > 0) {
    const recent = historyTurns.slice(-6); // Keep last 3 exchanges (6 turns)
    conversationHistoryContext = '\n\n[ประวัติการสนทนาก่อนหน้านี้ในห้องนี้]:\n' +
      recent.map(t => `${t.role === 'user' ? 'ลูกค้า' : 'ซูริ'}: ${t.text}`).join('\n');
  }

  const result = await headlessRunner(
    text,
    personaPrompt +
      '\n' +
      (options.role === 'owner' ? OWNER_NOTE : SALES_NOTE) +
      HEADLESS_NOTE +
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

  const claim = headlessCommerceClaim(result.text, text);
  if (claim) {
    return { ...HEADLESS_HANDOFFS[claim], source: 'rules', toolCalls: result.toolCalls };
  }

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
    return CANNOT_ANSWER_NOW_TEXT;
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
  options: ConversationOptionsFull,
  headlessRunner: typeof runHeadless = runHeadless
): Promise<ConversationResult> {
  const fallback = answerMessage(text, options);
  let rejectedHeadlessPrice: ConversationResult | undefined;

  /*
   * The headless path keeps its own conversation through `--resume`, so the turns recorded here
   * are for the record and for the API path, not replayed into it.
   */
  if (options.headless) {
    const result = await answerViaHeadless(text, options, options.headless, fallbackFor(text, options), headlessRunner);
    if (result.reason !== 'HEADLESS_PRICE_UNVERIFIED' || !options.llm?.port) {
      recordTurns(text, result.text, options);
      return result;
    }
    // Prices can retry through the existing RAG tool path. There is no corresponding source of
    // production/delivery dates or stock, so those commitments stop at the human handoff above.
    rejectedHeadlessPrice = result;
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
    fallback,
    // The same `.agents/` persona the headless path uses — its compact `local` variant, because a
    // ~9B model on a 12 s budget loses the tools under the full file (see persona.ts). Until now
    // only the headless path read the persona at all.
    loadPersonaPrompt(activePersonaId(), 'local')
  );

  // A second ungrounded model price is not a successful retry. Published evidence owns its final
  // text; otherwise retain the handoff for numeric commercial claims, including small prices.
  const retryClaim = rejectedHeadlessPrice && result.reason !== 'PUBLISHED_CATALOG_EVIDENCE'
    ? headlessCommerceClaim(result.text, text) : null;
  const final: ConversationResult = retryClaim ? { ...HEADLESS_HANDOFFS[retryClaim], source: 'rules', toolCalls: result.toolCalls } : result;
  if (rejectedHeadlessPrice) final.toolCalls = [...rejectedHeadlessPrice.toolCalls, ...final.toolCalls];
  recordTurns(text, final.text, options);
  return final;
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
