import { describe, expect, it } from 'vitest'
import {
  hashMarketingContentContent,
  parseMarketingContentVersionPayload,
  serializeMarketingContentVersion,
  zMarketingContentPayloadInput,
} from '@/modules/marketing/domain/marketing-content-contract'

// @req FR-157 — Content payloads stay distinct from Strategy and bind only
// server-resolved immutable FileAsset metadata.
// @spec SDD-088, BR-007, SEC-001
// @tested tests/unit/marketing/marketing-content-contract.test.js

const payload = {
  objective: 'Publish an evidence-backed product story',
  audience: 'Thai SME owners',
  message: 'A clear operating system for the next growth step',
  claims: 'Claims must be supported by the evidence reference.',
  shotList: 'Opening product frame, customer proof, closing CTA',
  acceptanceCriteria: 'Readable caption and approved claim wording',
  evidenceReference: 'facts://business/product-brief/v1',
  format: 'IMAGE',
  initiativeId: null,
  channels: ['INSTAGRAM', 'SEO'],
  asset: { fileId: 'file-1' },
  rights: {
    holder: 'Business A',
    license: 'Owned media',
    channels: ['INSTAGRAM', 'SEO'],
    validFrom: '2026-09-06T00:00:00.000Z',
    validUntil: '2026-10-06T00:00:00.000Z',
    proof: 'rights://business-a/creative-1',
  },
  production: null,
}

describe('Marketing content contract', () => {
  it('accepts client file ids but rejects resolved file metadata and Strategy fields', () => {
    expect(zMarketingContentPayloadInput.parse(payload)).toMatchObject({ asset: { fileId: 'file-1' } })
    expect(() => zMarketingContentPayloadInput.parse({ ...payload, budget: 1 })).toThrow()
    expect(() => zMarketingContentPayloadInput.parse({
      ...payload,
      asset: { fileId: 'file-1', fileVersion: 2, sha256: 'a'.repeat(64) },
    })).toThrow()
  })

  it('rejects rights that do not cover every intended channel or have an invalid window', () => {
    expect(() => zMarketingContentPayloadInput.parse({
      ...payload,
      rights: { ...payload.rights, channels: ['INSTAGRAM'] },
    })).toThrow(/cover every intended channel/)
    expect(() => zMarketingContentPayloadInput.parse({
      ...payload,
      rights: { ...payload.rights, validUntil: '2026-09-01T00:00:00.000Z' },
    })).toThrow(/after validFrom/)
    expect(() => zMarketingContentPayloadInput.parse({ ...payload, asset: null, rights: payload.rights })).toThrow(/require an asset/)
  })

  it('canonicalizes key order while binding title and the resolved revision payload', () => {
    const persisted = {
      ...payload,
      asset: { fileId: 'file-1', fileVersion: 2, sha256: 'a'.repeat(64) },
    }
    const reordered = {
      production: null,
      rights: persisted.rights,
      asset: persisted.asset,
      channels: persisted.channels,
      initiativeId: null,
      format: persisted.format,
      evidenceReference: persisted.evidenceReference,
      acceptanceCriteria: persisted.acceptanceCriteria,
      shotList: persisted.shotList,
      claims: persisted.claims,
      message: persisted.message,
      audience: persisted.audience,
      objective: persisted.objective,
    }
    expect(hashMarketingContentContent({ title: 'Creative brief', payload: persisted }))
      .toBe(hashMarketingContentContent({ title: 'Creative brief', payload: reordered }))
    expect(hashMarketingContentContent({ title: 'Creative brief v2', payload: persisted }))
      .not.toBe(hashMarketingContentContent({ title: 'Creative brief', payload: persisted }))
  })

  it('stores title and persisted payload in an exact immutable envelope', () => {
    const persisted = {
      ...payload,
      asset: { fileId: 'file-1', fileVersion: 2, sha256: 'a'.repeat(64) },
    }
    const stored = serializeMarketingContentVersion({ title: 'Creative brief', payload: persisted })
    expect(parseMarketingContentVersionPayload(stored)).toEqual({ title: 'Creative brief', payload: persisted })
    expect(() => parseMarketingContentVersionPayload(JSON.stringify(persisted))).toThrow(/immutable title/i)
  })
})
