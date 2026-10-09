// @spec ADR-107 - bounded runtime configuration without permissive authority defaults.
// @tested tests/config.test.js
import { FileManagementError } from './errors.js'

export function loadFileManagementConfig(env = process.env) {
  const databaseUrl = env.FILE_DATABASE_URL
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) throw new FileManagementError('FILE_DATABASE_CONFIG_INVALID', 500, 'FILE_DATABASE_URL is required')
  const port = env.FILE_PORT === undefined ? 4401 : Number(env.FILE_PORT)
  const maxUploadBytes = env.FILE_MAX_UPLOAD_BYTES === undefined ? 512 * 1024 * 1024 : Number(env.FILE_MAX_UPLOAD_BYTES)
  const uploadTimeoutMs = env.FILE_UPLOAD_TIMEOUT_MS === undefined ? 600000 : Number(env.FILE_UPLOAD_TIMEOUT_MS)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1 || maxUploadBytes > 512 * 1024 * 1024 || !Number.isInteger(uploadTimeoutMs) || uploadTimeoutMs < 1000 || uploadTimeoutMs > 3600000) {
    throw new FileManagementError('FILE_CONFIG_INVALID', 500, 'File service port or maximum upload size is invalid')
  }
  return Object.freeze({ databaseUrl: databaseUrl.trim(), port, maxUploadBytes, uploadTimeoutMs })
}
