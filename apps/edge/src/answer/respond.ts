import { Catalog, searchByName } from '../catalog/store.js';
import { Role } from '../identity/registry.js';
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
import { activePersonaId, loadPersonaPrompt } from './persona.js';
import type { AnswerRag } from '../rag/genesis-rag.js';
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
ถ้าสร้างไฟล์ ให้เขียนลงโฟลเดอร์ out/ เท่านั้น แล้วบอกชื่อไฟล์ในคำตอบ`;

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
  const personaPrompt = loadPersonaPrompt(activePersonaId());

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
    fallback,
    // The same `.agents/` persona the headless path uses — its compact `local` variant, because a
    // ~9B model on a 12 s budget loses the tools under the full file (see persona.ts). Until now
    // only the headless path read the persona at all.
    loadPersonaPrompt(activePersonaId(), 'local')
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
