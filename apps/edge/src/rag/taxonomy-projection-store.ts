import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import type { CanonicalCatalog } from './catalog-manifest.js';
import {
  buildTaxonomyProjection,
  TAXONOMY_PROJECTION_VERSION,
  type TaxonomyProjectionBatch,
  type TaxonomyProjectionManifest,
} from './taxonomy-projection.js';
import type { TaxonomyReviewReport } from './taxonomy-report.js';

// @req TAX-NFR-002 — no silent overwrite — a changed snapshot is refused rather than merged, so rollback stays an explicit act.

export type TaxonomyProjectionIngestDecision =
  | 'ingest_empty_store'
  | 'skip_same_snapshot'
  | 'legacy_unmanifested'
  | 'snapshot_changed';

export interface MaterializeTaxonomyProjectionOptions {
  catalog: CanonicalCatalog;
  report?: TaxonomyReviewReport;
  storePath: string;
}

export interface MaterializeTaxonomyProjectionResult {
  decision: TaxonomyProjectionIngestDecision;
  batch: TaxonomyProjectionBatch;
  manifest: TaxonomyProjectionManifest;
}

function materializedStoreHasData(storePath: string): boolean {
  return ['nodes.bin', 'edges.bin'].some((name) => {
    const item = fs.statSync(path.join(storePath, name), { throwIfNoEntry: false });
    return Boolean(item && item.size > 0);
  });
}

export function readTaxonomyProjectionManifest(
  manifestPath: string
): TaxonomyProjectionManifest | null {
  if (!fs.existsSync(manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<TaxonomyProjectionManifest>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.projectionVersion !== TAXONOMY_PROJECTION_VERSION ||
    typeof parsed.catalogSnapshotId !== 'string' ||
    parsed.activated !== false
  ) {
    throw new Error(`Unsupported taxonomy projection manifest: ${manifestPath}`);
  }
  return parsed as TaxonomyProjectionManifest;
}

export function writeTaxonomyProjectionManifest(
  manifestPath: string,
  manifest: TaxonomyProjectionManifest
): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  fs.renameSync(tempPath, manifestPath);
}

export function decideTaxonomyProjectionIngest(
  storePath: string,
  existingManifest: TaxonomyProjectionManifest | null,
  snapshotId: string
): TaxonomyProjectionIngestDecision {
  if (existingManifest) {
    return existingManifest.catalogSnapshotId === snapshotId
      ? 'skip_same_snapshot'
      : 'snapshot_changed';
  }
  return materializedStoreHasData(storePath) ? 'legacy_unmanifested' : 'ingest_empty_store';
}

function loadGenesisDatabase(): any {
  const require = createRequire(import.meta.url);
  const nativeAddonPath = 'G:/GenesisBlock_Dev/GenesisBlock/index.win32-x64-msvc.node';
  try {
    const nativeModule = fs.existsSync(nativeAddonPath)
      ? require(path.resolve(nativeAddonPath))
      : require('G:/GenesisBlock_Dev/GenesisBlock/index.js');
    if (!nativeModule?.GenesisDatabase) {
      throw new Error('GenesisDatabase export is unavailable');
    }
    return nativeModule.GenesisDatabase;
  } catch (error) {
    throw new Error(
      `GenesisBlock native binding unavailable: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

async function closeDatabase(db: any): Promise<void> {
  const close = db && (typeof db.close === 'function' ? db.close : db.shutdown);
  if (typeof close === 'function') await close.call(db);
}

export async function materializeTaxonomyProjection(
  options: MaterializeTaxonomyProjectionOptions
): Promise<MaterializeTaxonomyProjectionResult> {
  const storePath = path.resolve(options.storePath);
  const manifestPath = path.join(storePath, 'taxonomy-manifest.json');
  const batch = buildTaxonomyProjection(options.catalog, options.report);
  const existingManifest = readTaxonomyProjectionManifest(manifestPath);
  const decision = decideTaxonomyProjectionIngest(
    storePath,
    existingManifest,
    batch.manifest.catalogSnapshotId
  );

  if (decision === 'snapshot_changed') {
    throw new Error(`Taxonomy projection snapshot changed; refusing refresh: ${storePath}`);
  }
  if (decision === 'legacy_unmanifested') {
    throw new Error(`Taxonomy projection store has data without a manifest: ${storePath}`);
  }
  if (decision === 'skip_same_snapshot') {
    return {
      decision,
      batch,
      manifest: existingManifest as TaxonomyProjectionManifest,
    };
  }

  const GenesisDatabase = loadGenesisDatabase();
  fs.mkdirSync(storePath, { recursive: true });
  let db: any = null;
  try {
    db = GenesisDatabase.open({
      path: storePath,
      vectorDim: 384,
      retention: 'frontier_only',
    });
    await db.bulkAddNodes(batch.nodes);
    await db.bulkAddEdges(batch.edges);
    await db.saveState();
    writeTaxonomyProjectionManifest(manifestPath, batch.manifest);
    return { decision, batch, manifest: batch.manifest };
  } finally {
    await closeDatabase(db);
  }
}
