// @req FR-291 — bounded natural-language intent only; never infer scope or facts.
// @tested tests/unit/line-product-facts.test.js

const clarify = code => ({ inputKind: 'NATURAL_LANGUAGE', request: null, clarification: { code } });

export function parseNaturalProductFacts(text) {
  if (typeof text !== 'string' || text.trimStart().startsWith('#')) return null;
  const normalized = text.normalize('NFC');
  const clean = normalized.replace(/[\p{Cc}\p{Cf}]/gu, ' ');
  const skus = [...clean.matchAll(/(?:^|[\s(])(TEST-ONLY-[A-Za-z0-9][A-Za-z0-9_-]*)(?=$|[\s),.!?])/gu)].map(match => match[1]);
  const words = skus.reduce((value, sku) => value.replace(sku, ' '), clean);
  const productReference = skus.length > 0 || /สินค้า|\b(?:sku|product|item)\b/iu.test(words);
  const price = /ราคา|กี่บาท|ต้นทุน|กำไร|\b(?:price|pricing|cost|margin)\b/iu.test(words)
    || /\bhow much (?:is|are|for|does|do)\b/iu.test(words)
    || (productReference && /เท่า(?:ไหร่|ไร)|\bhow much\b/iu.test(words));
  const availability = /สต็อก|สต๊อก|ของเหลือ|เหลือ(?:กี่|เท่า|ไหม|มั้ย)|หมดหรือยัง|มี[^\n?]{0,120}(?:ไหม|มั้ย|หรือเปล่า)|\b(?:stock|available|availability|inventory)\b/iu.test(words)
    || /\b(?:do you|does it) have\b/iu.test(words)
    || /\b(?:how many|quantity|count)\b.{0,120}\b(?:left|remains?|remaining|in stock)\b/iu.test(words)
    || (productReference && /จำนวน|กี่(?:ชิ้น|อัน|หน่วย)|\b(?:how many|left|remaining|quantity|count)\b/iu.test(words));
  if (!price && !availability) return null;
  if (normalized.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(normalized)
    || /[{}\[\]`=<>\\]|https?:|ต้นทุน|กำไร|ข้ามกฎ|สมมติ|สมมุติ|เดา|ไม่|อย่า|\b(?:ignore|previous|instructions?|system|developer|prompt|tenant|businessid|cost|margin|not|no|don't)\b/iu.test(words)) {
    return clarify('NATURAL_FACTS_UNSUPPORTED');
  }
  if (availability && /จำนวน|เหลือ\s*(?:กี่|เท่า)|(?:สต็อก|สต๊อก)\s*(?:กี่|เท่า)|กี่(?:ชิ้น|อัน|หน่วย)|เพียงพอ|พอ(?:ไหม|มั้ย)|\b(?:how many|count|quantity|enough|sufficient)\b|\bhow much\s+(?:stock|inventory)\b|\b(?:stock|inventory)\b.{0,120}\b(?:how much|amount)\b|\bhow much\b.{0,120}\b(?:stock|inventory|left|remaining)\b/iu.test(words)) {
    return clarify('NATURAL_STOCK_COUNT_UNSUPPORTED');
  }
  if (skus.length !== 1 || skus[0].length > 128) return clarify('NATURAL_PRODUCT_REQUIRED');
  const numbers = words.match(/[+-]?\d+(?:[.,]\d+)*/gu) ?? [];
  const request = { sku: skus[0], facets: [...(availability ? ['availability'] : []), ...(price ? ['price'] : [])] };
  if (price) {
    const quantities = [...words.matchAll(/(?<![\p{L}\p{N}_.-])([0-9]+)\s*([A-Za-z][A-Za-z0-9_-]{0,31}|ชิ้น|อัน|กล่อง|แพ็ค|แพ็ก)(?=$|[\s?!.,])/gu)];
    if (numbers.length !== 1 || !/^\d+$/u.test(numbers[0]) || quantities.length !== 1
      || quantities[0][1] !== numbers[0] || !Number.isSafeInteger(Number(numbers[0])) || Number(numbers[0]) < 1) {
      return clarify('NATURAL_PRICE_QUANTITY_UNIT_REQUIRED');
    }
    request.quantity = Number(numbers[0]);
    request.unit = quantities[0][2];
  } else if (numbers.length) return clarify('NATURAL_STOCK_COUNT_UNSUPPORTED');
  return { inputKind: 'NATURAL_LANGUAGE', request, clarification: null };
}
