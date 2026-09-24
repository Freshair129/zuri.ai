// @spec ADR-107 - standalone service entrypoint and dependency boundaries.
import { pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import { createAuthorityHttpPort } from './authority-http-client.js'
import { loadFileManagementConfig } from './config.js'
import { createFileService } from './file-service.js'
import { createFileHttpServer } from './http-server.js'
import { createPostgresFileRepository } from './postgres-repository.js'
import { createConfiguredS3FileStoragePort } from './s3-storage.js'

export async function startFileManagement(env = process.env) {
  const config = loadFileManagementConfig(env)
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, application_name: 'zuri-file-management' })
  const repository = createPostgresFileRepository(pool)
  const storage = await createConfiguredS3FileStoragePort(env)
  const authority = createAuthorityHttpPort({ endpoint: env.FILE_AUTHORITY_URL, serviceToken: env.FILE_AUTHORITY_SERVICE_TOKEN })
  const unavailableStorage = storage || Object.freeze({
    health: async () => false,
    binding: async () => { throw Object.assign(new Error('storage unavailable'), { code: 'FILE_STORAGE_BINDING_UNAVAILABLE', status: 503 }) },
    putImmutable: async () => { throw Object.assign(new Error('storage unavailable'), { code: 'FILE_STORAGE_UNAVAILABLE', status: 503 }) },
    readExact: async () => { throw Object.assign(new Error('storage unavailable'), { code: 'FILE_STORAGE_UNAVAILABLE', status: 503 }) },
    close: async () => {},
  })
  const service = createFileService({ repository, storage: unavailableStorage, authority, maxUploadBytes: config.maxUploadBytes })
  const server = createFileHttpServer({ service, maxUploadBytes: config.maxUploadBytes, uploadTimeoutMs: config.uploadTimeoutMs, onError: ({ code }) => process.stderr.write(`${JSON.stringify({ code })}\n`) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, '0.0.0.0', resolve)
  })

  let closing = false
  async function close() {
    if (closing) return
    closing = true
    const forcedClose = setTimeout(() => server.closeAllConnections?.(), 10000)
    forcedClose.unref()
    await new Promise((resolve) => server.close(() => resolve()))
    clearTimeout(forcedClose)
    await Promise.allSettled([repository.close(), storage?.close?.()])
  }
  process.once('SIGTERM', () => { close().catch(() => { process.exitCode = 1 }) })
  process.once('SIGINT', () => { close().catch(() => { process.exitCode = 1 }) })
  return { server, service, close }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFileManagement().catch(() => {
    process.exitCode = 1
  })
}
