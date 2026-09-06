import { cardsToText, formatCards, type SearchEvidenceV4 } from './format-cards.js';

/**
 * The codex engine (`codex exec`) gets no MCP tools — unlike the claude headless path — so the
 * catalog evidence is fetched up front and carried in the system prompt instead. This module only
 * builds the text; fetching stays in respond.ts where the rag client lives.
 *
 * The same string doubles as the corpus for the number check: a figure the model uses must exist
 * either here or in the customer's own words, exactly like the tool-evidence rule on the other
 * paths. Prompt-carried evidence without that check would be the old ragContext injection again.
 */
export interface CodexEvidence {
  /** Appended to the system prompt. Always ends with the answer-only-from-this rule. */
  block: string;
  /** What the number check may treat as ground truth ('' when the service was unavailable). */
  evidenceText: string;
  unavailable: boolean;
}

export function buildCodexEvidence(ev: SearchEvidenceV4): CodexEvidence {
  if (ev.unavailable) {
    return {
      block:
        '\n\n[ระบบค้นหาสินค้าขัดข้องชั่วคราว]\n' +
        'ตอบลูกค้าว่าระบบข้อมูลสินค้าขัดข้องชั่วคราว ขอให้ลองใหม่ภายหลัง ' +
        'ห้ามเดารายการสินค้า ราคา หรือรหัสใด ๆ ทั้งสิ้น',
      evidenceText: '',
      unavailable: true,
    };
  }
  const cards = formatCards(ev);
  const text = cardsToText(cards, ev);
  return {
    block:
      '\n\n[ข้อมูลจริงจากแคตตาล็อก — ใช้อ้างอิงได้เฉพาะข้อมูลชุดนี้]\n' +
      text +
      '\n\nกติกา: รุ่น รหัส สี และราคา ต้องมาจากข้อมูลข้างบนเท่านั้น ' +
      'ห้ามแต่งเพิ่ม ถ้าข้อมูลไม่พอให้บอกลูกค้าตรง ๆ ว่าต้องตรวจสอบเพิ่มเติม',
    evidenceText: text,
    unavailable: false,
  };
}
