import fs from 'node:fs';
import path from 'node:path';

import {
  buildCanonicalCatalog,
  type CanonicalCatalog,
  type CatalogSourceRole,
} from './catalog-manifest.js';
import {
  buildTaxonomyProjection,
  TAXONOMY_PROJECTION_PROMOTION_POLICY,
  TAXONOMY_PROJECTION_STATUS,
  TAXONOMY_PROJECTION_VERSION,
  type TaxonomyProjectionManifest,
} from './taxonomy-projection.js';
import { readTaxonomyProjectionManifest } from './taxonomy-projection-store.js';
import {
  buildTaxonomyReviewReport,
  type TaxonomyReviewReport,
} from './taxonomy-report.js';

// @req RAG-GR-003 — the served graph declares its source: a proposed projection is labelled as one and never implies an approved graph.
// @req TAX-NFR-003 — counts and assignments carry snapshot and taxonomy provenance.

export const TAXONOMY_SERVING_VERSION = 'taxonomy-serving-v1' as const;
export const TAXONOMY_QUERY_ALIAS_VERSION = 'taxonomy-query-alias-v1' as const;
export const TAXONOMY_SERVING_MODE = 'preview' as const;
export const TAXONOMY_SERVING_AUTHORITY = 'non_authoritative' as const;
export const TAXONOMY_SERVING_DEFAULT_LIMIT = 5;
export const TAXONOMY_SERVING_MAX_LIMIT = 50;

export type TaxonomyServingErrorCode =
  | 'TAXONOMY_QUERY_INVALID'
  | 'TAXONOMY_PROJECTION_UNAVAILABLE';

export class TaxonomyServingError extends Error {
  constructor(
    public readonly code: TaxonomyServingErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'TaxonomyServingError';
  }
}

export interface TaxonomyServingQueryInput {
  query?: string;
  categoryId?: string;
  limit?: number;
  includeReview?: boolean;
}

export interface TaxonomyServingQuery {
  query: string | null;
  categoryId: string | null;
  limit: number;
  includeReview: boolean;
}

export interface TaxonomyServingProjectionCounts {
  candidateCategoryCount: number;
  approvedCategoryCount: number;
  familyCount: number;
  variantCount: number;
  offerCount: number;
}

export interface TaxonomyServingMatchCounts {
  matchedFamilyCount: number;
  returnedFamilyCount: number;
  matchedBundleFamilyCount: number;
  returnedBundleFamilyCount: number;
  matchedVariantCount: number;
  returnedVariantCount: number;
  matchedOfferCount: number;
  returnedOfferCount: number;
  taxonomyStatusCounts: {
    auto: number;
    review_required: number;
    unclassified: number;
  };
  mergeReviewByTaxonomyStatus: {
    auto: number;
    review_required: number;
    unclassified: number;
  };
}

export interface TaxonomyServingOffer {
  offerId: string;
  sourceCode: string;
  sourceRefs: CatalogSourceRole[];
  sourceRowCount: number;
  duplicateSourceRows: number;
}

export interface TaxonomyServingResult {
  matchType: 'exact_code' | 'text' | 'category';
  familyId: string;
  name: string;
  englishName: string | null;
  sourceCodes: string[];
  variantIds: string[];
  offerIds: string[];
  sourceRefs: CatalogSourceRole[];
  mergeStatus: string;
  taxonomyStatus: string;
  candidateCategoryIds: string[];
  componentSignature: string | null;
  componentCount: number;
  isBundle: boolean;
  reviewReasons: string[];
  offers: TaxonomyServingOffer[];
}

export interface TaxonomyServingResponse {
  servingVersion: typeof TAXONOMY_SERVING_VERSION;
  queryAliasVersion: typeof TAXONOMY_QUERY_ALIAS_VERSION;
  mode: typeof TAXONOMY_SERVING_MODE;
  authority: typeof TAXONOMY_SERVING_AUTHORITY;
  projectionStatus: typeof TAXONOMY_PROJECTION_STATUS;
  activated: false;
  promotionPolicy: typeof TAXONOMY_PROJECTION_PROMOTION_POLICY;
  vectorStatus: 'not_built';
  snapshotId: string;
  asOf: string;
  taxonomyRuleVersion: string;
  reportVersion: string;
  projectionVersion: typeof TAXONOMY_PROJECTION_VERSION;
  sourceLineage: TaxonomyServingSourceLineage[];
  query: TaxonomyServingQuery;
  projectionCounts: TaxonomyServingProjectionCounts;
  matchCounts: TaxonomyServingMatchCounts;
  results: TaxonomyServingResult[];
}

