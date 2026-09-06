import fs from 'fs';
import path from 'path';
import {
  buildCanonicalCatalog,
  buildGenesisGraphBatch,
  decideCatalogIngest,
  readCatalogManifest,
  writeCatalogManifest,
} from './catalog-manifest.js';
import type {
  CanonicalCatalog,
  CatalogIngestDecision,
} from './catalog-manifest.js';
import {
  readTaxonomyProjectionManifest,
} from './taxonomy-projection-store.js';
import {
  buildTaxonomyReviewReport,
} from './taxonomy-report.js';
import {
  serveTaxonomyPreview,
  TaxonomyServingError,
  type TaxonomyServingQueryInput,
  type TaxonomyServingResponse,
} from './taxonomy-serving.js';
import { tryLoadGenesisDatabase, GENESIS_PACKAGE } from './v4/genesis-binding.js';

// @req RAG-OPS-001 — the readiness and single-owner guard: this is the only opener of the store,
//   and it refuses work until the canonical catalog is ready. Both halves are tested — the
//   refusals in tests/unit/genesis-readiness.test.ts, which need no engine because deciding not to
//   open happens before anything is opened, and the ingest and the lock in
//   tests/integration/genesis-ingest.test.ts, which run against a temporary store wherever the
//   native binding is installed and are skipped, loudly, where it is not.

// Load the GenesisBlock native binding. Resolution (npm package first, then GENESIS_NATIVE_MODULE,
// then the legacy absolute G: path) lives in one place so this module and the v4 pipeline cannot
// disagree about which engine they are talking to.
const GenesisDatabase: any = tryLoadGenesisDatabase();
if (!GenesisDatabase) {
  console.warn(
    `[GenesisRAG] GenesisBlock native module unavailable; native catalog features are disabled. ` +
      `Fix: npm install ${GENESIS_PACKAGE}`,
  );
}

export interface GenesisNativeOptions {
  storePath?: string;
  catalogJsonPath?: string;
  pricingCatalogJsonPath?: string;
  manifestPath?: string;
  taxonomyProjectionStorePath?: string;
}

export class GenesisNativeCatalog {
  private db: any = null;
  private isInitialized = false;
  private initializationError: string | null = null;
  private catalog: CanonicalCatalog | null = null;
  private ingestDecision: CatalogIngestDecision | null = null;
  private initializationPromise: Promise<boolean> | null = null;

  constructor(private options: GenesisNativeOptions = {}) {
    this.options.storePath = options.storePath || process.env.GENESIS_STORE_PATH || path.resolve('./data/genesis_smartgift_store_family_v2');
    this.options.catalogJsonPath = options.catalogJsonPath || process.env.SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH || undefined;
    const workspacePricingPath = path.resolve('../smartgift-pricing/public/catalog/giftset.json');
    this.options.pricingCatalogJsonPath =
      options.pricingCatalogJsonPath ||
      process.env.SMARTGIFT_PRICING_CATALOG_JSON_PATH ||
      (fs.existsSync(workspacePricingPath) ? workspacePricingPath : undefined);
    this.options.manifestPath =
      options.manifestPath || path.join(this.options.storePath!, 'catalog-manifest.json');
    this.options.taxonomyProjectionStorePath =
      options.taxonomyProjectionStorePath ||
      process.env.GENESIS_TAXONOMY_PROJECTION_STORE_PATH ||
      path.resolve('./data/genesis_smartgift_store_taxonomy_v3');
  }

  async init(): Promise<boolean> {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.initialize();
    return this.initializationPromise;
  }

  private async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;
    if (this.initializationError) return false;
    if (!GenesisDatabase) {
      this.initializationError = 'GENESIS_NATIVE_BINDING_UNAVAILABLE';
      console.warn('[GenesisRAG] GenesisDatabase class is not available.');
      return false;
    }

    let catalog: CanonicalCatalog;
    try {
      catalog = buildCanonicalCatalog({
        semanticPath: this.options.catalogJsonPath,
        pricingPath: this.options.pricingCatalogJsonPath,
      });
    } catch (err) {
      this.initializationError = 'CATALOG_SNAPSHOT_INVALID';
      console.error('[GenesisRAG] Catalog snapshot error:', err);
      return false;
    }

    if (this.options.pricingCatalogJsonPath && !fs.existsSync(this.options.pricingCatalogJsonPath)) {
      console.warn(`[GenesisRAG] Optional pricing catalog not found: ${this.options.pricingCatalogJsonPath}`);
    }

