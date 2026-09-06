import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// @req RAG-FR-001 — the one canonical normalized catalog snapshot, carrying lineage to each upstream source.
// @req RAG-FR-002 — the snapshot manifest: source role, content hash, schema version, counts and generated_at.
// @req RAG-FR-003 — stable product identity — normalizeCatalogName plus a content-derived stableId, so a refresh does not renumber the catalog.
// @req RAG-GR-001 — deterministic Product and Category nodes: re-ingest produces the same logical ids.
// @req RAG-GR-002 — BELONGS_TO_CATEGORY is the only relation emitted; any new one is a separate decision.

export type CatalogSourceRole = 'semantic' | 'pricing';
export type CatalogMergeStatus = 'auto_merged' | 'review_required';
export type CatalogVariantStatus = 'candidate' | 'review_required';

type JsonObject = Record<string, unknown>;

export interface CanonicalCatalogProduct {
  offerId: string;
  code: string;
  name: string;
  englishName: string | null;
  description: string | null;
  category: string | null;
  branding: string[];
  mode: string;
  moq: unknown;
  tiers: unknown;
  visual: unknown;
  rmb: number | null;
  upc: number | null;
  dims: [number, number, number] | null;
  kg: number | null;
  e: boolean;
  img: string | null;
  sourceRowCount: number;
  duplicateSourceRows: number;
  sourceRefs: CatalogSourceRole[];
  sourceNames: {
    semantic: string | null;
    pricing: string | null;
  };
}

export interface CatalogOffer {
  offerId: string;
  sourceCode: string;
  sourceRefs: CatalogSourceRole[];
  sourceRowCount: number;
  duplicateSourceRows: number;
}

export interface CatalogVariant {
  variantId: string;
  familyId: string;
  status: CatalogVariantStatus;
  offerIds: string[];
  sourceCodes: string[];
  attributes: {
    color: string[] | null;
    size: string | null;
    material: string | null;
    packaging: string | null;
  };
}

export interface CatalogFamily {
  familyId: string;
  normalizedName: string;
  name: string;
  englishName: string | null;
  category: string | null;
  branding: string[];
  mergeStatus: CatalogMergeStatus;
  sourceRefs: CatalogSourceRole[];
  sourceCodes: string[];
  offerIds: string[];
  variantIds: string[];
}

export interface CatalogSourceManifest {
  role: CatalogSourceRole;
  path: string;
  sha256: string;
  recordCount: number;
  uniqueCodeCount: number;
  duplicateCodes: string[];
  exactDuplicateCodes: string[];
  conflictingDuplicateCodes: string[];
  duplicateRowCount: number;
}

export interface CatalogManifest {
  schemaVersion: 2;
  snapshotId: string;
  generatedAt: string;
  sources: CatalogSourceManifest[];
  productCount: number;
  familyCount: number;
  variantCount: number;
  offerCount: number;
  duplicateSourceRowCount: number;
  conflictingSourceCodeCount: number;
  reviewFamilyCount: number;
  graph: {
    productNodeCount: number;
    familyNodeCount: number;
    variantNodeCount: number;
    offerNodeCount: number;
    categoryNodeCount: number;
    edgeCount: number;
  };
  vector: {
    status: 'not_built';
    dimension: null;
    count: 0;
  };
}

export interface CanonicalCatalog {
  products: CanonicalCatalogProduct[];
  families: CatalogFamily[];
  variants: CatalogVariant[];
  offers: CatalogOffer[];
  manifest: CatalogManifest;
}

export interface GenesisNodeInput {
  id: string;
  labels: string[];
  props: JsonObject;
}

export interface GenesisEdgeInput {
  id: string;
  from: string;
  to: string;
  rel: string;
  props?: JsonObject;
}

export interface GenesisGraphBatch {
  nodes: GenesisNodeInput[];
  edges: GenesisEdgeInput[];
}

export type CatalogIngestDecision =
  | 'ingest_empty_store'
  | 'skip_same_snapshot'
  | 'legacy_unmanifested'
  | 'snapshot_changed';

interface IndexedRowEntry {
  row: JsonObject;
  rows: JsonObject[];
}

interface IndexedRows {
  byCode: Map<string, IndexedRowEntry>;
  duplicateCodes: string[];
  exactDuplicateCodes: string[];
  conflictingDuplicateCodes: string[];
  duplicateRowCount: number;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  const item = text(value);
  return item ? [item] : [];
}

function dimensions(value: unknown): [number, number, number] | null {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[x×,*]/i).map((item) => item.trim())
      : [];
  if (values.length !== 3) return null;
  const parsed = values.map(numberValue);
  return parsed.every((item): item is number => item !== null)
    ? [parsed[0], parsed[1], parsed[2]]
    : null;
}

