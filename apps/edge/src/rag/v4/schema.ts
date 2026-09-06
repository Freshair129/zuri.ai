import { createHash } from 'node:crypto';

export type NodeLabel =
  | 'CategoryGroup' | 'ProductType' | 'TypeSentinel' | 'ProductModel' | 'PhysicalVariant'
  | 'PhysicalSKU' | 'CatalogOffer' | 'CommercialSKU' | 'CustomizationOption' | 'AttributeValue';

export type EdgeRel =
  | 'IN_GROUP' | 'IN_TYPE' | 'HAS_VARIANT' | 'HAS_SKU' | 'HAS_ATTRIBUTE'
  | 'CONTAINS' | 'PRICED_AS' | 'CUSTOMIZABLE_WITH' | 'SINGLE_OF';

export interface SourceRef { file: string; sha256: string; rowKey: string }
export interface GraphNode { id: string; labels: NodeLabel[]; props: Record<string, unknown> }
export interface GraphEdge { id: string; from: string; to: string; rel: EdgeRel; props?: Record<string, unknown> }
export interface GraphBatch { nodes: GraphNode[]; edges: GraphEdge[]; stats: Record<string, number> }

export const TYPE_UNCLASSIFIED = 'TYPE_unclassified';
export const SKU_PKG_GIFTBOX_STD = 'SKU_PKG_GIFTBOX_STD';
export const COLLECTION = 'e5_v4';
export const VECTOR_DIM = 384;
export const EMBED_MODEL = 'intfloat/multilingual-e5-small';
export const EMBED_MODEL_REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3';

export function sha1Hex(s: string): string {
  return createHash('sha1').update(s, 'utf8').digest('hex');
}

/** ASCII-only upper-case slug; non [A-Z0-9] runs become one dash; no leading/trailing dash. */
export function slug(s: string): string {
  return s.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function cut(tok: string, n: number): string {
  return tok.slice(0, n).replace(/-+$/g, '');
}

export const catGroupId = (groupSlug: string): string => `CATGROUP_${groupSlug}`;
export const typeNodeId = (typeId: string): string => `TYPE_${typeId}`;
export const offerNodeId = (code: string): string => `OFFER_${code.trim().toUpperCase()}`;
export const cskuId = (seed: string): string => `CSKU_${sha1Hex(seed).slice(0, 20).toUpperCase()}`;
export const customId = (optionId: string): string => `CUSTOM_${optionId}`;
export function edgeId(rel: EdgeRel, from: string, to: string, extra = ''): string {
  return `EDGE_${sha1Hex(`${rel}|${from}|${to}|${extra}`).slice(0, 20).toUpperCase()}`;
}
