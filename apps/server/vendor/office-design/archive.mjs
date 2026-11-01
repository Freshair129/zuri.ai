import {inflateRawSync} from 'node:zlib';

const allowed = /^(manifest\.json|schema\.json|id-map\.json|README\.txt|assets\/[0-9a-f]{64}\.glb)$/;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Inspect without extracting. Bound both the transport and expanded contents;
// check the central directory independently of the browser ZIP writer.
export function readHandoffArchive(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 22 || bytes.length > 100_000_000) throw Error('Archive size limit');
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 20) !== 0) throw Error('Invalid ZIP end record');
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16), size = bytes.readUInt32LE(end + 12);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count < 4 || count > 20000 || start + size !== end) throw Error('Invalid ZIP directory');
  const files = new Map();
  let cursor = start, localEnd = 0, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP entry');
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16), packed = bytes.readUInt32LE(cursor + 20), length = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32), offset = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (flags !== 0 || ![0, 8].includes(method) || length > 20_000_000 || next > end || bytes.readUInt16LE(cursor + 34) || offset !== localEnd || offset + 30 > start) throw Error('Unsupported ZIP entry');
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (!allowed.test(name) || files.has(name)) throw Error('Unsafe or duplicate ZIP path');
    if (bytes.readUInt32LE(offset) !== 0x04034b50 || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method || bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== packed || bytes.readUInt32LE(offset + 22) !== length || bytes.readUInt16LE(offset + 26) !== nameLength) throw Error('ZIP header disagreement');
    const dataStart = offset + 30 + nameLength + bytes.readUInt16LE(offset + 28);
    if (dataStart + packed > start || bytes.toString('utf8', offset + 30, offset + 30 + nameLength) !== name) throw Error('ZIP local entry disagreement');
    const packedBytes = bytes.subarray(dataStart, dataStart + packed);
    const content = method === 0 ? packedBytes : inflateRawSync(packedBytes, {maxOutputLength: 20_000_000});
    expanded += content.length;
    if (expanded > 100_000_000 || content.length !== length || crc32(content) !== crc) throw Error('ZIP content CRC or size mismatch');
    files.set(name, content);
    localEnd = dataStart + packed;
    cursor = next;
  }
  if (cursor !== end || localEnd !== start) throw Error('ZIP contains unaccounted data');
  return files;
}