export interface TaxonomyServingContext {
  catalog: CanonicalCatalog;
  report: TaxonomyReviewReport;
  projectionManifest: TaxonomyProjectionManifest;
}

export interface TaxonomyServingSourceLineage {
  role: CatalogSourceRole;
  sha256: string;
  recordCount: number;
  uniqueCodeCount: number;
}

export interface TaxonomyServingSourceOptions {
  semanticPath?: string;
  pricingPath?: string;
  projectionStorePath?: string;
  projectionManifestPath?: string;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// These aliases expand user queries only. They never create or promote a canonical assignment.
const QUERY_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  'แก้ว': 'drinkware',
  'แก้วน้ำ': 'drinkware',
  'แก้วกาแฟ': 'drinkware',
  'ร่ม': 'umbrella',
  'ปากกา': 'pen',
  'สมุด': 'notebook',
  'แฟลชไดรฟ์': 'usb_flash_drive',
  'แฟลชไดร์ฟ': 'usb_flash_drive',
  'ยูเอสบี': 'usb_flash_drive',
  'พาวเวอร์แบงค์': 'power_bank',
  'แบตสำรอง': 'power_bank',
  'พัดลม': 'fan',
  'ลำโพง': 'speaker',
  'เมาส์': 'mouse',
  'คีย์บอร์ด': 'keyboard',
  'พวงกุญแจ': 'key_chain',
  'กระเป๋า': 'bag',
  'ที่ชาร์จ': 'charger',
  'แท่นชาร์จ': 'charger',
  'ผ้าเช็ดตัว': 'towel',
  'ถุงมือ': 'glove',
  'เครื่องชงกาแฟ': 'coffee_maker',
  'ชุดชา': 'tea_set',
  'เครื่องทำความชื้น': 'humidifier',
  'เครื่องนวดคอ': 'neck_massager',
  'ปืนนวด': 'massage_gun',
  'ไดร์เป่าผม': 'hair_dryer',
  'เอียร์บัด': 'earbuds',
  'กำไลอัจฉริยะ': 'smart_bracelet',
  'แป้นพิมพ์': 'keyboard',
  'ที่คั่นหนังสือ': 'bookmark',
  'ที่ใส่นามบัตร': 'name_card_holder',
  'หวีนวด': 'massage_comb',
  'กระเป๋าเอกสาร': 'briefcase',
};

function normalizeQueryTerm(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

function queryCategoryAlias(term: string): string | null {
  return QUERY_CATEGORY_ALIASES[normalizeQueryTerm(term)] || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeOptionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > 200) {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', `${field} is too long`);
  }
  return normalized || null;
}

export function normalizeTaxonomyServingQuery(
  input: TaxonomyServingQueryInput | unknown
): TaxonomyServingQuery {
  if (!isRecord(input)) {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', 'query input must be an object');
  }

  const query = normalizeOptionalText(input.query, 'query');
  const categoryId = normalizeOptionalText(input.categoryId, 'categoryId')?.toLowerCase() || null;
  if (categoryId && !/^[a-z0-9_]+$/.test(categoryId)) {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', 'categoryId is not a registered id shape');
  }

  const limit = input.limit === undefined ? TAXONOMY_SERVING_DEFAULT_LIMIT : input.limit;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > TAXONOMY_SERVING_MAX_LIMIT
  ) {
    throw new TaxonomyServingError(
      'TAXONOMY_QUERY_INVALID',
      `limit must be an integer from 1 through ${TAXONOMY_SERVING_MAX_LIMIT}`
    );
  }

  const includeReview = input.includeReview === undefined ? true : input.includeReview;
  if (typeof includeReview !== 'boolean') {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', 'includeReview must be boolean');
  }
  if (!query && !categoryId) {
    throw new TaxonomyServingError('TAXONOMY_QUERY_INVALID', 'query or categoryId is required');
  }

  return { query, categoryId, limit, includeReview };
}

