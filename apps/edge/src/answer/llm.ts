import type { ModelPort, ToolSpec } from './model-port.js';
import { Role } from '../identity/registry.js';
import { Turn } from './memory.js';
import {
  EvidenceOptions,
  EvidenceRecord,
  POLICY_TOPIC_KEYS,
  PolicyTopic,
  explainPolicy,
  findWithinBudget,
  leadTime,
  quotePrice,
  searchProducts,
  compactSearchForModel,
} from './tools.js';

/**
 * The conversational layer.
 *
 * The model decides what the person is asking and how to say the answer back. It does not decide
 * what anything costs: every figure comes from a tool call into the pricing engine, and the
 * finished text is checked against those tool results before it is allowed out. A price quoted in
 * chat is a commitment to a customer, so "the model produced a plausible number" is not a
 * standard this path is allowed to meet.
 *
 * Three things keep that true rather than merely intended:
 *
 * 1. **Scoped evidence.** Tool results are cut to the caller's role before the model sees them, so
 *    a sales conversation has no cost or margin in context to leak.
 * 2. **The number check.** Every figure of 100 or more in the reply must appear in a tool result
 *    or in what the person themselves typed. It does not, the deterministic answer is sent instead.
 * 3. **A real fallback.** No key, an API error, a timeout, or a failed check all end at the same
 *    place — the pattern-based answer, which is always available and never guesses.
 */

export interface LlmOptions {
  /**
   * The model behind this turn. A port, not a key: a business running its own model
   * has nothing to authenticate to, and `apiKey` being required here is what used to
   * make a local deployment impossible to express.
   */
  port: ModelPort;
  /** Hard ceiling. A LINE reply token expires in about thirty seconds. */
  timeoutMs: number;
  maxIterations: number;
}

export interface ConversationResult {
  text: string;
  source: 'model' | 'rules';
  /** Why the rules answer was used, when it was. */
  reason?: string;
  toolCalls: string[];
}

export const SYSTEM_PROMPT = `คุณคือ "ซูริ" (Zuri) ผู้ช่วยฝ่ายขายของ SmartGift ผู้นำเข้าของพรีเมียมองค์กร
คุยกับทีมงานผ่านแชท LINE

วิธีคุย
- ตอบภาษาไทย ประโยคสั้น ตรงประเด็น เป็นกันเองแบบเพื่อนร่วมงานที่ทำงานเป็น ไม่ต้องเป็นทางการจัด
- ไม่ใช้อิโมจิ ไม่ประจบ ไม่ขยายความสำเร็จเกินจริง
- ตอบสิ่งที่เขาถามก่อน แล้วค่อยเสริมถ้าจำเป็น อย่าร่ายยาว
- ถ้ายังขาดข้อมูลที่จำเป็น เช่น จำนวนที่จะสั่ง ให้ถามกลับสั้น ๆ หนึ่งคำถาม

กติกาเรื่องตัวเลข (สำคัญที่สุด)
- ตัวเลขทุกตัวที่พูดถึงราคา ต้นทุน จำนวนวัน หรือจำนวนรายการ ต้องมาจากผลลัพธ์ของเครื่องมือเท่านั้น
- ห้ามคำนวณเอง ห้ามประมาณ ห้ามเดา ห้ามจำจากบทสนทนาก่อนหน้าโดยไม่เรียกเครื่องมือใหม่
- ถ้าเครื่องมือไม่มีข้อมูล ให้บอกตรง ๆ ว่ายังไม่มีข้อมูล อย่าเติมให้ดูสมบูรณ์
- ราคาที่ตอบไปคือคำมั่นต่อลูกค้า ตัวเลขผิดหนึ่งตัวคือปัญหาจริง

ขอบเขต
- เรื่องราคา สินค้า งบประมาณ ระยะเวลาผลิตและขนส่ง เงื่อนไขการสั่งซื้อ ให้ใช้เครื่องมือ
- เรื่องที่อยู่นอกขอบเขตนี้ ให้บอกว่ายังช่วยไม่ได้ และแนะนำให้ถามผู้ดูแล`;

export const OWNER_NOTE = `
ผู้ใช้คนนี้เป็นเจ้าของกิจการ จึงเห็นต้นทุน ตัวคูณ และ margin ได้
ข้อมูลชุดนี้เป็นข้อมูลภายใน อย่าจัดรูปให้เหมือนข้อความที่ส่งต่อให้ลูกค้าได้ทันที`;

