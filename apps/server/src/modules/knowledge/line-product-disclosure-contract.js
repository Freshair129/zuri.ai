import { createHash } from 'node:crypto'
import { DISCLOSURE_FIELDS, DISCLOSURE_FIELD_LABELS } from './line-product-disclosure-fields'
export { DISCLOSURE_FIELDS, DISCLOSURE_FIELD_LABELS } from './line-product-disclosure-fields'

// @req FR-079, FR-235 — only explicitly selected public ProductMaster fields
// can become opaque model facts and fixed-label customer output.
// @spec SEC-032 — model output selects server-owned fact IDs and never supplies
// customer-facing prose or values.
// @tested tests/unit/line-product-disclosure-contract.test.js

const ALLOWED_FIELDS = new Set(DISCLOSURE_FIELDS)
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u
const MAX_TEXT_LENGTH = 500
const MAX_FACTS = DISCLOSURE_FIELDS.length

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function assertPublicText(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TEXT_LENGTH
    || value.trim() !== value || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError('LINE_PRODUCT_DISCLOSURE_VALUE_INVALID')
  }
  return value
}

function assertPublicValue(field, value) {
  if (!ALLOWED_FIELDS.has(field)) throw new TypeError('LINE_PRODUCT_DISCLOSURE_FIELD_INVALID')
  if (value === null) return null
  if (['sku', 'nameTh', 'nameEn', 'unit', 'category', 'productFamily'].includes(field)) {
    return assertPublicText(value)
  }
  if (field === 'dimensionsCm') {
    if (!exactKeys(value, ['height', 'length', 'width'])
      || ['height', 'length', 'width'].some((key) => typeof value[key] !== 'number'
        || !Number.isFinite(value[key]) || value[key] < 0)) {
      throw new TypeError('LINE_PRODUCT_DISCLOSURE_VALUE_INVALID')
    }
    return { height: value.height, length: value.length, width: value.width }
  }
  if (field === 'unitWeightKg' && typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  throw new TypeError('LINE_PRODUCT_DISCLOSURE_VALUE_INVALID')
}

/** Hash a public alias using the policy lookup normalization without storing its text. */
export function disclosureLookupHash(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError('LINE_PRODUCT_DISCLOSURE_LOOKUP_INVALID')
  }
  const normalized = value.trim().normalize('NFC').toUpperCase()
  if (!normalized || normalized.length > MAX_TEXT_LENGTH || CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError('LINE_PRODUCT_DISCLOSURE_LOOKUP_INVALID')
  }
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/** Convert selected, typed server values into the only facts the model may select. */
export function projectDisclosureFacts(values) {
  if (!Array.isArray(values) || values.length > MAX_FACTS) {
    throw new TypeError('LINE_PRODUCT_DISCLOSURE_VALUES_INVALID')
  }
  const byField = new Map()
  for (const row of values) {
    if (!exactKeys(row, ['field', 'value']) || !ALLOWED_FIELDS.has(row.field) || byField.has(row.field)) {
      throw new TypeError('LINE_PRODUCT_DISCLOSURE_VALUES_INVALID')
    }
    byField.set(row.field, assertPublicValue(row.field, row.value))
  }
  const facts = []
  for (const field of DISCLOSURE_FIELDS) {
    if (!byField.has(field) || byField.get(field) === null) continue
    facts.push({ id: `f${facts.length + 1}`, field, label: DISCLOSURE_FIELD_LABELS[field], value: byField.get(field) })
  }
  return facts
}

function renderValue(field, value) {
  const checked = assertPublicValue(field, value)
  if (field === 'dimensionsCm') {
    return `height ${checked.height} cm, length ${checked.length} cm, width ${checked.width} cm`
  }
  if (field === 'unitWeightKg') return `${checked} kg`
  return checked
}

/** Render only the selected opaque IDs, in fixed server field order. Invalid or empty selection is silent. */
export function renderDisclosureFacts(facts, factIds) {
  if (!Array.isArray(facts) || facts.length === 0 || facts.length > MAX_FACTS
    || !Array.isArray(factIds) || factIds.length === 0 || factIds.length > MAX_FACTS) return ''

  const byId = new Map()
  const seenFields = new Set()
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]
    if (!exactKeys(fact, ['id', 'field', 'label', 'value'])
      || fact.id !== `f${index + 1}` || !ALLOWED_FIELDS.has(fact.field)
      || fact.label !== DISCLOSURE_FIELD_LABELS[fact.field] || seenFields.has(fact.field)) return ''
    try { assertPublicValue(fact.field, fact.value) } catch { return '' }
    seenFields.add(fact.field)
    byId.set(fact.id, fact)
  }

  const selected = new Set()
  for (const id of factIds) {
    if (typeof id !== 'string' || selected.has(id) || !byId.has(id)) return ''
    selected.add(id)
  }
  return DISCLOSURE_FIELDS
    .map((field) => [...selected].map((id) => byId.get(id)).find((fact) => fact.field === field))
    .filter(Boolean)
    .map((fact) => `${fact.label}: ${renderValue(fact.field, fact.value)}`)
    .join('\n')
}
