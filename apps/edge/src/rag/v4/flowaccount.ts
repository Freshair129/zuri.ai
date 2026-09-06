import ExcelJS from 'exceljs';

export interface FlowAccountRow {
  rowIndex: number; productCode: string; name: string; unit: string | null; category: string | null;
  unitPrice: number; unitPriceWithVat: number; buyPrice: number;
}
export type Bucket = 'parsed' | 'name_coded' | 'unparsed' | 'non_giftset' | 'blank' | 'inactive';
export interface PriceLine {
  rowIndex: number; bucket: 'parsed' | 'name_coded' | 'non_giftset'; flowAccountCode: string | null; base: string;
  priceListGroup: string | null; qtyTier: number | null; unitPrice: number; unitPriceWithVat: number;
  priceMissing: boolean; flowAccountName: string; category: string | null;
}
export interface BucketRow { rowIndex: number; bucket: Bucket; reason: string; productCode: string; name: string; unitPrice: number; hasPrice: boolean }
export interface ParsedFlowAccount { lines: PriceLine[]; review: BucketRow[]; counts: Record<Bucket, number>; total: number }

export class FlowAccountSchemaError extends Error {}

/**
 * The base-code shape, shared by CODE_RX and NAME_RX. Two alternatives:
 *   1. The common case — a digit run (widened to 5 digits for DY05601), then an optional letter
 *      (FXD1X-4) and an optional single-digit dash-suffix (THB03-2).
 *   2. A dash-suffix with NO digit run before it at all (TFA-2 — nothing between the letters and
 *      the dash), accepted only when a "(P-...)" group immediately follows. That lookahead is
 *      load-bearing, not decoration: without it, a plain "BASE-003" quantity code like CK-003
 *      would read as base "CK-00" + qty 3 — a base and a quantity nobody wrote, invented purely
 *      because the grammar had nowhere else to put trailing digits. Requiring a group to follow
 *      is what distinguishes a real bare-dash variant tag from an ordinary quantity suffix.
 * RCA-PRICE-DATA-LOSS: both alternatives recover real, priced rows that fell into 'unparsed'.
 */
const BASE_SHAPE = '[A-Z]{2,4}(?:\\d{1,5}[A-Z]?(?:-\\d)?|-\\d{1,2}(?=\\())';
export const CODE_RX = new RegExp(`^(?<base>${BASE_SHAPE})\\s*(?:\\((?<group>P-[^)]+)\\))?\\s*-?\\s*(?<qty>\\d+)?\\s*$`);
export const NAME_RX = new RegExp(`(?<base>${BASE_SHAPE})\\s*(?:\\((?<group>P-[^)]+)\\)?)?\\s*$`);

const GIFT_SET = 'Gift Set';
const INACTIVE_MARK = 'ไม่ใช้งาน';

/**
 * RCA-PRICE-DATA-LOSS: the only other signal, besides an explicit "Gift Set" tag, that a
 * category=null row is a genuine gift set whose category was simply never filled in — this is
 * literally how staff record a code when the ProductCode column is left blank ("... Model:XXX").
 * Deliberately not used alone (see `parseFlowAccountRows`): most rows carrying this marker have
 * no price at all and are draft/discontinued entries, not a lost price.
 */
const MODEL_MARKER_RX = /model\s*[:：]/i;

export function parseCode(code: string): { base: string; group: string | null; qty: number | null } | null {
  const m = CODE_RX.exec(code.trim().toUpperCase());
  if (!m || !m.groups) return null;
  return { base: m.groups.base, group: m.groups.group ?? null, qty: m.groups.qty ? Number(m.groups.qty) : null };
}

function codeFromName(name: string): { base: string; group: string | null } | null {
  const m = NAME_RX.exec(name.trim().toUpperCase());
  if (!m || !m.groups) return null;
  return { base: m.groups.base, group: m.groups.group ?? null };
}