export const SALES_NOTE = `
ผู้ใช้คนนี้เป็นทีมขาย จึงเห็นเฉพาะราคาขาย
ต้นทุน ตัวคูณ และ margin ไม่ได้ถูกส่งมาให้คุณ ถ้าถูกถาม ให้บอกว่าเรื่องนี้ต้องถามผู้ดูแล`;

/** Numbers this size are prices, day counts and quantities — the ones worth checking. */
const CHECKED_FROM = 100;
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/**
 * Phrases that introduce a list of things we supposedly sell.
 *
 * Deliberately a small, literal set rather than an attempt to understand the sentence. Both
 * observed failures used the same shape — `เช่น` followed by a list — and the point is to catch
 * that shape when there is no evidence behind it, not to police Thai prose.
 */
const SUGGESTION_MARKERS = ['เช่น', 'ตัวอย่างเช่น', 'อาทิ', 'ได้แก่'];

/**
 * True when a reply offers the customer a menu of products the model never looked up.
 *
 * The failure this exists for: asked for a New Year gift with no product type named, the model
 * answered without calling a tool and suggested เสื้อผ้า, ไฟ LED and ของแต่งโต๊ะทำงาน — none of
 * which SmartGift sells. `unverifiedNumbers` already refuses an invented *price*; an invented
 * *category* is the same promise made one level up, and nothing was catching it.
 *
 * Two conditions, and both are necessary. No tool call means there is no evidence in the turn at
 * all, so any statement about what we carry is guesswork — even when it happens to be right. A
 * suggestion marker means the reply is actually offering something, which is what makes the
 * guesswork reach the customer; a bare "which type did you have in mind?" carries no claim and is
 * left alone.
 *
 * Three prompt-side attempts to stop the model doing this all cost more answers than they saved
 * (see docs/model-cards/qwen3.5-9b.md). This runs after the model has finished, so it costs
 * nothing at inference time — the constraint every one of those attempts violated.
 */
export function suggestsUnseenProducts(text: string, toolCallCount: number): boolean {
  if (toolCallCount > 0) return false;
  return SUGGESTION_MARKERS.some((marker) => text.includes(marker));
}

export function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/**
 * Figures in the reply that are in neither the evidence nor the person's own words.
 *
 * Rounding is tolerated to one decimal place, because "12.34 บาท" read back as "12.3 บาท" is a
 * presentation choice rather than an invented number. Anything else is treated as invented.
 */
export function unverifiedNumbers(reply: string, evidence: string, userText: string): number[] {
  const allowed = numbersIn(`${evidence} ${userText}`);
  const bad: number[] = [];
  for (const value of numbersIn(reply)) {
    if (value < CHECKED_FROM) continue;
    const ok = allowed.some(
      (a) => a === value || Math.abs(a - value) < 0.05 || Math.round(a) === value
    );
    if (!ok) bad.push(value);
  }
  return bad;
}

