import { z } from 'zod'
import {
  LINE_OA_RICH_MENU_ACTIONS,
  LINE_OA_RICH_MENU_LAYOUTS,
} from '@/lib/validation/enums'
import { zLineOaAccountCode } from './line-oa-account'

// @req FR-151 — the pure vocabulary and rules of the rich menu designer: the
//   input contracts, the LINE layout grid, the image-size and bounds
//   validation, and the freeze gate. Nothing here opens a database; the
//   service in application/ is the only writer and calls these.
// @spec ADR-060 D3 (rich menus are Studio-owned design data), D6 (a tap
//   action is an allow-listed vocabulary, never a URL the designer invents
//   and the runtime executes blindly); SRS LOS-RQ-040, LOS-RQ-041, LOS-RQ-016
// @spec BR-002 — the external richMenuId is an attribute of a version, never a key
// @tested tests/unit/line-oa-rich-menu-domain.test.js

export const LINE_OA_RICH_MENU_ENTITY = 'LINE_OA_RICH_MENU'
export const LINE_OA_RICH_MENU_VERSION_ENTITY = 'LINE_OA_RICH_MENU_VERSION'

/**
 * The image sizes LINE accepts for a rich menu (width × height, pixels): the
 * full and half heights at three widths. The designer validates every area
 * against the size the author declares, and a frozen version can only carry
 * one of these.
 */
export const RICH_MENU_IMAGE_SIZES = Object.freeze([
  Object.freeze({ width: 2500, height: 1686 }),
  Object.freeze({ width: 2500, height: 843 }),
  Object.freeze({ width: 1200, height: 810 }),
  Object.freeze({ width: 1200, height: 405 }),
  Object.freeze({ width: 800, height: 540 }),
  Object.freeze({ width: 800, height: 270 }),
])
export const RICH_MENU_MAX_AREAS = 20
export const RICH_MENU_CHAT_BAR_MAX = 14
export const RICH_MENU_IMAGE_MAX_BYTES = 1024 * 1024
export const RICH_MENU_IMAGE_MIMES = Object.freeze(['image/png', 'image/jpeg'])

/** `columns × rows` of each LINE layout, as the designer's starting grid. */
const LAYOUT_GRID = Object.freeze({
  '1x1': Object.freeze({ columns: 1, rows: 1 }),
  '2x1': Object.freeze({ columns: 2, rows: 1 }),
  '2x2': Object.freeze({ columns: 2, rows: 2 }),
  '2x3': Object.freeze({ columns: 3, rows: 2 }),
  '3x1': Object.freeze({ columns: 3, rows: 1 }),
  '1x2': Object.freeze({ columns: 1, rows: 2 }),
})

export const zBounds = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}).strict()

// One tap action. A discriminated union so an unknown `type` fails at the
// boundary and every variant carries only the fields LINE's object has: the
// designer never stores a free-form action object it cannot render.
export const zRichMenuAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MESSAGE'), label: z.string().trim().max(20).optional(), text: z.string().trim().min(1).max(300) }).strict(),
  z.object({ type: z.literal('POSTBACK'), label: z.string().trim().max(20).optional(), data: z.string().trim().min(1).max(300), displayText: z.string().trim().max(300).optional() }).strict(),
  z.object({ type: z.literal('URI'), label: z.string().trim().max(20).optional(), uri: z.string().trim().url().max(1000).refine((u) => /^https:\/\//i.test(u) || /^tel:/i.test(u), 'uri must be https:// or tel:') }).strict(),
  z.object({ type: z.literal('LIFF'), label: z.string().trim().max(20).optional(), liffAppCode: z.string().trim().min(1).max(200), path: z.string().trim().max(500).optional() }).strict(),
  z.object({ type: z.literal('RICHMENU_SWITCH'), label: z.string().trim().max(20).optional(), richMenuAlias: z.string().trim().min(1).max(32), data: z.string().trim().min(1).max(300) }).strict(),
])

export const zRichMenuArea = z.object({
  bounds: zBounds,
  action: zRichMenuAction,
}).strict()

export const zRichMenuDraft = z.object({
  layout: z.enum(LINE_OA_RICH_MENU_LAYOUTS),
  chatBarText: z.string().trim().min(1).max(RICH_MENU_CHAT_BAR_MAX),
  selected: z.boolean().optional(),
  imageFileAssetId: z.string().trim().min(1).max(200).nullable().optional(),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  areas: z.array(zRichMenuArea).max(RICH_MENU_MAX_AREAS),
}).strict()

const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const zRichMenuAlias = z.string().trim().min(1).max(32).regex(ALIAS_PATTERN, 'alias must be lower-case letters, digits and single hyphens')

export const zCreateRichMenu = z.object({
  accountId: z.string().trim().min(1).max(200),
  code: zLineOaAccountCode,
  name: z.string().trim().min(1).max(300),
  alias: zRichMenuAlias.optional(),
  draft: zRichMenuDraft,
}).strict()

export const zRichMenuActionInput = z.object({
  action: z.enum(LINE_OA_RICH_MENU_ACTIONS),
  // Optimistic concurrency on the menu row (ADR-060 D11 pattern, as FR-146).
  version: z.number().int().positive(),
  draft: zRichMenuDraft.optional(),
  name: z.string().trim().min(1).max(300).optional(),
  alias: zRichMenuAlias.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'SAVE_DRAFT' && !value.draft) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['draft'], message: 'draft is required for SAVE_DRAFT' })
  }
})

