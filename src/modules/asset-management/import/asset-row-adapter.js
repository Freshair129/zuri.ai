// @req FR-139 — every spreadsheet row converges on AssetIntakeEnvelope.
// @spec SDD-083, NFR-022, ADR-056
// @tested tests/unit/asset-intake-adapters-contract.test.js

function text(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text).join('')
    if (value.result != null) return String(value.result)
    if (value.text != null) return String(value.text)
  }
  return String(value).trim()
}

function optional(value) {
  const result = text(value)
  return result || undefined
}

function bool(value) {
  const normalized = text(value).toUpperCase()
  if (['TRUE', 'YES', '1', 'Y'].includes(normalized)) return true
  if (['FALSE', 'NO', '0', 'N', ''].includes(normalized)) return false
  return value
}

function quantity(value) {
  const result = Number(text(value))
  return Number.isFinite(result) ? result : value
}

export function assetRowToEnvelope(row, {
  businessId,
  channel,
  evidenceRows = [],
  procurementRows = [],
} = {}) {
  const correlationId = text(row.correlationId)
  const inlineEvidence = optional(row.paymentFileAssetId)
    ? [{ fileAssetId: text(row.paymentFileAssetId), role: 'PAYMENT_PROOF', paymentReference: optional(row.paymentReference) }]
    : []
  const inlineRefs = [
    optional(row.prValue) ? { type: 'PR', system: optional(row.prSystem) || 'ERP', value: text(row.prValue), lineValue: optional(row.prLineValue) } : null,
    optional(row.poValue) ? { type: 'PO', system: optional(row.poSystem) || 'ERP', value: text(row.poValue), lineValue: optional(row.poLineValue) } : null,
  ].filter(Boolean)
  const lotId = optional(row.lotId)
  const expiresOn = optional(row.expiresOn)
  const acquisitionAmount = optional(row.acquisitionAmount)

  return {
    schemaVersion: '1.0',
    source: { channel, correlationId },
    businessId,
    origin: text(row.origin),
    item: {
      name: text(row.name),
      categoryCode: text(row.categoryCode),
      quantity: quantity(row.quantity),
      expiryControlled: bool(row.expiryControlled),
      description: optional(row.description),
      brand: optional(row.brand),
      model: optional(row.model),
      serialNumber: optional(row.serialNumber),
    },
    evidence: [...evidenceRows, ...inlineEvidence].map((item) => ({
      fileAssetId: text(item.fileAssetId), role: text(item.role), paymentReference: optional(item.paymentReference),
    })),
    procurementRefs: [...procurementRows, ...inlineRefs].map((item) => ({
      type: text(item.type), system: text(item.system), value: text(item.value), lineValue: optional(item.lineValue),
    })),
    lot: lotId || expiresOn ? { lotId: lotId || '', manufacturedOn: optional(row.manufacturedOn), expiresOn: expiresOn || '' } : null,
    responsibilities: [],
    location: optional(row.locationCode) ? {
      branchId: optional(row.branchId),
      locationCode: text(row.locationCode),
      locationName: optional(row.locationName) || text(row.locationCode),
      effectiveFrom: optional(row.locationEffectiveFrom),
    } : null,
    projectAllocation: optional(row.projectId) ? {
      projectId: text(row.projectId),
      workstreamId: optional(row.workstreamId),
      projectBusinessId: optional(row.projectBusinessId) || businessId,
      exclusive: bool(row.projectExclusive === undefined ? 'TRUE' : row.projectExclusive),
      quantity: quantity(row.projectQuantity || 1),
      effectiveFrom: optional(row.projectEffectiveFrom) || '',
      effectiveTo: optional(row.projectEffectiveTo),
    } : null,
    depreciation: acquisitionAmount ? {
      method: 'STRAIGHT_LINE',
      acquisitionAmount,
      residualValue: optional(row.residualValue) || '0',
      usefulLifeMonths: quantity(row.usefulLifeMonths),
      startDate: text(row.depreciationStartDate),
      currency: optional(row.currency) || 'THB',
    } : null,
  }
}

export { text as assetCellText }
