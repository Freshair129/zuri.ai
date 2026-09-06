import type { ResultV4, SelectedPrice, SearchResponseV4 } from '../rag/v4/search.js';
import type { ParsedQuery } from '../rag/v4/query-parser.js';

export interface SearchEvidenceV4 {
  query: string;
  parsed: SearchResponseV4['parsed'] | null;
  matchCount: number;
  matches: ResultV4[];
  nearest: ResultV4[];
  unavailable?: true;
  reason?: string;
  priceSource: 'commercial_sku';
}

export interface CardPayload {
  id: string;
  kind: 'model' | 'offer';
  code: string | null;
  name: string;
  typeNameTh: string | null;
  colors: string[];
  sizes: string[];
  selectedPrice: SelectedPrice | null;
  priceExportDate: string | null;
  priceNote: string | null;
  status: string;
  image: string | null;
  reviewNote: string | null;
}

/**
 * Convert search evidence to card payloads, truncated to max.
 * Returns empty array if unavailable.
 */
export function formatCards(ev: SearchEvidenceV4, max = 5): CardPayload[] {
  if (ev.unavailable) return [];

  const results = ev.matches.slice(0, max);
  return results.map((result) => {
    const colors = Array.from(new Set(result.variants.map((v) => v.color).filter(Boolean) as string[]));
    const sizes = Array.from(new Set(result.variants.map((v) => v.size).filter(Boolean) as string[]));
    const typeNameTh = result.type?.name_th ?? null;

    let priceNote: string | null = null;
    if (result.selectedPrice?.belowMoq) {
      priceNote = 'ราคาขั้นต่ำ สำหรับปริมาณ ' + result.selectedPrice.qtyTier;
    }

    let reviewNote: string | null = null;
    if (result.status === 'review_required') {
      reviewNote = 'ข้อมูลรอตรวจสอบ';
    }

    return {
      id: result.id,
      kind: result.kind,
      code: result.code,
      name: result.name,
      typeNameTh,
      colors,
      sizes,
      selectedPrice: result.selectedPrice,
      priceExportDate: result.priceLadder.find((t) => t.exportDate)?.exportDate ?? null,
      priceNote,
      status: result.status,
      image: result.image,
      reviewNote,
    };
  });
}

/**
 * Generate deterministic Thai text representation of cards.
 * Handles unavailable state, budget unmet, and normal card listing.
 */
export function cardsToText(cards: CardPayload[], ev: SearchEvidenceV4): string {
  if (ev.unavailable) {
    return 'ระบบราคาขัดข้องชั่วคราว กรุณาลองอีกครั้งในภายหลัง';
  }

  if (ev.parsed?.budgetUnmet && ev.nearest.length > 0) {
    const lines: string[] = ['ไม่มีสินค้าในงบประมาณที่ระบุ แต่มีสินค้าใกล้เคียงดังนี้:'];
    for (let i = 0; i < Math.min(3, ev.nearest.length); i++) {
      const n = ev.nearest[i];
      const typeStr = n.type?.name_th ? ` (${n.type.name_th})` : '';
      const priceStr = n.selectedPrice ? ` — ${n.selectedPrice.unitPrice} บาท/ชุด` : '';
      lines.push(`${i + 1}. ${n.name}${typeStr}${priceStr}`);
    }
    return lines.join('\n');
  }

  if (cards.length === 0) {
    return 'ไม่พบสินค้าที่ตรงกับเงื่อนไขของท่าน';
  }

  const lines: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const code = card.code ? ` (${card.code})` : '';
    const colorStr = card.colors.length > 0 ? ` — สี: ${card.colors.join(', ')}` : '';
    const sizeStr = card.sizes.length > 0 ? ` — ขนาด: ${card.sizes.join(', ')}` : '';
    const asOf = card.priceExportDate ? ` (ราคาอ้างอิง ณ ${thaiShortDate(card.priceExportDate)})` : '';
    const tier = card.selectedPrice?.qtyTier != null ? `${card.selectedPrice.qtyTier} ชุด` : 'ต่อชุด';
    const priceStr = card.selectedPrice ? ` — ${tier}: ${card.selectedPrice.unitPrice} บาท/ชุด${asOf}` : '';
    lines.push(`${i + 1}) ${card.name}${code}${colorStr}${sizeStr}${priceStr}`);
  }
  return lines.join('\n');
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** ISO `YYYY-MM-DD` → `D เดือน YYYY` (Thai short month, Gregorian year as stored). */
export function thaiShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${TH_MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}
