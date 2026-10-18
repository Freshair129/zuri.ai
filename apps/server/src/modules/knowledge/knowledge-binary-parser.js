// @req FR-288 — managed binary projection and immutable source locations.
// @spec SDD-114 — versioned binary source projection and bounded parsing.
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import yauzl from 'yauzl'

// The queue and legacy RawExternalRecord/KnowledgeRawArtifact columns are text
// columns. This tagged data URL is a transport serialization only: raw hashes
// are always computed over the decoded original bytes.
export const KNOWLEDGE_BINARY_ENCODING = 'base64-data-uri-v1'
export const KNOWLEDGE_BINARY_MAX_BYTES = 20 * 1024 * 1024
export const KNOWLEDGE_BINARY_TIMEOUT_MS = 60_000
export const KNOWLEDGE_BINARY_PARSER_VERSION = 'knowledge-binary-parser-1'
export const KNOWLEDGE_BINARY_MAPPING_VERSION = 'source-locator-map-1'
export const KNOWLEDGE_BINARY_OUTPUT_MAX_BYTES = 10 * 1024 * 1024
// Retain the binary serialization tags needed to reopen immutable raw rows
// produced by an older parser build. New intake always uses the active profile.
export const KNOWLEDGE_BINARY_SERIALIZATION_HISTORY = Object.freeze([
  Object.freeze({ profile: 'knowledge-binary-parser-1', encoding: 'base64-data-uri-v1' }),
])
export const KNOWLEDGE_BINARY_FORMATS = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/html': 'html',
})

export function hashKnowledgeBinaryBytes(bytes) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) throw new TypeError('Knowledge binary input must be bytes')
  return createHash('sha256').update(bytes).digest('hex')
}

/** Conservative byte sniff used after live FileAsset authorization. */
export async function detectKnowledgeBinaryMediaType(bytes) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) || !bytes.length || bytes.length > KNOWLEDGE_BINARY_MAX_BYTES) return null
  const value = Buffer.from(bytes)
  if (value.subarray(0, 1024).indexOf(Buffer.from('%PDF-')) >= 0) return 'application/pdf'
  if (value[0] === 0x50 && value[1] === 0x4b) {
    const isDocx = await new Promise((resolve) => {
      yauzl.fromBuffer(value, { lazyEntries: true, decodeStrings: true, strictFileNames: true }, (error, zip) => {
        if (error || !zip) return resolve(false)
        let contentTypes = false
        let documentXml = false
        let entries = 0
        zip.on('error', () => resolve(false))
        zip.on('entry', (entry) => {
          entries += 1
          if (entries > 2000) { zip.close(); return resolve(false) }
          if (entry.fileName === '[Content_Types].xml') contentTypes = true
          if (entry.fileName === 'word/document.xml') documentXml = true
          zip.readEntry()
        })
        zip.on('end', () => resolve(contentTypes && documentXml))
        zip.readEntry()
      })
    })
    if (isDocx) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    return null
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(value.subarray(0, Math.min(value.length, 4096))).replace(/^\uFEFF/u, '')
    // HTML fragments may begin with user-visible text before their first
    // element. Scan only the bounded prefix, but do not require the first
    // token itself to be markup.
    if (/(?:<!doctype\s+html\b|<!--|<\/?[a-z][a-z0-9:-]*(?:\s|\/?>))/iu.test(text)) return 'text/html'
  } catch { return null }
  return null
}

export function isKnowledgeBinaryProfile(source = {}) {
  return KNOWLEDGE_BINARY_SERIALIZATION_HISTORY.some((entry) => entry.profile === source.binaryProfile && entry.encoding === source.binaryEncoding)
    && Object.hasOwn(KNOWLEDGE_BINARY_FORMATS, String(source.contentType || '').toLowerCase())
}

