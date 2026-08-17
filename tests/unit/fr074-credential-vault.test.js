import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFileCredentialVault } from '@/platform/integrations/core/credential-vault'

// @req FR-074 — local/test secret adapter stores ciphertext only.
// @spec ADR-031 §D3, SEC-015
// @tested tests/unit/fr074-credential-vault.test.js

describe('FR-074 local credential vault', () => {
  let tempDir
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  })

  it('round-trips a local secret while persisting ciphertext only', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'zuri-fr074-vault-'))
    const filePath = path.join(tempDir, 'vault.json')
    const vault = createFileCredentialVault({ filePath, masterKey: 'local-test-master-key-1234' })
    await vault.put('secret://phase1/local', 'provider-secret')
    await expect(vault.get('secret://phase1/local')).resolves.toBe('provider-secret')
    expect(await readFile(filePath, 'utf8')).not.toContain('provider-secret')
  })

  it('rejects missing master-key configuration', () => {
    expect(() => createFileCredentialVault({ filePath: 'vault.json', masterKey: '' })).toThrow(/master/i)
  })
})
