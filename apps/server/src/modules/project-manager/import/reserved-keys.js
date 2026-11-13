export const LEGACY_PLAN_REPLAY_KEY_PREFIX = 'zai-legacy-plan:'
export const RESERVED_PLAN_IMPORT_KEY_MESSAGE = `trace.idempotencyKey uses the reserved prefix ${LEGACY_PLAN_REPLAY_KEY_PREFIX}`

export function isReservedPlanImportIdempotencyKey(value) {
  return typeof value === 'string' && value.startsWith(LEGACY_PLAN_REPLAY_KEY_PREFIX)
}
