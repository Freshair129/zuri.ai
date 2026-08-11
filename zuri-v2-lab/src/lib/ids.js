import { randomUUID } from 'crypto'

// @spec BR-002, SDD-003 — UUID PKs + human codes; external identifiers are never PKs
// @tested tests/unit/ids.test.js

export function newId() {
  return randomUUID()
}

/**
 * Normalize a name into a human code fragment: "Customer Data" -> "CUSTOMER-DATA".
 */
export function codeFragment(name, maxLen = 18) {
  return String(name)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toUpperCase()
    .slice(0, maxLen)
    .replace(/-+$/g, '') || 'X'
}

/**
 * Build a human code like `PRJ-CUSTOMER-DATA`.
 */
export function humanCode(prefix, name) {
  return `${prefix}-${codeFragment(name)}`
}

/**
 * Generate a unique human code, retrying with a numeric suffix on collision.
 * `exists` is an async predicate (code) => boolean.
 */
export async function uniqueHumanCode(prefix, name, exists, maxAttempts = 50) {
  const base = humanCode(prefix, name)
  if (!(await exists(base))) return base
  for (let i = 2; i <= maxAttempts; i++) {
    const candidate = `${base}-${i}`
    if (!(await exists(candidate))) return candidate
  }
  // Last resort: uuid fragment guarantees uniqueness.
  return `${base}-${randomUUID().slice(0, 8).toUpperCase()}`
}

/**
 * Guard: external identifiers must never be used as internal primary keys.
 * Accepts only UUID v4-style internal ids.
 */
export function isInternalId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
}
