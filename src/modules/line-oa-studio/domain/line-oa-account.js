import { z } from 'zod'
import {
  LINE_OA_ACCOUNT_ACTIONS,
  LINE_OA_ACCOUNT_STATUSES,
  LINE_OA_TRANSPORT_MODES,
} from '@/lib/validation/enums'

// @req FR-146 — the pure vocabulary and rules of the LineOaAccount aggregate:
//   the input contracts, the stored status machine, the derived effective
//   status and the transport-mode default. Nothing here opens a database; the
//   service in application/ is the only writer and calls these.
// @spec ADR-060 D2, D3, D5, D11 — one Business per account, many accounts per
//   Business; LIVE is derived from the agent lane's binding and never stored;
//   transportMode is EDGE or CLOUD and defaults from an ACTIVE edge credential.
// @spec BR-002 — LINE identifiers (basic id, channel id, bot user id) are
//   attributes here, never keys.
// @tested tests/unit/line-oa-account-domain.test.js

export const LINE_OA_ACCOUNT_ENTITY = 'LINE_OA_ACCOUNT'
export const LINE_OA_DOMAIN_KEY = 'line-oa'

// Human code, unique per Tenant: lower-case kebab, like `oa-smartgift-main`.
// It is a label people type and read, so it is bounded and shaped; it is not
// the primary key and never derives from a LINE identifier.
const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const zLineOaAccountCode = z.string().trim().min(3).max(64)
  .regex(CODE_PATTERN, 'code must be lower-case letters, digits and single hyphens')

// LINE "basic id" (@handle) is presentation metadata, stored as typed.
const BASIC_ID_PATTERN = /^@[a-z0-9._-]{1,50}$/i

export const zBotProfile = z.object({
  greeting: z.string().trim().max(1000).optional(),
  fallbackText: z.string().trim().max(1000).optional(),
  personaLabel: z.string().trim().max(120).optional(),
}).strict()

export const zConnectLineOaAccount = z.object({
  businessId: z.string().trim().min(1).max(200),
  integrationConnectionId: z.string().trim().min(1).max(200),
  code: zLineOaAccountCode,
  displayName: z.string().trim().min(1).max(200),
  basicId: z.string().trim().regex(BASIC_ID_PATTERN, 'basicId must look like @handle').optional(),
  bindingCode: z.string().trim().min(1).max(200).optional(),
  transportMode: z.enum(LINE_OA_TRANSPORT_MODES).optional(),
  isDefaultForBusiness: z.boolean().optional(),
  botProfile: zBotProfile.optional(),
}).strict()

export const zLineOaAccountAction = z.object({
  action: z.enum(LINE_OA_ACCOUNT_ACTIONS),
  // Optimistic concurrency: the caller names the version it read. A stale
  // version is a conflict, never a silent last-writer-wins (ADR-060 D5, D11).
  version: z.number().int().positive(),
  transportMode: z.enum(LINE_OA_TRANSPORT_MODES).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'SWITCH_TRANSPORT_MODE' && !value.transportMode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transportMode'], message: 'transportMode is required for SWITCH_TRANSPORT_MODE' })
  }
})

/**
 * The stored status machine. `LIVE` is deliberately absent: it is derived by
 * `deriveEffectiveStatus` from the agent lane's binding and can never be set.
 */
// Archiving is allowed from every stored status except the terminal one — the
// set is derived from the enum rather than spelled out, so a status added to
// enums.js is archivable without anyone remembering this file.
const NON_TERMINAL_STATUSES = Object.freeze(LINE_OA_ACCOUNT_STATUSES.filter((status) => status !== 'ARCHIVED'))

export const STORED_STATUS_TRANSITIONS = Object.freeze({
  PAUSE: Object.freeze({ from: Object.freeze(['CONNECTED']), to: 'PAUSED' }),
  RESUME: Object.freeze({ from: Object.freeze(['PAUSED']), to: 'CONNECTED' }),
  ARCHIVE: Object.freeze({ from: NON_TERMINAL_STATUSES, to: 'ARCHIVED' }),
})

/**
 * The stored status to write for `action` from `current`, or `null` when the
 * transition is not defined — the caller turns `null` into a 409, never into a
 * guess.
 */
export function nextStoredStatus(current, action) {
  const transition = STORED_STATUS_TRANSITIONS[action]
  if (!transition || !LINE_OA_ACCOUNT_STATUSES.includes(current)) return null
  return transition.from.includes(current) ? transition.to : null
}

/**
 * A new account is CONNECTED when both references it needs exist — the LINE_OA
 * connection (always, it is required) and the agent binding code — and DRAFT
 * until the binding is known. It is never LIVE at creation: LIVE needs the
 * agent lane to report an ACTIVE binding (FR-052), which no client can assert.
 */
export function initialStoredStatus({ bindingCode } = {}) {
  return bindingCode ? 'CONNECTED' : 'DRAFT'
}

/**
 * What the account reads as, given what the agent lane says about its binding.
 * `bindingStatus` is one of ACTIVE | PENDING | INACTIVE | ROTATED from
 * `zuri_core.line_channel_binding`, or `null` when the read model is not wired
 * (the honest answer this slice gives — see the service's health sources).
 */
export function deriveEffectiveStatus(storedStatus, bindingStatus) {
  if (storedStatus === 'CONNECTED' && bindingStatus === 'ACTIVE') return 'LIVE'
  return storedStatus
}

/**
 * ADR-060 D3 / ADR-059 D5: a Business that holds an ACTIVE Zuri Edge Device
 * credential defaults to the EDGE transport; everyone else is cloud-served.
 * A publisher may override at connect time; afterwards only the audited switch.
 */
export function defaultTransportMode({ hasActiveEdgeCredential = false } = {}) {
  return hasActiveEdgeCredential ? 'EDGE' : 'CLOUD'
}

/** A stored presentation profile, or an empty one when the column cannot be trusted. */
export function parseBotProfile(json) {
  try {
    const parsed = JSON.parse(json || '{}')
    const result = zBotProfile.safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}
