// @req FR-173, FR-187 — structured catalog FileAssets use a private JSON-only
// bucket and remain separate from asset evidence before admission.
// @spec TASK-ZAI-050, ADR-075
// @tested tests/unit/knowledge-catalog-storage-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const migration = fs.readFileSync(path.resolve('supabase/migrations/20260918120000_knowledge_catalog_storage.sql'), 'utf8')

async function storageModule() {
  return import(pathToFileURL(path.resolve('src/platform/storage/supabase-object-storage.js')).href)
}

describe('TASK-ZAI-050 knowledge catalog storage boundary', () => {
  it('declares one private 16 MiB JSON-only bucket without changing asset-evidence', () => {
    expect(migration).toMatch(/'knowledge-catalog'/g)
    expect(migration).toMatch(/public\s*,\s*file_size_limit\s*,\s*allowed_mime_types/i)
    expect(migration).toMatch(/false\s*,\s*16777216\s*,\s*ARRAY\['application\/json'\]/i)
    expect(migration).not.toMatch(/asset-evidence/i)
  })

  it('routes a catalog ref to the configured private catalog port', async () => {
    const storage = await storageModule()
    const fetchFn = vi.fn().mockResolvedValue(new Response(Buffer.from('[]'), { status: 200 }))
    const port = storage.createConfiguredManagedBlobObjectStoragePort({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_STORAGE_SERVICE_ROLE_KEY: 'server-secret',
      ZURI_ASSET_EVIDENCE_BUCKET: 'asset-evidence',
      ZURI_KNOWLEDGE_CATALOG_BUCKET: 'knowledge-catalog',
    }, { fetchFn })
    await expect(port.get({ ref: 'supabase://knowledge-catalog/smartgift/catalog.json' })).resolves.toEqual(Buffer.from('[]'))
    expect(fetchFn.mock.calls[0][0]).toBe('https://example.supabase.co/storage/v1/object/knowledge-catalog/smartgift/catalog.json')
  })
})
