import { readFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// @req FR-051, FR-052 - authenticate the production Supabase transport.
// @spec SDD-026, SEC-010 - caller-controlled TLS trust must fail closed.
// @tested tests/unit/phase1-runtime-login-probe.test.js

const PINNED_CA_PATH = fileURLToPath(
  new URL('../config/certs/supabase-prod-ca-2021.crt', import.meta.url),
)
const PINNED_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA'

export function loadPinnedSupabaseCa({ readFile = readFileSync, caPath = PINNED_CA_PATH } = {}) {
  let pem
  try {
    pem = readFile(caPath, 'utf8')
  } catch (cause) {
    throw new Error('SUPABASE_CA_REQUIRED', { cause })
  }

  try {
    const certificate = new X509Certificate(pem)
    if (certificate.fingerprint256 !== PINNED_FINGERPRINT) {
      throw new Error('SUPABASE_CA_FINGERPRINT_MISMATCH')
    }
  } catch (cause) {
    if (cause?.message === 'SUPABASE_CA_FINGERPRINT_MISMATCH') throw cause
    throw new Error('SUPABASE_CA_INVALID', { cause })
  }
  return pem
}

export function pinnedSupabaseTlsOptions(options) {
  return {
    rejectUnauthorized: true,
    ca: loadPinnedSupabaseCa(options),
  }
}