function projectionCounts(manifest: TaxonomyProjectionManifest): TaxonomyServingProjectionCounts {
  return {
    candidateCategoryCount: manifest.counts.candidateCategoryCount,
    approvedCategoryCount: manifest.counts.approvedBaseCategoryCount,
    familyCount: manifest.counts.familyCount,
    variantCount: manifest.counts.variantCount,
    offerCount: manifest.counts.offerCount,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertProjectionEvidence(
  catalog: CanonicalCatalog,
  report: TaxonomyReviewReport,
  manifest: TaxonomyProjectionManifest
): void {
  const expected = buildTaxonomyProjection(catalog, report).manifest;
  const compatible =
    manifest.projectionVersion === TAXONOMY_PROJECTION_VERSION &&
    manifest.catalogSnapshotId === catalog.manifest.snapshotId &&
    manifest.taxonomyRuleVersion === report.ruleVersion &&
    manifest.reviewReportVersion === report.reportVersion &&
    manifest.status === TAXONOMY_PROJECTION_STATUS &&
    manifest.activated === false &&
    manifest.promotionPolicy === TAXONOMY_PROJECTION_PROMOTION_POLICY &&
    sameJson(manifest.counts, expected.counts) &&
    sameJson(manifest.taxonomyStatusCounts, expected.taxonomyStatusCounts) &&
    sameJson(manifest.mergeReviewByTaxonomyStatus, expected.mergeReviewByTaxonomyStatus) &&
    manifest.vector.status === 'not_built';

  if (!compatible) {
    throw new TaxonomyServingError(
      'TAXONOMY_PROJECTION_UNAVAILABLE',
      'projection manifest is missing, drifted, or not explicitly non-active'
    );
  }
}

function matchStatus(record: TaxonomyReviewReport['families'][number]): string {
  return record.assignment.status;
}

function isVisible(
  record: TaxonomyReviewReport['families'][number],
  includeReview: boolean
): boolean {
  return includeReview || matchStatus(record) === 'auto' || matchStatus(record) === 'approved';
}

function queryTerms(query: string): string[] {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function matchesText(
  family: CanonicalCatalog['families'][number],
  record: TaxonomyReviewReport['families'][number],
  query: string
): boolean {
  const haystack = [
    family.normalizedName,
    family.name,
    family.englishName || '',
    family.sourceCodes.join(' '),
    record.assignment.categoryIds.join(' '),
  ]
    .join(' ')
    .toLowerCase();
  return queryTerms(query).every((term) => {
    const categoryId = queryCategoryAlias(term);
    return categoryId ? record.assignment.categoryIds.includes(categoryId) : haystack.includes(term);
  });
}

function matchesExactCode(
  family: CanonicalCatalog['families'][number],
  query: string | null
): boolean {
  if (!query) return false;
  const normalized = query.toUpperCase();
  return family.sourceCodes.some((sourceCode) => sourceCode.toUpperCase() === normalized);
}

function buildResult(
  family: CanonicalCatalog['families'][number],
  record: TaxonomyReviewReport['families'][number],
  offersById: Map<string, CanonicalCatalog['offers'][number]>,
  productsByOfferId: Map<string, CanonicalCatalog['products'][number]>,
  matchType: TaxonomyServingResult['matchType']
): TaxonomyServingResult {
  const offers = record.offerIds
    .map((offerId) => offersById.get(offerId))
    .filter((offer): offer is CanonicalCatalog['offers'][number] => Boolean(offer))
    .sort((left, right) => compareStable(left.offerId, right.offerId))
    .map((offer) => {
      const product = productsByOfferId.get(offer.offerId);
      return {
        offerId: offer.offerId,
        sourceCode: offer.sourceCode,
        sourceRefs: [...offer.sourceRefs],
        sourceRowCount: product?.sourceRowCount ?? offer.sourceRowCount,
        duplicateSourceRows: product?.duplicateSourceRows ?? offer.duplicateSourceRows,
      };
    });
  const componentCount = record.assignment.components.length;
  return {
    matchType,
    familyId: family.familyId,
    name: family.name,
    englishName: family.englishName,
    sourceCodes: [...family.sourceCodes],
    variantIds: [...family.variantIds],
    offerIds: [...family.offerIds],
    sourceRefs: [...family.sourceRefs],
    mergeStatus: family.mergeStatus,
    taxonomyStatus: record.assignment.status,
    candidateCategoryIds: [...record.assignment.categoryIds],
    componentSignature: record.assignment.componentSignature,
    componentCount,
    isBundle: componentCount >= 2,
    reviewReasons: [...record.assignment.reviewReasons],
    offers,
  };
}

function countMatches(
  matches: Array<{ family: CanonicalCatalog['families'][number]; record: TaxonomyReviewReport['families'][number] }>
): {
  familyCount: number;
  bundleFamilyCount: number;
  variantCount: number;
  offerCount: number;
  taxonomyStatusCounts: TaxonomyServingMatchCounts['taxonomyStatusCounts'];
  mergeReviewByTaxonomyStatus: TaxonomyServingMatchCounts['mergeReviewByTaxonomyStatus'];
} {
  const taxonomyStatusCounts = { auto: 0, review_required: 0, unclassified: 0 };
  const mergeReviewByTaxonomyStatus = { auto: 0, review_required: 0, unclassified: 0 };
  let bundleFamilyCount = 0;
  let variantCount = 0;
  let offerCount = 0;

  for (const { family, record } of matches) {
    const status = matchStatus(record) as keyof typeof taxonomyStatusCounts;
    if (status in taxonomyStatusCounts) taxonomyStatusCounts[status] += 1;
    if (family.mergeStatus === 'review_required') {
      if (status in mergeReviewByTaxonomyStatus) mergeReviewByTaxonomyStatus[status] += 1;
    }
    if (record.assignment.components.length >= 2) bundleFamilyCount += 1;
    variantCount += family.variantIds.length;
    offerCount += family.offerIds.length;
  }

  return {
    familyCount: matches.length,
    bundleFamilyCount,
    variantCount,
    offerCount,
    taxonomyStatusCounts,
    mergeReviewByTaxonomyStatus,
  };
}

export function serveTaxonomyPreview(
  catalog: CanonicalCatalog,
  report: TaxonomyReviewReport,
  manifest: TaxonomyProjectionManifest,
  input: TaxonomyServingQueryInput
): TaxonomyServingResponse {
  assertProjectionEvidence(catalog, report, manifest);
  const query = normalizeTaxonomyServingQuery(input);
  const recordsByFamilyId = new Map(report.families.map((record) => [record.familyId, record]));
  const matches: Array<{
    family: CanonicalCatalog['families'][number];
    record: TaxonomyReviewReport['families'][number];
    exactCode: boolean;
  }> = [];

  for (const family of catalog.families) {
    const record = recordsByFamilyId.get(family.familyId);
    if (!record || !isVisible(record, query.includeReview)) continue;
    if (query.categoryId && !record.assignment.categoryIds.includes(query.categoryId)) continue;
    if (query.query && !matchesText(family, record, query.query)) continue;
    matches.push({ family, record, exactCode: matchesExactCode(family, query.query) });
  }

  matches.sort((left, right) => {
    if (left.exactCode !== right.exactCode) return left.exactCode ? -1 : 1;
    return compareStable(left.family.familyId, right.family.familyId);
  });

  const fullCounts = countMatches(matches);
  const returnedMatches = matches.slice(0, query.limit);
  const returnedCounts = countMatches(returnedMatches);
  const offersById = new Map(catalog.offers.map((offer) => [offer.offerId, offer]));
  const productsByOfferId = new Map(catalog.products.map((product) => [product.offerId, product]));

  return {
    servingVersion: TAXONOMY_SERVING_VERSION,
    queryAliasVersion: TAXONOMY_QUERY_ALIAS_VERSION,
    mode: TAXONOMY_SERVING_MODE,
    authority: TAXONOMY_SERVING_AUTHORITY,
    projectionStatus: TAXONOMY_PROJECTION_STATUS,
    activated: false,
    promotionPolicy: TAXONOMY_PROJECTION_PROMOTION_POLICY,
    vectorStatus: 'not_built',
    snapshotId: catalog.manifest.snapshotId,
    asOf: catalog.manifest.generatedAt,
    taxonomyRuleVersion: report.ruleVersion,
    reportVersion: report.reportVersion,
    projectionVersion: TAXONOMY_PROJECTION_VERSION,
    sourceLineage: report.sourceLineage.map(({ role, sha256, recordCount, uniqueCodeCount }) => ({
      role,
      sha256,
      recordCount,
      uniqueCodeCount,
    })),
    query,
    projectionCounts: projectionCounts(manifest),
    matchCounts: {
      matchedFamilyCount: fullCounts.familyCount,
      returnedFamilyCount: returnedCounts.familyCount,
      matchedBundleFamilyCount: fullCounts.bundleFamilyCount,
      returnedBundleFamilyCount: returnedCounts.bundleFamilyCount,
      matchedVariantCount: fullCounts.variantCount,
      returnedVariantCount: returnedCounts.variantCount,
      matchedOfferCount: fullCounts.offerCount,
      returnedOfferCount: returnedCounts.offerCount,
      taxonomyStatusCounts: fullCounts.taxonomyStatusCounts,
      mergeReviewByTaxonomyStatus: fullCounts.mergeReviewByTaxonomyStatus,
    },
    results: returnedMatches.map(({ family, record, exactCode }) =>
      buildResult(
        family,
        record,
        offersById,
        productsByOfferId,
        exactCode ? 'exact_code' : query.categoryId && !query.query ? 'category' : 'text'
      )
    ),
  };
}

export function resolveTaxonomyServingSourceOptions(
  options: TaxonomyServingSourceOptions = {}
): Required<Pick<TaxonomyServingSourceOptions, 'projectionStorePath'>> & TaxonomyServingSourceOptions {
  const workspacePricingPath = path.resolve('../smartgift-pricing/public/catalog/giftset.json');
  const projectionStorePath =
    options.projectionStorePath ||
    process.env.GENESIS_TAXONOMY_PROJECTION_STORE_PATH ||
    path.resolve('./data/genesis_smartgift_store_taxonomy_v3');
  return {
    ...options,
    semanticPath:
      options.semanticPath || process.env.SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH || undefined,
    pricingPath:
      options.pricingPath ||
      process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
      (fs.existsSync(workspacePricingPath) ? workspacePricingPath : undefined),
    projectionStorePath,
    projectionManifestPath:
      options.projectionManifestPath || path.join(projectionStorePath, 'taxonomy-manifest.json'),
  };
}

export function loadTaxonomyServingContext(
  options: TaxonomyServingSourceOptions = {}
): TaxonomyServingContext {
  const resolved = resolveTaxonomyServingSourceOptions(options);
  let catalog: CanonicalCatalog;
  try {
    catalog = buildCanonicalCatalog({
      semanticPath: resolved.semanticPath,
      pricingPath: resolved.pricingPath,
    });
  } catch (error) {
    throw new TaxonomyServingError(
      'TAXONOMY_PROJECTION_UNAVAILABLE',
      `canonical catalog unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }

  let manifest: TaxonomyProjectionManifest | null;
  try {
    manifest = readTaxonomyProjectionManifest(resolved.projectionManifestPath!);
  } catch (error) {
    throw new TaxonomyServingError(
      'TAXONOMY_PROJECTION_UNAVAILABLE',
      `projection manifest unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
  if (!manifest) {
    throw new TaxonomyServingError(
      'TAXONOMY_PROJECTION_UNAVAILABLE',
      'taxonomy projection manifest does not exist'
    );
  }

  const report = buildTaxonomyReviewReport(catalog);
  assertProjectionEvidence(catalog, report, manifest);
  return { catalog, report, projectionManifest: manifest };
}