export function rawKnowledgeBinaryContentType(mediaType, { binaryProfile = KNOWLEDGE_BINARY_PARSER_VERSION, binaryEncoding = KNOWLEDGE_BINARY_ENCODING } = {}) {
  const canonicalType = String(mediaType || '').toLowerCase()
  if (!isKnowledgeBinaryProfile({ binaryProfile, binaryEncoding, contentType: canonicalType })) throw binaryError('BINARY_PROFILE_INVALID', 400)
  return `${canonicalType}; zuri-profile=${binaryProfile}; zuri-encoding=${binaryEncoding}`
}

/** Raw rows carry the profile tag in their existing contentType column. */
export function knowledgeBinaryDescriptorFromRawContentType(contentType) {
  if (typeof contentType !== 'string') return null
  const [mediaType, ...parameters] = contentType.split(';').map((part) => part.trim())
  const tags = new Map(parameters.map((part) => {
    const separator = part.indexOf('=')
    return separator < 0 ? [part.toLowerCase(), ''] : [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()]
  }))
  const descriptor = { mediaType: mediaType.toLowerCase(), binaryProfile: tags.get('zuri-profile'), binaryEncoding: tags.get('zuri-encoding') }
  if (!isKnowledgeBinaryProfile({ ...descriptor, contentType: descriptor.mediaType })) return null
  return { ...descriptor, contentType: descriptor.mediaType }
}

export function encodeKnowledgeBinary(bytes, mediaType) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) throw new TypeError('Knowledge binary input must be bytes')
  const canonicalType = String(mediaType || '').toLowerCase()
  if (!Object.hasOwn(KNOWLEDGE_BINARY_FORMATS, canonicalType)) throw binaryError('UNSUPPORTED_MEDIA_TYPE', 415)
  if (!bytes.length || bytes.length > KNOWLEDGE_BINARY_MAX_BYTES) throw binaryError(bytes.length ? 'INPUT_BYTES_LIMIT' : 'EMPTY_DOCUMENT', bytes.length ? 413 : 422)
  return `data:${canonicalType};base64,${Buffer.from(bytes).toString('base64')}`
}

/** Decode only when the persisted typed profile explicitly authorizes it. */
export function decodeKnowledgeBinary(content, { binaryProfile, binaryEncoding, contentType, maxBytes = KNOWLEDGE_BINARY_MAX_BYTES } = {}) {
  const mediaType = String(contentType || '').toLowerCase()
  if (!isKnowledgeBinaryProfile({ binaryProfile, binaryEncoding, contentType: mediaType })) {
    throw binaryError('BINARY_PROFILE_INVALID', 400)
  }
  if (typeof content !== 'string') throw binaryError('BINARY_SERIALIZATION_INVALID', 400)
  const prefix = `data:${mediaType};base64,`
  if (!content.startsWith(prefix)) throw binaryError('BINARY_SERIALIZATION_INVALID', 400)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > KNOWLEDGE_BINARY_MAX_BYTES) throw binaryError('BINARY_PROFILE_INVALID', 400)
  const maxEncoded = 4 * Math.ceil(Math.max(0, maxBytes) / 3)
  if (content.length > prefix.length + maxEncoded) throw binaryError('INPUT_BYTES_LIMIT', 413)
  const encoded = content.slice(prefix.length)
  const invalidCharacter = /[^A-Za-z0-9+/=]/u.test(encoded)
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const interiorPadding = padding ? encoded.slice(0, -padding).includes('=') : encoded.includes('=')
  if (!encoded.length || encoded.length > maxEncoded || encoded.length % 4 !== 0 || invalidCharacter || interiorPadding) {
    throw binaryError(encoded.length > maxEncoded ? 'INPUT_BYTES_LIMIT' : 'BINARY_SERIALIZATION_INVALID', encoded.length > maxEncoded ? 413 : 400)
  }
  const decodedLength = (encoded.length / 4) * 3 - padding
  if (decodedLength > maxBytes) throw binaryError('INPUT_BYTES_LIMIT', 413)
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > maxBytes || bytes.toString('base64') !== encoded) throw binaryError(bytes.length > maxBytes ? 'INPUT_BYTES_LIMIT' : 'BINARY_SERIALIZATION_INVALID', bytes.length > maxBytes ? 413 : 400)
  return bytes
}

