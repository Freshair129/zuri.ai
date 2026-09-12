// @req FR-094, FR-095 — Lightweight CBOR decoder for WebAuthn / FIDO2 payloads
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/unit/identity/webauthn-cbor.test.js

/**
 * Decode a CBOR buffer into JavaScript data structures.
 * Supports types used in WebAuthn attestationObject and COSE_Key structures.
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {any}
 */
export function decodeCbor(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  let offset = 0

  function readLength(info) {
    if (info < 24) return info
    if (info === 24) {
      const val = buf.readUInt8(offset)
      offset += 1
      return val
    }
    if (info === 25) {
      const val = buf.readUInt16BE(offset)
      offset += 2
      return val
    }
    if (info === 26) {
      const val = buf.readUInt32BE(offset)
      offset += 4
      return val
    }
    if (info === 27) {
      const high = buf.readUInt32BE(offset)
      const low = buf.readUInt32BE(offset + 4)
      offset += 8
      return high * 2 ** 32 + low
    }
    throw new Error(`Unsupported CBOR length info: ${info}`)
  }

  function parseItem() {
    if (offset >= buf.length) {
      throw new Error('Unexpected end of CBOR buffer')
    }

    const initialByte = buf.readUInt8(offset)
    offset += 1

    const majorType = initialByte >> 5
    const additionalInfo = initialByte & 0x1f

    switch (majorType) {
      case 0: { // Unsigned integer
        return readLength(additionalInfo)
      }
      case 1: { // Negative integer
        const val = readLength(additionalInfo)
        return -1 - val
      }
      case 2: { // Byte string
        const len = readLength(additionalInfo)
        const bytes = buf.subarray(offset, offset + len)
        offset += len
        return bytes
      }
      case 3: { // Text string
        const len = readLength(additionalInfo)
        const str = buf.toString('utf8', offset, offset + len)
        offset += len
        return str
      }
      case 4: { // Array
        const len = readLength(additionalInfo)
        const arr = []
        for (let i = 0; i < len; i++) {
          arr.push(parseItem())
        }
        return arr
      }
      case 5: { // Map
        const len = readLength(additionalInfo)
        const map = new Map()
        for (let i = 0; i < len; i++) {
          const key = parseItem()
          const val = parseItem()
          map.set(key, val)
        }
        return map
      }
      case 6: { // Tag
        readLength(additionalInfo) // Skip tag number
        return parseItem()
      }
      case 7: { // Simple values
        if (additionalInfo === 20) return false
        if (additionalInfo === 21) return true
        if (additionalInfo === 22) return null
        if (additionalInfo === 23) return undefined
        throw new Error(`Unsupported simple value: ${additionalInfo}`)
      }
      default:
        throw new Error(`Unsupported CBOR major type: ${majorType}`)
    }
  }

  const result = parseItem()
  return result
}
