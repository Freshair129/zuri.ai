import type { ModelPort, ToolSpec, InvocationContext } from './model-port.js';
import { Role } from '../identity/registry.js';
import { Turn } from './memory.js';
import type { PublishedProductQueryResult, PublishedProductPrice } from '../rag/genesisrag17/product-rag.js';
import type { ProgressDetail } from '../conversation/progress.js';
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
  /** Model ceiling within the server-issued end-to-end execution budget. */
  timeoutMs: number;
  maxIterations: number;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  context?: InvocationContext;
  additionalTools?: ToolSpec[];
  onProgress?: (event: ProgressDetail) => void | Promise<void>;
}

export interface ConversationResult {
  text: string;
  source: 'model' | 'rules';
  /** Why the rules answer was used, when it was. */
  reason?: string;
  toolCalls: string[];
}

/** Who the assistant is when no persona folder is selected — the `.agents/` persona replaces exactly this part. */
export const DEFAULT_PERSONA = `คุณคือ "ซูริ" (Zuri) ผู้ช่วยฝ่ายขายของ SmartGift ผู้นำเข้าของพรีเมียมองค์กร
คุยกับทีมงานผ่านแชท LINE

วิธีคุย
- ตอบภาษาไทย ประโยคสั้น ตรงประเด็น เป็นกันเองแบบเพื่อนร่วมงานที่ทำงานเป็น ไม่ต้องเป็นทางการจัด
- ไม่ใช้อิโมจิ ไม่ประจบ ไม่ขยายความสำเร็จเกินจริง
- ตอบสิ่งที่เขาถามก่อน แล้วค่อยเสริมถ้าจำเป็น อย่าร่ายยาว
- ถ้ายังขาดข้อมูลที่จำเป็น เช่น จำนวนที่จะสั่ง ให้ถามกลับสั้น ๆ หนึ่งคำถาม`;

/**
 * The evidence and scope rules the API/Ollama path always sends, whichever persona is active.
 * A persona file describes voice and product rules; it must not be able to switch off the
 * "numbers come from tools only" contract, so that stays here rather than in `.agents/`.
 */
export const ANSWER_RULES = `กติกาเรื่องตัวเลข (สำคัญที่สุด)
- ตัวเลขทุกตัวที่พูดถึงราคา ต้นทุน จำนวนวัน หรือจำนวนรายการ ต้องมาจากผลลัพธ์ของเครื่องมือเท่านั้น
- ห้ามคำนวณเอง ห้ามประมาณ ห้ามเดา ห้ามจำจากบทสนทนาก่อนหน้าโดยไม่เรียกเครื่องมือใหม่
- ถ้าเครื่องมือไม่มีข้อมูล ให้บอกตรง ๆ ว่ายังไม่มีข้อมูล อย่าเติมให้ดูสมบูรณ์
- ราคาที่ตอบไปคือคำมั่นต่อลูกค้า ตัวเลขผิดหนึ่งตัวคือปัญหาจริง
- จำนวนขั้นต่ำ ขั้นบันไดจำนวน และเบรกราคา ก็เป็นตัวเลขตามกติกานี้ ห้ามยกมาเองจากความจำหรือจากตัวอย่างในบทบาท
- ถ้าลูกค้าบอกงบแต่ไม่บอกจำนวน ให้ถามกลับสั้น ๆ ว่าต้องการกี่ชุด โดยห้ามยกตัวอย่างจำนวนเป็นตัวเลขในคำถาม (ห้ามเขียนแบบ "เช่น 100 หรือ 200 ชุด") เพราะตัวเลขทุกตัวในคำตอบถูกตรวจว่ามาจากเครื่องมือ

ขอบเขต
- เรื่องราคา สินค้า งบประมาณ ระยะเวลาผลิตและขนส่ง เงื่อนไขการสั่งซื้อ ให้ใช้เครื่องมือ
- เรื่องที่อยู่นอกขอบเขตนี้ ให้บอกว่ายังช่วยไม่ได้ และแนะนำให้ถามผู้ดูแล`;