function buildTools(options: EvidenceOptions, evidence: EvidenceRecord[]): ToolSpec[] {
  /**
   * `output` is what the rest of the system keeps — cards, and the number check that refuses a
   * figure the catalog never offered. `forModel` is what goes into the prompt, which is a
   * different job with a hard budget attached: see `compactSearchForModel`.
   */
  const record = (tool: string, input: unknown, output: unknown, forModel: unknown = output) => {
    evidence.push({ tool, input, output });
    return JSON.stringify(forModel);
  };

  return [
    ({
      name: 'quote_price',
      description:
        'ราคาขายต่อชุดของสินค้าหนึ่งรหัส ครบทุกขั้นบันไดจำนวน ใช้เมื่อรู้รหัสสินค้าแล้ว ' +
        'ใส่ quantity ด้วยถ้าลูกค้าบอกจำนวน จะได้ราคาของขั้นที่ครอบจำนวนนั้น',
      inputSchema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'รหัสสินค้าตามแคตตาล็อก เช่น TJS23-2' },
          quantity: { type: 'integer', minimum: 1, description: 'จำนวนที่ลูกค้าจะสั่ง (ชุด)' },
        },
        required: ['sku'],
        additionalProperties: false,
      } as const,
      run: async ({ sku, quantity }) =>
        record('quote_price', { sku, quantity }, await quotePrice(sku, quantity ?? null, options)),
    }),

    ({
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
        additionalProperties: false,
      } as const,
      run: async ({ quantity, maxPriceThb }) =>
        record(
          'find_within_budget',
          { quantity, maxPriceThb },
          await findWithinBudget(quantity, maxPriceThb, options)
        ),
    }),

    ({
      name: 'search_products',
      description:
        'ค้นสินค้าจากชื่อหรือคำอธิบาย ใช้เมื่อลูกค้าพูดถึงประเภทสินค้าแต่ยังไม่มีรหัส เช่น "ร่ม" "กระติกน้ำ"',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'คำค้น ภาษาไทยหรืออังกฤษ' },
        },
        required: ['query'],
        additionalProperties: false,
      } as const,
      run: async ({ query }) => {
        const found = await searchProducts(query, options);
        return record('search_products', { query }, found, compactSearchForModel(found));
      },
    }),

    ({
      name: 'lead_time',
      description:
        'ระยะเวลาตั้งแต่วางมัดจำจนได้รับของ แยกตามขั้นตอน ' +
        'ใส่ deadlineDays ถ้าลูกค้ามีกำหนดรับของ จะได้คำตอบว่าต้องส่งทางรถหรือทางเรือ',
      inputSchema: {
        type: 'object',
        properties: {
          quantity: { type: 'integer', minimum: 1, description: 'จำนวนที่จะสั่ง (ชุด)' },
          mode: {
            type: 'string',
            enum: ['truck', 'sea'],
            description: 'วิธีขนส่งจากจีน ถ้าลูกค้าระบุมาแล้ว',
          },
          deadlineDays: {
            type: 'integer',
            minimum: 1,
            description: 'จำนวนวันที่ลูกค้าต้องการได้ของ',
          },
          rush: { type: 'boolean', description: 'งานเร่ง ข้ามขั้นทำตัวอย่าง' },
        },
        required: ['quantity'],
        additionalProperties: false,
      } as const,
      run: async ({ quantity, mode, deadlineDays, rush }) =>
        record(
          'lead_time',
          { quantity, mode, deadlineDays, rush },
          leadTime(quantity, { mode, deadlineDays, rush })
        ),
    }),

    ({
      name: 'explain_policy',
      description:
        'เงื่อนไขการค้าที่บริษัทใช้เป็นมาตรฐาน ใช้เมื่อถูกถามเรื่องค่าส่งในไทย วิธีขนส่งจากจีน ' +
        'ค่าสกรีน ขั้นตอนสั่งซื้อ หรือหลักการของราคาขั้นบันได',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: POLICY_TOPIC_KEYS,
            description: 'หัวข้อเงื่อนไขที่ต้องการ',
          },
        },
        required: ['topic'],
        additionalProperties: false,
      } as const,
      run: async ({ topic }) =>
        record('explain_policy', { topic }, explainPolicy(topic as PolicyTopic)),
    }),
  ];
}

function textOf(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
    .trim();
}

/**
 * One conversational turn.
 *
 * `fallback` is the deterministic answer, computed by the caller before this runs. It is what gets
 * returned whenever the model path cannot be trusted or cannot finish in time — which means a
 * person always gets an answer, and never gets an unverified one.
 */
export async function answerWithModel(
  userText: string,
  history: Turn[],
  role: Role,
  evidenceOptions: EvidenceOptions,
  llm: LlmOptions,
  fallback: string
): Promise<ConversationResult> {
  const evidence: EvidenceRecord[] = [];
  const abort = AbortSignal.timeout(llm.timeoutMs);

  const rules = (reason: string): ConversationResult => ({
    text: fallback,
    source: 'rules',
    reason,
    toolCalls: evidence.map((e) => e.tool),
  });

  try {
    const reply = await llm.port.generate({
      system: SYSTEM_PROMPT + (role === 'owner' ? OWNER_NOTE : SALES_NOTE),
      messages: [
        ...history.map((turn) => ({
          role: turn.role as 'user' | 'assistant',
          content: turn.text,
        })),
        { role: 'user' as const, content: userText },
      ],
      tools: buildTools(evidenceOptions, evidence),
      maxIterations: llm.maxIterations,
      timeoutMs: llm.timeoutMs,
      signal: abort,
    });

    const text = reply.text;
    if (!text) return rules('model returned no text');

    const evidenceText = JSON.stringify(evidence);
    const historyText = history.map((t) => t.text).join(' ');
    const invented = unverifiedNumbers(text, evidenceText, `${userText} ${historyText}`);
    if (invented.length) {
      return rules(`unverified numbers in reply: ${invented.join(', ')}`);
    }

    if (suggestsUnseenProducts(text, evidence.length)) {
      return rules('reply offers products the model never looked up');
    }

    return { text, source: 'model', toolCalls: evidence.map((e) => e.tool) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return rules(`model call failed: ${detail}`);
  }
}
