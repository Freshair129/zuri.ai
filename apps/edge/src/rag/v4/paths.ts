// Single source of truth for every filesystem location the v4 catalog pipeline touches.
//
// Before this module the pipeline hardcoded one developer's machine — `D:/workspace/...` for
// inputs and `G:/GenesisBlock_Dev/...` for the engine — so a fresh checkout could not ingest at
// all. Every path is now env-overridable with a repo-relative default, and `repoRoot` is derived
// from this module's own URL so it resolves identically from `src/` (tsx) and `dist/` (built).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORY_MAP_FILE, TYPE_ALIASES_FILE } from './config.js';

/** Repo root: this file lives at <root>/{src,dist}/rag/v4/paths.{ts,js}. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface PipelinePaths {
  /** Root for all large, generated, git-ignored pipeline data. */
  dataRoot: string;
  /** Upstream projection produced by the business-01-smart-gift data-pipeline. */
  upstream: string;
  /** Semantic catalog (JSON array of Catalog2026Item) — generated from `upstream`. */
  catalog: string;
  /** Owner-logic identity review consumed by build-graph — generated from `upstream`. */
  identity: string;
  /** FlowAccount product export (xlsx), the price source. */
  flowaccount: string;
  /** Hand-written config, versioned in git. */
  categoryMap: string;
  aliases: string;
  /** GenesisBlock store root; holds <runId>/ dirs plus the CURRENT pointer. */
  storeRoot: string;
  /** Optional price-PDF index; informational only, never forces a reingest. */
  pdfIndex: string;
}

const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

/**
 * Default upstream location: the sibling `business-01-smart-gift` checkout, whose
 * `data-pipeline/02_prepared/pricelist_master.json` is the canonical projection of the
 * smartgift SQL source (427 product masters / 32 families / 4 groups — verified to match
 * `src/rag/v4/config/*` exactly). Override with `SMARTGIFT_UPSTREAM_PRICELIST`.
 */
function defaultUpstream(): string {
  return path.join(
    path.dirname(REPO_ROOT),
    'business-01-smart-gift',
    'data-pipeline',
    '02_prepared',
    'pricelist_master.json',
  );
}

export function resolvePipelinePaths(overrides: Partial<PipelinePaths> = {}): PipelinePaths {
  const dataRoot = overrides.dataRoot ?? env('ZURI_DATA_ROOT') ?? path.join(REPO_ROOT, 'data');
  const sourceDir = path.join(dataRoot, 'source');
  return {
    dataRoot,
    upstream: overrides.upstream ?? env('SMARTGIFT_UPSTREAM_PRICELIST') ?? defaultUpstream(),
    catalog: overrides.catalog ?? env('SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH') ?? path.join(sourceDir, 'catalog-2026.json'),
    identity:
      overrides.identity ??
      env('GENESIS_USER_LOGIC_REVIEW_PATH') ??
      path.join(dataRoot, 'catalog_identity_review_user_logic_v1', 'identity-review.json'),
    flowaccount:
      overrides.flowaccount ??
      env('SMARTGIFT_FLOWACCOUNT_XLSX') ??
      path.join(sourceDir, 'flowaccount-product-2026-06-21.xlsx'),
    categoryMap: overrides.categoryMap ?? CATEGORY_MAP_FILE,
    aliases: overrides.aliases ?? TYPE_ALIASES_FILE,
    storeRoot:
      overrides.storeRoot ??
      env('GENESIS_SMARTGIFT_STORE_V4_ROOT') ??
      path.join(dataRoot, 'genesis_smartgift_store_v4'),
    pdfIndex: overrides.pdfIndex ?? env('SMARTGIFT_PRICE_PDF_INDEX') ?? path.join(sourceDir, 'price-pdf-index.json'),
  };
}
