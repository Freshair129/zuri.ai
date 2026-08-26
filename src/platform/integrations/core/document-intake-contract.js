import { z } from 'zod'

// @req FR-071 — the document intake adapter accepts the SmartGift extraction
// contract as a strict, evidence-bearing staging envelope before any canonical
// Supabase write.
// @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
// SEC-001, SEC-008
// @tested tests/unit/platform/document-intake-contract.test.js

export const DOCUMENT_INTAKE_CONTRACT_VERSION = 'smartgift.document-intake.v1'
export const DOCUMENT_INTAKE_PROVIDER_CODE = 'SMARTGIFT_DOCUMENT_INTAKE'
export const DOCUMENT_INTAKE_PURPOSE = 'DATA_DOCUMENT_INGESTION'

export const DOCUMENT_INTAKE_DOMAINS = Object.freeze(['product', 'customer'])
export const DOCUMENT_INTAKE_ENTITY_TYPES = Object.freeze({
  product: 'PRODUCT_DOCUMENT',
  customer: 'CUSTOMER_DOCUMENT',
})

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase SHA-256 digest')
const DOCUMENT_KINDS = ['pdf', 'docx', 'excel', 'image']
const EXTRACTION_METHODS = ['native_text', 'spreadsheet_parser', 'thai_ocr', 'vision_layout']
const CONTRACT_STATUSES = ['EXTRACTED_NATIVE', 'VISION_REQUIRED', 'READY_FOR_VALIDATION', 'QUARANTINED']

const MIME_TYPES_BY_KIND = Object.freeze({
  pdf: new Set(['application/pdf']),
  docx: new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12',
  ]),
  excel: new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
  ]),
  image: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff']),
})

export const DOCUMENT_FIELD_ALLOWLIST = Object.freeze({
  product: Object.freeze([
    'product.sku',
    'product.name',
    'product.category',
    'product.description',
    'product.attributes',
  ]),
  customer: Object.freeze([
    'customer.name',
    'customer.legalName',
    'customer.taxId',
    'customer.phone',
    'customer.email',
    'customer.address',
    'customer.contactName',
  ]),
})

const evidenceSchema = z.object({
  page: z.number().int().positive().optional(),
  sheet: z.string().min(1).optional(),
  cell: z.string().min(1).optional(),
  bbox: z.array(z.number().finite()).length(4).optional(),
  anchor: z.string().min(1).optional(),
  excerpt: z.string().optional(),
}).strict()

const fieldSchema = z.object({
  path: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().finite().min(0).max(1),
  method: z.enum(EXTRACTION_METHODS),
  evidence: evidenceSchema,
}).strict()

const documentSchema = z.object({
  documentId: z.string().regex(/^doc_[0-9a-f]{32}$/),
  sourceRef: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  kind: z.enum(DOCUMENT_KINDS),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().max(1024 * 1024 * 1024),
  artifactSha256: SHA256,
}).strict()

const extractionSchema = z.object({
  methods: z.array(z.enum(EXTRACTION_METHODS)).min(1),
  requiresVision: z.boolean(),
  requiredMethods: z.array(z.enum(['thai_ocr', 'vision_layout'])),
  embeddedImageCount: z.number().int().nonnegative(),
}).strict()

const targetSchema = z.object({
  system: z.literal('supabase'),
  mode: z.literal('STAGING_ONLY'),
  table: z.enum(['product_import_staging', 'customer_import_staging']),
}).strict()

const promotionSchema = z.object({
  canonicalWrite: z.literal('cloud-agent-only'),
  requiresValidation: z.literal(true),
  requiresEvidence: z.literal(true),
}).strict()

export const documentIntakeContractSchema = z.object({
  contractVersion: z.literal(DOCUMENT_INTAKE_CONTRACT_VERSION),
  document: documentSchema,
  domain: z.enum(DOCUMENT_INTAKE_DOMAINS),
  language: z.literal('th-TH'),
  pipelineRunId: z.string().regex(/^run_[A-Za-z0-9_-]+$/),
  extractionRunId: z.string().regex(/^extract_[A-Za-z0-9_-]+$/),
  extraction: extractionSchema,
  fields: z.array(fieldSchema).max(10_000),
  status: z.enum(CONTRACT_STATUSES),
  dataClassification: z.enum(['internal', 'restricted']),
  warnings: z.array(z.string().max(500)).max(100),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO date'),
  target: targetSchema,
  promotion: promotionSchema,
}).strict()

