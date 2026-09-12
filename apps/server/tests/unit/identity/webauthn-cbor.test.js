import { describe, expect, it } from 'vitest'
import { decodeCbor } from '@/modules/identity/webauthn-cbor'

describe('webauthn-cbor decoder', () => {
  it('decodes simple integers and negative integers', () => {
    // 0 -> 0x00
    expect(decodeCbor(Buffer.from([0x00]))).toBe(0)
    // 1 -> 0x01
    expect(decodeCbor(Buffer.from([0x01]))).toBe(1)
    // 23 -> 0x17
    expect(decodeCbor(Buffer.from([0x17]))).toBe(23)
    // 24 -> 0x18, 0x18
    expect(decodeCbor(Buffer.from([0x18, 0x18]))).toBe(24)
    // 100 -> 0x18, 0x64
    expect(decodeCbor(Buffer.from([0x18, 0x64]))).toBe(100)
    // 1000 -> 0x19, 0x03, 0xe8
    expect(decodeCbor(Buffer.from([0x19, 0x03, 0xe8]))).toBe(1000)

    // Negative integers: -1 -> 0x20
    expect(decodeCbor(Buffer.from([0x20]))).toBe(-1)
    // -7 (ES256 alg): -1 - 6 = -7 -> 0x26
    expect(decodeCbor(Buffer.from([0x26]))).toBe(-7)
    // -257 (RS256 alg): -1 - 256 = -257 -> 0x39, 0x01, 0x00
    expect(decodeCbor(Buffer.from([0x39, 0x01, 0x00]))).toBe(-257)
  })

  it('decodes text strings and byte strings', () => {
    // Text string "none": 4 bytes -> 0x64, 'n', 'o', 'n', 'e'
    const noneBuf = Buffer.from([0x64, 0x6e, 0x6f, 0x6e, 0x65])
    expect(decodeCbor(noneBuf)).toBe('none')

    // Byte string of 3 bytes [0x01, 0x02, 0x03] -> 0x43, 0x01, 0x02, 0x03
    const bytesBuf = Buffer.from([0x43, 0x01, 0x02, 0x03])
    const decodedBytes = decodeCbor(bytesBuf)
    expect(Buffer.isBuffer(decodedBytes)).toBe(true)
    expect(decodedBytes).toEqual(Buffer.from([0x01, 0x02, 0x03]))
  })

  it('decodes maps and arrays', () => {
    // Map with 1 pair: {"a": 1}
    // major 5, len 1: 0xa1, key "a" (0x61, 0x61), val 1 (0x01)
    const mapBuf = Buffer.from([0xa1, 0x61, 0x61, 0x01])
    const map = decodeCbor(mapBuf)
    expect(map instanceof Map).toBe(true)
    expect(map.get('a')).toBe(1)

    // Array of 2 items: [1, 2] -> 0x82, 0x01, 0x02
    const arrBuf = Buffer.from([0x82, 0x01, 0x02])
    expect(decodeCbor(arrBuf)).toEqual([1, 2])
  })

  it('decodes boolean and null values', () => {
    expect(decodeCbor(Buffer.from([0xf4]))).toBe(false)
    expect(decodeCbor(Buffer.from([0xf5]))).toBe(true)
    expect(decodeCbor(Buffer.from([0xf6]))).toBe(null)
  })
})
