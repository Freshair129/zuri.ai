// @req FR-151 — the pure rules of the rich menu designer, proven without a
//   database: the input contracts, the layout grid, image-size and bounds
//   validation, and the freeze gate.
// @spec ADR-060 D3, D6; SRS LOS-RQ-040, LOS-RQ-041
// @tested tests/unit/line-oa-rich-menu-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  RICH_MENU_IMAGE_SIZES,
  RICH_MENU_MAX_AREAS,
  freezeBlockers,
  isAllowedImageSize,
  layoutAreas,
  parseAreas,
  validateRichMenuDraft,
  zCreateRichMenu,
  zRichMenuAction,
  zRichMenuActionInput,
  zRichMenuDraft,
} from '@/modules/line-oa-studio/domain/line-oa-rich-menu'
import { LINE_OA_RICH_MENU_ACTION_TYPES, LINE_OA_RICH_MENU_LAYOUTS } from '@/lib/validation/enums'

const area = (x, y, width, height, action = { type: 'MESSAGE', text: 'hi' }) => ({ bounds: { x, y, width, height }, action })
const goodDraft = () => ({
  layout: '2x1', chatBarText: 'เมนู', imageFileAssetId: 'file-1', imageWidth: 2500, imageHeight: 843,
  areas: [area(0, 0, 1250, 843), area(1250, 0, 1250, 843, { type: 'URI', uri: 'https://example.com' })],
})

describe('FR-151 rich menu domain rules', () => {
  it('tiles every LINE layout exactly over the image, remainder to the last column and row', () => {
    for (const layout of LINE_OA_RICH_MENU_LAYOUTS) {
      for (const size of RICH_MENU_IMAGE_SIZES) {
        const areas = layoutAreas(layout, size.width, size.height)
        const [columns, rows] = layout === '2x3' ? [3, 2] : layout.split('x').map(Number)
        expect(areas).toHaveLength(columns * rows)
        const covered = areas.reduce((sum, a) => sum + a.width * a.height, 0)
        expect(covered).toBe(size.width * size.height)
        for (const a of areas) {
          expect(a.x + a.width).toBeLessThanOrEqual(size.width)
          expect(a.y + a.height).toBeLessThanOrEqual(size.height)
        }
      }
    }
    expect(layoutAreas('9x9', 2500, 843)).toEqual([])
  })

  it('accepts only the six LINE image sizes', () => {
    expect(isAllowedImageSize(2500, 1686)).toBe(true)
    expect(isAllowedImageSize(800, 270)).toBe(true)
    expect(isAllowedImageSize(2500, 1000)).toBe(false)
    const issues = validateRichMenuDraft({ ...goodDraft(), imageWidth: 2500, imageHeight: 1000 })
    expect(issues.map((i) => i.code)).toContain('IMAGE_SIZE_UNSUPPORTED')
  })

  it('reports an area that leaves the image, by index', () => {
    const draft = goodDraft()
    draft.areas[1] = area(1250, 0, 1300, 843)
    const issues = validateRichMenuDraft(draft)
    expect(issues).toEqual([{ code: 'AREA_OUT_OF_BOUNDS', index: 1, message: expect.stringContaining('area 1') }])
    expect(validateRichMenuDraft(goodDraft())).toEqual([])
  })

  it('freezes only a valid draft that names its image', () => {
    expect(freezeBlockers(goodDraft())).toEqual([])
    expect(freezeBlockers({ ...goodDraft(), imageFileAssetId: null }).map((i) => i.code)).toEqual(['IMAGE_REQUIRED'])
    expect(freezeBlockers({ ...goodDraft(), areas: [] }).map((i) => i.code)).toEqual(['NO_AREAS'])
  })

  it('bounds the draft: chat-bar text, area count, image dimensions, strict keys', () => {
    expect(zRichMenuDraft.safeParse(goodDraft()).success).toBe(true)
    expect(zRichMenuDraft.safeParse({ ...goodDraft(), chatBarText: 'x'.repeat(15) }).success).toBe(false)
    expect(zRichMenuDraft.safeParse({ ...goodDraft(), areas: Array.from({ length: RICH_MENU_MAX_AREAS + 1 }, () => area(0, 0, 1, 1)) }).success).toBe(false)
    expect(zRichMenuDraft.safeParse({ ...goodDraft(), imageWidth: 0 }).success).toBe(false)
    expect(zRichMenuDraft.safeParse({ ...goodDraft(), status: 'PUBLISHED' }).success).toBe(false)
  })

  it('allow-lists tap actions and their fields — no free-form action rides in', () => {
    expect(zRichMenuAction.safeParse({ type: 'MESSAGE', text: 'สวัสดี' }).success).toBe(true)
    expect(zRichMenuAction.safeParse({ type: 'POSTBACK', data: 'action=buy', displayText: 'ซื้อ' }).success).toBe(true)
    expect(zRichMenuAction.safeParse({ type: 'URI', uri: 'https://shop.example' }).success).toBe(true)
    expect(zRichMenuAction.safeParse({ type: 'URI', uri: 'http://shop.example' }).success).toBe(false)
    expect(zRichMenuAction.safeParse({ type: 'URI', uri: 'javascript:alert(1)' }).success).toBe(false)
    expect(zRichMenuAction.safeParse({ type: 'LIFF', liffAppCode: 'liff-shop' }).success).toBe(true)
    expect(zRichMenuAction.safeParse({ type: 'RICHMENU_SWITCH', richMenuAlias: 'menu-b', data: 'switch' }).success).toBe(true)
    expect(zRichMenuAction.safeParse({ type: 'DATETIMEPICKER', data: 'x' }).success).toBe(false)
    expect(zRichMenuAction.safeParse({ type: 'MESSAGE', text: 'hi', uri: 'https://x' }).success).toBe(false)
    for (const type of LINE_OA_RICH_MENU_ACTION_TYPES) expect(zRichMenuAction.options.map((o) => o.shape.type.value)).toContain(type)
  })

  it('shapes create and action inputs', () => {
    expect(zCreateRichMenu.safeParse({ accountId: 'a', code: 'main-menu', name: 'Main', alias: 'main', draft: goodDraft() }).success).toBe(true)
    expect(zCreateRichMenu.safeParse({ accountId: 'a', code: 'Main Menu', name: 'Main', draft: goodDraft() }).success).toBe(false)
    expect(zRichMenuActionInput.safeParse({ action: 'FREEZE', version: 1 }).success).toBe(true)
    expect(zRichMenuActionInput.safeParse({ action: 'SAVE_DRAFT', version: 1 }).success).toBe(false)
    expect(zRichMenuActionInput.safeParse({ action: 'SAVE_DRAFT', version: 1, draft: goodDraft() }).success).toBe(true)
    expect(zRichMenuActionInput.safeParse({ action: 'PUBLISH', version: 1 }).success).toBe(false)
  })

  it('reads a stored areas column defensively', () => {
    expect(parseAreas(JSON.stringify(goodDraft().areas))).toHaveLength(2)
    expect(parseAreas('not json')).toEqual([])
    expect(parseAreas(JSON.stringify([{ bounds: { x: 0 }, action: {} }]))).toEqual([])
  })
})