function code(value: unknown): string | null {
  const item = text(value);
  return item ? item.toUpperCase() : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 20).toUpperCase()}`;
}

export function normalizeCatalogName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[＋]/g, '+')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim();
}

function indexedRows(rows: JsonObject[]): IndexedRows {
  const byCode = new Map<string, IndexedRowEntry>();
  const duplicates = new Set<string>();
  const exactDuplicates = new Set<string>();
  const conflictingDuplicates = new Set<string>();
  let duplicateRowCount = 0;

  for (const row of rows) {
    const itemCode = code(row.code);
    if (!itemCode) continue;
    const existing = byCode.get(itemCode);
    if (!existing) {
      byCode.set(itemCode, { row, rows: [row] });
      continue;
    }

    existing.rows.push(row);
    duplicates.add(itemCode);
    duplicateRowCount += 1;
    if (stableJson(existing.row) === stableJson(row)) exactDuplicates.add(itemCode);
    else conflictingDuplicates.add(itemCode);
  }

  return {
    byCode,
    duplicateCodes: [...duplicates].sort(),
    exactDuplicateCodes: [...exactDuplicates].sort(),
    conflictingDuplicateCodes: [...conflictingDuplicates].sort(),
    duplicateRowCount,
  };
}

function readRows(filePath: string, role: CatalogSourceRole): JsonObject[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  if (role === 'semantic') {
    if (!Array.isArray(parsed)) throw new Error(`Semantic catalog must be a JSON array: ${filePath}`);
    return parsed.map(objectValue);
  }

  const products = objectValue(parsed).products;
  if (!Array.isArray(products)) throw new Error(`Pricing catalog must contain products[]: ${filePath}`);
  return products.map(objectValue);
}

function sourceManifest(
  filePath: string,
  role: CatalogSourceRole,
  rows: JsonObject[],
  index: IndexedRows
): CatalogSourceManifest {
  return {
    role,
    path: filePath,
    sha256: hashFile(filePath),
    recordCount: rows.length,
    uniqueCodeCount: index.byCode.size,
    duplicateCodes: index.duplicateCodes,
    exactDuplicateCodes: index.exactDuplicateCodes,
    conflictingDuplicateCodes: index.conflictingDuplicateCodes,
    duplicateRowCount: index.duplicateRowCount,
  };
}

function buildFamilyProjection(products: CanonicalCatalogProduct[]): {
  families: CatalogFamily[];
  variants: CatalogVariant[];
  offers: CatalogOffer[];
} {
  const grouped = new Map<string, CanonicalCatalogProduct[]>();
  for (const product of products) {
    const normalizedName = normalizeCatalogName(product.englishName || product.name);
    const group = grouped.get(normalizedName) || [];
    group.push(product);
    grouped.set(normalizedName, group);
  }

  const families: CatalogFamily[] = [];
  const variants: CatalogVariant[] = [];
  const offers: CatalogOffer[] = [];

  for (const [key, group] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sortedGroup = [...group].sort((a, b) => a.code.localeCompare(b.code));
    const first = sortedGroup[0];
    const familyId = stableId('FAMILY', key);
    const familyVariantIds: string[] = [];
    const familyOfferIds: string[] = [];
    const familySourceCodes: string[] = [];
    const familySourceRefs = new Set<CatalogSourceRole>();
    const familyBranding = new Set<string>();

    for (const product of sortedGroup) {
      const variantId = `VARIANT_${product.code}`;
      familyVariantIds.push(variantId);
      familyOfferIds.push(product.offerId);
      familySourceCodes.push(product.code);
      product.sourceRefs.forEach((source) => familySourceRefs.add(source));
      product.branding.forEach((item) => familyBranding.add(item));

      variants.push({
        variantId,
        familyId,
        status: sortedGroup.length > 1 ? 'review_required' : 'candidate',
        offerIds: [product.offerId],
        sourceCodes: [product.code],
        attributes: {
          color: null,
          size: null,
          material: null,
          packaging: null,
        },
      });
      offers.push({
        offerId: product.offerId,
        sourceCode: product.code,
        sourceRefs: product.sourceRefs,
        sourceRowCount: product.sourceRowCount,
        duplicateSourceRows: product.duplicateSourceRows,
      });
    }

    families.push({
      familyId,
      normalizedName: normalizeCatalogName(first.englishName || first.name),
      name: first.name,
      englishName: first.englishName,
      category: first.category,
      branding: [...familyBranding].sort(),
      mergeStatus: sortedGroup.length > 1 ? 'review_required' : 'auto_merged',
      sourceRefs: [...familySourceRefs].sort(),
      sourceCodes: familySourceCodes,
      offerIds: familyOfferIds,
      variantIds: familyVariantIds,
    });
  }

  return { families, variants, offers };
}

export function buildCanonicalCatalog(options: {
  semanticPath?: string;
  pricingPath?: string;
}): CanonicalCatalog {
  const semanticPath = options.semanticPath ? path.resolve(options.semanticPath) : undefined;
  const pricingPath = options.pricingPath ? path.resolve(options.pricingPath) : undefined;
  if (!semanticPath && !pricingPath) throw new Error('At least one catalog source is required');
  if (semanticPath && !fs.existsSync(semanticPath)) {
    throw new Error(`Semantic catalog not found: ${semanticPath}`);
  }
  if (pricingPath && !fs.existsSync(pricingPath) && !semanticPath) {
    throw new Error(`Pricing catalog not found: ${pricingPath}`);
  }

  const sources: CatalogSourceManifest[] = [];
  const semanticRows = semanticPath ? readRows(semanticPath, 'semantic') : [];
  const semanticIndex = indexedRows(semanticRows);
  if (semanticPath) sources.push(sourceManifest(semanticPath, 'semantic', semanticRows, semanticIndex));

  const pricingRows = pricingPath && fs.existsSync(pricingPath) ? readRows(pricingPath, 'pricing') : [];
  const pricingIndex = indexedRows(pricingRows);
  if (pricingPath && fs.existsSync(pricingPath)) {
    sources.push(sourceManifest(pricingPath, 'pricing', pricingRows, pricingIndex));
  }

  const allCodes = new Set([...semanticIndex.byCode.keys(), ...pricingIndex.byCode.keys()]);
  const products = [...allCodes].sort().map((itemCode): CanonicalCatalogProduct => {
    const semanticEntry = semanticIndex.byCode.get(itemCode);
    const pricingEntry = pricingIndex.byCode.get(itemCode);
    const semantic = semanticEntry?.row;
    const pricing = pricingEntry?.row;
    const semanticName = text(semantic?.name);
    const pricingName = text(pricing?.name);
    const sourceRowCount = (semanticEntry?.rows.length || 0) + (pricingEntry?.rows.length || 0);
    const duplicateSourceRows =
      Math.max(0, (semanticEntry?.rows.length || 0) - 1) + Math.max(0, (pricingEntry?.rows.length || 0) - 1);

    return {
      offerId: `OFFER_${itemCode}`,
      code: itemCode,
      name: semanticName || pricingName || itemCode,
      englishName: text(semantic?.englishName) || pricingName,
      description: text(semantic?.description),
      category: text(semantic?.category),
      branding: stringArray(semantic?.branding),
      mode: text(semantic?.mode) || 'quote',
      moq: semantic?.moq ?? null,
      tiers: semantic?.tiers ?? null,
      visual: semantic?.visual ?? null,
      rmb: numberValue(pricing?.rmb),
      upc: numberValue(pricing?.upc),
      dims: dimensions(pricing?.dims),
      kg: numberValue(pricing?.kg),
      e: booleanValue(pricing?.e),
      img: text(pricing?.img) || text(semantic?.image),
      sourceRowCount,
      duplicateSourceRows,
      sourceRefs: [
        ...(semantic ? (['semantic'] as CatalogSourceRole[]) : []),
        ...(pricing ? (['pricing'] as CatalogSourceRole[]) : []),
      ],
      sourceNames: {
        semantic: semanticName,
        pricing: pricingName,
      },
    };
  });

  const { families, variants, offers } = buildFamilyProjection(products);
  const categoryCount = new Set(families.map((family) => family.category).filter(Boolean)).size;
  const duplicateSourceRowCount = sources.reduce((total, source) => total + source.duplicateRowCount, 0);
  const conflictingSourceCodes = new Set(
    sources.flatMap((source) => source.conflictingDuplicateCodes)
  );
  const edgeCount =
    variants.length + variants.reduce((total, variant) => total + variant.offerIds.length, 0) +
    families.filter((family) => family.category !== null).length;
  const fingerprint = JSON.stringify({
    schemaVersion: 2,
    normalizationVersion: 'catalog-family-v1',
    sources: sources.map(
      ({ role, sha256, recordCount, uniqueCodeCount, duplicateCodes, conflictingDuplicateCodes }) => ({
        role,
        sha256,
        recordCount,
        uniqueCodeCount,
        duplicateCodes,
        conflictingDuplicateCodes,
      })
    ),
    productCodes: products.map((product) => product.code),
    familyKeys: families.map((family) => family.familyId),
  });

  return {
    products,
    families,
    variants,
    offers,
    manifest: {
      schemaVersion: 2,
      snapshotId: crypto.createHash('sha256').update(fingerprint).digest('hex'),
      generatedAt: new Date().toISOString(),
      sources,
      productCount: families.length,
      familyCount: families.length,
      variantCount: variants.length,
      offerCount: offers.length,
      duplicateSourceRowCount,
      conflictingSourceCodeCount: conflictingSourceCodes.size,
      reviewFamilyCount: families.filter((family) => family.mergeStatus === 'review_required').length,
      graph: {
        productNodeCount: families.length,
        familyNodeCount: families.length,
        variantNodeCount: variants.length,
        offerNodeCount: offers.length,
        categoryNodeCount: categoryCount,
        edgeCount,
      },
      vector: {
        status: 'not_built',
        dimension: null,
        count: 0,
      },
    },
  };
}

export function buildGenesisGraphBatch(catalog: CanonicalCatalog): GenesisGraphBatch {
  const nodes: GenesisNodeInput[] = [];
  const edges: GenesisEdgeInput[] = [];
  const categories = new Set<string>();
  const productByOffer = new Map(catalog.products.map((product) => [product.offerId, product]));
  const variantById = new Map(catalog.variants.map((variant) => [variant.variantId, variant]));

  for (const family of catalog.families) {
    const familyId = family.familyId;
    nodes.push({
      id: familyId,
      labels: ['ProductFamily', 'Product'],
      props: {
        ...family,
        source: 'SmartGift Consolidated Catalog',
        catalogVersion: catalog.manifest.snapshotId,
      },
    });

    if (family.category) {
      const categoryId = `CAT_${family.category.toUpperCase().replace(/\s+/g, '_')}`;
      if (!categories.has(categoryId)) {
        categories.add(categoryId);
        nodes.push({
          id: categoryId,
          labels: ['Category'],
          props: {
            name: family.category,
            catalogVersion: catalog.manifest.snapshotId,
          },
        });
      }
      edges.push({
        id: `${familyId}__BELONGS_TO_CATEGORY__${categoryId}`,
        from: familyId,
        to: categoryId,
        rel: 'BELONGS_TO_CATEGORY',
      });
    }

    for (const variantId of family.variantIds) {
      const variant = variantById.get(variantId);
      if (!variant) continue;
      nodes.push({
        id: variant.variantId,
        labels: ['ProductVariant', 'Variant'],
        props: {
          ...variant,
          catalogVersion: catalog.manifest.snapshotId,
        },
      });
      edges.push({
        id: `${familyId}__HAS_VARIANT__${variant.variantId}`,
        from: familyId,
        to: variant.variantId,
        rel: 'HAS_VARIANT',
      });

      for (const offerId of variant.offerIds) {
        const product = productByOffer.get(offerId);
        if (!product) continue;
        nodes.push({
          id: offerId,
          labels: ['CatalogOffer', 'Offer'],
          props: {
            ...product,
            source: 'SmartGift Catalog Offer',
            catalogVersion: catalog.manifest.snapshotId,
          },
        });
        edges.push({
          id: `${variant.variantId}__HAS_OFFER__${offerId}`,
          from: variant.variantId,
          to: offerId,
          rel: 'HAS_OFFER',
        });
      }
    }
  }

  return { nodes, edges };
}

export function readCatalogManifest(manifestPath: string): CatalogManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<CatalogManifest>;
  if (parsed.schemaVersion !== 2 || typeof parsed.snapshotId !== 'string') {
    throw new Error(`Unsupported catalog manifest: ${manifestPath}`);
  }
  return parsed as CatalogManifest;
}

export function writeCatalogManifest(manifestPath: string, manifest: CatalogManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tempPath, manifestPath);
}

export function storeHasMaterializedData(storePath: string): boolean {
  // projection.sqlite can exist with only Genesis schema metadata. Product/edge files are the
  // evidence that a graph snapshot actually contains catalog data.
  return ['nodes.bin', 'edges.bin'].some((name) => {
    const item = fs.statSync(path.join(storePath, name), { throwIfNoEntry: false });
    return Boolean(item && item.size > 0);
  });
}

export function decideCatalogIngest(
  storePath: string,
  existingManifest: CatalogManifest | null,
  snapshotId: string
): CatalogIngestDecision {
  if (existingManifest) {
    return existingManifest.snapshotId === snapshotId ? 'skip_same_snapshot' : 'snapshot_changed';
  }
  return storeHasMaterializedData(storePath) ? 'legacy_unmanifested' : 'ingest_empty_store';
}