export function parseFlowAccountRows(rows: FlowAccountRow[]): ParsedFlowAccount {
  const lines: PriceLine[] = []; const review: BucketRow[] = [];
  const counts: Record<Bucket, number> = { parsed: 0, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 0, inactive: 0 };
  const note = (r: FlowAccountRow, bucket: Bucket, reason: string) => {
    counts[bucket]++;
    review.push({ rowIndex: r.rowIndex, bucket, reason, productCode: r.productCode, name: r.name, unitPrice: r.unitPrice, hasPrice: r.unitPrice > 0 });
  };
  for (const r of rows) {
    if (r.name.includes(INACTIVE_MARK)) { note(r, 'inactive', 'inactive_mark'); continue; }
    const code = (r.productCode || '').trim();
    const isGift = r.category === GIFT_SET;
    if (code) {
      const p = parseCode(code);
      if (!p) { note(r, isGift ? 'unparsed' : 'non_giftset', 'regex'); continue; }
      const bucket: PriceLine['bucket'] = isGift ? 'parsed' : 'non_giftset';
      counts[bucket]++;
      lines.push({ rowIndex: r.rowIndex, bucket, flowAccountCode: code.toUpperCase(), base: p.base, priceListGroup: p.group, qtyTier: p.qty,
        unitPrice: r.unitPrice, unitPriceWithVat: r.unitPriceWithVat, priceMissing: !(r.unitPrice > 0), flowAccountName: r.name, category: r.category });
      continue;
    }
    // An explicit category tag is authoritative either way — "Gift Set" always qualifies, any
    // other explicit tag never does. Only a genuinely untagged (null) row asks the marker+price
    // question, which is what keeps this from second-guessing a deliberate classification.
    const isGiftLikelyUntagged = r.category === null && r.unitPrice > 0 && MODEL_MARKER_RX.test(r.name);
    const fromName = (isGift || isGiftLikelyUntagged) ? codeFromName(r.name) : null;
    if (fromName) {
      counts.name_coded++;
      lines.push({ rowIndex: r.rowIndex, bucket: 'name_coded', flowAccountCode: null, base: fromName.base, priceListGroup: fromName.group, qtyTier: null,
        unitPrice: r.unitPrice, unitPriceWithVat: r.unitPriceWithVat, priceMissing: !(r.unitPrice > 0), flowAccountName: r.name, category: r.category });
      continue;
    }
    note(r, 'blank', 'no_code');
  }
  return { lines, review, counts, total: rows.length };
}

const HEADER = ['BarCode', 'ProductCode', 'Name', 'Unit', 'Category', 'Description', 'UnitPrice', 'UnitPriceWithVat', 'BuyPrice', 'BuyPriceWithVat'];

export async function readFlowAccountXlsx(path: string): Promise<FlowAccountRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet('products') ?? wb.worksheets[0];
  if (!ws) throw new FlowAccountSchemaError('no worksheet');
  const header = (ws.getRow(3).values as unknown[]).slice(1).map((v) => String(v ?? '').trim());
  if (HEADER.some((h, i) => header[i] !== h)) throw new FlowAccountSchemaError(`unexpected header row 3: ${header.join(',')}`);
  const rows: FlowAccountRow[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '')) || 0);
  const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v));
  ws.eachRow((row, idx) => {
    if (idx <= 3) return;
    const v = row.values as unknown[];
    const name = str(v[3]).trim();
    if (!name) return;
    rows.push({ rowIndex: idx, productCode: str(v[2]).trim(), name, unit: str(v[4]).trim() || null, category: str(v[5]).trim() || null,
      unitPrice: num(v[7]), unitPriceWithVat: num(v[8]), buyPrice: num(v[9]) });
  });
  return rows;
}

/** RCA-PRICE-DATA-LOSS prevention #5 — a per-ingest worklist of gift-set bases whose every
 * FlowAccount line has UnitPrice 0. These offers reach customers with an empty price ladder;
 * the fix is business data entry, so ingest surfaces them instead of ad-hoc analysis. */
export interface PricePdfRef { file: string; pages: number[] }
export interface UnpricedOffer {
  base: string;
  name: string;
  buckets: Array<PriceLine['bucket']>;
  rowIndexes: number[];
  qtyTiers: number[];
  /** Where the price already exists in the ใบราคา PDFs (from an optional prebuilt index) —
   * empty when the base appears in no price list at all. */
  priceListRefs: PricePdfRef[];
}

export function buildUnpricedWorklist(
  lines: PriceLine[],
  pdfIndex?: Record<string, PricePdfRef[]>,
): UnpricedOffer[] {
  const byBase = new Map<string, PriceLine[]>();
  for (const l of lines) {
    if (l.bucket === 'non_giftset') continue;
    const arr = byBase.get(l.base);
    if (arr) arr.push(l);
    else byBase.set(l.base, [l]);
  }
  const out: UnpricedOffer[] = [];
  for (const [base, group] of byBase) {
    if (!group.every((l) => l.priceMissing)) continue;
    out.push({
      base,
      name: group[0].flowAccountName,
      buckets: [...new Set(group.map((l) => l.bucket))],
      rowIndexes: group.map((l) => l.rowIndex),
      qtyTiers: group.map((l) => l.qtyTier).filter((q): q is number => q !== null),
      priceListRefs: pdfIndex?.[base] ?? [],
    });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base));
}
