import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { modelCard, toCardViewModel } from '../../src/line-poc/flex.js';
import { validateCardViewModel } from '../../src/cards/validator.js';
import type { CardPayload } from '../../src/answer/format-cards.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const basePayload: CardPayload = {
  id: 'PRODUCT_M2',
  kind: 'model',
  code: 'TBY01',
  name: 'เครื่องนวดคอ',
  typeNameTh: 'เครื่องนวดคอ',
  colors: ['White', 'Black'],
  sizes: [],
  selectedPrice: { qtyTier: 100, unitPrice: 490, belowMoq: false, source: 'offer' },
  priceExportDate: '2026-06-21',
  priceNote: null,
  status: 'auto',
  image: 'https://example.com/tby01.jpg',
  reviewNote: null,
};

describe('modelCard(CardPayload) — preview-only LINE Flex bubble (AC-D7)', () => {
  it('builds a bubble with a hero image, title, colour chips, and a real price line', () => {
    const bubble = modelCard(basePayload) as Record<string, any>;
    assert.strictEqual(bubble.type, 'bubble');
    assert.strictEqual(bubble.hero.type, 'image');
    assert.strictEqual(bubble.hero.url, basePayload.image);

    const bodyText = JSON.stringify(bubble.body);
    assert.ok(bodyText.includes('เครื่องนวดคอ'));
    assert.ok(bodyText.includes('White'));
    assert.ok(bodyText.includes('Black'));
    assert.ok(bodyText.includes('490'));
    assert.ok(bodyText.includes('100 ชุด'));

    const button = bubble.footer.contents[0];
    assert.strictEqual(button.action.type, 'postback');
    assert.strictEqual(button.action.label, 'ดูตัวเลือก');
    assert.strictEqual(button.action.data, `v4:${basePayload.id}`);
    assert.strictEqual(button.action.uri, undefined);
  });

  it('omits the hero block when there is no image', () => {
    const bubble = modelCard({ ...basePayload, image: null }) as Record<string, any>;
    assert.strictEqual(bubble.hero, undefined);
  });

  it('never invents a price: no selectedPrice and no priceNote shows the "no price data" line, not a number', () => {
    const bubble = modelCard({ ...basePayload, selectedPrice: null, priceNote: null }) as Record<string, any>;
    const bodyText = JSON.stringify(bubble.body);
    assert.ok(bodyText.includes('ยังไม่มีข้อมูลราคา'));
  });

  it('surfaces review_required as a risk flag on the bubble', () => {
    const bubble = modelCard({ ...basePayload, status: 'review_required', reviewNote: 'ข้อมูลรอตรวจสอบ' }) as Record<string, any>;
    const bodyText = JSON.stringify(bubble.body);
    assert.ok(bodyText.includes('ข้อมูลรอตรวจสอบ'));
  });

  it('throws rather than building a card with no title, instead of validating silently', () => {
    assert.throws(() => modelCard({ ...basePayload, name: '' }), /invalid card/);
  });

  it('toCardViewModel(payload) always passes src/cards/validator.ts', () => {
    const cases: CardPayload[] = [
      basePayload,
      { ...basePayload, image: null, colors: [], sizes: ['500ml'], selectedPrice: null, priceNote: 'ราคาขั้นต่ำ สำหรับปริมาณ 10' },
      { ...basePayload, status: 'review_required', reviewNote: 'ข้อมูลรอตรวจสอบ' },
      { ...basePayload, kind: 'offer', code: 'TBS17-2', typeNameTh: null },
    ];
    for (const c of cases) {
      const result = validateCardViewModel(toCardViewModel(c));
      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.valid, true);
    }
  });

  it('the DM answer path never calls modelCard (static guard: ESM exports cannot be mocked, so this checks the source directly)', () => {
    const guarded = [...walkTsFiles(path.join(REPO_ROOT, 'src', 'answer')), path.join(REPO_ROOT, 'src', 'cli', 'index.ts')];
    const offenders = guarded.filter((f) => fs.readFileSync(f, 'utf8').includes('modelCard('));
    assert.deepStrictEqual(offenders.map((f) => path.relative(REPO_ROOT, f)), []);
  });
});
