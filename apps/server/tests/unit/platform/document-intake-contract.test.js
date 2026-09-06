import { describe, expect, it } from 'vitest'

import {
  validateDocumentIntakeContract,
} from '@/platform/integrations/core/document-intake-contract'

// @req FR-071 — validate the SmartGift document contract before it reaches the
// server-owned raw staging repository.
// @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
// SEC-001, SEC-008
// @tested tests/unit/platform/document-intake-contract.test.js

function validContract(overrides = {}) {
  const artifactSha256 = overrides.document?.artifactSha256 || 'b'.repeat(64)
  const document = {
    documentId: `doc_${artifactSha256.slice(0, 32)}`,
    sourceRef: 'inbox/customer-list.xlsx',
    fileName: 'customer-list.xlsx',
    kind: 'excel',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 100,
    artifactSha256,
    ...overrides.document,
  }
  const extraction = {
    methods: ['spreadsheet_parser', 'thai_ocr', 'vision_layout'],
    requiresVision: true,
    requiredMethods: ['thai_ocr', 'vision_layout'],
    embeddedImageCount: 1,
    ...overrides.extraction,
  }
  return {
    contractVersion: 'smartgift.document-intake.v1',
    document,
    domain: 'customer',
    language: 'th-TH',
    pipelineRunId: 'run_contract',
    extractionRunId: 'extract_contract',
    extraction,
    fields: [{
      path: 'customer.name',
      value: 'Example',
      confidence: 0.91,
      method: 'thai_ocr',
      evidence: { sheet: 'ลูกค้า', cell: 'A2' },
    }],
    status: 'READY_FOR_VALIDATION',
    dataClassification: 'restricted',
    warnings: [],
    createdAt: '2026-08-21T00:00:00.000Z',
    target: {
      system: 'supabase',
      mode: 'STAGING_ONLY',
      table: 'customer_import_staging',
    },
    promotion: {
      canonicalWrite: 'cloud-agent-only',
      requiresValidation: true,
      requiresEvidence: true,
    },
    ...overrides,
    document,
    extraction,
  }
}

describe('smartgift.document-intake.v1', () => {
  it('accepts a Thai restricted Customer contract with evidence', () => {
    expect(validateDocumentIntakeContract(validContract())).toMatchObject({
      contractVersion: 'smartgift.document-intake.v1',
      domain: 'customer',
      dataClassification: 'restricted',
    })
  })

  it('rejects an absolute local source path', () => {
    expect(() => validateDocumentIntakeContract(validContract({
      document: { sourceRef: 'D:/private/customer-list.xlsx' },
    }))).toThrow(/absolute local path/i)
  })

  it('rejects a document id that is not derived from the artifact hash', () => {
    expect(() => validateDocumentIntakeContract(validContract({
      document: { documentId: 'doc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    }))).toThrow(/documentId must be derived/i)
  })

  it('rejects missing evidence and disallowed fields', () => {
    expect(() => validateDocumentIntakeContract(validContract({
      fields: [{
        path: 'customer.taxId',
        value: 'x',
        confidence: 0.8,
        method: 'thai_ocr',
        evidence: {},
      }],
    }))).toThrow(/evidence location/i)

    expect(() => validateDocumentIntakeContract(validContract({
      fields: [{
        path: 'customer.creditLimit',
        value: 10,
        confidence: 0.8,
        method: 'thai_ocr',
        evidence: { sheet: 'ลูกค้า', cell: 'B2' },
      }],
    }))).toThrow(/not allowed/i)
  })
})
