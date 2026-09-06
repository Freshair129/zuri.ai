// Contract for the half of RAG-OPS-001 that needs a real engine: the ingest itself, and the lock
// that makes "single owner" more than a claim.
//
// Skipped where the GenesisBlock native binding is not installed, on the same principle as the
// DuckDB slice: a suite that silently passes without the thing it is testing teaches everyone to
// ignore it. Where the binding is present — the edge device it ships on, and any developer machine
// that ran `npm install` — these run for real against a temporary store.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GenesisNativeCatalog } from '../../src/rag/genesis-native.js';
import { TaxonomyServingError } from '../../src/rag/taxonomy-serving.js';
import { buildCanonicalCatalog, readCatalogManifest } from '../../src/rag/catalog-manifest.js';
import { tryLoadGenesisDatabase, GENESIS_PACKAGE } from '../../src/rag/v4/genesis-binding.js';

// @tested RAG-OPS-001 — an empty store is ingested once, a second owner is refused, and a moved
//   snapshot never overwrites what is already there.

const NEEDS_BINDING = tryLoadGenesisDatabase()
  ? false
  : `the GenesisBlock native binding is not installed — run \`npm install ${GENESIS_PACKAGE}\``;

const CATALOG = [
  { code: 'A-100', name: 'ร่มพับ 3 ตอน', englishName: '3-fold umbrella', category: 'umbrella' },
  { code: 'B-200', name: 'กระบอกน้ำสเตนเลส', englishName: 'steel bottle', category: 'bottle' },
];

interface Fixture {
  dir: string;
  semanticPath: string;
  storePath: string;
  manifestPath: string;
  open(): GenesisNativeCatalog;
  writeCatalog(rows: unknown[]): void;
}

async function withStore(run: (f: Fixture) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genesis-ingest-'));
  const fixture: Fixture = {
    dir,
    semanticPath: path.join(dir, 'semantic.json'),
    storePath: path.join(dir, 'store'),
    manifestPath: path.join(dir, 'catalog-manifest.json'),
    open: () =>
      new GenesisNativeCatalog({
        storePath: fixture.storePath,
        catalogJsonPath: fixture.semanticPath,
        manifestPath: fixture.manifestPath,
        taxonomyProjectionStorePath: path.join(dir, 'projection'),
      }),
    writeCatalog: (rows) => fs.writeFileSync(fixture.semanticPath, JSON.stringify(rows), 'utf8'),
  };
  fixture.writeCatalog(CATALOG);
  try {
    await run(fixture);
  } finally {
    // Best effort. The store has no close, by design — one process owns it for its lifetime — so
    // Windows will refuse to unlink the open lock file. The OS clears its own temp directory.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the lock is still held; leaving the directory is the correct outcome, not a failure */
    }
  }
}

describe('GenesisBlock ingest', { skip: NEEDS_BINDING }, () => {
  it('ingests an empty store and records what it put there', async () => {
    await withStore(async (f) => {
      assert.strictEqual(await f.open().init(), true);

      const written = readCatalogManifest(f.manifestPath);
      assert.ok(written, 'an ingest that writes no manifest cannot be recognised next time');
      const expected = buildCanonicalCatalog({ semanticPath: f.semanticPath }).manifest;
      assert.strictEqual(written!.snapshotId, expected.snapshotId);
      assert.strictEqual(written!.offerCount, CATALOG.length);

      // The store is materialized, not merely created: nodes and edges carry the catalog.
      const files = fs.readdirSync(f.storePath);
      for (const name of ['nodes.bin', 'edges.bin']) {
        assert.ok(files.includes(name), `${name} should exist after an ingest`);
        assert.ok(fs.statSync(path.join(f.storePath, name)).size > 0, `${name} should hold data`);
      }
    });
  });

  it('holds a lock, and refuses a second owner rather than opening the store twice', async () => {
    await withStore(async (f) => {
      const first = f.open();
      assert.strictEqual(await first.init(), true);
      assert.ok(fs.existsSync(path.join(f.storePath, 'genesis.lock')), 'the owner should hold a lock');

      const second = f.open();
      assert.strictEqual(await second.init(), false, 'a second owner must not open the same store');

      // And it refuses work rather than answering from a store it does not own.
      await assert.rejects(
        () => second.previewTaxonomy({ query: 'ร่ม' } as never),
        (error: unknown) => {
          assert.ok(error instanceof TaxonomyServingError);
          assert.match(String((error as Error).message), /GENESIS_STORE_ALREADY_OPEN/);
          return true;
        }
      );

      // The one that owns it is unaffected by the refused attempt.
      assert.strictEqual(await first.init(), true);
    });
  });

  it('refuses a moved snapshot without touching the manifest already there', async () => {
    await withStore(async (f) => {
      assert.strictEqual(await f.open().init(), true);
      const before = readCatalogManifest(f.manifestPath);

      f.writeCatalog([...CATALOG, { code: 'C-300', name: 'ปากกา', englishName: 'pen' }]);
      const changed = f.open();
      assert.strictEqual(await changed.init(), false, 'a changed snapshot is not adopted automatically');

      const after = readCatalogManifest(f.manifestPath);
      assert.strictEqual(after!.snapshotId, before!.snapshotId, 'the refusal must not rewrite the record');
      assert.strictEqual(after!.offerCount, CATALOG.length);

      await assert.rejects(
        () => changed.previewTaxonomy({ query: 'ร่ม' } as never),
        (error: unknown) => error instanceof TaxonomyServingError
      );
    });
  });
});