/**
 * The equal-cell grid of a LINE layout over an image of `width × height`:
 * the designer's starting areas, with the remainder pixels given to the last
 * column and row so the cells tile the image exactly. Pure; the author may
 * then move or resize any area, and `validateRichMenuDraft` checks the result.
 */
export function layoutAreas(layout, width, height) {
  const grid = LAYOUT_GRID[layout]
  if (!grid || !(width > 0) || !(height > 0)) return []
  const cellWidth = Math.floor(width / grid.columns)
  const cellHeight = Math.floor(height / grid.rows)
  const areas = []
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const last = { column: column === grid.columns - 1, row: row === grid.rows - 1 }
      areas.push({
        x: column * cellWidth,
        y: row * cellHeight,
        width: last.column ? width - column * cellWidth : cellWidth,
        height: last.row ? height - row * cellHeight : cellHeight,
      })
    }
  }
  return areas
}

export function isAllowedImageSize(width, height) {
  return RICH_MENU_IMAGE_SIZES.some((size) => size.width === width && size.height === height)
}

/**
 * Every reason a draft could not be deployed as it stands. An empty list is
 * a deployable body. Saving a draft tolerates issues (the author is mid-work);
 * freezing refuses them — that is the difference between the two actions.
 */
export function validateRichMenuDraft(draft) {
  const issues = []
  if (!isAllowedImageSize(draft.imageWidth, draft.imageHeight)) {
    issues.push({ code: 'IMAGE_SIZE_UNSUPPORTED', message: `image must be one of ${RICH_MENU_IMAGE_SIZES.map((s) => `${s.width}x${s.height}`).join(', ')}` })
  }
  if (!draft.areas?.length) issues.push({ code: 'NO_AREAS', message: 'a rich menu needs at least one tap area' })
  draft.areas?.forEach((area, index) => {
    const { x, y, width, height } = area.bounds
    if (x + width > draft.imageWidth || y + height > draft.imageHeight) {
      issues.push({ code: 'AREA_OUT_OF_BOUNDS', index, message: `area ${index} exceeds the ${draft.imageWidth}x${draft.imageHeight} image` })
    }
  })
  return issues
}

/** Why a draft may not be frozen right now — validation issues plus the image requirement. */
export function freezeBlockers(draft) {
  const issues = validateRichMenuDraft(draft)
  if (!draft.imageFileAssetId) issues.push({ code: 'IMAGE_REQUIRED', message: 'a frozen version needs its image FileAsset' })
  return issues
}

/** A stored areas column, or an empty list when the column cannot be trusted. */
export function parseAreas(json) {
  try {
    const parsed = JSON.parse(json || '[]')
    const result = z.array(zRichMenuArea).safeParse(parsed)
    return result.success ? result.data : []
  } catch {
    return []
  }
}
