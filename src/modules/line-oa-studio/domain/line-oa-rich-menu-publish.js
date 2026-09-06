import { parseAreas } from './line-oa-rich-menu'

// @req FR-152 — the pure translation of a frozen LineOaRichMenuVersion into
//   the object LINE's rich menu API accepts, and the rules of the publish job
//   that are decidable without a database: which kinds exist, which stage a
//   kind starts at, and how each kind treats an ambiguous provider outcome.
// @spec ADR-060 D6 (an allow-listed action vocabulary is translated, never
//   passed through); ADR-061 D7 (an ambiguous create is UNKNOWN, never a
//   retry that could duplicate; idempotent operations may retry)
// @tested tests/unit/line-oa-rich-menu-publish.test.js

export const LINE_OA_RICH_MENU_JOB_ENTITY = 'LINE_OA_RICH_MENU_JOB'
/** The job ledger's stored statuses; ACCEPTED is the provider's acceptance, never delivery. */
export const LINE_OA_RICH_MENU_JOB_STATUSES = Object.freeze(['QUEUED', 'CLAIMED', 'ACCEPTED', 'FAILED', 'UNKNOWN', 'CANCELLED'])
export const RICH_MENU_JOB_TTL_MS = 24 * 60 * 60_000
export const RICH_MENU_JOB_LEASE_MS = 120_000

/** The stage a kind begins at; PUBLISH walks CREATE → UPLOAD → DONE. */
export function initialStage(kind) {
  return kind === 'PUBLISH' ? 'CREATE' : 'APPLY'
}

/**
 * Translate one tap action. `LIFF` has no URL until the LIFF app registry
 * exists, so it is reported as unresolved rather than invented; the job fails
 * before any call is made.
 */
export function translateAction(action) {
  switch (action?.type) {
    case 'MESSAGE':
      return { ok: true, value: { type: 'message', ...(action.label ? { label: action.label } : {}), text: action.text } }
    case 'POSTBACK':
      return { ok: true, value: { type: 'postback', ...(action.label ? { label: action.label } : {}), data: action.data, ...(action.displayText ? { displayText: action.displayText } : {}) } }
    case 'URI':
      return { ok: true, value: { type: 'uri', ...(action.label ? { label: action.label } : {}), uri: action.uri } }
    case 'RICHMENU_SWITCH':
      return { ok: true, value: { type: 'richmenuswitch', ...(action.label ? { label: action.label } : {}), richMenuAliasId: action.richMenuAlias, data: action.data } }
    case 'LIFF':
      return { ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' }
    default:
      return { ok: false, code: 'LINE_OA_RICH_MENU_ACTION_UNKNOWN' }
  }
}

/**
 * The LINE rich menu object for a version, or the first reason it cannot be
 * built. `name` is the menu's name; `selected` and `chatBarText` come from
 * the version; every area is translated through the allow-list.
 */
export function buildLineRichMenuObject({ menu, version }) {
  const areas = Array.isArray(version?.areas) ? version.areas : parseAreas(version?.areasJson)
  if (!areas.length) return { ok: false, code: 'LINE_OA_RICH_MENU_NO_AREAS' }
  const translated = []
  for (const area of areas) {
    const action = translateAction(area.action)
    if (!action.ok) return { ok: false, code: action.code }
    translated.push({ bounds: area.bounds, action: action.value })
  }
  return {
    ok: true,
    value: {
      size: { width: version.imageWidth, height: version.imageHeight },
      selected: version.selected === true,
      name: String(menu.name).slice(0, 300),
      chatBarText: version.chatBarText,
      areas: translated,
    },
  }
}

/**
 * What a provider outcome means for a job, by the operation's idempotency:
 * - create (PUBLISH/CREATE): UNCONFIRMED → UNKNOWN (a menu may exist on LINE)
 * - upload / setDefault / setAlias: UNCONFIRMED and RETRYABLE → back to QUEUED
 * - PERMANENT → FAILED; ACCEPTED → advance
 */
export function settleOutcome({ stage, result }) {
  if (result.status === 'ACCEPTED_BY_LINE') return 'ACCEPTED'
  if (result.status === 'PERMANENT_FAILURE') return 'FAILED'
  if (stage === 'CREATE') return 'UNKNOWN'
  return 'RETRY'
}

/** Exponential backoff, capped at one minute, from the attempt count. */
export function retryDelayMs(attempts) {
  return Math.min(60_000, 1000 * 2 ** Math.min(Math.max(attempts, 0), 6))
}
