import { randomUUID } from 'crypto'

// @spec BR-002, SDD-003 — UUID PKs + human codes; retry generated-code unique-index races
// @tested tests/unit/ids.test.js, tests/integration/code-allocation-retry.test.js

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
 * Choose an available human-code candidate; the database unique index enforces
 * uniqueness, and create flows should use retryOnCodeConflict to choose again
 * if another writer wins after this check. `exists` is an async predicate.
 */
export async function uniqueHumanCode(prefix, name, exists, maxAttempts = 50) {
  const base = humanCode(prefix, name)
  if (!(await exists(base))) return base
  for (let i = 2; i <= maxAttempts; i++) {
    const candidate = `${base}-${i}`
    if (!(await exists(candidate))) return candidate
  }
  // Last resort: an eight-hex UUID fragment makes a collision unlikely, not impossible.
  return `${base}-${randomUUID().slice(0, 8).toUpperCase()}`
}

/**
 * Whether a Prisma unique violation positively identifies a generated human-code column.
 * A targetless P2002 is not specific enough to retry safely and surfaces unchanged.
 */
export function isCodeConflict(error) {
  if (error?.code !== 'P2002') return false
  const target = error.meta?.target
  if (target == null) return false
  const targets = Array.isArray(target) ? target : [target]
  return targets.some((name) => typeof name === 'string' && /(^|_)(asset)?code(_|$)/i.test(name))
}

/** Retry the whole read-and-insert attempt after a unique human-code collision. */
export async function retryOnCodeConflict(
  attempt,
  { attempts = 5, exhausted, shouldRetry = () => true } = {},
) {
  if (typeof attempt !== 'function') throw new TypeError('attempt must be a function')
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts must be a positive integer')
  if (typeof shouldRetry !== 'function') throw new TypeError('shouldRetry must be a function')

  let lastError
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      return await attempt(attemptNumber)
    } catch (error) {
      if (!isCodeConflict(error) || !shouldRetry(error, attemptNumber)) throw error
      lastError = error
    }
  }

  if (exhausted !== undefined) {
    const error = exhausted(lastError)
    if (!(error instanceof Error)) throw new TypeError('exhausted must return an Error')
    throw error
  }

  throw Object.assign(new Error('CODE_ALLOCATION_EXHAUSTED'), { status: 409 })
}

/**
 * Guard: external identifiers must never be used as internal primary keys.
 * Accepts only UUID v4-style internal ids.
 */
export function isInternalId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
}
