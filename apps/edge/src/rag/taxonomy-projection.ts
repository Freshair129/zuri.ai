import type {
  CanonicalCatalog,
  CanonicalCatalogProduct,
  CatalogFamily,
  CatalogOffer,
  CatalogVariant,
  GenesisEdgeInput,
  GenesisNodeInput,
} from './catalog-manifest.js';
import {
  buildTaxonomyReviewReport,
  type TaxonomyReviewReport,
} from './taxonomy-report.js';

// @req TAX-FR-005 — the versioned side-by-side projection of category assignments.
// @req RAG-GR-004 — verifiable graph counts: offers, categories, nodes and edges are all exposed by the projection.

export const TAXONOMY_PROJECTION_SCHEMA_VERSION = 1 as const;
export const TAXONOMY_PROJECTION_VERSION = 'taxonomy-v3-projection-v1' as const;
export const TAXONOMY_PROJECTION_STATUS = 'proposed' as const;
export const TAXONOMY_PROJECTION_PROMOTION_POLICY = 'visible_no_promotion' as const;

interface TaxonomyProjectionCounts {
  candidateCategoryCount: number;
  approvedBaseCategoryCount: number;
  familyCount: number;
  variantCount: number;
  offerCount: number;
  candidateCategoryEdgeCount: number;
  approvedCategoryEdgeCount: number;
  nodeCount: number;
  edgeCount: number;
}

export interface TaxonomyProjectionManifest {
  schemaVersion: typeof TAXONOMY_PROJECTION_SCHEMA_VERSION;
  projectionVersion: typeof TAXONOMY_PROJECTION_VERSION;
  catalogSnapshotId: string;
  taxonomyRuleVersion: string;
  reviewReportVersion: string;
  status: typeof TAXONOMY_PROJECTION_STATUS;
  promotionPolicy: typeof TAXONOMY_PROJECTION_PROMOTION_POLICY;
  activated: false;
  sourceLineage: TaxonomyReviewReport['sourceLineage'];
  counts: TaxonomyProjectionCounts;
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
  vector: {
    status: 'not_built';
    dimension: null;
    count: 0;
  };
}

