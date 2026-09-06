// Contract for pipeline path resolution and engine binding.
//
// The pipeline was previously unrunnable outside one machine because inputs and the engine were
// addressed by absolute `D:/` and `G:/` paths. These tests pin the two properties that keep that
// from regressing: every path is env-overridable, and the defaults are repo-relative rather than
// drive-absolute.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolvePipelinePaths, REPO_ROOT } from '../../src/rag/v4/paths.js';
import { candidates, GENESIS_PACKAGE } from '../../src/rag/v4/genesis-binding.js';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const PIPELINE_ENV = {
  ZURI_DATA_ROOT: undefined,
  SMARTGIFT_UPSTREAM_PRICELIST: undefined,
  SMARTGIFT_SEMANTIC_CATALOG_JSON_PATH: undefined,
  GENESIS_USER_LOGIC_REVIEW_PATH: undefined,
  SMARTGIFT_FLOWACCOUNT_XLSX: undefined,
  GENESIS_SMARTGIFT_STORE_V4_ROOT: undefined,
  SMARTGIFT_PRICE_PDF_INDEX: undefined,
};

describe('v4 pipeline paths', () => {
  it('defaults every path inside the repo, never onto an absolute drive letter', () => {
    const p = withEnv(PIPELINE_ENV, () => resolvePipelinePaths());
    for (const key of ['dataRoot', 'catalog', 'identity', 'flowaccount', 'storeRoot', 'pdfIndex'] as const) {
      assert.ok(
        p[key].startsWith(REPO_ROOT),
        `${key} defaulted outside the repo: ${p[key]}`,
      );
    }
  });

  it('defaults the upstream export to the sibling business-01-smart-gift checkout', () => {
    const p = withEnv(PIPELINE_ENV, () => resolvePipelinePaths());
    assert.ok(p.upstream.includes('business-01-smart-gift'), p.upstream);
    assert.ok(p.upstream.endsWith(`${path.sep}pricelist_master.json`), p.upstream);
    // A sibling of the repo, not a child of it.
    assert.ok(!p.upstream.startsWith(REPO_ROOT + path.sep), p.upstream);
  });

  it('keeps the two hand-written config files in git, not under the data root', () => {
    const p = withEnv(PIPELINE_ENV, () => resolvePipelinePaths());
    assert.ok(p.categoryMap.includes(path.join('rag', 'v4', 'config')), p.categoryMap);
    assert.ok(p.aliases.includes(path.join('rag', 'v4', 'config')), p.aliases);
    assert.ok(!p.categoryMap.startsWith(p.dataRoot), 'config must not live under the data root');
  });

  it('reroots the generated inputs when ZURI_DATA_ROOT moves', () => {
    const p = withEnv({ ...PIPELINE_ENV, ZURI_DATA_ROOT: path.join(path.sep, 'tmp', 'zuri-data') }, () =>
      resolvePipelinePaths(),
    );
    const root = path.join(path.sep, 'tmp', 'zuri-data');
    assert.equal(p.dataRoot, root);
    assert.equal(p.catalog, path.join(root, 'source', 'catalog-2026.json'));
    assert.equal(p.storeRoot, path.join(root, 'genesis_smartgift_store_v4'));
    assert.equal(p.identity, path.join(root, 'catalog_identity_review_user_logic_v1', 'identity-review.json'));
  });

  it('lets each individual path be overridden without moving the others', () => {
    const store = path.join(path.sep, 'srv', 'store');
    const p = withEnv({ ...PIPELINE_ENV, GENESIS_SMARTGIFT_STORE_V4_ROOT: store }, () => resolvePipelinePaths());
    assert.equal(p.storeRoot, store);
    assert.ok(p.catalog.startsWith(REPO_ROOT), 'the other paths keep their defaults');
  });

  it('prefers explicit argument overrides over the environment', () => {
    const p = withEnv({ ...PIPELINE_ENV, ZURI_DATA_ROOT: path.join(path.sep, 'from-env') }, () =>
      resolvePipelinePaths({ dataRoot: path.join(path.sep, 'from-arg') }),
    );
    assert.equal(p.dataRoot, path.join(path.sep, 'from-arg'));
  });
});

describe('v4 genesis binding', () => {
  it('resolves the engine as an npm dependency rather than an absolute path', () => {
    const list = withEnv({ GENESIS_NATIVE_MODULE: undefined }, () => candidates());
    assert.equal(list[0], GENESIS_PACKAGE);
  });

  it('lets an operator point at a local engine build first', () => {
    const list = withEnv({ GENESIS_NATIVE_MODULE: '/opt/genesis/index.node' }, () => candidates());
    assert.equal(list[0], '/opt/genesis/index.node');
    assert.ok(list.includes(GENESIS_PACKAGE), 'the package stays as the fallback');
  });
});
