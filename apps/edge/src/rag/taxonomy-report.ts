import type {
  CanonicalCatalog,
  CatalogFamily,
  CatalogSourceRole,
} from './catalog-manifest.js';
import {
  classifyTaxonomyName,
  TAXONOMY_RULE_VERSION,
  type TaxonomyClassification,
} from './taxonomy.js';

// @req TAX-FR-004 — the review report over current families, unmatched names and conflicting cases.

export const TAXONOMY_REPORT_VERSION = 'taxonomy-review-v1';
export const TAXONOMY_UNRESOLVED_POLICY = 'visible_no_promotion';

export interface TaxonomyReviewCounts {
  candidateBaseCategoryCount: number;
  approvedBaseCategoryCount: 0;
  productFamilyCount: number;
  bundleFamilyCount: number;
  variantCount: number;
  offerCount: number;
  mergeReviewFamilyCount: number;
  mergeReviewByTaxonomyStatus: {
    auto: number;
    review_required: number;
    unclassified: number;
  };
  taxonomyAutoFamilyCount: number;
  taxonomyReviewRequiredFamilyCount: number;
  unclassifiedFamilyCount: number;
  unexplainedAutoAssignmentCount: number;
}

export interface TaxonomyReviewSourceLineage {
  role: CatalogSourceRole;
  path: string;
  sha256: string;
  recordCount: number;
  uniqueCodeCount: number;
}

export interface TaxonomyFamilyReviewRecord {
  familyId: string;
  normalizedName: string;
  sourceCodes: string[];
  offerIds: string[];
  variantIds: string[];
  mergeStatus: CatalogFamily['mergeStatus'];
  assignment: TaxonomyClassification;
}

export interface TaxonomyReviewReport {
  reportVersion: typeof TAXONOMY_REPORT_VERSION;
  ruleVersion: typeof TAXONOMY_RULE_VERSION;
  status: 'proposed';
  unresolvedPolicy: typeof TAXONOMY_UNRESOLVED_POLICY;
  snapshotId: string;
  sourceLineage: TaxonomyReviewSourceLineage[];
  counts: TaxonomyReviewCounts;
  families: TaxonomyFamilyReviewRecord[];
}

export interface TaxonomyReviewSummary {
  reportVersion: typeof TAXONOMY_REPORT_VERSION;
  status: 'proposed';
  snapshotId: string;
  ruleVersion: typeof TAXONOMY_RULE_VERSION;
  counts: TaxonomyReviewCounts;
  categoryCounts: Record<string, number>;
  reviewReasonCounts: Record<string, number>;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function classifyFamily(family: CatalogFamily): TaxonomyFamilyReviewRecord {
  const sourceName = family.englishName || family.name;
  return {
    familyId: family.familyId,
    normalizedName: family.normalizedName,
    sourceCodes: [...family.sourceCodes],
    offerIds: [...family.offerIds],
    variantIds: [...family.variantIds],
    mergeStatus: family.mergeStatus,
    assignment: classifyTaxonomyName(sourceName),
  };
}

function hasExplainedAutoAssignment(record: TaxonomyFamilyReviewRecord): boolean {
  return (
    record.assignment.status !== 'auto' ||
    (record.assignment.categoryIds.length > 0 &&
      record.assignment.componentSignature !== null &&
      record.assignment.components.length > 0 &&
      record.assignment.components.every(
        (component) =>
          component.categoryId.length > 0 &&
          component.matchedAlias.length > 0 &&
          component.sourcePhrase.length > 0
      ))
  );
}

function countRecordCategories(
  records: TaxonomyFamilyReviewRecord[]
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const categoryId of record.assignment.categoryIds) {
      counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => compareStable(left[0], right[0]))
  );
}

function countReviewReasons(
  records: TaxonomyFamilyReviewRecord[]
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const reason of record.assignment.reviewReasons) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort((left, right) => compareStable(left[0], right[0]))
  );
}

function buildCounts(
  catalog: CanonicalCatalog,
  records: TaxonomyFamilyReviewRecord[]
): TaxonomyReviewCounts {
  const candidateCategories = new Set(
    records.flatMap((record) => record.assignment.categoryIds)
  );
  const unexplainedAutoAssignmentCount = records.filter(
    (record) => !hasExplainedAutoAssignment(record)
  ).length;
  const mergeReviewByTaxonomyStatus = {
    auto: 0,
    review_required: 0,
    unclassified: 0,
  };
  for (const record of records) {
    if (record.mergeStatus === 'review_required') {
      mergeReviewByTaxonomyStatus[record.assignment.status] += 1;
    }
  }

  return {
    candidateBaseCategoryCount: candidateCategories.size,
    approvedBaseCategoryCount: 0,
    productFamilyCount: catalog.families.length,
    bundleFamilyCount: records.filter(
      (record) => record.assignment.components.length >= 2
    ).length,
    variantCount: catalog.variants.length || catalog.manifest.variantCount,
    offerCount: catalog.offers.length || catalog.manifest.offerCount,
    mergeReviewFamilyCount: records.filter(
      (record) => record.mergeStatus === 'review_required'
    ).length,
    mergeReviewByTaxonomyStatus,
    taxonomyAutoFamilyCount: records.filter(
      (record) => record.assignment.status === 'auto'
    ).length,
    taxonomyReviewRequiredFamilyCount: records.filter(
      (record) => record.assignment.status === 'review_required'
    ).length,
    unclassifiedFamilyCount: records.filter(
      (record) => record.assignment.status === 'unclassified'
    ).length,
    unexplainedAutoAssignmentCount,
  };
}

export function buildTaxonomyReviewReport(
  catalog: CanonicalCatalog
): TaxonomyReviewReport {
  const families = [...catalog.families]
    .sort((left, right) => compareStable(left.familyId, right.familyId))
    .map(classifyFamily);

  return {
    reportVersion: TAXONOMY_REPORT_VERSION,
    ruleVersion: TAXONOMY_RULE_VERSION,
    status: 'proposed',
    unresolvedPolicy: TAXONOMY_UNRESOLVED_POLICY,
    snapshotId: catalog.manifest.snapshotId,
    sourceLineage: [...catalog.manifest.sources]
      .sort((left, right) => compareStable(left.role, right.role))
      .map((source) => ({
        role: source.role,
        path: source.path,
        sha256: source.sha256,
        recordCount: source.recordCount,
        uniqueCodeCount: source.uniqueCodeCount,
      })),
    counts: buildCounts(catalog, families),
    families,
  };
}

export function summarizeTaxonomyReviewReport(
  report: TaxonomyReviewReport
): TaxonomyReviewSummary {
  return {
    reportVersion: report.reportVersion,
    status: report.status,
    snapshotId: report.snapshotId,
    ruleVersion: report.ruleVersion,
    counts: report.counts,
    categoryCounts: countRecordCategories(report.families),
    reviewReasonCounts: countReviewReasons(report.families),
  };
}
