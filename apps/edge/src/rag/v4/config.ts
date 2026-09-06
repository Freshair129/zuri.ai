import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CategoryGroupMap { version: 'v1'; groups: Array<{ id: string; name_th: string; name_en: string; order: number }>; typeToGroup: Record<string, string> }
export interface TypeAlias { typeId: string; name_th: string; name_en: string; aliases_th: string[]; aliases_en: string[] }
export interface TypeAliases { version: 'v1'; types: TypeAlias[] }

const CONFIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config');
export const CATEGORY_MAP_FILE = path.join(CONFIG_DIR, 'category-group-map.v1.json');
export const TYPE_ALIASES_FILE = path.join(CONFIG_DIR, 'product-type-aliases.v1.json');

export function loadCategoryGroupMap(): CategoryGroupMap { return JSON.parse(fs.readFileSync(CATEGORY_MAP_FILE, 'utf8')); }
export function loadTypeAliases(): TypeAliases { return JSON.parse(fs.readFileSync(TYPE_ALIASES_FILE, 'utf8')); }

export function validateCategoryGroupMap(map: CategoryGroupMap, observedTypeIds: string[]): void {
  const groupIds = new Set(map.groups.map((g) => g.id));
  if (groupIds.size !== 4) throw new Error(`category-group-map must define exactly 4 groups, got ${groupIds.size}`);
  const missing = observedTypeIds.filter((t) => !(t in map.typeToGroup));
  if (missing.length) throw new Error(`category-group-map missing typeIds: ${missing.join(', ')}`);
  for (const [t, g] of Object.entries(map.typeToGroup)) if (!groupIds.has(g)) throw new Error(`typeId ${t} maps to unknown group ${g}`);
}

export function validateTypeAliases(a: TypeAliases, observedTypeIds: string[]): void {
  const have = new Set(a.types.map((t) => t.typeId));
  const missing = observedTypeIds.filter((t) => !have.has(t));
  if (missing.length) throw new Error(`product-type-aliases missing typeIds: ${missing.join(', ')}`);
  const seen = new Map<string, string>();
  for (const t of a.types) {
    if (!t.name_th) throw new Error(`type ${t.typeId} has no name_th`);
    for (const al of [t.name_th, ...t.aliases_th, ...t.aliases_en, t.name_en.toLowerCase()]) {
      const k = al.normalize('NFKC').toLowerCase().trim();
      const prev = seen.get(k);
      if (prev && prev !== t.typeId) throw new Error(`alias "${al}" claimed by ${prev} and ${t.typeId}`);
      seen.set(k, t.typeId);
    }
  }
}

export function aliasIndex(a: TypeAliases): Map<string, string> {
  const idx = new Map<string, string>();
  for (const t of a.types) for (const al of [t.name_th, t.name_en, ...t.aliases_th, ...t.aliases_en]) idx.set(al.normalize('NFKC').toLowerCase().trim(), t.typeId);
  return idx;
}
