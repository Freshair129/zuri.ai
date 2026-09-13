import fs from 'fs';
import path from 'path';

export const DEFAULT_PERSONA_ID = 'zuri-01';

/**
 * Where the persona folders live.
 *
 * The CLI runs from the checkout, so `.agents/` beside the process is right. The Desktop app's
 * packaged worker runs with cwd = its data root (`%APPDATA%\zuri-edge-device\runtime-data`) and
 * a cleared environment, so `.agents/` was never found there and every answer came from the
 * short built-in fallback. The package now ships `worker/.agents/` and the worker is told its
 * package root, so that is looked at first; `ZURI_AGENTS_ROOT` overrides both for an operator
 * who keeps personas elsewhere.
 */
export function agentsRoot(): string {
  const explicit = process.env.ZURI_AGENTS_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const packageRoot = process.env.ZURI_DESKTOP_PACKAGE_ROOT?.trim();
  if (packageRoot) {
    const packaged = path.join(packageRoot, 'worker', '.agents');
    if (fs.existsSync(packaged)) return packaged;
  }
  return path.resolve('.agents');
}

/** The persona the device answers as: `ZURI_ACTIVE_PERSONA`, read at answer time so a saved change applies without a restart. */
export function activePersonaId(): string {
  return process.env.ZURI_ACTIVE_PERSONA?.trim() || DEFAULT_PERSONA_ID;
}

export function loadPersonaPrompt(personaId: string = DEFAULT_PERSONA_ID): string {
  const personaPath = path.join(agentsRoot(), personaId, 'AGENTS.md');

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
  const root = agentsRoot();
  if (!fs.existsSync(root)) return ['zuri-01'];
  try {
    return fs.readdirSync(root).filter((file) => {
      const full = path.join(root, file);
      return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'AGENTS.md'));
    });
  } catch {
    return ['zuri-01'];
  }
}

export interface PersonaOption {
  id: string;
  /** The first `#` heading of AGENTS.md, or the id when there is none — what a dropdown shows. */
  label: string;
}

/**
 * What the GUI offers. The dropdown used to be two hardcoded options, one of which
 * (`default`) had no folder and silently fell through to the built-in fallback string; the
 * list is read from `.agents/` so an operator sees exactly the personas the device can load.
 */
export function listPersonaOptions(): PersonaOption[] {
  const root = agentsRoot();
  const options = listAvailablePersonas().map((id) => {
    let label = id;
    try {
      const head = fs
        .readFileSync(path.join(root, id, 'AGENTS.md'), 'utf8')
        .split('\n')
        .find((line) => line.startsWith('# '));
      if (head) label = `${id} — ${head.slice(2).trim()}`;
    } catch {
      /* the id alone is a valid label */
    }
    return { id, label };
  });
  const active = activePersonaId();
  if (!options.some((option) => option.id === active)) {
    options.push({ id: active, label: `${active} (ไม่พบ .agents/${active}/AGENTS.md — ใช้ persona สำรองในตัว)` });
  }
  return options;
}
