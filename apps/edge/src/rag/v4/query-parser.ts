export interface ParsedQuery { cleanText: string; excludeTypes: string[]; qty: number | null; budgetPerUnit: number | null; budgetTotal: number | null }

// Negation cues, longest first so 'ไม่ต้องการ' wins over 'ไม่ต้อง…' prefixes.
const NEG = ['ไม่ต้องพูดถึง', 'ไม่ต้องแนะนำ', 'ไม่ต้องการ', 'ไม่อยากได้', 'ไม่สนใจ', 'ไม่ใช่', 'ไม่เอา', 'ไม่นับ', 'ไม่รวม', 'ยกเว้น', 'not ', 'no '];
// Filler tokens allowed between a cue and the product alias: 'ไม่เอาแบบครอบหู', 'ไม่นับรุ่นที่เป็นหูฟัง'.
const FILLER = ['รุ่นที่เป็น', 'ตัวที่เป็น', 'ที่เป็น', 'แบบที่', 'แบบ', 'รุ่น', 'พวก', 'แค่', 'ชุด'];
const QTY_RX = /(\d[\d,]*)\s*(ชิ้น|ชุด|อัน|คน|ท่าน|pcs|sets?)(?![a-zA-Z])/iu;
const BUDGET_RX = /(?:งบ(?:ประมาณ)?|ไม่เกิน|budget|ราคาไม่เกิน)\s*(?:ไม่เกิน\s*)?(\d[\d,]*)\s*(?:บาท|฿|thb)?/iu;
const num = (s: string) => Number(s.replace(/,/g, ''));

export function parseQuery(text: string, aliases: Map<string, string>): ParsedQuery {
  let clean = text;
  const excludeTypes: string[] = [];
  // longest alias first so "แก้วกาแฟ" wins over "แก้ว"
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  for (const neg of NEG) {
    let at = clean.toLowerCase().indexOf(neg);
    while (at >= 0) {
      let after = clean.slice(at + neg.length).trimStart();
      let hit = keys.find((k) => after.toLowerCase().startsWith(k));
      if (!hit) {
        // try skipping one filler token ('แบบ', 'รุ่นที่เป็น', …) before the alias
        const filler = FILLER.find((f) => after.startsWith(f));
        if (filler) {
          const after2 = after.slice(filler.length).trimStart();
          const hit2 = keys.find((k) => after2.toLowerCase().startsWith(k));
          if (hit2) { after = after2; hit = hit2; }
        }
      }
      if (hit) {
        const t = aliases.get(hit)!;
        if (!excludeTypes.includes(t)) excludeTypes.push(t);
        const start = at; const end = at + neg.length + (clean.slice(at + neg.length).length - after.length) + hit.length;
        clean = clean.slice(0, start) + ' ' + clean.slice(end);
        at = clean.toLowerCase().indexOf(neg);
      } else at = clean.toLowerCase().indexOf(neg, at + neg.length);
    }
  }
  let qty: number | null = null;
  const q = QTY_RX.exec(clean);
  if (q) { qty = num(q[1]); clean = clean.replace(q[0], ' '); }
  let budgetPerUnit: number | null = null; let budgetTotal: number | null = null;
  const b = BUDGET_RX.exec(clean);
  if (b) {
    const v = num(b[1]); clean = clean.replace(b[0], ' ');
    if (qty && v >= 20 * qty) { budgetTotal = v; budgetPerUnit = Math.floor(v / qty); } else budgetPerUnit = v;
  }
  clean = clean.replace(/\b(สำหรับ|บาท|฿)\b/gu, ' ').replace(/\s+/g, ' ').trim();
  return { cleanText: clean || text.trim(), excludeTypes, qty, budgetPerUnit, budgetTotal };
}
