// Contract for the readiness and single-owner guard on the GenesisBlock store.
//
// This was the one requirement in the repository with implementing code and no test, on the stated
// grounds that reaching it needs the native binding and a real store. That is true of the ingest
// path and not of the guard: refusing work until the catalog is ready, and refusing to take over a
// store whose snapshot has moved, are both decisions made before anything is opened. What stays
// untested is the successful ingest, which does need a real engine — and that is a smaller and more
// honest gap than the whole requirement.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GenesisNativeCatalog } from '../../src/rag/genesis-native.js';
import { TaxonomyServingError } from '../../src/rag/taxonomy-serving.js';
import { decideCatalogIngest, storeHasMaterializedData } from '../../src/rag/catalog-manifest.js';

// @tested RAG-OPS-001 — work is refused until the catalog is ready, and a store whose snapshot
//   moved is never taken over automatically.

function withDir(run: (dir: string) => void | Promise<void>): Promise<void> | void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-readiness-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    const result = run(dir);
    if (result instanceof Promise) return result.finally(cleanup);
    cleanup();
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** A catalog path that cannot produce a snapshot, so initialization fails before anything opens. */
const unbuildableCatalog = (dir: string) => {
  const file = path.join(dir, 'not-a-catalog.json');
  fs.writeFileSync(file, '{ this is not json');
  return file;
};

describe('store readiness', () => {
  it('refuses to serve until the catalog is ready, rather than answering from nothing', async () => {
    await withDir(async (dir) => {
      const catalog = new GenesisNativeCatalog({
        storePath: path.join(dir, 'store'),
        catalogJsonPath: unbuildableCatalog(dir),
        manifestPath: path.join(dir, 'manifest.json'),
        taxonomyProjectionStorePath: path.join(dir, 'projection'),
      });

      await assert.rejects(
        () => catalog.previewTaxonomy({ query: 'ร่ม' } as never),
        (error: unknown) => {
          // The type matters more than the reason: the reason differs by machine (a host without
          // the native binding fails earlier), but the refusal is the requirement.
          assert.ok(error instanceof TaxonomyServingError, `expected a serving error, got ${error}`);
          assert.strictEqual((error as TaxonomyServingError).code, 'TAXONOMY_PROJECTION_UNAVAILABLE');
          assert.ok(String((error as Error).message).length > 0, 'a refusal must say why');
          return true;
        }
      );
    });
  });

  it('does not create the store it failed to open', async () => {
    await withDir(async (dir) => {
      const storePath = path.join(dir, 'store');
      const catalog = new GenesisNativeCatalog({
        storePath,
        catalogJsonPath: unbuildableCatalog(dir),
        manifestPath: path.join(dir, 'manifest.json'),
        taxonomyProjectionStorePath: path.join(dir, 'projection'),
      });

      assert.strictEqual(await catalog.init(), false);
      // A half-opened store is worse than none: the next process to look would find a directory
      // and have to guess whether anyone owns it.
      assert.strictEqual(fs.existsSync(storePath), false);
    });
  });

  it('stays refused instead of reopening on every call', async () => {
    await withDir(async (dir) => {
      const catalog = new GenesisNativeCatalog({
        storePath: path.join(dir, 'store'),
        catalogJsonPath: unbuildableCatalog(dir),
        manifestPath: path.join(dir, 'manifest.json'),
        taxonomyProjectionStorePath: path.join(dir, 'projection'),
      });

      assert.strictEqual(await catalog.init(), false);
      assert.strictEqual(await catalog.init(), false);
      // Concurrent callers share one attempt rather than racing to open the same path.
      assert.deepStrictEqual(await Promise.all([catalog.init(), catalog.init()]), [false, false]);
    });
  });
});

describe('single owner of a store', () => {
  it('refuses to take over a store whose snapshot has moved', () => {
    withDir((dir) => {
      const manifest = { snapshotId: 'snapshot-a' } as never;
      assert.strictEqual(decideCatalogIngest(dir, manifest, 'snapshot-b'), 'snapshot_changed');
      // Same snapshot is the one case where finding an existing store is unremarkable.
      assert.strictEqual(decideCatalogIngest(dir, manifest, 'snapshot-a'), 'skip_same_snapshot');
    });
  });

  it('will not silently re-ingest a store that holds data but claims no manifest', () => {
    withDir((dir) => {
      assert.strictEqual(decideCatalogIngest(dir, null, 'snapshot-a'), 'ingest_empty_store');

      fs.writeFileSync(path.join(dir, 'nodes.bin'), 'x');
      fs.writeFileSync(path.join(dir, 'edges.bin'), 'y');
      // Data with no manifest means somebody built this store by another route; adopting it would
      // be this process claiming ownership it cannot prove.
      assert.strictEqual(decideCatalogIngest(dir, null, 'snapshot-a'), 'legacy_unmanifested');
    });
  });

  it('reads emptiness from the graph files, not from the directory existing', () => {
    withDir((dir) => {
      assert.strictEqual(storeHasMaterializedData(dir), false);
      // A zero-byte file is Genesis schema metadata, not catalog data.
      fs.writeFileSync(path.join(dir, 'nodes.bin'), '');
      assert.strictEqual(storeHasMaterializedData(dir), false);
      fs.writeFileSync(path.join(dir, 'nodes.bin'), 'x');
      assert.strictEqual(storeHasMaterializedData(dir), true);
    });
  });
});
