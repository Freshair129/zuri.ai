import { z } from 'zod'
import { ASSET_EVIDENCE_DOCUMENT_TYPES, zAssetEvidenceDocumentType } from '@/lib/validation/enums'

// @req FR-138, FR-143 — one candidate shape, validated identically wherever a
//   candidate enters the system. The OpenAI adapter (FR-138) asks the provider
//   for exactly this structure and parses its reply with it; the edge job
//   completion path (FR-143) validates the device's posted candidate with the
//   same object. Two copies of this schema would let one path accept what the
//   other refuses, and the difference would show up as a stored candidate no
//   reviewer could explain.
// @spec SDD-085, SDD-082, BR-025, ADR-059
// @tested tests/unit/asset-evidence-extractor-contract.test.js,
//   tests/unit/edge-extraction-job-contract.test.js

/** The strict candidate a provider (cloud or edge) may return. */
export const zCandidate = z.object({
  schemaVersion: z.literal('1.0'),
  status: z.literal('CANDIDATE'),
  documentType: zAssetEvidenceDocumentType,
  fields: z.array(z.object({
    field: z.string().min(1).max(100),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    confidence: z.number().min(0).max(1),
    page: z.number().int().positive().nullable().optional(),
    anchor: z.string().max(500).nullable().optional(),
    bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
  }).strict()).max(200),
}).strict()

/** The same contract as a JSON Schema, for a provider's structured-output request. */
export const CANDIDATE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'status', 'documentType', 'fields'],
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] },
    status: { type: 'string', enum: ['CANDIDATE'] },
    documentType: { type: 'string', enum: ASSET_EVIDENCE_DOCUMENT_TYPES },
    fields: {
      type: 'array', maxItems: 200,
      items: {
        type: 'object', additionalProperties: false,
        required: ['field', 'value', 'confidence', 'page', 'anchor', 'bounds'],
        properties: {
          field: { type: 'string' },
          value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          page: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          anchor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          bounds: {
            anyOf: [{
              type: 'object', additionalProperties: false,
              required: ['x', 'y', 'width', 'height'],
              properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
            }, { type: 'null' }],
          },
        },
      },
    },
  },
}
