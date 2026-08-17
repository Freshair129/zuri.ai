import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

// @req FR-074 — local/test secret adapter for opaque IntegrationCredential refs.
// @spec ADR-031 §D3 — file-vault storage is never a production runtime source.
// @tested tests/unit/fr074-credential-vault.test.js

const VERSION = 1
const KEY_LENGTH = 32
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 }

function vaultError(code) {
  const error = new Error(code)
  error.code = code
  error.status = 503
  return error
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw vaultError(`${label}_REQUIRED`)
  return value
}

function keyFor(masterKey, salt) {
  try {
    return scryptSync(masterKey, salt, KEY_LENGTH, SCRYPT_OPTIONS)
  } catch {
    throw vaultError('CREDENTIAL_VAULT_UNAVAILABLE')
  }
}

export function createFileCredentialVault({
  filePath,
  masterKey,
  fsImpl = { mkdir, readFile, rename, writeFile, chmod },
} = {}) {
  requiredText(filePath, 'CREDENTIAL_VAULT_PATH')
  requiredText(masterKey, 'CREDENTIAL_VAULT_MASTER_KEY')
  if (masterKey.length < 16) throw vaultError('CREDENTIAL_VAULT_MASTER_KEY_TOO_SHORT')
  const absolutePath = path.resolve(filePath)

  async function load() {
    let raw
    try {
      raw = await fsImpl.readFile(absolutePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: VERSION, records: {} }
      throw vaultError('CREDENTIAL_VAULT_UNAVAILABLE')
    }
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.version !== VERSION || !parsed.records || typeof parsed.records !== 'object') throw new Error('invalid vault')
      return parsed
    } catch {
      throw vaultError('CREDENTIAL_VAULT_UNAVAILABLE')
    }
  }

  async function persist(store) {
    const temporaryPath = `${absolutePath}.${randomBytes(8).toString('hex')}.tmp`
    try {
      await fsImpl.mkdir(path.dirname(absolutePath), { recursive: true })
      await fsImpl.writeFile(temporaryPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 })
      await fsImpl.rename(temporaryPath, absolutePath)
      await fsImpl.chmod(absolutePath, 0o600)
    } catch {
      throw vaultError('CREDENTIAL_VAULT_UNAVAILABLE')
    }
  }

  function encrypt(secret) {
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', keyFor(masterKey, salt), iv)
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
    return {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  }

  function decrypt(record) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keyFor(masterKey, Buffer.from(record.salt, 'base64')),
        Buffer.from(record.iv, 'base64'),
      )
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    } catch {
      throw vaultError('CREDENTIAL_VAULT_UNAVAILABLE')
    }
  }

  return {
    async put(secretRef, secret) {
      requiredText(secretRef, 'SECRET_REF')
      requiredText(secret, 'CREDENTIAL')
      const store = await load()
      store.records[secretRef] = { ...encrypt(secret), updatedAt: new Date().toISOString() }
      await persist(store)
      return { secretRef, updatedAt: store.records[secretRef].updatedAt }
    },
    async get(secretRef) {
      requiredText(secretRef, 'SECRET_REF')
      const store = await load()
      const record = store.records[secretRef]
      return record ? decrypt(record) : null
    },
  }
}

export function createEnvCredentialVault({ env = process.env } = {}) {
  return createFileCredentialVault({
    filePath: env.ZURI_CREDENTIAL_VAULT_PATH || path.join(process.cwd(), '.zuri', 'credential-vault.json'),
    masterKey: env.ZURI_CREDENTIAL_VAULT_MASTER_KEY,
  })
}