    let decision: CatalogIngestDecision;
    try {
      const existingManifest = readCatalogManifest(this.options.manifestPath!);
      decision = decideCatalogIngest(
        this.options.storePath!,
        existingManifest,
        catalog.manifest.snapshotId
      );
    } catch (err) {
      this.initializationError = 'CATALOG_MANIFEST_INVALID';
      console.error('[GenesisRAG] Catalog manifest error:', err);
      return false;
    }

    if (decision === 'snapshot_changed') {
      this.initializationError = 'CATALOG_SNAPSHOT_CHANGED_REQUIRES_REFRESH';
      console.error(
        `[GenesisRAG] Catalog snapshot changed for ${this.options.storePath}; refusing automatic refresh.`
      );
      return false;
    }

    try {
      fs.mkdirSync(this.options.storePath!, { recursive: true });
      this.db = GenesisDatabase.open({
        path: this.options.storePath!,
        vectorDim: 384,
        retention: 'frontier_only',
      });

      console.log(`[GenesisRAG] 🚀 GenesisBlock Graph Database opened at: ${this.options.storePath}`);
      this.ingestDecision = decision;

      if (decision === 'ingest_empty_store') {
        const batch = buildGenesisGraphBatch(catalog);
        await this.db.bulkAddNodes(batch.nodes);
        await this.db.bulkAddEdges(batch.edges);
        await this.db.saveState();
        writeCatalogManifest(this.options.manifestPath!, catalog.manifest);
        console.log(
          `[GenesisRAG] ✅ Ingested ${catalog.manifest.familyCount} product families, ${catalog.manifest.offerCount} offers and recorded snapshot ${catalog.manifest.snapshotId.slice(0, 12)}.`
        );
      } else if (decision === 'skip_same_snapshot') {
        console.log(`[GenesisRAG] ℹ️ Catalog snapshot unchanged; skipped ingest.`);
      } else if (decision === 'legacy_unmanifested') {
        console.warn(
          `[GenesisRAG] Existing store has data but no catalog manifest; skipped automatic re-ingest.`
        );
      }

      this.catalog = catalog;
      this.isInitialized = true;
      return true;
    } catch (err: any) {
      this.db = null;
      if (err?.message?.includes('already open')) {
        this.initializationError = 'GENESIS_STORE_ALREADY_OPEN';
        console.error(`[GenesisRAG] Store is already active in another process; readiness is false.`);
        return false;
      }
      this.initializationError = 'GENESIS_DATABASE_INIT_FAILED';
      console.error('[GenesisRAG] Error initializing GenesisDatabase:', err);
      return false;
    }
  }

  async searchProducts(query: string, limit: number = 5): Promise<any[]> {
    if (this.catalog) {
      const qTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
      return this.catalog.families
        .filter((family) => {
          const haystack = [
            family.normalizedName,
            family.name,
            family.englishName || '',
            family.sourceCodes.join(' '),
            family.category || '',
          ]
            .join(' ')
            .toLowerCase();
          return qTerms.some((term) => haystack.includes(term));
        })
        .slice(0, limit)
        .map((family) => ({
          familyId: family.familyId,
          code: family.sourceCodes.length === 1 ? family.sourceCodes[0] : null,
          sourceCodes: family.sourceCodes,
          name: family.name,
          englishName: family.englishName,
          category: family.category,
          branding: family.branding,
          mergeStatus: family.mergeStatus,
          variantCount: family.variantIds.length,
          offerCount: family.offerIds.length,
          offers: family.offerIds
            .map((offerId) => this.catalog?.products.find((product) => product.offerId === offerId))
            .filter(Boolean)
            .map((offer) => ({
              code: offer!.code,
              rmb: offer!.rmb,
              upc: offer!.upc,
              dims: offer!.dims,
              kg: offer!.kg,
              e: offer!.e,
              img: offer!.img,
              sourceRowCount: offer!.sourceRowCount,
              duplicateSourceRows: offer!.duplicateSourceRows,
            })),
        }));
    }

    const ragServiceUrl = process.env.GENESIS_RAG_API_URL || 'http://localhost:8888';
    try {
      const response = await fetch(`${ragServiceUrl}/api/rag/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
      });
      if (response.ok) {
        const data: any = await response.json();
        if (data && data.success && Array.isArray(data.results)) return data.results.slice(0, limit);
      }
    } catch {}
    return [];
  }

  async previewTaxonomy(input: TaxonomyServingQueryInput): Promise<TaxonomyServingResponse> {
    const ready = await this.init();
    if (!ready || !this.catalog) {
      throw new TaxonomyServingError(
        'TAXONOMY_PROJECTION_UNAVAILABLE',
        this.initializationError || 'canonical catalog is not ready'
      );
    }

    const manifestPath = path.join(
      this.options.taxonomyProjectionStorePath!,
      'taxonomy-manifest.json'
    );
    let manifest;
    try {
      manifest = readTaxonomyProjectionManifest(manifestPath);
    } catch (error) {
      throw new TaxonomyServingError(
        'TAXONOMY_PROJECTION_UNAVAILABLE',
        error instanceof Error ? error.message : 'taxonomy projection manifest is invalid'
      );
    }
    if (!manifest) {
      throw new TaxonomyServingError(
        'TAXONOMY_PROJECTION_UNAVAILABLE',
        'taxonomy projection manifest does not exist'
      );
    }

    return serveTaxonomyPreview(
      this.catalog,
      buildTaxonomyReviewReport(this.catalog),
      manifest,
      input
    );
  }

  getTaxonomyProjectionStatus(): {
    available: boolean;
    status: 'proposed' | 'unavailable';
    activated: false;
    snapshotId: string | null;
    projectionVersion: string | null;
    reason: string | null;
  } {
    const manifestPath = path.join(
      this.options.taxonomyProjectionStorePath!,
      'taxonomy-manifest.json'
    );
    try {
      const manifest = readTaxonomyProjectionManifest(manifestPath);
      if (!manifest) {
        return {
          available: false,
          status: 'unavailable',
          activated: false,
          snapshotId: null,
          projectionVersion: null,
          reason: 'taxonomy projection manifest does not exist',
        };
      }
      if (
        manifest.status !== 'proposed' ||
        manifest.promotionPolicy !== 'visible_no_promotion' ||
        manifest.vector.status !== 'not_built' ||
        (this.catalog && manifest.catalogSnapshotId !== this.catalog.manifest.snapshotId)
      ) {
        return {
          available: false,
          status: 'unavailable',
          activated: false,
          snapshotId: manifest.catalogSnapshotId,
          projectionVersion: manifest.projectionVersion,
          reason: 'taxonomy projection is drifted or not explicitly non-active',
        };
      }
      return {
        available: true,
        status: 'proposed',
        activated: false,
        snapshotId: manifest.catalogSnapshotId,
        projectionVersion: manifest.projectionVersion,
        reason: null,
      };
    } catch (error) {
      return {
        available: false,
        status: 'unavailable',
        activated: false,
        snapshotId: null,
        projectionVersion: null,
        reason: error instanceof Error ? error.message : 'taxonomy projection manifest is invalid',
      };
    }
  }

  async getGraphData(): Promise<{ nodes: any[]; edges: any[] }> {
    if (!this.catalog) return { nodes: [], edges: [] };
    const batch = buildGenesisGraphBatch(this.catalog);
    return {
      nodes: batch.nodes.map((node) => ({
        id: node.id,
        label: node.labels[0],
        labels: node.labels,
        name: String(node.props.name || node.props.sourceCode || node.id),
        status: 'canonical',
        props: node.props,
      })),
      edges: batch.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: edge.rel,
      })),
    };
  }

  getCatalogStatus(): {
    initialized: boolean;
    initializationError: string | null;
    ingestDecision: CatalogIngestDecision | null;
    snapshotId: string | null;
    productCount: number;
    familyCount: number;
    offerCount: number;
    reviewFamilyCount: number;
    vectorStatus: 'not_built' | 'unknown';
  } {
    const vectorStatus =
      this.ingestDecision === 'legacy_unmanifested'
        ? 'unknown'
        : this.catalog
          ? this.catalog.manifest.vector.status
          : 'unknown';
    return {
      initialized: this.isInitialized,
      initializationError: this.initializationError,
      ingestDecision: this.ingestDecision,
      snapshotId: this.catalog?.manifest.snapshotId || null,
      productCount: this.catalog?.manifest.productCount || 0,
      familyCount: this.catalog?.manifest.familyCount || 0,
      offerCount: this.catalog?.manifest.offerCount || 0,
      reviewFamilyCount: this.catalog?.manifest.reviewFamilyCount || 0,
      vectorStatus,
    };
  }
}
