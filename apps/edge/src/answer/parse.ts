/**
 * Read what a person is asking for out of a chat message.
 *
 * Deliberately a set of patterns rather than a model. What comes out of here decides which
 * product is priced and at what quantity — and the number that follows becomes a commitment to a
 * customer. A pattern that fails to match says so and asks; a model that guesses wrong produces a
 * plausible price nobody can trace.
 *
 * A model may be added later to fill these same three fields for free-form questions. It would
 * never produce the price itself.
 */

export type Intent =
  | { kind: 'price'; sku: string; quantity: number | null }
  | { kind: 'budget'; quantity: number; maxPriceThb: number }
  | { kind: 'search'; query: string }
  | { kind: 'help' }
  | { kind: 'unknown' };

/**
 * Item codes as the factory writes them: two to four capitals, then a mix of digits and dashes,
 * with at least one digit. TJS23-2, TCZ0036, TDR0--5, BW16-2, DQL00.
 */
const SKU_RE = /\b([A-Z]{2,4}[A-Z0-9-]*\d[A-Z0-9-]*)\b/;

/**
 * "100 ชุด", "100ชิ้น", "100 pcs", "100 sets".
 *
 * The word boundary is attached only to the Latin units. `\b` is defined over `[A-Za-z0-9_]`, so
 * placing it after a Thai word never matches — "100 ชุด" would silently fail to parse.
 */
const QTY_RE = /(\d[\d,]*)\s*(?:ชุด|ชิ้น|อัน|เซ็ต|pcs?\b|sets?\b|pieces?\b)/i;

/** "งบ 300", "ไม่เกิน 300", "budget 300", "300 บาท/ชุด". */
const BUDGET_RE =
  /(?:งบ(?:ประมาณ)?|ไม่เกิน|budget|under)\s*(\d[\d,]*)|(\d[\d,]*)\s*บาท\s*(?:\/|ต่อ)\s*(?:ชุด|ชิ้น)/i;

const HELP_RE = /^\s*(help|ช่วย|ใช้ยังไง|ทำอะไรได้|เมนู|\?)\s*$/i;

const num = (s: string) => Number(s.replace(/,/g, ''));

export function parseMessage(text: string): Intent {
  const raw = (text || '').trim();
  if (!raw) return { kind: 'unknown' };
  if (HELP_RE.test(raw)) return { kind: 'help' };

  const upper = raw.toUpperCase();
  const skuMatch = SKU_RE.exec(upper);
  const qtyMatch = QTY_RE.exec(raw);
  const budgetMatch = BUDGET_RE.exec(raw);

  const quantity = qtyMatch ? num(qtyMatch[1]) : null;
  const budget = budgetMatch ? num(budgetMatch[1] || budgetMatch[2]) : null;

  /*
   * A code always wins. Someone who typed a code knows which product they mean, and answering a
   * budget search instead would be answering a question they did not ask.
   */
  if (skuMatch) return { kind: 'price', sku: skuMatch[1], quantity };

  if (budget !== null && quantity !== null) {
    return { kind: 'budget', quantity, maxPriceThb: budget };
  }

  /*
   * Words with no code and no complete budget pair: treat as a product search, but only if there
   * is something to search on. Bare numbers are not a search.
   */
  const words = raw.replace(/[\d,]+/g, ' ').trim();
  if (words.length >= 2) return { kind: 'search', query: words };

  return { kind: 'unknown' };
}