export interface TaxonomyProjectionBatch {
  nodes: GenesisNodeInput[];
  edges: GenesisEdgeInput[];
  manifest: TaxonomyProjectionManifest;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function categoryNodeId(categoryId: string): string {
  return `TAXCAT_${categoryId.toUpperCase()}`;
}

function taxonomyEdgeProps(
  taxonomyStatus: string,
  report: TaxonomyReviewReport
): Record<string, unknown> {
  return {
    taxonomyStatus,
    ruleVersion: report.ruleVersion,
    reportVersion: report.reportVersion,
    snapshotId: report.snapshotId,
  };
}

function familyRecordMap(report: TaxonomyReviewReport): Map<string, TaxonomyReviewReport['families'][number]> {
  return new Map(report.families.map((record) => [record.familyId, record]));
}

function addFamilyNode(
  nodes: GenesisNodeInput[],
  family: CatalogFamily,
  record: TaxonomyReviewReport['families'][number],
  report: TaxonomyReviewReport
): void {
  nodes.push({
    id: family.familyId,
    labels: ['ProductFamily', 'Product'],
    props: {
      ...family,
      source: 'SmartGift Taxonomy Projection',
      catalogVersion: report.snapshotId,
      taxonomyProjectionVersion: TAXONOMY_PROJECTION_VERSION,
      taxonomyStatus: record.assignment.status,
      candidateCategoryIds: [...record.assignment.categoryIds],
      componentSignature: record.assignment.componentSignature,
      reviewReasons: [...record.assignment.reviewReasons],
      taxonomyRuleVersion: report.ruleVersion,
      taxonomyReportVersion: report.reportVersion,
      taxonomyPromotion: 'not_promoted',
    },
  });
}

function addVariantNode(
  nodes: GenesisNodeInput[],
  variant: CatalogVariant,
  report: TaxonomyReviewReport
): void {
  nodes.push({
    id: variant.variantId,
    labels: ['ProductVariant', 'Variant'],
    props: {
      ...variant,
      catalogVersion: report.snapshotId,
      taxonomyProjectionVersion: TAXONOMY_PROJECTION_VERSION,
    },
  });
}

function addOfferNode(
  nodes: GenesisNodeInput[],
  offer: CatalogOffer,
  product: CanonicalCatalogProduct | undefined,
  report: TaxonomyReviewReport
): void {
  nodes.push({
    id: offer.offerId,
    labels: ['CatalogOffer', 'Offer'],
    props: {
      ...(product || {}),
      offerId: offer.offerId,
      sourceCode: offer.sourceCode,
      sourceRefs: offer.sourceRefs,
      sourceRowCount: offer.sourceRowCount,
      duplicateSourceRows: offer.duplicateSourceRows,
      source: 'SmartGift Catalog Offer',
      catalogVersion: report.snapshotId,
      taxonomyProjectionVersion: TAXONOMY_PROJECTION_VERSION,
    },
  });
}

function addIdentityEdges(
  edges: GenesisEdgeInput[],
  family: CatalogFamily,
  variant: CatalogVariant,
  report: TaxonomyReviewReport
): void {
  edges.push({
    id: `${family.familyId}__HAS_VARIANT__${variant.variantId}`,
    from: family.familyId,
    to: variant.variantId,
    rel: 'HAS_VARIANT',
    props: {
      catalogVersion: report.snapshotId,
      taxonomyProjectionVersion: TAXONOMY_PROJECTION_VERSION,
    },
  });
  for (const offerId of [...variant.offerIds].sort(compareStable)) {
    edges.push({
      id: `${variant.variantId}__HAS_OFFER__${offerId}`,
      from: variant.variantId,
      to: offerId,
      rel: 'HAS_OFFER',
      props: {
        catalogVersion: report.snapshotId,
        taxonomyProjectionVersion: TAXONOMY_PROJECTION_VERSION,
      },
    });
  }
}

function addCategoryNodes(
  nodes: GenesisNodeInput[],
  categoryIds: string[],
  report: TaxonomyReviewReport
): void {
  for (const categoryId of [...categoryIds].sort(compareStable)) {
    nodes.push({
      id: categoryNodeId(categoryId),
      labels: ['Category'],
      props: {
        categoryId,
        name: categoryId,
        status: 'candidate',
        taxonomyVersion: report.ruleVersion,
        catalogVersion: report.snapshotId,
        reviewReportVersion: report.reportVersion,
        promotion: 'not_promoted',
      },
    });
  }
}

function addTaxonomyEdges(
  edges: GenesisEdgeInput[],
  record: TaxonomyReviewReport['families'][number],
  report: TaxonomyReviewReport
): void {
  if (record.assignment.status === 'unclassified') return;
  const relation = 'CANDIDATE_CATEGORY';
  for (const categoryId of [...record.assignment.categoryIds].sort(compareStable)) {
    const target = categoryNodeId(categoryId);
    edges.push({
      id: `${record.familyId}__${relation}__${target}`,
      from: record.familyId,
      to: target,
      rel: relation,
      props: taxonomyEdgeProps(record.assignment.status, report),
    });
  }
}

function buildCounts(
  report: TaxonomyReviewReport,
  nodes: GenesisNodeInput[],
  edges: GenesisEdgeInput[]
): TaxonomyProjectionCounts {
  return {
    candidateCategoryCount: report.counts.candidateBaseCategoryCount,
    approvedBaseCategoryCount: 0,
    familyCount: report.counts.productFamilyCount,
    variantCount: report.counts.variantCount,
    offerCount: report.counts.offerCount,
    candidateCategoryEdgeCount: edges.filter((edge) => edge.rel === 'CANDIDATE_CATEGORY').length,
    approvedCategoryEdgeCount: edges.filter((edge) => edge.rel === 'BELONGS_TO_CATEGORY').length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

export function buildTaxonomyProjection(
  catalog: CanonicalCatalog,
  report: TaxonomyReviewReport = buildTaxonomyReviewReport(catalog)
): TaxonomyProjectionBatch {
  if (report.snapshotId !== catalog.manifest.snapshotId) {
    throw new Error('Taxonomy report snapshot does not match the canonical catalog');
  }

  const records = familyRecordMap(report);
  const nodes: GenesisNodeInput[] = [];
  const edges: GenesisEdgeInput[] = [];
  const variantById = new Map(catalog.variants.map((variant) => [variant.variantId, variant]));
  const offerById = new Map(catalog.offers.map((offer) => [offer.offerId, offer]));
  const productByOffer = new Map(catalog.products.map((product) => [product.offerId, product]));
  const categoryIds = new Set<string>();

  for (const record of report.families) {
    record.assignment.categoryIds.forEach((categoryId) => categoryIds.add(categoryId));
  }
  addCategoryNodes(nodes, [...categoryIds], report);

  for (const family of [...catalog.families].sort((left, right) => compareStable(left.familyId, right.familyId))) {
    const record = records.get(family.familyId);
    if (!record) throw new Error(`Taxonomy report is missing family: ${family.familyId}`);
    addFamilyNode(nodes, family, record, report);
    addTaxonomyEdges(edges, record, report);

    for (const variantId of [...family.variantIds].sort(compareStable)) {
      const variant = variantById.get(variantId);
      if (!variant) throw new Error(`Canonical catalog is missing variant: ${variantId}`);
      addVariantNode(nodes, variant, report);
      addIdentityEdges(edges, family, variant, report);
      for (const offerId of [...variant.offerIds].sort(compareStable)) {
        const offer = offerById.get(offerId);
        if (!offer) throw new Error(`Canonical catalog is missing offer: ${offerId}`);
        addOfferNode(nodes, offer, productByOffer.get(offerId), report);
      }
    }
  }

  const counts = buildCounts(report, nodes, edges);
  return {
    nodes,
    edges,
    manifest: {
      schemaVersion: TAXONOMY_PROJECTION_SCHEMA_VERSION,
      projectionVersion: TAXONOMY_PROJECTION_VERSION,
      catalogSnapshotId: report.snapshotId,
      taxonomyRuleVersion: report.ruleVersion,
      reviewReportVersion: report.reportVersion,
      status: TAXONOMY_PROJECTION_STATUS,
      promotionPolicy: TAXONOMY_PROJECTION_PROMOTION_POLICY,
      activated: false,
      sourceLineage: report.sourceLineage,
      counts,
      taxonomyStatusCounts: {
        auto: report.counts.taxonomyAutoFamilyCount,
        review_required: report.counts.taxonomyReviewRequiredFamilyCount,
        unclassified: report.counts.unclassifiedFamilyCount,
      },
      mergeReviewByTaxonomyStatus: report.counts.mergeReviewByTaxonomyStatus,
      vector: {
        status: 'not_built',
        dimension: null,
        count: 0,
      },
    },
  };
}
