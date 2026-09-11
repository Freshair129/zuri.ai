import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GENESIS_RAG17_PARSER_PROFILES,
  GENESIS_RAG17_PARSER_VERSION,
  GENESIS_RAG17_PARSER_VERSION_2,
  GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION,
  extractGenesisRag17Mentions,
  genesisRag17ParserIdentity,
  genesisRag17ParserProfileForProvider,
  genesisRag17RecognizerIdentity,
  genesisRag17StructuredRecognizer,
  parseGenesisRag17Document,
  parsedArtifactContentHash,
} from '@/modules/knowledge/genesisrag17-source'
import { hasUnmappedTemporalLanguage, isoDatesIn } from '@/modules/knowledge/genesisrag17-structured-record'
import { canonicalGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import { normalizeOrganizationName } from '@/modules/knowledge/normalization'

// @req FR-188 — genesisrag17-parser-2 renders each SmartGift catalog record into
// one descriptive section (one mention, no date) plus one canonical-JSON claim
// section per relation, and the pinned structured recognizer keys every
// occurrence by the SmartGift code verbatim; parser-1 prose is unchanged.
// @spec ADR-075, docs/plans/GENESISRAG17-CONTRACT.md, docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md
// @tested tests/unit/genesisrag17-parser-2.test.js

const fixture = (name) => readFileSync(new URL(`../fixtures/genesisrag17/smartgift-catalog/${name}`, import.meta.url), 'utf8')
const products = JSON.parse(fixture('products.json'))
const bundles = JSON.parse(fixture('bundles.json'))
const pricelist = JSON.parse(fixture('pricelist.json'))
const corpus = JSON.parse(readFileSync(new URL('../fixtures/genesisrag17-corpus-v1.json', import.meta.url), 'utf8'))

const STRUCTURED = GENESIS_RAG17_PARSER_PROFILES.STRUCTURED_RECORD
const { recognizer: structuredRecognizer } = genesisRag17RecognizerIdentity(STRUCTURED)

function parse2(content, ids = {}) {
  return parseGenesisRag17Document({
    documentId: ids.documentId ?? 'doc-sg',
    rawArtifactId: ids.rawArtifactId ?? 'raw-sg',
    parsedArtifactId: ids.parsedArtifactId ?? 'parsed-sg',
    content: typeof content === 'string' ? content : canonicalGenesisRag17Json(content),
    profile: STRUCTURED,
  })
}

function parseAll(records) {
  return records.map((record) => {
    const result = parse2(record, { parsedArtifactId: `parsed-${record.externalId}` })
    return { record, ...result, mentions: extractGenesisRag17Mentions(result.chunks, { recognizer: structuredRecognizer }) }
  })
}

const isClaim = (chunk) => chunk.text.startsWith('{')

// Mirrors GKS gks-core pipeline.mjs parseStructuredClaim + occurrenceMatches:
// the whole chunk is the JSON, and both endpoints resolve to a mention in that
// chunk whose name equals the value and whose offsets slice to it.
function gksStructuredClaim(chunk, mentions) {
  const parsed = JSON.parse(chunk.text.trim())
  if (/[?]/.test(chunk.text) || /\b(?:does not|did not|didn't|doesn't|never)\b/i.test(chunk.text)) return null
  const label = (value) => String(value).trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  const find = (value) => mentions.find((mention) => label(mention.name) === label(value) && chunk.text.slice(mention.startOffset, mention.endOffset).toLowerCase() === mention.name.toLowerCase())
  return { predicate: parsed.predicate, subject: find(parsed.subject), object: find(parsed.object) }
}

describe('genesisrag17-parser-2 identity and selection', () => {
  it('selects parser-2 only for SMARTGIFT_CATALOG sources', () => {
    expect(genesisRag17ParserProfileForProvider('SMARTGIFT_CATALOG')).toBe(STRUCTURED)
    for (const provider of [undefined, null, 'genesisrag17', 'KNOWLEDGE_ADMISSION', 'smartgift_catalog']) {
      expect(genesisRag17ParserProfileForProvider(provider)).toBe(GENESIS_RAG17_PARSER_PROFILES.TEXT)
    }
    expect(genesisRag17ParserIdentity({ profile: STRUCTURED })).toBe(GENESIS_RAG17_PARSER_VERSION_2)
    expect(GENESIS_RAG17_PARSER_VERSION_2).toBe('genesisrag17-parser-2')
    expect(genesisRag17ParserIdentity()).toBe(GENESIS_RAG17_PARSER_VERSION)
    expect(genesisRag17RecognizerIdentity(STRUCTURED).recognizerVersion).toBe('genesisrag17-structured-recognizer-1')
    expect(genesisRag17RecognizerIdentity(STRUCTURED).recognizerVersion).toBe(GENESIS_RAG17_STRUCTURED_RECOGNIZER_VERSION)
    expect(genesisRag17RecognizerIdentity().recognizerVersion).toBe('rule_v1')
  })

  it('refuses a token budget, an unknown profile, and a mismatched parser identity', () => {
    expect(() => genesisRag17ParserIdentity({ profile: STRUCTURED, maxTokens: 4 })).toThrow(/does not window/)
    expect(() => genesisRag17ParserIdentity({ profile: 'binary' })).toThrow(/profile is unknown/)
    expect(() => parseGenesisRag17Document({ documentId: 'd', rawArtifactId: 'r', content: canonicalGenesisRag17Json(products[0]), profile: STRUCTURED, parserVersion: GENESIS_RAG17_PARSER_VERSION })).toThrow(/configuration identity/)
  })
})

describe('genesisrag17-parser-2 rendering (C-4)', () => {
  it('renders a product as one descriptive section plus one IN_CATEGORY claim at exact offsets', () => {
    const record = products.find((row) => row.code === 'PM-BOTTLE-LED')
    const { parsed, chunks } = parse2(record)
    const descriptive = parsed.content.split('\n\n')[0]
    const claim = '{"object":"eco-friendly","predicate":"IN_CATEGORY","subject":"PM-BOTTLE-LED"}'

    expect(parsed.parserVersion).toBe(GENESIS_RAG17_PARSER_VERSION_2)
    expect(parsed.content).toBe(`${descriptive}\n\n${claim}`)
    expect(parsed.contentHash).toBe(hashGenesisRag17Text(parsed.content))
    expect(descriptive.split('\n')[0]).toBe('ProductMaster PM-BOTTLE-LED')
    expect(chunks.map(({ ordinal, text, startOffset, endOffset }) => ({ ordinal, text, startOffset, endOffset }))).toEqual([
      { ordinal: 0, text: descriptive, startOffset: 0, endOffset: descriptive.length },
      { ordinal: 1, text: claim, startOffset: descriptive.length + 2, endOffset: descriptive.length + 2 + claim.length },
    ])
    expect(parsed.metadata).toMatchObject({ extractorVersion: 'genesisrag17-parser-2', chunkBoundary: 'record-section', recordCount: 1, descriptiveCount: 1, claimCount: 1, chunkCount: 2, catalogVersionDate: null, rawContentHash: hashGenesisRag17Text(canonicalGenesisRag17Json(record)) })
    for (const chunk of chunks) {
      expect(parsed.content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
      expect(chunk.contentHash).toBe(hashGenesisRag17Text(chunk.text))
    }
  })

  it('does not window a long record: one section is one chunk', () => {
    const record = { ...products.find((row) => row.code === 'PM-NB'), nameEn: Array.from({ length: 120 }, (_, index) => `w${index}`).join(' ') }
    const { parsed, chunks } = parse2(record)
    expect(chunks[0].tokenCount).toBeGreaterThan(80)
    expect(chunks).toHaveLength(2)
    expect(parsed.metadata).toMatchObject({ chunkerVersion: null, maxTokens: null })
  })

  it('renders every fixture record with the expected descriptive and claim sections', () => {
    const all = parseAll([...products, ...bundles, ...pricelist])
    const claimsOf = (code) => all.find(({ record }) => record.externalId === code).chunks.filter(isClaim).map((chunk) => JSON.parse(chunk.text))

    for (const { record, chunks } of all) {
      expect(chunks.filter((chunk) => !isClaim(chunk))).toHaveLength(1)
      expect(chunks[0].ordinal).toBe(0)
      expect(isClaim(chunks[0])).toBe(false)
      expect(chunks[0].text.startsWith(`${record.entityType} `)).toBe(true)
    }
    expect(claimsOf('PM-TMB')).toEqual([{ subject: 'PM-TMB', predicate: 'IN_CATEGORY', object: 'eco-friendly' }])
    expect(claimsOf('PM-PB10K')).toEqual([{ subject: 'PM-PB10K', predicate: 'IN_CATEGORY', object: 'executive-smart-tech' }])
    expect(claimsOf('PKG-XMAS-2026-SIGNATURE-CLEVEL')).toEqual([
      { subject: 'PKG-XMAS-2026-SIGNATURE-CLEVEL', predicate: 'HAS_COMPONENT', object: 'PM-NB' },
      { subject: 'PKG-XMAS-2026-SIGNATURE-CLEVEL', predicate: 'HAS_COMPONENT', object: 'PM-PB10K' },
      { subject: 'PKG-XMAS-2026-SIGNATURE-CLEVEL', predicate: 'HAS_COMPONENT', object: 'PM-PEN' },
    ])
    expect(claimsOf('PKG-NY-2027-REACH-OPS')).toEqual([
      { subject: 'PKG-NY-2027-REACH-OPS', predicate: 'HAS_COMPONENT', object: 'PM-TMB' },
      { subject: 'PKG-NY-2027-REACH-OPS', predicate: 'HAS_COMPONENT', object: 'PM-BOTTLE-LED' },
    ])
    expect(claimsOf('PM-BOTTLE-LED@qty100')).toEqual([{ subject: 'PM-BOTTLE-LED', predicate: 'PRICED_AT', object: 'PM-BOTTLE-LED:qty100:20000' }])
    expect(claimsOf('PM-TMB@qty500')).toEqual([{ subject: 'PM-TMB', predicate: 'PRICED_AT', object: 'PM-TMB:qty500:20000' }])
    expect(all.flatMap(({ chunks }) => chunks.filter(isClaim))).toHaveLength(5 + 5 + 15)
  })

  it('makes every claim chunk the whole canonical JSON triple whose endpoints are that chunk’s mentions', () => {
    for (const { chunks, mentions } of parseAll([...products, ...bundles, ...pricelist])) {
      for (const chunk of chunks.filter(isClaim)) {
        const triple = JSON.parse(chunk.text)
        expect(Object.keys(triple).sort()).toEqual(['object', 'predicate', 'subject'])
        expect(chunk.text).toBe(canonicalGenesisRag17Json(triple))
        const own = mentions.filter((mention) => mention.chunkId === chunk.chunkId)
        expect(own.map((mention) => mention.name).sort()).toEqual([triple.subject, triple.object].sort())
        for (const mention of own) expect(chunk.text.slice(mention.startOffset, mention.endOffset)).toBe(mention.name)
        const claim = gksStructuredClaim(chunk, own)
        expect(claim.subject?.name).toBe(triple.subject)
        expect(claim.object?.name).toBe(triple.object)
        expect(chunk.text).not.toMatch(/[?]|\bnever\b|\bdoes not\b/i)
      }
    }
  })
})

describe('genesisrag17-structured-recognizer-1 (C-6)', () => {
  it('gives each descriptive chunk exactly one mention: the record’s own entity', () => {
    for (const { record, chunks, mentions } of parseAll([...products, ...bundles, ...pricelist])) {
      const own = mentions.filter((mention) => mention.chunkId === chunks[0].chunkId)
      expect(own).toHaveLength(1)
      const expected = {
        ProductMaster: { semanticType: 'Product', name: record.code },
        BundleOffer: { semanticType: 'PACKAGE', name: record.code },
        PriceListEntry: { semanticType: 'PRICE_TIER', name: `${record.productExternalId}:qty${record.qty}:${Math.round(record.srpUnitPriceThb * 100)}` },
      }[record.entityType]
      expect(own[0]).toMatchObject({ ...expected, startOffset: record.entityType.length + 1 })
    }
  })

  it('types claim endpoints Product / PACKAGE / CATEGORY / PRICE_TIER', () => {
    const typed = (records) => parseAll(records).flatMap(({ chunks, mentions }) => chunks.filter(isClaim).map((chunk) => {
      const triple = JSON.parse(chunk.text)
      const byName = Object.fromEntries(mentions.filter((mention) => mention.chunkId === chunk.chunkId).map((mention) => [mention.name, mention.semanticType]))
      return [triple.predicate, byName[triple.subject], byName[triple.object]]
    }))
    expect(new Set(typed(products).map((row) => row.join(' ')))).toEqual(new Set(['IN_CATEGORY Product CATEGORY']))
    expect(new Set(typed(bundles).map((row) => row.join(' ')))).toEqual(new Set(['HAS_COMPONENT PACKAGE Product']))
    expect(new Set(typed(pricelist).map((row) => row.join(' ')))).toEqual(new Set(['PRICED_AT Product PRICE_TIER']))
  })

  it('keys every occurrence by the SmartGift code verbatim, bypassing organization normalization', () => {
    const all = parseAll([...products, ...bundles, ...pricelist])
    for (const mention of all.flatMap(({ mentions }) => mentions)) expect(mention.resolutionKey).toBe(mention.name)

    const affixed = { ...products[0], category: 'Acme Ltd.' }
    expect(normalizeOrganizationName('Acme Ltd.')).not.toBe('Acme Ltd.')
    const [{ mentions }] = parseAll([affixed])
    expect(mentions.find((mention) => mention.semanticType === 'CATEGORY')).toMatchObject({ name: 'Acme Ltd.', resolutionKey: 'Acme Ltd.' })
  })

  it('keeps PRICE_TIER codes distinct and sourceMentionIds unique', () => {
    const all = parseAll(pricelist)
    const tiers = all.flatMap(({ mentions }) => mentions).filter((mention) => mention.semanticType === 'PRICE_TIER')
    expect(new Set(tiers.map((mention) => mention.resolutionKey)).size).toBe(15)
    expect(tiers).toHaveLength(30)
    const ids = all.flatMap(({ mentions }) => mentions.map((mention) => mention.sourceMentionId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays the only exception to the recognizer guard and refuses prose', () => {
    const { chunks } = parse2(products[0])
    expect(() => extractGenesisRag17Mentions(chunks, { recognizer: (input) => genesisRag17StructuredRecognizer(input) })).toThrow(/custom recognizers/)
    expect(() => extractGenesisRag17Mentions([{ chunkId: 'c', text: 'Alice works for Acme Ltd.' }], { recognizer: structuredRecognizer })).toThrow(expect.objectContaining({ code: 'GENESISRAG17_STRUCTURED_RECOGNIZER_INPUT_INVALID' }))
    expect(() => extractGenesisRag17Mentions([{ chunkId: 'c', text: '{"subject":"A","predicate":"IN_CATEGORY","object":"b"}' }], { recognizer: structuredRecognizer })).toThrow(/canonical form/)
  })
})

describe('genesisrag17-parser-2 temporal rendering (C-5)', () => {
  const all = (records) => parseAll(records).flatMap(({ chunks }) => chunks)

  it('leaves the undated fixture uniformly undated with no temporal phrase in any claim', () => {
    for (const chunk of all([...products, ...bundles, ...pricelist])) {
      expect(isoDatesIn(chunk.text)).toEqual([])
      if (isClaim(chunk)) expect(hasUnmappedTemporalLanguage(chunk.text)).toBe(false)
    }
  })

  it('puts exactly the one catalog version date in every claim chunk and none in descriptive chunks', () => {
    const dated = [...products, ...bundles, ...pricelist].map((record) => ({ ...record, catalogVersionDate: '2026-09-01' }))
    const results = parseAll(dated)
    for (const { parsed, chunks } of results) {
      expect(parsed.metadata.catalogVersionDate).toBe('2026-09-01')
      for (const chunk of chunks) {
        if (isClaim(chunk)) {
          expect(isoDatesIn(chunk.text)).toEqual(['2026-09-01'])
          expect(Object.keys(JSON.parse(chunk.text)).sort()).toEqual(['catalogVersionDate', 'object', 'predicate', 'subject'])
          expect(hasUnmappedTemporalLanguage(chunk.text)).toBe(false)
        } else {
          expect(isoDatesIn(chunk.text)).toEqual([])
        }
      }
    }
    const { mentions } = results.find(({ record }) => record.externalId === 'PM-TMB@qty1')
    expect(mentions.map((mention) => mention.name)).toEqual(['PM-TMB:qty1:32000', 'PM-TMB:qty1:32000', 'PM-TMB'])
  })

  it('refuses a mixed batch, an impossible date and a temporal phrase in a claim', () => {
    const mixed = [{ ...products[0], catalogVersionDate: '2026-09-01' }, products[1]]
    expect(() => parse2(JSON.stringify(mixed))).toThrow(/mixes catalog version dates/)
    expect(() => parse2({ ...products[0], catalogVersionDate: '2026-02-30' })).toThrow(expect.objectContaining({ code: 'GENESISRAG17_STRUCTURED_RECORD_INVALID' }))
    expect(() => parse2({ ...products[0], category: 'sale in 2026' })).toThrow(/temporal language/)
    // A code carrying an ISO date is refused before it could become a second date.
    expect(() => parse2({ ...products[0], category: 'launch-2026-01-01' })).toThrow(/descriptive section must carry no date/)
    expect(() => parse2({ ...pricelist[0], productExternalId: 'PM-2026-01-01', externalId: 'x' })).toThrow(/date/)
    expect(() => parse2({ ...products[0], category: 'what?' })).toThrow(/question or negation/)
  })
})

describe('genesisrag17-parser-2 negative and idempotency cases', () => {
  it('fails malformed records with a parser error and emits no chunks', () => {
    const { nameTh, ...missingName } = products[0]
    expect(nameTh).toBeTruthy()
    for (const content of ['{"entityType":', JSON.stringify(missingName), JSON.stringify({ ...products[0], entityType: 'CatalogOffer' }), '[]', JSON.stringify([products[0], products[0]]), JSON.stringify({ ...products[0], code: 'PM-OTHER' }), JSON.stringify({ ...products[0], code: 'PKG-X', externalId: 'PKG-X' })]) {
      let result
      let thrown
      try {
        result = parse2(content)
      } catch (error) {
        thrown = error
      }
      expect(result).toBeUndefined()
      expect(thrown).toMatchObject({ status: 422, code: 'GENESISRAG17_STRUCTURED_RECORD_INVALID' })
      expect(JSON.stringify(thrown.details ?? {})).not.toContain('กระบอก')
    }
    expect(() => parse2({ ...bundles[1], components: [...bundles[1].components, { productExternalId: 'PKG-NESTED', qty: 1, srpQty1Thb: 1 }] })).toThrow(/not a product code/)
    expect(() => parse2({ ...pricelist[0], srpUnitPriceThb: 290.001 })).toThrow(/satang/)
  })

  it('strips an unknown top-level field without rendering it, so Stage 5 still owns the deny', () => {
    const { parsed } = parse2({ ...products[0], customerName: 'someone' })
    expect(parsed.content).not.toContain('customerName')
    expect(parsed.content).not.toContain('someone')
  })

  it('renders an array of records in order and a bundle category as IN_CATEGORY on the PACKAGE', () => {
    const { parsed, chunks } = parse2(JSON.stringify([products[0], { ...bundles[1], category: 'eco-friendly' }]))
    expect(parsed.metadata.recordCount).toBe(2)
    expect(chunks.map((chunk) => chunk.headingPath[1])).toEqual(['descriptive', 'claim IN_CATEGORY', 'descriptive', 'claim HAS_COMPONENT', 'claim HAS_COMPONENT', 'claim IN_CATEGORY'])
    const mentions = extractGenesisRag17Mentions(chunks, { recognizer: structuredRecognizer })
    expect(mentions.filter((mention) => mention.chunkId === chunks[5].chunkId).map((mention) => [mention.semanticType, mention.name])).toEqual([
      ['CATEGORY', 'eco-friendly'],
      ['PACKAGE', 'PKG-NY-2027-REACH-OPS'],
    ])
  })

  it('types a priced package subject as PACKAGE', () => {
    const entry = { ...pricelist[0], externalId: 'PKG-XMAS@qty10', productExternalId: 'PKG-XMAS-2026-SIGNATURE-CLEVEL', qty: 10, srpUnitPriceThb: 930 }
    const [{ chunks, mentions }] = parseAll([entry])
    expect(mentions.filter((mention) => mention.chunkId === chunks[1].chunkId).map((mention) => [mention.semanticType, mention.name])).toEqual([
      ['PRICE_TIER', 'PKG-XMAS-2026-SIGNATURE-CLEVEL:qty10:93000'],
      ['PACKAGE', 'PKG-XMAS-2026-SIGNATURE-CLEVEL'],
    ])
  })

  it('produces the identical parsed artifact from the same raw twice (dedupe key)', () => {
    const content = canonicalGenesisRag17Json(bundles[0])
    const first = parse2(content)
    const second = parse2(content)
    expect(second).toEqual(first)
    expect(parsedArtifactContentHash(second.parsed)).toBe(parsedArtifactContentHash(first.parsed))
    expect(extractGenesisRag17Mentions(second.chunks, { recognizer: structuredRecognizer })).toEqual(extractGenesisRag17Mentions(first.chunks, { recognizer: structuredRecognizer }))
  })
})

describe('genesisrag17-parser-1 prose regression', () => {
  it('parses prose exactly as before when no profile is named', () => {
    const implicit = parseGenesisRag17Document({ documentId: 'doc-corpus', rawArtifactId: 'raw-v1', parsedArtifactId: 'parsed-v1', content: corpus.text })
    const explicit = parseGenesisRag17Document({ documentId: 'doc-corpus', rawArtifactId: 'raw-v1', parsedArtifactId: 'parsed-v1', content: corpus.text, profile: GENESIS_RAG17_PARSER_PROFILES.TEXT })
    expect(explicit).toEqual(implicit)
    expect(implicit.parsed.parserVersion).toBe('genesisrag17-parser-1')
    expect(implicit.parsed.content).toBe(corpus.text)
    expect(implicit.parsed.metadata).toMatchObject({ chunkerVersion: 'genesisrag17-chunker-1', maxTokens: 80 })
    expect(implicit.chunks).toHaveLength(8)
    const mentions = extractGenesisRag17Mentions(implicit.chunks)
    expect(mentions.filter((mention) => mention.semanticType === 'Person')).toHaveLength(8)
    expect(mentions.filter((mention) => mention.semanticType === 'Organization')).toHaveLength(4)
    expect(mentions.filter((mention) => mention.semanticType === 'Product')).toHaveLength(4)
    expect(mentions.every((mention) => mention.resolutionKey === normalizeOrganizationName(mention.name))).toBe(true)
  })
})
