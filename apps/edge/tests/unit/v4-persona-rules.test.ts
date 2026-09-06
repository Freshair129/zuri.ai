import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadPersonaPrompt } from '../../src/answer/persona.js';

/**
 * §5.8's card rules (<=5 cards, show real colours + price at the asked quantity,
 * review_required -> "ข้อมูลรอตรวจสอบ", unavailable -> say so plainly and never invent a code,
 * budgetUnmet -> offer `nearest` with real prices) have to reach the model two ways: through
 * `.agents/zuri-01/AGENTS.md` in the normal case, and through `persona.ts`'s fallback string when
 * that file is unreadable — a wiped `.agents/` directory must not silently drop every guardrail.
 */

const AGENTS_MD = fs.readFileSync(path.resolve('.agents', 'zuri-01', 'AGENTS.md'), 'utf8');
const FALLBACK = loadFallbackPromptDirectly();

// `loadPersonaPrompt` reads the real committed file when it exists, so the fallback branch is
// exercised by calling it for a persona id that has no AGENTS.md on disk.
function loadFallbackPromptDirectly(): string {
  return loadPersonaPrompt('__no_such_persona_for_fallback_test__');
}

describe('v4 card rules reach the model prompt (§5.8)', () => {
  it('AGENTS.md carries every §5.8 card rule', () => {
    assert.ok(AGENTS_MD.includes('5 การ์ด'), 'missing the <=5 cards rule');
    assert.ok(AGENTS_MD.includes('สีที่มีจริง'), 'missing the "show real colours" rule');
    assert.ok(AGENTS_MD.includes('ณ จำนวนที่ลูกค้าถาม'), 'missing the "price at the asked quantity" rule');
    assert.ok(AGENTS_MD.includes('review_required'), 'missing the review_required rule');
    assert.ok(AGENTS_MD.includes('ข้อมูลรอตรวจสอบ'), 'missing the review_required copy');
    assert.ok(AGENTS_MD.includes('unavailable'), 'missing the unavailable rule');
    assert.ok(AGENTS_MD.includes('ห้ามแต่งรหัส'), 'missing the "never invent a code" rule');
    assert.ok(AGENTS_MD.includes('budgetUnmet'), 'missing the budgetUnmet rule');
    assert.ok(AGENTS_MD.includes('nearest'), 'missing the nearest-alternatives rule');
    assert.ok(AGENTS_MD.includes('ราคาจริง'), 'missing the "real price" rule for nearest alternatives');
  });

  it('the persona.ts fallback string (used when AGENTS.md is unreadable) carries the same rules', () => {
    assert.ok(FALLBACK.includes('5 การ์ด'), 'fallback missing the <=5 cards rule');
    assert.ok(FALLBACK.includes('สีที่มีจริง'), 'fallback missing the "show real colours" rule');
    assert.ok(FALLBACK.includes('ราคา ณ จำนวนที่ลูกค้าถาม'), 'fallback missing the "price at the asked quantity" rule');
    assert.ok(FALLBACK.includes('ไม่ใช่'), 'fallback missing the exclude-type rule');
    assert.ok(FALLBACK.includes('review_required'), 'fallback missing the review_required rule');
    assert.ok(FALLBACK.includes('unavailable'), 'fallback missing the unavailable rule');
    assert.ok(FALLBACK.includes('ห้ามแต่งรหัส'), 'fallback missing the "never invent a code" rule');
    assert.ok(FALLBACK.includes('budgetUnmet'), 'fallback missing the budgetUnmet rule');
  });

  it('loadPersonaPrompt still returns the real AGENTS.md content for zuri-01', () => {
    const real = loadPersonaPrompt('zuri-01');
    assert.strictEqual(real, AGENTS_MD.trim());
  });
});

describe('persona forbids raw internal fields and markdown (LINE plain text)', () => {
  it('AGENTS.md carries the no-markdown and no-internal-dump rules', () => {
    const md = fs.readFileSync(path.join(process.cwd(), '.agents', 'zuri-01', 'AGENTS.md'), 'utf8');
    assert.match(md, /ไม่ใช่ markdown/);
    assert.match(md, /ข้อมูลภายใน/);
    assert.match(md, /flowaccount_only/);
  });
  it('the persona.ts fallback restates both rules', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'answer', 'persona.ts'), 'utf8');
    assert.match(src, /ห้ามใช้ markdown/);
    assert.match(src, /flowaccount_only/);
  });
});