/**
 * Rules first, persona second. Measured on qwen3.5:9b with the 5.7k-char `.agents/zuri-01`
 * persona: persona-then-rules answered a budget question with invented tier quantities
 * (100/200/1000) and no tool call on every run, so the number guard discarded the reply and
 * the job failed; the short built-in persona did not. Leading with the rules is the cheapest
 * lever and keeps the persona file free to carry example copy.
 */
export function composeSystemPrompt(personaPrompt: string): string {
  return ANSWER_RULES + '\n\n' + personaPrompt;
}

export const SYSTEM_PROMPT = composeSystemPrompt(DEFAULT_PERSONA);

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

/** Current operational facts need a read this turn, even if the model skips tools.
 * “งานสกรีนใช้เวลากี่วัน” is a product lead-time question, not a PM status query.
 */
function needsCurrentWorkRecords(text: string): boolean {
  const work = /(?:งาน|โครงการ|โปรเจกต์|เวิร์กสตรีม|\b(?:tasks?|projects?|workstreams?|work\s*items?)\b|\b(?:WI|PRJ|WST)-[\w-]+)/iu;
  const current = /(?:สถานะ|คืบหน้า|เสร็จ|ติดขัด|ค้าง|ถึงไหน|เป็นไง|เป็นอย่างไร|มีอะไร|มีบ้าง|รายการ|ค้นหา|ดูงาน|ดูโครงการ|\b(?:status|progress|done|completed|blocked|pending|planned|active|cancelled|list|find|search|show)\b)/iu;
  return work.test(text) && current.test(text);
}

/** A numeric guard cannot prove tax, shipping or validity claims. Published catalog
 * evidence therefore owns the final text; model prose cannot turn a snapshot into a quote.
 */
