// @req FR-293 — only a separate disposable TEST harness signs source-bound admission.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { generateKeyPairSync, sign } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { canonicalJSON } from '../../src/modules/project-manager/application/handoff-contract.js'

const ENVELOPE = 'managed-blob-transfer-test-admission-envelope.v1'

const [testRoot, admissionFile, publicKeyFile] = process.argv.slice(2)
const rootPath = path.resolve(testRoot || '.')
const allowedOutputPaths = path.isAbsolute(testRoot || '')
  && path.resolve(path.dirname(admissionFile || '.')) === rootPath
  && path.basename(admissionFile || '') === 'test-admission.json'
  && path.resolve(path.dirname(publicKeyFile || '.')) === rootPath
  && path.basename(publicKeyFile || '') === 'test-admission-public.pem'
if (!allowedOutputPaths || !path.isAbsolute(admissionFile || '') || !path.isAbsolute(publicKeyFile || '')
  || process.env.ZURI_SESSION_SECRET || process.env.DATABASE_URL) {
  process.exitCode = 2
} else {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 16 * 1024) throw new Error('SIGNER_INPUT_TOO_LARGE')
      chunks.push(Buffer.from(chunk))
    }
    const claims = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const keys = generateKeyPairSync('ed25519')
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' })
    const signature = sign(null, Buffer.from(canonicalJSON(claims)), keys.privateKey).toString('base64url')
    await writeFile(publicKeyFile, publicKey, { flag: 'wx', mode: 0o644 })
    await writeFile(admissionFile, canonicalJSON({ schemaVersion: ENVELOPE, claims, signature }),
      { flag: 'wx', mode: 0o600 })
  } catch {
    process.exitCode = 1
  }
}
