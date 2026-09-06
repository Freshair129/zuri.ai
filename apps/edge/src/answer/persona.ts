import fs from 'fs';
import path from 'path';

export function loadPersonaPrompt(personaId: string = 'zuri-01'): string {
  const agentsRoot = path.resolve('.agents');
  const personaPath = path.join(agentsRoot, personaId, 'AGENTS.md');

  if (fs.existsSync(personaPath)) {
    try {
      const content = fs.readFileSync(personaPath, 'utf8').trim();
      console.log(`[Persona] 🎭 Loaded persona "${personaId}" from ${personaPath}`);
      return content;
    } catch (err) {
      console.warn(`[Persona] Failed to read ${personaPath}:`, err);
    }
  }

  // Fallback default. `.agents/zuri-01/AGENTS.md` normally carries the full persona and the
  // §5.8 card rules; when that file is missing (a fresh checkout, a bad path, a wiped `.agents/`
  // directory) the model must not fall back to inventing product cards with no guardrails at
  // all, so the same core rules are restated here in short form.
  return `คุณคือ "ซูริ" (Zuri) ผู้ช่วยฝ่ายขายของ SmartGift ตอบภาษาไทย เป็นกันเอง สุภาพ และช่วยเหลือเรื่องสินค้า/ราคาอย่างมืออาชีพ
เมื่อแสดงสินค้าจากแคตตาล็อก ให้แสดงไม่เกิน 5 การ์ดระดับ Model หรือ Offer พร้อมสีที่มีจริงและราคา ณ จำนวนที่ลูกค้าถาม
ถ้าลูกค้าขอสินค้าที่ไม่ใช่ประเภทหนึ่ง (เช่น "ไม่ใช่แก้ว") ห้ามแสดงสินค้าประเภทนั้นปนมา
ถ้าระบบแจ้งว่าราคาหรือข้อมูลรอตรวจสอบ (review_required) ให้บอกว่า "ข้อมูลรอตรวจสอบ" ถ้าระบบขัดข้อง (unavailable) ให้บอกตรง ๆ ห้ามแต่งรหัสสินค้าหรือราคาขึ้นมาเอง ถ้าไม่มีสินค้าตรงงบ (budgetUnmet) ให้เสนอสินค้าใกล้เคียงพร้อมราคาจริง
ห้ามใช้ markdown (** ## ตาราง) — เป็นแชท LINE ธรรมดา และห้ามโชว์ค่าดิบของระบบ (flowaccount_only, review_required, node id) ให้แปลเป็นภาษาลูกค้าเสมอ`;
}

export function listAvailablePersonas(): string[] {
  const agentsRoot = path.resolve('.agents');
  if (!fs.existsSync(agentsRoot)) return ['zuri-01'];
  try {
    return fs.readdirSync(agentsRoot).filter((file) => {
      const full = path.join(agentsRoot, file);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'AGENTS.md'));
    });
  } catch {
    return ['zuri-01'];
  }
}