export async function parseKnowledgeBinary({ bytes, mediaType, sourceId, sourceVersion, rawArtifactId, parserVersion = KNOWLEDGE_BINARY_PARSER_VERSION } = {}) {
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) throw binaryError('BINARY_INPUT_INVALID', 400)
  if (bytes.length === 0) throw binaryError('EMPTY_DOCUMENT', 422)
  if (bytes.length > KNOWLEDGE_BINARY_MAX_BYTES) throw binaryError('INPUT_BYTES_LIMIT', 413)
  if (!Object.hasOwn(KNOWLEDGE_BINARY_FORMATS, String(mediaType || '').toLowerCase())) throw binaryError('UNSUPPORTED_MEDIA_TYPE', 415)
  const inputBytes = Buffer.from(bytes)
  if (await detectKnowledgeBinaryMediaType(inputBytes) !== String(mediaType).toLowerCase()) throw binaryError('MEDIA_TYPE_MISMATCH', 415)
  const worker = new Worker(new URL('./knowledge-binary-parser-worker.mjs', import.meta.url), {
    workerData: { bytes: new Uint8Array(inputBytes), mediaType, sourceId, sourceVersion, rawArtifactId, parserVersion, rawSha256: hashKnowledgeBinaryBytes(inputBytes) },
    // These are V8 heap limits, not a hard resident-set-size guarantee.
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      callback(value)
    }
    const timer = setTimeout(() => finish(reject, binaryError('PARSER_TIMEOUT', 408)), KNOWLEDGE_BINARY_TIMEOUT_MS)
    timer.unref?.()
    worker.once('message', (message) => {
      if (!message || message.ok !== true || !message.result) {
        const detail = message?.error || {}
        const code = ['INPUT_BYTES_LIMIT', 'PDF_PAGE_LIMIT', 'DOCX_PARAGRAPH_LIMIT', 'TABLE_CELL_LIMIT', 'HTML_ELEMENT_LIMIT', 'ARCHIVE_EXPANSION_LIMIT', 'ARCHIVE_ENTRY_COUNT_LIMIT', 'AMBIGUOUS_TABLE_MAPPING', 'PDF_TABLE_NOT_PROJECTED', 'OUTPUT_BYTES_LIMIT', 'PARSER_TIMEOUT', 'IMAGE_ONLY_DOCUMENT', 'IMAGE_CONTENT_NOT_PROCESSED', 'MALFORMED_PDF', 'MALFORMED_DOCX', 'ENCRYPTED_DOCUMENT', 'EXTERNAL_RELATIONSHIP', 'UNSUPPORTED_DOCX_FEATURE', 'INVALID_UTF8_HTML', 'MEDIA_TYPE_MISMATCH', 'EMPTY_DOCUMENT'].includes(detail.code) ? detail.code : 'PARSER_FAILED'
        const status = ['INPUT_BYTES_LIMIT', 'PDF_PAGE_LIMIT', 'DOCX_PARAGRAPH_LIMIT', 'TABLE_CELL_LIMIT', 'HTML_ELEMENT_LIMIT', 'ARCHIVE_EXPANSION_LIMIT', 'ARCHIVE_ENTRY_COUNT_LIMIT', 'OUTPUT_BYTES_LIMIT'].includes(code)
          ? 413
          : code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : code === 'PARSER_TIMEOUT' ? 408 : code === 'BINARY_PROFILE_INVALID' ? 400 : 422
        return finish(reject, binaryError(code, status))
      }
      finish(resolve, message.result)
    })
    worker.once('error', () => finish(reject, binaryError('PARSER_WORKER_FAILED', 422)))
    worker.once('exit', (code) => {
      if (!settled) finish(reject, binaryError(code === 0 ? 'PARSER_NO_RESULT' : 'PARSER_WORKER_FAILED', 422))
    })
  })
}

function binaryError(code, status, message = code) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}