export class DocumentIntakeContractError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DocumentIntakeContractError'
    this.code = code
    this.details = details
    this.status = 422
  }
}

function isAbsoluteSourceRef(value) {
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)
}

function hasEvidenceLocation(evidence) {
  return evidence.page != null
    || Boolean(evidence.sheet)
    || Boolean(evidence.cell)
    || Boolean(evidence.bbox)
    || Boolean(evidence.anchor)
}

function issueDetails(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

function assertContractRules(contract) {
  if (isAbsoluteSourceRef(contract.document.sourceRef)) {
    throw new DocumentIntakeContractError(
      'SOURCE_REF_ABSOLUTE_PATH',
      'sourceRef must not contain an absolute local path',
    )
  }

  if (contract.document.documentId !== `doc_${contract.document.artifactSha256.slice(0, 32)}`) {
    throw new DocumentIntakeContractError(
      'DOCUMENT_ID_ARTIFACT_MISMATCH',
      'documentId must be derived from artifactSha256',
    )
  }

  if (!MIME_TYPES_BY_KIND[contract.document.kind]?.has(contract.document.mimeType)) {
    throw new DocumentIntakeContractError(
      'DOCUMENT_MIME_KIND_MISMATCH',
      'document kind and mimeType do not agree',
    )
  }

  if (contract.domain === 'customer' && contract.dataClassification !== 'restricted') {
    throw new DocumentIntakeContractError(
      'CUSTOMER_CLASSIFICATION_REQUIRED',
      'customer contracts must be restricted',
    )
  }

  const expectedTable = `${contract.domain}_import_staging`
  if (contract.target.table !== expectedTable) {
    throw new DocumentIntakeContractError(
      'STAGING_TABLE_DOMAIN_MISMATCH',
      'target staging table does not match the contract domain',
    )
  }

  const requiredMethods = new Set(contract.extraction.requiredMethods)
  if (contract.extraction.requiresVision) {
    for (const method of ['thai_ocr', 'vision_layout']) {
      if (!requiredMethods.has(method)) {
        throw new DocumentIntakeContractError(
          'VISION_METHODS_INCOMPLETE',
          'requiresVision contracts must declare Thai OCR and layout vision',
        )
      }
    }
  } else if (requiredMethods.size > 0) {
    throw new DocumentIntakeContractError(
      'VISION_METHODS_UNEXPECTED',
      'a non-vision contract must not declare required vision methods',
    )
  }

  if (contract.status === 'READY_FOR_VALIDATION' && contract.fields.length === 0) {
    throw new DocumentIntakeContractError(
      'READY_CONTRACT_HAS_NO_FIELDS',
      'READY_FOR_VALIDATION requires at least one extracted field',
    )
  }

  const allowed = new Set(DOCUMENT_FIELD_ALLOWLIST[contract.domain])
  for (const field of contract.fields) {
    if (!allowed.has(field.path)) {
      throw new DocumentIntakeContractError(
        'FIELD_NOT_ALLOWED',
        `field path is not allowed for ${contract.domain}: ${field.path}`,
        { path: field.path, domain: contract.domain },
      )
    }
    if (!hasEvidenceLocation(field.evidence)) {
      throw new DocumentIntakeContractError(
        'FIELD_EVIDENCE_REQUIRED',
        `field has no evidence location: ${field.path}`,
        { path: field.path },
      )
    }
  }
}

export function validateDocumentIntakeContract(input) {
  const parsed = documentIntakeContractSchema.safeParse(input)
  if (!parsed.success) {
    throw new DocumentIntakeContractError(
      'CONTRACT_SCHEMA_INVALID',
      'document intake contract validation failed',
      { issues: issueDetails(parsed.error) },
    )
  }
  assertContractRules(parsed.data)
  return parsed.data
}

export function summarizeDocumentIntakeContract(contract) {
  return {
    contractVersion: contract.contractVersion,
    domain: contract.domain,
    documentId: contract.document.documentId,
    artifactSha256: contract.document.artifactSha256,
    kind: contract.document.kind,
    status: contract.status,
    dataClassification: contract.dataClassification,
    pipelineRunId: contract.pipelineRunId,
    extractionRunId: contract.extractionRunId,
    requiresVision: contract.extraction.requiresVision,
    extractionMethods: contract.extraction.methods,
    fieldCount: contract.fields.length,
    evidenceChecked: contract.fields.every((field) => hasEvidenceLocation(field.evidence)),
  }
}
