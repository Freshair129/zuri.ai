// Deterministic test data. Inputs are public taxonomy configuration only; no catalog or chats.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tests/fixtures/v4');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const aliases = read('src/rag/v4/config/product-type-aliases.v1.json').types;
// Stable taxonomy order for reproducible synthetic identifiers.
aliases.sort((a, b) => Number(b.typeId === 'drinkware') - Number(a.typeId === 'drinkware'));
const groups = read('src/rag/v4/config/category-group-map.v1.json').typeToGroup;
const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
const jsonl = (name, rows) => fs.writeFileSync(path.join(dir, 'querysets', name), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const identity = { productMasters: [], variants: [], offers: [], componentLinks: [], customizationProfiles: [{ customizationProfileId: 'SYNTH_CUSTOM', optionIds: ['screen_logo'] }], graph: { nodes: [], edges: [] } };
const colors = ['Black', 'Blue', 'White', 'Red', 'Green', 'Yellow', 'Orange'];
for (let i = 0; i < 50; i++) {
  const type = aliases[i % aliases.length];
  const productId = `PRODUCT_SYNTH_${String(i + 1).padStart(3, '0')}`;
  const model = { productId, displayName: `${type.name_th} รุ่นสังเคราะห์ ${i + 1}`, englishName: `${type.name_en} Synthetic ${i + 1}`, baseSignature: `synthetic ${type.typeId} ${i + 1}`, status: 'auto', typeId: type.typeId, physicalVariantIds: [], offerIds: [] };
  for (let j = 0; j < (i < 19 ? 7 : 6); j++) {
    const physicalVariantId = `PHYSICAL_VARIANT_SYNTH_${i + 1}_${j + 1}`;
    model.physicalVariantIds.push(physicalVariantId);
    identity.variants.push({ physicalVariantId, productId, status: 'auto', attributes: { colors: [colors[j]], sizes: ['Standard'], materials: ['Synthetic test material'] } });
    for (const [attributeType, value] of [['color', colors[j]], ['size', 'Standard'], ['material', 'Synthetic test material']]) {
      const id = `ATTRIBUTE_SYNTH_${attributeType}_${value.replaceAll(' ', '_')}`;
      if (!identity.graph.nodes.some(n => n.id === id)) identity.graph.nodes.push({ id, label: 'AttributeValue', props: { attributeType, value } });
      identity.graph.edges.push({ from: physicalVariantId, to: id, rel: 'HAS_ATTRIBUTE', props: {} });
    }
  }
  identity.productMasters.push(model);
}
const catalog = [];
for (let i = 0; i < 82; i++) {
  const model = identity.productMasters[i % 50];
  const sourceCode = `SYN${String(i + 1).padStart(3, '0')}`;
  const offerId = `OFFER_${sourceCode}`;
  const offer = { offerId, sourceCode, offerKind: i < 50 ? 'single' : 'set', status: 'auto', productId: i < 50 ? model.productId : null, componentLinkIds: [], customizationProfileIds: ['SYNTH_CUSTOM'] };
  // 50 single links + 22 four-component sets + 10 five-component sets = 188 links.
  const count = i < 50 ? 1 : i < 72 ? 4 : 5;
  for (let j = 0; j < count; j++) {
    const component = identity.productMasters[(i + j) % 50];
    const componentLinkId = `SYNTH_LINK_${i + 1}_${j + 1}`;
    offer.componentLinkIds.push(componentLinkId);
    component.offerIds.push(offerId);
    identity.componentLinks.push({ componentLinkId, offerId, productId: component.productId, physicalVariantId: component.physicalVariantIds[0], quantity: 1, position: j + 1, role: component.typeId, typeId: component.typeId });
  }
  identity.offers.push(offer);
  catalog.push({ code: sourceCode.toLowerCase(), name: `${model.displayName} ชุดทดสอบ ${i + 1}`, englishName: `${model.englishName} Test offer ${i + 1}`, category: groups[model.typeId], description: 'ข้อมูลสังเคราะห์สำหรับทดสอบเท่านั้น', image: null, branding: ['สกรีนโลโก้'] });
}
const lines = Array.from({ length: 142 }, (_, i) => {
  const offer = identity.offers[i % 82];
  const qtyTier = i < 82 ? 10 : 100;
  const unitPrice = 600 + (i % 82) * 3 - (i < 82 ? 0 : 50);
  return { rowIndex: i + 1, bucket: 'parsed', flowAccountCode: `${offer.sourceCode}(P-01)-${qtyTier}`, base: offer.sourceCode, priceListGroup: 'P-01', qtyTier, unitPrice, unitPriceWithVat: Number((unitPrice * 1.07).toFixed(2)), priceMissing: false, flowAccountName: `ชุดทดสอบสังเคราะห์ ${offer.sourceCode}(P-01)`, category: 'Gift Set' };
});
write('synthetic-50.json', { identity, catalog, flowaccount: { lines, review: [], counts: { parsed: 142, name_coded: 0, unparsed: 0, non_giftset: 0, blank: 0, inactive: 0 }, total: 142 } });
const texts = ['สวัสดี', 'สบายดีไหม', '@ซูริ', 'สวัสดี zuri ทำอะไรได้บ้าง', 'ไม่ใช่แก้ว งบ 200 บาท', 'ขอของขวัญ ไม่ใช่แก้ว งบ 200 บาท', 'เลือกสินค้า ไม่ใช่แก้ว งบ 200 บาท', 'ช่วยหา ไม่ใช่แก้ว งบ 200 บาท', 'แก้วน้ำมีกี่สี', 'พาวเวอร์แบงก์มีตัวไหนบ้าง', 'สมุดมีตัวไหนบ้าง', 'ขอบคุณครับ', 'ช่วยออกแบบรูปดาว', 'ขอพักก่อน', 'รับทราบ', 'ไว้คุยกันใหม่', 'วันนี้ขอดูตัวอย่าง'];
write('line-chat-turns.json', texts.map((text, i) => ({ source: `synthetic-authored-${i + 1}`, text: text.includes('ไม่ใช่แก้ว') ? `แก้วน้ำหรือสมุด ${text}` : text })));
const queries = Array.from({ length: 60 }, (_, i) => {
  const group = ['smart_tech', 'care_wellness', 'office', 'home_travel'][Math.floor(i / 15)];
  const models = identity.productMasters.filter(m => groups[m.typeId] === group);
  const model = models[i % models.length];
  const type = aliases.find(t => t.typeId === model.typeId);
  const exclude = i < 15 ? [model.typeId === 'drinkware' ? 'power_bank' : 'drinkware'] : [];
  const qty = i % 3 === 0 ? 100 : null;
  const budget = i % 3 === 1 ? 900 : null;
  const intent = ['find', 'compare', 'color', 'price'][i % 4];
  const suffix = { find: 'มีตัวไหนบ้าง', compare: 'เปรียบเทียบตัวเลือก', color: 'มีกี่สี', price: 'ราคาเท่าไหร่' }[intent];
  const excludedName = exclude.length ? aliases.find(t => t.typeId === exclude[0]).name_th : '';
  const specific = i % 10 < 3;
  return { id: `SYN-NL-${i + 1}`, text: `${specific ? model.displayName : type.name_th} ${suffix}${exclude.length ? ` ไม่ใช่${excludedName}` : ''}${qty ? ` จำนวน ${qty} ชิ้น` : ''}${budget ? ` งบ ${budget} บาท` : ''}`, expected: { kind: specific ? 'model' : 'type', id: specific ? model.productId : model.typeId }, exclude, qty, budget, group, intent };
});
jsonl('QS_NL_SYNTHETIC_v1.jsonl', queries);
jsonl('QS_LINE_SYNTHETIC_v1.jsonl', [...texts.slice(4, 9), 'แก้วน้ำมีตัวไหนบ้าง'].map((text, i) => ({ id: `SYN-LINE-${i + 1}`, text: i < 4 ? `แก้วน้ำหรือสมุด ${text}` : text, expected: { kind: 'type', id: i < 4 ? 'notebook' : 'drinkware' }, exclude: i < 4 ? ['drinkware'] : [], qty: null, budget: i < 4 ? 200 : null, group: i < 4 ? 'office' : 'home_travel', intent: i === 4 ? 'color' : 'find' })));
// 1,005 authored query cases over 82 offers, not 1,005 distinct catalog offers.
jsonl('QS_OFFER_SYNTHETIC_v1.jsonl', Array.from({ length: 1005 }, (_, i) => {
  const offer = identity.offers[i % 82];
  return { id: `SYN-OS-${i + 1}`, offerId: offer.offerId, sourceCode: offer.sourceCode, text: `${catalog[i % 82].name} ตัวอย่างคำค้น ${i + 1}`, expected: { kind: 'model', ids: [...new Set(identity.componentLinks.filter(l => l.offerId === offer.offerId).map(l => l.productId))] }, restricted: true };
}));
const codes = ['SYN01(P-14)-100', 'SYN02(P-14)-500', 'SYN03-2(P-20)-500', 'SYN0762(P-PT)-10', 'SYN05', 'BAD-801-(400)100', 'SYN-2(P-02)-500', '', '', '', '', '', '', 'SYN14', 'INVALID', 'SYN16', 'SYN17', 'SYN18', 'SY05601(P-09)-20', 'SYN20'];
const rows = codes.map((productCode, i) => ({ rowIndex: i + 1, productCode, name: `สินค้าทดสอบสังเคราะห์ ${i + 1}`, unit: 'ชุด', category: [13, 14].includes(i) ? 'Other' : 'Gift Set', unitPrice: i === 4 ? 0 : 610 + i * 10, unitPriceWithVat: i === 4 ? 0 : Number(((610 + i * 10) * 1.07).toFixed(2)), buyPrice: 0 }));
rows[7].name = 'ชุดทดสอบ SYN08-4(P-06)';
rows[8].name = 'ชุดทดสอบ SYN09-2';
rows[15].name = 'สินค้าทดสอบ ไม่ใช้งาน';
write('flowaccount-rows.json', rows);
console.log('Generated synthetic fixtures from taxonomy and authored constants only.');