function publishedCatalogAnswer(evidence: EvidenceRecord[]): string | null {
  const catalog = evidence.filter(item => ['quote_price', 'search_products', 'find_within_budget'].includes(item.tool));
  const published = catalog.map(item => (item.output as { publishedProducts?: PublishedProductQueryResult } | null)?.publishedProducts)
    .filter((value): value is PublishedProductQueryResult => value?.productSchemaVersion === 'published-products.v1');
  if (!published.length) return null;
  const identity = (value: PublishedProductQueryResult) => JSON.stringify([value.scope, value.corpusId, value.corpusGeneration, value.manifestHash]);
  if (published.some(value => identity(value) !== identity(published[0])) || catalog.some(item => (item.output as { unavailable?: boolean } | null)?.unavailable)) {
    return 'ยังยืนยันข้อมูลสินค้าจากชุดข้อมูลเดียวกันไม่ได้ กรุณาลองใหม่';
  }
  const latest = published.at(-1)!;
  const label = (value: string, max = 200) => value.replace(/[\r\n\t\u0000-\u001f]/g, ' ').slice(0, max) + (value.length > max ? '…' : '');
  const priceLines = (price: PublishedProductPrice): string[] => {
    if (price.status === 'PRICE_MISSING') return ['ยังไม่มีราคาที่อ้างอิงได้'];
    if (price.status === 'BELOW_MOQ') return ['จำนวนที่ถามต่ำกว่าเกณฑ์ขั้นต่ำ จึงยังไม่มีราคาสำหรับจำนวนนี้'];
    const tiers = price.selected ? [price.selected] : price.tiers.slice(0, 3);
    return tiers.map(tier =>
      `เกณฑ์จำนวนขั้นต่ำ ${tier.minQty}: ${(tier.amountMinor / 100).toFixed(2)} THB ตามแคตตาล็อก · วันที่ข้อมูล ${tier.asOf ?? 'ไม่ระบุ'}`,
    ).concat(tiers.find(tier => tier.source)?.source ? [`แหล่งข้อมูล: ${label(tiers.find(tier => tier.source)!.source!)}`] : []);
  };
  const productLabel = (code: string, name?: string) => name && name !== code ? `${label(name)} (${label(code, 256)})` : label(code, 256);
  const blocks = latest.operation === 'price' && latest.price
    ? [[productLabel(latest.price.code, latest.results.find(product => product.code === latest.price!.code)?.name), ...priceLines(latest.price)].join('\n')]
    : latest.results.map(product => [productLabel(product.code, product.name), ...priceLines(product.price)].join('\n'));
  let text = 'ราคาอ้างอิงจากแคตตาล็อก (snapshot)';
  if (!blocks.length) text += '\nไม่พบรายการที่ยืนยันได้ตามเงื่อนไข';
  let shown = 0;
  for (const block of blocks) { if (shown >= 5 || text.length + block.length > 4000) break; text += '\n\n' + block; shown++; }
  if (shown < blocks.length) text += '\n\nมีรายการเพิ่มเติม กรุณาระบุรหัสหรือเงื่อนไขให้แคบลง';
  return text + '\n\nยังไม่ยืนยันหน่วยสินค้า ภาษี ค่าจัดส่ง และช่วงเวลาที่ราคาใช้ได้ ข้อมูลนี้ยังไม่ใช่ใบเสนอราคาหรือยอดชำระ';
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
  fallback: string,
  /** The `.agents/` persona text. Defaults to the built-in one, which makes `system` equal `SYSTEM_PROMPT`. */
  personaPrompt: string = DEFAULT_PERSONA
): Promise<ConversationResult> {
  const evidence: EvidenceRecord[] = [];
  let workProposalAttempted = false;
  let workReadAttempted = false;
  const currentWorkRequested = needsCurrentWorkRecords(userText);
  const timeout = AbortSignal.timeout(llm.timeoutMs);
  const abort = llm.signal ? AbortSignal.any([llm.signal, timeout]) : timeout;
  const progress = (event: ProgressDetail) => { try { void Promise.resolve(llm.onProgress?.(event)).catch(() => {}); } catch { /* diagnostic only */ } };
  const observeTool = (tool: ToolSpec): ToolSpec => ({ ...tool, run: async input => {
    progress({ phase: 'TOOL', state: 'STARTED', toolName: tool.name });
    try {
      const result = await tool.run(input);
      progress({ phase: 'TOOL', state: 'COMPLETED', toolName: tool.name });
      return result;
    } catch (error) {
      progress({ phase: 'TOOL', state: 'FAILED', toolName: tool.name });
      throw error;
    }
  } });

  const rules = (reason: string): ConversationResult => ({
    text: currentWorkRequested || workReadAttempted
      ? 'ยังตรวจสอบข้อมูลปัจจุบันจากระบบ Project/Work ไม่ได้ กรุณาลองใหม่ หรือใช้ /work หรือ /projects'
      : fallback,
    source: 'rules',
    reason,
    toolCalls: evidence.map((e) => e.tool),
  });

  try {
    const reply = await llm.port.generate({
      system: composeSystemPrompt(personaPrompt) + (role === 'owner' ? OWNER_NOTE : SALES_NOTE)
        + (llm.additionalTools?.length ? '\nProject/Work: use the authorized work tools for searches and changes. A proposal is only a preview; never claim a task was saved. Only a new human confirmation message can commit it. Never use memory as current work status.' : ''),
      messages: [
        ...history.map((turn) => ({
          role: turn.role as 'user' | 'assistant',
          content: turn.text,
        })),
        { role: 'user' as const, content: userText },
      ],
      tools: [...buildTools(evidenceOptions, evidence), ...(llm.additionalTools ?? []).map(tool => ({
        ...tool, run: async (input: Record<string, never>) => {
          if (tool.name === 'propose_work_change') workProposalAttempted = true;
          if (tool.name === 'search_project_work') workReadAttempted = true;
          const result = await tool.run(input);
          evidence.push({ tool: tool.name, input, output: result });
          return result;
        },
      }))].map(observeTool),
      maxIterations: llm.maxIterations,
      timeoutMs: llm.timeoutMs,
      signal: abort,
      maxOutputTokens: llm.maxOutputTokens,
      context: llm.context,
    });

    const proposalEvidence = [...evidence].reverse().find(item => item.tool === 'propose_work_change');
    if (proposalEvidence && typeof proposalEvidence.output === 'string') {
      const proposal = JSON.parse(proposalEvidence.output);
      if (proposal.status === 'AWAITING_CONFIRMATION'
        && typeof proposal.proposalId === 'string'
        && /^[a-f0-9-]{36}$/i.test(proposal.proposalId)
        && proposal.confirmationCommand === `ยืนยันงาน ${proposal.proposalId}`) {
        // The human approves the persisted arguments, never the model's paraphrase.
        return { text: `รอยืนยัน${proposal.action === 'create_work' ? 'สร้าง' : 'แก้ไข'}งาน\nเป้าหมาย: ${proposal.targetTitle}\n${JSON.stringify(proposal.args)}\nหมดอายุ ${proposal.expiresAt}\nพิมพ์ ${proposal.confirmationCommand}`,
          source: 'model', reason: 'WORK_PREVIEW_VERIFIED', toolCalls: evidence.map(item => item.tool) };
      }
    }
    if (workProposalAttempted) return rules('work proposal was not verified');
    const workEvidence = [...evidence].reverse().find(item => item.tool === 'search_project_work');
    if (workEvidence && typeof workEvidence.output === 'string') {
      const records = JSON.parse(workEvidence.output);
      if (records.source === 'PROJECT_MANAGER' && Array.isArray(records.items) && records.items.length <= 10) {
        return { text: (records.items.length
          ? records.items.map((item: { code: string; title?: string; name?: string; status: string }) =>
            `${item.code}: ${item.title ?? item.name} — ${item.status}`).join('\n')
          : 'ไม่พบงานหรือโครงการในขอบเขตที่คุณมีสิทธิ์') + `\nตรวจจากระบบ Project/Work เมื่อ ${records.observedAt}`,
          source: 'model', reason: 'CURRENT_WORK_RECORDS_VERIFIED', toolCalls: evidence.map(item => item.tool) };
      }
    }
    if (workReadAttempted) return rules('current work records were not verified');
    const text = reply.text;
    if (currentWorkRequested || needsCurrentWorkRecords(text)) {
      return { ...rules('CURRENT_WORK_RECORDS_REQUIRED'),
        text: 'ยังตรวจสอบข้อมูลปัจจุบันจากระบบ Project/Work ไม่ได้ กรุณาลองใหม่ หรือใช้ /work หรือ /projects' };
    }
    if (llm.additionalTools?.length && /(?:งาน|โครงการ|โปรเจกต์|\btask\b|\bproject\b)/iu.test(text)
      && /(?:บันทึก|สร้าง|แก้ไข|เปลี่ยน|อัปเดต|อัพเดท|ลบ|\bsaved\b|\bcreated\b|\bupdated\b|\bdeleted\b)/iu.test(text)) {
      // This model has no commit capability, even when it sounds confident.
      return { text: 'ยังไม่มีการบันทึกหรือแก้ไขงาน ต้องตรวจรายการที่เสนอและยืนยันจาก LINE ก่อน',
        source: 'rules', reason: 'WORK_CONFIRMATION_REQUIRED', toolCalls: evidence.map(item => item.tool) };
    }
    const publishedText = publishedCatalogAnswer(evidence);
    if (publishedText) return { text: publishedText, source: 'rules', reason: 'PUBLISHED_CATALOG_EVIDENCE', toolCalls: evidence.map(item => item.tool) };
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
    if (error instanceof Error && error.message === 'MSP_INJECTION_RECEIPT_UNKNOWN') throw error;
    if (!abort.aborted && !currentWorkRequested && !workReadAttempted && !workProposalAttempted) {
      const publishedText = publishedCatalogAnswer(evidence);
      if (publishedText) return { text: publishedText, source: 'rules', reason: 'PUBLISHED_CATALOG_EVIDENCE', toolCalls: evidence.map(item => item.tool) };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return rules(`model call failed: ${detail}`);
  }
}
