import type { GraphNode } from './schema.js';

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function modelPassage(n: GraphNode, typeNameTh: string): string {
  const p = n.props as { displayName: string; englishName: string | null; colors: string[]; baseSignature: string };
  const colors = (p.colors ?? []).slice(0, 10).join(', ');
  return `passage: ${typeNameTh} | ${p.displayName} | ${p.englishName ?? ''} | สี: ${colors} | ${clip(p.baseSignature, 200)}`;
}

export function offerPassage(n: GraphNode, componentTypeNamesTh: string[]): string {
  const p = n.props as { name_th: string | null; name_en: string | null; description: string | null };
  return `passage: ชุดของขวัญ | ${p.name_th ?? ''} | ${p.name_en ?? ''} | ประกอบด้วย: ${componentTypeNamesTh.join(', ')} | ${clip(p.description, 200)}`;
}
