// @req FR-187 — a SmartGift catalog file uploaded from the Knowledge intake is
// validated, stored on the private knowledge store and admitted as a structured
// projection in one step.
// @spec ADR-075 D2, ADR-075 D3
// @tested tests/unit/smartgift-catalog-upload-service.test.js
//
// Why this exists: the admission API only reads a FILE source from a FileAsset,
// and in the Docker deployment the Files page can create neither a LOCAL_FILE
// (its mounts are Windows paths the Linux container cannot reach) nor a
// MANAGED_BLOB (only Asset evidence and pricing-catalog write those). This is
// the upload path for catalog JSON, and it writes to the private MinIO store,
// never a hosted bucket.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { createManagedBlobFileAsset, resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { createConfiguredKnowledgeManagedBlobPort } from '@/platform/storage/s3-object-storage'
import { assertKnowledgeBusinessWritable } from './knowledge-authorization'
import { admitKnowledge } from './knowledge-admission-service'
import {
  parseSmartGiftCatalogFile,
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_MAX_FILE_BYTES,
} from './smartgift-catalog-adapter'

const uploadInput = z.object({
  businessId: z.string().min(1),
  projectId: z.string().min(1).nullish(),
  name: z.string().trim().min(1).max(200).regex(/\.json$/i, 'A SmartGift catalog file must be a .json file'),
  contentBase64: z.string().min(1),
}).strict()

function failure(status, code, message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

export async function uploadSmartGiftCatalogFile(input, {
  db = prisma,
  viewer,
  env = process.env,
  now = new Date(),
  objectStoragePort,
  admit = admitKnowledge,
} = {}) {
  const value = uploadInput.parse(input)
  await assertKnowledgeBusinessWritable(viewer, value.businessId, { db, env })

  const content = Buffer.from(value.contentBase64, 'base64')
  if (!content.length) throw failure(422, 'KNOWLEDGE_STRUCTURED_FORMAT_INVALID', 'The catalog file is empty')
  if (content.length > SMARTGIFT_CATALOG_MAX_FILE_BYTES) {
    throw failure(413, 'KNOWLEDGE_CONTENT_TOO_LARGE', `The catalog file exceeds the ${SMARTGIFT_CATALOG_MAX_FILE_BYTES} byte limit`)
  }
  // Refuse a file that is not a catalog before anything is stored.
  const records = parseSmartGiftCatalogFile(content.toString('utf8'))
  const sha256 = createHash('sha256').update(content).digest('hex')

  const storage = objectStoragePort || createConfiguredKnowledgeManagedBlobPort(env)
  if (!storage) throw failure(503, 'KNOWLEDGE_STORAGE_UNAVAILABLE', 'Private knowledge storage is not enabled')

  // Identical bytes already held for this Business are reused, whichever store
  // holds them; the managed-blob reader resolves the ref to its own store.
  let asset = await db.fileAsset.findFirst({
    where: { businessId: value.businessId, sha256, storageKind: 'MANAGED_BLOB', status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  const reused = Boolean(asset)
  if (!asset) {
    const stored = await storage.put({
      key: `smartgift-catalog/${value.businessId}/${sha256}/${randomUUID()}.json`,
      content,
      mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
    })
    try {
      asset = await createManagedBlobFileAsset({
        businessId: value.businessId,
        projectId: value.projectId ?? null,
        name: value.name,
        mime: SMARTGIFT_CATALOG_CONTENT_TYPE,
        size: content.length,
        sha256,
        blobRef: stored.ref,
        uploadedBy: viewer?.principal?.id ?? null,
      }, { db, viewer })
    } catch (error) {
      await storage.remove({ ref: stored.ref }).catch(() => {})
      throw error
    }
  }

  const admission = await admit({
    businessId: value.businessId,
    projectId: value.projectId ?? null,
    idempotencyKey: `smartgift-catalog-upload:${asset.id}`,
    source: { kind: 'FILE', fileAssetId: asset.id, format: SMARTGIFT_CATALOG_FORMAT },
  }, {
    viewer,
    db,
    env,
    now,
    ...(objectStoragePort ? { fileContentResolver: (fileId, options) => resolveFileAssetContent(fileId, { ...options, db, objectStoragePort }) } : {}),
  })

  return {
    fileAssetId: asset.id,
    fileName: asset.name,
    sha256,
    recordCount: records.length,
    reused,
    admission,
  }
}
