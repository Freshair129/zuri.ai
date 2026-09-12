// @req FR-094, FR-095 — multi-factor authentication (TOTP) RFC 6238
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/unit/identity/totp.test.js

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Encode a buffer to a Base32 string (RFC 4648, unpadded).
 * @param {Buffer} buffer
 * @returns {string}
 */
export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return output
}

/**
 * Decode a Base32 string to a Buffer.
 * @param {string} str
 * @returns {Buffer}
 */
export function base32Decode(str) {
  const cleanStr = str.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const bytes = []

  for (let i = 0; i < cleanStr.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleanStr[i])
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${cleanStr[i]}`)
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/**
 * Generate a random Base32 TOTP secret.
 * @param {number} [byteLength=20] 160-bit secret recommended by RFC 4226 / 6238
 * @returns {string}
 */
export function generateTotpSecret(byteLength = 20) {
  return base32Encode(randomBytes(byteLength))
}

/**
 * Generate an otpauth:// URI suitable for QR codes and authenticator apps.
 * @param {object} params
 * @param {string} params.secret Base32 encoded secret
 * @param {string} params.accountName User account identifier (e.g. email or code)
 * @param {string} [params.issuer='zuri-ai'] Issuer label
 * @returns {string}
 */
export function generateTotpUri({ secret, accountName, issuer = 'zuri-ai' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`
  const query = new URLSearchParams({
    secret: secret.toUpperCase().replace(/\s+/g, ''),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${query.toString()}`
}

/**
 * Generate a 6-digit TOTP code for a given timestamp and secret.
 * @param {object} params
 * @param {string} params.secret Base32 encoded secret
 * @param {number} [params.timestamp=Date.now()] Milliseconds epoch
 * @param {number} [params.step=30] Timestep in seconds
 * @param {number} [params.digits=6]
 * @returns {string} 6-digit zero-padded string
 */
export function generateTotp({ secret, timestamp = Date.now(), step = 30, digits = 6 }) {
  const key = base32Decode(secret)
  const counter = Math.floor(timestamp / 1000 / step)

  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigInt64BE(BigInt(counter), 0)

  const hmac = createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const codeInt = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits

  return codeInt.toString().padStart(digits, '0')
}

/**
 * Timing-safe verify of a TOTP code within an allowed window of steps.
 * @param {object} params
 * @param {string} params.token 6-digit code submitted by user
 * @param {string} params.secret Base32 secret
 * @param {number} [params.window=1] Steps before and after to check (clock skew)
 * @param {number} [params.timestamp=Date.now()]
 * @param {number} [params.step=30]
 * @returns {boolean}
 */
export function verifyTotp({ token, secret, window = 1, timestamp = Date.now(), step = 30 }) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token.trim())) {
    return false
  }

  const cleanToken = token.trim()
  const tokenBuf = Buffer.from(cleanToken, 'utf8')
  const currentCounter = Math.floor(timestamp / 1000 / step)

  for (let delta = -window; delta <= window; delta++) {
    const checkTimestamp = (currentCounter + delta) * step * 1000
    const candidate = generateTotp({ secret, timestamp: checkTimestamp, step })
    const candidateBuf = Buffer.from(candidate, 'utf8')
    if (tokenBuf.length === candidateBuf.length && timingSafeEqual(tokenBuf, candidateBuf)) {
      return true
    }
  }

  return false
}
