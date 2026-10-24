#!/usr/bin/env node
// @req FR-230 — host-only Ed25519 attestation after Docker shutdown inspection.
// @spec SEC-001, SEC-031 — private key never enters the web container.
// @tested tests/unit/msp-retention.test.js
import { readFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
import path from 'node:path'
try {
  const [keyPath, ...extra] = process.argv.slice(2)
  if (extra.length || !path.isAbsolute(keyPath)) throw new Error('INVALID_KEY_PATH')
  const raw = readFileSync(0, 'utf8')
  if (raw.length > 1024) throw new Error('INVALID_CLAIMS')
  const claims = JSON.parse(raw), key = createPrivateKey(readFileSync(keyPath))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('INVALID_KEY')
  const signature = sign(null, Buffer.from(JSON.stringify(claims)), key).toString('base64url')
  console.log(JSON.stringify({ claims, signature }))
} catch { console.error('MSP_RETENTION_HOST_SIGNING_FAILED'); process.exitCode = 1 }
