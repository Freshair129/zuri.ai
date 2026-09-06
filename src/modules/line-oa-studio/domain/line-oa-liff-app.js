import { z } from 'zod'
import {
  LINE_OA_LIFF_APP_ACTIONS,
  LINE_OA_LIFF_BOT_PROMPTS,
  LINE_OA_LIFF_SCOPES,
  LINE_OA_LIFF_VIEW_SIZES,
} from '@/lib/validation/enums'
import { zLineOaAccountCode } from './line-oa-account'

// @req FR-153 — the pure vocabulary and rules of the LIFF app registry: the
//   input contracts, the stored status machine, the shape of a LINE liffId,
//   and the one resolution the rest of the Studio needs — a registered app's
//   code to the https://liff.line.me URL a rich menu or flow may open.
// @spec SRS LOS-RQ-070 (an account registers LIFF apps; the liffId is an
//   external reference); BR-002 (liffId is an attribute, never a key);
//   ADR-060 D6 (a LIFF tap action names a registered app, never a raw URL)
// @tested tests/unit/line-oa-liff-app-domain.test.js

export const LINE_OA_LIFF_APP_ENTITY = 'LINE_OA_LIFF_APP'
/** Stored statuses; ACTIVE means a liffId is recorded and the app may be resolved. */
export const LINE_OA_LIFF_APP_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'ARCHIVED'])
export const LIFF_BASE_URL = 'https://liff.line.me'

// A LIFF id as LINE Developers issues it: ten digits, a hyphen, eight
// alphanumerics. It is validated as a shape, never looked up.
export const LIFF_ID_PATTERN = /^\d{10}-[A-Za-z0-9]{8}$/
export const zLiffId = z.string().trim().regex(LIFF_ID_PATTERN, 'liffId must look like 1234567890-AbCdEfGh')

const zEndpointUrl = z.string().trim().url().max(1000).refine((u) => /^https:\/\//i.test(u), 'endpointUrl must be https://')
const zScopes = z.array(z.enum(LINE_OA_LIFF_SCOPES)).max(LINE_OA_LIFF_SCOPES.length)
  .refine((list) => new Set(list).size === list.length, 'scopes must not repeat')

export const zLiffAppFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  viewSize: z.enum(LINE_OA_LIFF_VIEW_SIZES).optional(),
  endpointUrl: zEndpointUrl,
  scopes: zScopes.optional(),
  botPrompt: z.enum(LINE_OA_LIFF_BOT_PROMPTS).optional(),
}).strict()

export const zRegisterLiffApp = zLiffAppFields.extend({
  accountId: z.string().trim().min(1).max(200),
  code: zLineOaAccountCode,
  liffId: zLiffId.optional(),
}).strict()

export const zLiffAppAction = z.object({
  action: z.enum(LINE_OA_LIFF_APP_ACTIONS),
  version: z.number().int().positive(),
  fields: zLiffAppFields.partial().strict().optional(),
  liffId: zLiffId.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'UPDATE' && (!value.fields || Object.keys(value.fields).length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields is required for UPDATE' })
  }
  if (value.action === 'RECORD_LIFF_ID' && !value.liffId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['liffId'], message: 'liffId is required for RECORD_LIFF_ID' })
  }
})

/** A new registration is ACTIVE only when its liffId is known; otherwise DRAFT. */
export function initialLiffStatus({ liffId } = {}) {
  return liffId ? 'ACTIVE' : 'DRAFT'
}

/** The URL LINE opens for a LIFF app, with an optional path/query appended. */
export function liffUrl(liffId, path = '') {
  const suffix = typeof path === 'string' && path ? (path.startsWith('/') || path.startsWith('?') ? path : `/${path}`) : ''
  return `${LIFF_BASE_URL}/${liffId}${suffix}`
}

/**
 * Resolve a rich menu / flow LIFF action against an account's registry. Only
 * an ACTIVE app with a recorded liffId resolves; anything else is reported by
 * code so the caller refuses rather than invents a link.
 */
export function resolveLiffAction(action, liffApps = []) {
  if (action?.type !== 'LIFF') return { ok: false, code: 'LINE_OA_LIFF_ACTION_INVALID' }
  const app = liffApps.find((row) => row.code === action.liffAppCode)
  if (!app) return { ok: false, code: 'LINE_OA_RICH_MENU_LIFF_UNRESOLVED' }
  if (app.status !== 'ACTIVE' || !app.externalLiffId) return { ok: false, code: 'LINE_OA_RICH_MENU_LIFF_NOT_ACTIVE' }
  return { ok: true, uri: liffUrl(app.externalLiffId, action.path), app }
}

/** A stored scopes column, or an empty list when the column cannot be trusted. */
export function parseScopes(json) {
  try {
    const result = zScopes.safeParse(JSON.parse(json || '[]'))
    return result.success ? result.data : []
  } catch {
    return []
  }
}
