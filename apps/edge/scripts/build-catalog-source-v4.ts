// Stage 1 of the v4 catalog pipeline: turn the upstream SmartGift export into the two generated
// inputs `catalog:ingest-v4` reads, and stage the FlowAccount price export beside them.
//
//   pricelist_master.json  ->  data/source/catalog-2026.json
//                          ->  data/catalog_identity_review_user_logic_v1/identity-review.json
//   <flowaccount>.xlsx     ->  data/source/flowaccount-product-2026-06-21.xlsx
//
// This replaces the retired `identity:review` + `user-logic:review` chain, whose two leaf inputs
// (`../smartgift-pricing/public/catalog/giftset.json` and a file in one developer's Downloads)
// no longer exist. See src/rag/v4/upstream-projection.ts for the lineage evidence and the one
// known fidelity gap.
//
// Usage:
//   npm run catalog:source-v4                 # write the artifacts
//   npm run catalog:source-v4 -- --check      # verify only; exit 1 if they are missing/stale
import fs from 'node:fs';
import path from 'node:path';

import { resolvePipelinePaths } from '../src/rag/v4/paths.js';
import { projectUpstream, type UpstreamPricelistMaster } from '../src/rag/v4/upstream-projection.js';

const CHECK_ONLY = process.argv.includes('--check');

/** FlowAccount export candidates, in preference order, relative to the upstream repo root. */
const FLOWACCOUNT_CANDIDATES = [
  path.join('data-pipeline', '01_raw', '01_flowaccount_exports'),
  path.join('data-pipeline', '01_raw'),
];

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Finds the FlowAccount product export in the upstream repo. It is named in Thai
 * (`บริษัท เทราบิส จำกัด_product.xlsx`) and the pipeline wants it under a stable ASCII name, so
 * this matches on the `_product.xlsx` suffix rather than the full Thai filename.
 * `SMARTGIFT_FLOWACCOUNT_SOURCE_XLSX` overrides the search entirely.
 */
function findFlowAccountSource(upstreamPath: string): string | null {
  const explicit = process.env.SMARTGIFT_FLOWACCOUNT_SOURCE_XLSX?.trim();
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  // pricelist_master.json lives at <repo>/data-pipeline/02_prepared/, so up two is the repo root.
  const upstreamRepo = path.resolve(path.dirname(upstreamPath), '..', '..');
  for (const dir of FLOWACCOUNT_CANDIDATES) {
    const full = path.join(upstreamRepo, dir);
    if (!fs.existsSync(full)) continue;
    const hit = fs
      .readdirSync(full)
      .filter((f) => f.toLowerCase().endsWith('_product.xlsx'))
      .sort()[0];
    if (hit) return path.join(full, hit);
  }
  return null;
}

function main(): void {
  const paths = resolvePipelinePaths();

  if (!fs.existsSync(paths.upstream)) {
    console.error(
      `[catalog-source-v4] upstream export not found: ${paths.upstream}\n` +
        `  This is business-01-smart-gift/data-pipeline/02_prepared/pricelist_master.json.\n` +
        `  Point at it with SMARTGIFT_UPSTREAM_PRICELIST=<path> if the checkout lives elsewhere.`,
    );
    process.exit(2);
  }

  const src = JSON.parse(fs.readFileSync(paths.upstream, 'utf8')) as UpstreamPricelistMaster;
  const { catalog, identity, stats } = projectUpstream(src);

  const catalogJson = `${JSON.stringify(catalog, null, 2)}\n`;
  const identityJson = `${JSON.stringify(identity, null, 2)}\n`;

  const flowSource = findFlowAccountSource(paths.upstream);

  if (CHECK_ONLY) {
    const problems: string[] = [];
    for (const [label, file, expected] of [
      ['catalog-2026.json', paths.catalog, catalogJson],
      ['identity-review.json', paths.identity, identityJson],
    ] as const) {
      if (!fs.existsSync(file)) problems.push(`${label}: missing (${file})`);
      else if (fs.readFileSync(file, 'utf8') !== expected) problems.push(`${label}: stale — upstream has moved on (${file})`);
    }
    if (!fs.existsSync(paths.flowaccount)) problems.push(`flowaccount xlsx: missing (${paths.flowaccount})`);
    if (problems.length) {
      console.error(`[catalog-source-v4] check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      console.error('  Run: npm run catalog:source-v4');
      process.exit(1);
    }
    console.log('[catalog-source-v4] check passed; generated inputs match the upstream export.');
    return;
  }

  writeAtomic(paths.catalog, catalogJson);
  writeAtomic(paths.identity, identityJson);

  if (flowSource) {
    fs.mkdirSync(path.dirname(paths.flowaccount), { recursive: true });
    fs.copyFileSync(flowSource, paths.flowaccount);
  } else if (!fs.existsSync(paths.flowaccount)) {
    // Not fatal here: the projection artifacts are still valid and useful on their own. Ingest
    // will fail loudly on the missing xlsx, which is the right place for that error.
    console.warn(
      `[catalog-source-v4] WARNING: no FlowAccount *_product.xlsx found near ${paths.upstream}.\n` +
        `  Ingest needs ${paths.flowaccount}; set SMARTGIFT_FLOWACCOUNT_SOURCE_XLSX=<path> and rerun.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        upstream: paths.upstream,
        wrote: { catalog: paths.catalog, identity: paths.identity, flowaccount: flowSource ? paths.flowaccount : null },
        flowaccountSource: flowSource,
        stats,
      },
      null,
      2,
    ),
  );
}

main();
