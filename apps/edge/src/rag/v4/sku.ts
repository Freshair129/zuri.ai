import { cut, sha1Hex, slug } from './schema.js';

export interface SkuInput {
  productId: string; physicalVariantId: string; typeId: string | null; englishName: string | null;
  colors: string[]; sizes: string[]; materials: string[];
}

export const COLOR_ABBR: Record<string, string> = {
  black: 'BLK', white: 'WHT', blue: 'BLU', red: 'RED', green: 'GRN', gray: 'GRY', grey: 'GRY', gold: 'GLD',
  silver: 'SLV', pink: 'PNK', orange: 'ORG', beige: 'BGE', navy: 'NVY', brown: 'BRN', purple: 'PUR', yellow: 'YEL',
};
export const MATERIAL_ABBR: Record<string, string> = {
  sus304: 'S304', sus316: 'S316', '304 stainless steel': 'S304', '316 stainless steel': 'S316',
  'stainless steel': 'SS', abs: 'ABS', pp: 'PP', pc: 'PC', glass: 'GLS', ceramic: 'CER', leather: 'LTH', 'pu leather': 'PU',
  bamboo: 'BMB', wood: 'WD', silicone: 'SIL', 'wheat straw': 'WHT', cotton: 'CTN', nylon: 'NYL', metal: 'MTL',
};

const BASE_MAX = 36;
const TYPE_MAX = 10, MODEL_MAX = 12, VARIANT_MAX = 12, SIZE_MAX = 5;

export function stableSkuId(productId: string, physicalVariantId: string): string {
  return `SKU_${sha1Hex(`${productId}|${physicalVariantId}`).slice(0, 20)}`;
}

function typeTok(typeId: string | null): string {
  if (!typeId) return 'UNCL';
  return cut(slug(typeId), TYPE_MAX) || 'UNCL';
}
function modelTokFull(input: SkuInput): string {
  const s = input.englishName ? slug(input.englishName) : '';
  if (s) return s;
  return (input.productId.split('_')[1] || input.productId).slice(0, 6).toUpperCase();
}
function colorTok(colors: string[]): string | null {
  if (!colors.length) return null;
  const first = colors[0].trim().toLowerCase();
  const tok = COLOR_ABBR[first] || slug(colors[0]).slice(0, 3);
  return colors.length > 1 ? `${tok}-MC` : tok;
}
function sizeTok(sizes: string[]): string | null {
  if (!sizes.length) return null;
  const s = slug(sizes[0]).replace(/-?(CM|ML|MM)$/g, '');
  return cut(s, SIZE_MAX) || null;
}
function materialTok(materials: string[]): string | null {
  if (!materials.length) return null;
  const key = materials[0].trim().toLowerCase();
  return MATERIAL_ABBR[key] || slug(materials[0]).slice(0, 4) || null;
}
function variantTok(input: SkuInput): string {
  const parts = [colorTok(input.colors), sizeTok(input.sizes), materialTok(input.materials)].filter(Boolean) as string[];
  return cut(parts.join('-'), VARIANT_MAX) || 'STD';
}

/** §5.4: base ≤ 36; if over, only modelTok shrinks; variantTok is never cut by the base budget. */
export function baseDisplayCode(input: SkuInput): string {
  const t = typeTok(input.typeId);
  const v = variantTok(input);
  let m = cut(modelTokFull(input), MODEL_MAX);
  const assemble = () => `SKU-${t}-${m}-${v}`;
  let base = assemble();
  if (base.length > BASE_MAX) {
    const over = base.length - BASE_MAX;
    m = cut(m, Math.max(1, m.length - over));
    base = assemble();
  }
  if (base.length > BASE_MAX) base = cut(base, BASE_MAX); // only reachable with a 1-char modelTok
  return base;
}

export function assignDisplayCodes(inputs: SkuInput[]): Map<string, string> {
  const groups = new Map<string, SkuInput[]>();
  for (const i of inputs) {
    const b = baseDisplayCode(i);
    (groups.get(b) ?? groups.set(b, []).get(b)!).push(i);
  }
  const out = new Map<string, string>();
  for (const [base, members] of groups) {
    members.sort((a, b) => (a.physicalVariantId < b.physicalVariantId ? -1 : a.physicalVariantId > b.physicalVariantId ? 1 : 0));
    members.forEach((m, idx) => {
      const id = stableSkuId(m.productId, m.physicalVariantId);
      if (idx === 0) out.set(id, base);
      else if (idx + 1 <= 99) out.set(id, `${base}-${idx + 1}`);
      else out.set(id, `${cut(base, 35)}-${id.slice(4, 8).toUpperCase()}`);
    });
  }
  return out;
}
