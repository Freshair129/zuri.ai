// @spec ADR-107 - runtime configuration contract proof.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFileManagementConfig } from '../src/config.js'

test('config uses a bounded default upload deadline', () => {
  const config = loadFileManagementConfig({ FILE_DATABASE_URL: 'postgres://file_service@db/zuri_files' })
  assert.equal(config.uploadTimeoutMs, 600000)
})

test('config rejects an upload deadline outside the allowed range', () => {
  assert.throws(
    () => loadFileManagementConfig({ FILE_DATABASE_URL: 'postgres://file_service@db/zuri_files', FILE_UPLOAD_TIMEOUT_MS: '3600001' }),
    (error) => error.code === 'FILE_CONFIG_INVALID',
  )
})
